const VideoCall = require('../models/VideoCall');
const Chat = require('../models/Chat');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { validationResult } = require('express-validator');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

// WebRTC configuration
const WEBRTC_CONFIG = {
  iceServers: [
    {
      urls: process.env.STUN_SERVERS || 'stun:stun.l.google.com:19302'
    },
    {
      urls: process.env.TURN_SERVERS || 'turn:numb.viagenie.ca',
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_PASSWORD
    }
  ]
};

class VideoCallController {
  // ===============================
  // VIDEO CALL MANAGEMENT
  // ===============================

  // Create new video call
  createVideoCall = catchAsync(async (req, res) => {
    const { participants, type = 'video', context, settings } = req.body;

    // Validate participants
    if (!participants || !Array.isArray(participants) || participants.length === 0) {
      throw new AppError('Participants are required', 400, true, 'INVALID_PARTICIPANTS');
    }

    // Check if user is trying to call themselves
    if (participants.length === 1 && participants[0].toString() === req.user.id) {
      throw new AppError('Cannot create call with only yourself', 400, true, 'INVALID_CALL');
    }

    // Generate unique call ID
    const callId = await VideoCall.generateCallId();

    // Create video call
    const videoCall = new VideoCall({
      callId,
      participants: [
        {
          user: req.user.id,
          role: 'initiator',
          joinedAt: new Date(),
          status: 'connected'
        },
        ...participants.map(participantId => ({
          user: participantId,
          role: 'participant',
          status: 'waiting'
        }))
      ],
      initiator: req.user.id,
      type,
      context,
      settings: {
        maxParticipants: settings?.maxParticipants || 10,
        isRecording: settings?.isRecording || false,
        quality: settings?.quality || 'auto',
        features: {
          screenShare: settings?.features?.screenShare ?? true,
          chat: settings?.features?.chat ?? true,
          recording: settings?.features?.recording ?? false,
          fileShare: settings?.features?.fileShare ?? true,
          ...settings?.features
        },
        ...settings
      },
      technical: {
        webrtcConfig: WEBRTC_CONFIG
      },
      createdBy: req.user.id
    });

    await videoCall.save();

    // Populate participant details
    await videoCall.populate('participants.user', 'firstName lastName avatar role');

    // Send call invitations to participants
    await this.sendCallInvitations(videoCall, req.user.id);

    // Add call event
    await videoCall.addEvent('call_created', req.user.id);

    logger.info('Video call created', {
      callId: videoCall.callId,
      initiatorId: req.user.id,
      type,
      participantCount: participants.length + 1
    });

    res.status(201).json({
      success: true,
      message: 'Video call created successfully',
      data: {
        call: videoCall.getCallSummary(),
        webrtcConfig: WEBRTC_CONFIG,
        participants: videoCall.participants
      }
    });
  });

  // Get video call details
  getVideoCall = catchAsync(async (req, res) => {
    const { callId } = req.params;

    const videoCall = await VideoCall.findOne({ callId })
      .populate('participants.user', 'firstName lastName avatar role isOnline')
      .populate('initiator', 'firstName lastName avatar')
      .populate('context.conversation', 'title type')
      .populate('context.order', 'orderNumber')
      .populate('context.product', 'name')
      .populate('context.store', 'name');

    if (!videoCall) {
      throw new AppError('Video call not found', 404, true, 'CALL_NOT_FOUND');
    }

    // Check if user is participant
    const isParticipant = videoCall.participants.some(p => p.user._id.toString() === req.user.id);

    if (!isParticipant && req.user.role !== 'admin') {
      throw new AppError('Not authorized to view this call', 403, true, 'NOT_AUTHORIZED');
    }

    res.status(200).json({
      success: true,
      data: {
        call: videoCall,
        webrtcConfig: WEBRTC_CONFIG,
        isParticipant: isParticipant,
        currentUser: videoCall.participants.find(p => p.user._id.toString() === req.user.id)
      }
    });
  });

  // Join video call
  joinVideoCall = catchAsync(async (req, res) => {
    const { callId } = req.params;
    const { audioEnabled = true, videoEnabled = true } = req.body;

    const videoCall = await VideoCall.findOne({ callId });

    if (!videoCall) {
      throw new AppError('Video call not found', 404, true, 'CALL_NOT_FOUND');
    }

    // Check if call is active or pending
    if (!['pending', 'active'].includes(videoCall.status)) {
      throw new AppError('Call is not available to join', 400, true, 'CALL_NOT_AVAILABLE');
    }

    // Check if user is already a participant
    const existingParticipant = videoCall.participants.find(p => p.user.toString() === req.user.id);

    if (existingParticipant) {
      // Update participant status
      existingParticipant.status = 'connected';
      existingParticipant.joinedAt = new Date();
      existingParticipant.isMuted = !audioEnabled;
      existingParticipant.isVideoEnabled = videoEnabled;
    } else {
      // Add new participant
      await videoCall.addParticipant(req.user.id, 'participant');
    }

    // Start call if it's pending
    if (videoCall.status === 'pending') {
      await videoCall.startCall();
    }

    // Update participant settings
    const participant = videoCall.participants.find(p => p.user.toString() === req.user.id);
    if (participant) {
      participant.isMuted = !audioEnabled;
      participant.isVideoEnabled = videoEnabled;
    }

    await videoCall.save();

    // Send real-time notification
    const io = req.app.get('io');
    if (io) {
      io.to(callId).emit('participant_joined', {
        callId,
        participant: {
          user: participant.user,
          role: participant.role,
          joinedAt: participant.joinedAt,
          isMuted: participant.isMuted,
          isVideoEnabled: participant.isVideoEnabled
        }
      });
    }

    logger.info('User joined video call', {
      callId,
      userId: req.user.id,
      audioEnabled,
      videoEnabled
    });

    res.status(200).json({
      success: true,
      message: 'Joined call successfully',
      data: {
        call: videoCall.getCallSummary(),
        participant: participant,
        webrtcConfig: WEBRTC_CONFIG
      }
    });
  });

  // Leave video call
  leaveVideoCall = catchAsync(async (req, res) => {
    const { callId } = req.params;

    const videoCall = await VideoCall.findOne({ callId });

    if (!videoCall) {
      throw new AppError('Video call not found', 404, true, 'CALL_NOT_FOUND');
    }

    // Remove participant
    await videoCall.removeParticipant(req.user.id);

    // End call if no participants left
    const remainingParticipants = videoCall.participants.filter(p => p.status === 'connected');

    if (remainingParticipants.length === 0) {
      await videoCall.endCall();
    }

    // Send real-time notification
    const io = req.app.get('io');
    if (io) {
      io.to(callId).emit('participant_left', {
        callId,
        userId: req.user.id,
        remainingParticipants: remainingParticipants.length
      });
    }

    logger.info('User left video call', {
      callId,
      userId: req.user.id,
      remainingParticipants: remainingParticipants.length
    });

    res.status(200).json({
      success: true,
      message: 'Left call successfully',
      data: {
        callEnded: videoCall.status === 'ended',
        remainingParticipants: remainingParticipants.length
      }
    });
  });

  // End video call
  endVideoCall = catchAsync(async (req, res) => {
    const { callId } = req.params;

    const videoCall = await VideoCall.findOne({ callId });

    if (!videoCall) {
      throw new AppError('Video call not found', 404, true, 'CALL_NOT_FOUND');
    }

    // Check permissions
    const isInitiator = videoCall.initiator.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isInitiator && !isAdmin) {
      throw new AppError('Not authorized to end this call', 403, true, 'NOT_AUTHORIZED');
    }

    await videoCall.endCall();

    // Notify all participants
    const io = req.app.get('io');
    if (io) {
      io.to(callId).emit('call_ended', {
        callId,
        endedBy: req.user.id,
        endTime: videoCall.endTime
      });
    }

    // Send notifications to participants
    await this.sendCallEndedNotifications(videoCall, req.user.id);

    logger.info('Video call ended', {
      callId,
      endedBy: req.user.id,
      duration: videoCall.duration
    });

    res.status(200).json({
      success: true,
      message: 'Call ended successfully',
      data: {
        call: videoCall.getCallSummary()
      }
    });
  });

  // ===============================
  // CALL PARTICIPANT MANAGEMENT
  // ===============================

  // Mute/unmute participant
  toggleMute = catchAsync(async (req, res) => {
    const { callId } = req.params;
    const { participantId, muted } = req.body;

    const videoCall = await VideoCall.findOne({ callId });

    if (!videoCall) {
      throw new AppError('Video call not found', 404, true, 'CALL_NOT_FOUND');
    }

    // Check permissions
    const isParticipant = videoCall.participants.some(p => p.user._id.toString() === req.user.id);
    const isAdmin = req.user.role === 'admin';

    if (!isParticipant && !isAdmin) {
      throw new AppError('Not authorized to manage call participants', 403, true, 'NOT_AUTHORIZED');
    }

    // Can only mute others, not yourself via this endpoint
    if (participantId === req.user.id) {
      throw new AppError('Use the self-mute endpoint to mute yourself', 400, true, 'INVALID_OPERATION');
    }

    await videoCall.toggleMute(participantId, muted);

    // Send real-time notification
    const io = req.app.get('io');
    if (io) {
      io.to(callId).emit('participant_muted', {
        callId,
        participantId,
        muted,
        mutedBy: req.user.id
      });
    }

    logger.info('Participant mute toggled', {
      callId,
      participantId,
      muted,
      mutedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: `Participant ${muted ? 'muted' : 'unmuted'} successfully`,
      data: {
        participantId,
        muted
      }
    });
  });

  // Toggle video for participant
  toggleVideo = catchAsync(async (req, res) => {
    const { callId } = req.params;
    const { participantId, enabled } = req.body;

    const videoCall = await VideoCall.findOne({ callId });

    if (!videoCall) {
      throw new AppError('Video call not found', 404, true, 'CALL_NOT_FOUND');
    }

    // Check permissions
    const isParticipant = videoCall.participants.some(p => p.user._id.toString() === req.user.id);
    const isAdmin = req.user.role === 'admin';

    if (!isParticipant && !isAdmin) {
      throw new AppError('Not authorized to manage call participants', 403, true, 'NOT_AUTHORIZED');
    }

    await videoCall.toggleVideo(participantId, enabled);

    // Send real-time notification
    const io = req.app.get('io');
    if (io) {
      io.to(callId).emit('participant_video_toggled', {
        callId,
        participantId,
        enabled,
        toggledBy: req.user.id
      });
    }

    logger.info('Participant video toggled', {
      callId,
      participantId,
      enabled,
      toggledBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: `Participant video ${enabled ? 'enabled' : 'disabled'} successfully`,
      data: {
        participantId,
        enabled
      }
    });
  });

  // Start screen sharing
  startScreenShare = catchAsync(async (req, res) => {
    const { callId } = req.params;

    const videoCall = await VideoCall.findOne({ callId });

    if (!videoCall) {
      throw new AppError('Video call not found', 404, true, 'CALL_NOT_FOUND');
    }

    // Check if user is participant
    const isParticipant = videoCall.participants.some(p => p.user._id.toString() === req.user.id);

    if (!isParticipant) {
      throw new AppError('Not authorized to screen share in this call', 403, true, 'NOT_AUTHORIZED');
    }

    // Check if screen sharing is allowed
    if (!videoCall.settings.features.screenShare) {
      throw new AppError('Screen sharing is not enabled for this call', 400, true, 'SCREEN_SHARE_DISABLED');
    }

    await videoCall.startScreenShare(req.user.id);

    // Send real-time notification
    const io = req.app.get('io');
    if (io) {
      io.to(callId).emit('screen_share_started', {
        callId,
        userId: req.user.id
      });
    }

    logger.info('Screen sharing started', {
      callId,
      userId: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Screen sharing started successfully'
    });
  });

  // Stop screen sharing
  stopScreenShare = catchAsync(async (req, res) => {
    const { callId } = req.params;

    const videoCall = await VideoCall.findOne({ callId });

    if (!videoCall) {
      throw new AppError('Video call not found', 404, true, 'CALL_NOT_FOUND');
    }

    await videoCall.stopScreenShare(req.user.id);

    // Send real-time notification
    const io = req.app.get('io');
    if (io) {
      io.to(callId).emit('screen_share_stopped', {
        callId,
        userId: req.user.id
      });
    }

    logger.info('Screen sharing stopped', {
      callId,
      userId: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Screen sharing stopped successfully'
    });
  });

  // ===============================
  // CALL RECORDING
  // ===============================

  // Start call recording
  startRecording = catchAsync(async (req, res) => {
    const { callId } = req.params;

    const videoCall = await VideoCall.findOne({ callId });

    if (!videoCall) {
      throw new AppError('Video call not found', 404, true, 'CALL_NOT_FOUND');
    }

    // Check permissions
    const isInitiator = videoCall.initiator.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isInitiator && !isAdmin) {
      throw new AppError('Not authorized to start recording', 403, true, 'NOT_AUTHORIZED');
    }

    // Check if recording is allowed
    if (!videoCall.settings.features.recording) {
      throw new AppError('Recording is not enabled for this call', 400, true, 'RECORDING_DISABLED');
    }

    await videoCall.startRecording(req.user.id);

    // Send real-time notification
    const io = req.app.get('io');
    if (io) {
      io.to(callId).emit('recording_started', {
        callId,
        startedBy: req.user.id,
        startTime: new Date()
      });
    }

    // Notify all participants about recording
    await this.sendRecordingNotifications(videoCall, req.user.id, 'started');

    logger.info('Call recording started', {
      callId,
      startedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Recording started successfully'
    });
  });

  // Stop call recording
  stopRecording = catchAsync(async (req, res) => {
    const { callId } = req.params;

    const videoCall = await VideoCall.findOne({ callId });

    if (!videoCall) {
      throw new AppError('Video call not found', 404, true, 'CALL_NOT_FOUND');
    }

    await videoCall.stopRecording(req.user.id);

    // Send real-time notification
    const io = req.app.get('io');
    if (io) {
      io.to(callId).emit('recording_stopped', {
        callId,
        stoppedBy: req.user.id,
        stopTime: new Date()
      });
    }

    // Notify all participants about recording stop
    await this.sendRecordingNotifications(videoCall, req.user.id, 'stopped');

    logger.info('Call recording stopped', {
      callId,
      stoppedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Recording stopped successfully'
    });
  });

  // ===============================
  // CALL INTEGRATIONS
  // ===============================

  // Create video call from chat
  createCallFromChat = catchAsync(async (req, res) => {
    const { conversationId } = req.params;
    const { type = 'video' } = req.body;

    const conversation = await Chat.findById(conversationId);

    if (!conversation) {
      throw new AppError('Conversation not found', 404, true, 'CONVERSATION_NOT_FOUND');
    }

    // Check if user is participant in conversation
    const isParticipant = conversation.participants.some(p => p.user._id.toString() === req.user.id);

    if (!isParticipant) {
      throw new AppError('Not authorized to create call from this conversation', 403, true, 'NOT_AUTHORIZED');
    }

    // Get other participants
    const otherParticipants = conversation.participants
      .filter(p => p.user._id.toString() !== req.user.id)
      .map(p => p.user);

    if (otherParticipants.length === 0) {
      throw new AppError('No other participants in conversation', 400, true, 'NO_PARTICIPANTS');
    }

    // Create video call
    const videoCall = new VideoCall({
      participants: [
        {
          user: req.user.id,
          role: 'initiator',
          joinedAt: new Date(),
          status: 'connected'
        },
        ...otherParticipants.map(userId => ({
          user: userId,
          role: 'participant',
          status: 'waiting'
        }))
      ],
      initiator: req.user.id,
      type,
      context: {
        conversation: conversationId
      },
      settings: {
        maxParticipants: conversation.participants.length + 5,
        isRecording: false,
        features: {
          screenShare: true,
          chat: true,
          recording: false,
          fileShare: true
        }
      },
      createdBy: req.user.id
    });

    await videoCall.save();

    // Send call invitations
    await this.sendCallInvitations(videoCall, req.user.id);

    logger.info('Video call created from chat', {
      callId: videoCall.callId,
      conversationId,
      initiatorId: req.user.id,
      type
    });

    res.status(201).json({
      success: true,
      message: 'Video call created successfully',
      data: {
        call: videoCall.getCallSummary(),
        webrtcConfig: WEBRTC_CONFIG
      }
    });
  });

  // Get active calls for user
  getActiveCalls = catchAsync(async (req, res) => {
    const activeCalls = await VideoCall.findActiveCallsForUser(req.user.id);

    res.status(200).json({
      success: true,
      data: {
        calls: activeCalls.map(call => call.getCallSummary()),
        count: activeCalls.length
      }
    });
  });

  // ===============================
  // CALL HISTORY & ANALYTICS
  // ===============================

  // Get call history
  getCallHistory = catchAsync(async (req, res) => {
    const {
      page = 1,
      limit = 20,
      type,
      status,
      dateFrom,
      dateTo
    } = req.query;

    let query = {
      'participants.user': req.user.id,
      isDeleted: false
    };

    if (type) query.type = type;
    if (status) query.status = status;

    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    const calls = await VideoCall.find(query)
      .populate('participants.user', 'firstName lastName avatar')
      .populate('initiator', 'firstName lastName avatar')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await VideoCall.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        calls,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalCalls: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Get call analytics (admin)
  getCallAnalytics = catchAsync(async (req, res) => {
    const { dateRange = 30 } = req.query;

    // Check admin permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to view call analytics', 403, true, 'NOT_AUTHORIZED');
    }

    const stats = await VideoCall.getCallStats(parseInt(dateRange));

    // Additional analytics
    const callTypes = await VideoCall.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - parseInt(dateRange) * 24 * 60 * 60 * 1000) } } },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          totalDuration: { $sum: '$duration' },
          averageDuration: { $avg: '$duration' }
        }
      }
    ]);

    const dailyActivity = await VideoCall.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - parseInt(dateRange) * 24 * 60 * 60 * 1000) } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          calls: { $sum: 1 },
          totalDuration: { $sum: '$duration' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        period: `${dateRange} days`,
        overview: stats,
        callTypes,
        dailyActivity
      }
    });
  });

  // ===============================
  // CALL ADMINISTRATION
  // ===============================

  // Get all calls (admin)
  getAllCalls = catchAsync(async (req, res) => {
    const {
      status,
      type,
      page = 1,
      limit = 20
    } = req.query;

    // Check admin permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to view all calls', 403, true, 'NOT_AUTHORIZED');
    }

    let query = { isDeleted: false };

    if (status) query.status = status;
    if (type) query.type = type;

    const calls = await VideoCall.find(query)
      .populate('participants.user', 'firstName lastName avatar')
      .populate('initiator', 'firstName lastName avatar')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await VideoCall.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        calls,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalCalls: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Force end call (admin)
  forceEndCall = catchAsync(async (req, res) => {
    const { callId } = req.params;

    const videoCall = await VideoCall.findOne({ callId });

    if (!videoCall) {
      throw new AppError('Video call not found', 404, true, 'CALL_NOT_FOUND');
    }

    // Check admin permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to force end calls', 403, true, 'NOT_AUTHORIZED');
    }

    await videoCall.endCall();

    // Notify all participants
    const io = req.app.get('io');
    if (io) {
      io.to(callId).emit('call_force_ended', {
        callId,
        endedBy: req.user.id,
        reason: 'Admin force end'
      });
    }

    logger.info('Call force ended by admin', {
      callId,
      endedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Call force ended successfully'
    });
  });

  // ===============================
  // CALL MAINTENANCE
  // ===============================

  // Clean up old calls (admin)
  cleanupOldCalls = catchAsync(async (req, res) => {
    const { daysOld = 90 } = req.query;

    // Check admin permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to cleanup calls', 403, true, 'NOT_AUTHORIZED');
    }

    const deletedCount = await VideoCall.cleanupOldCalls(parseInt(daysOld));

    logger.info('Old video calls cleaned up', {
      adminId: req.user.id,
      deletedCount,
      daysOld
    });

    res.status(200).json({
      success: true,
      message: 'Old calls cleaned up successfully',
      data: {
        deletedCount
      }
    });
  });

  // Get call statistics (admin)
  getCallStatistics = catchAsync(async (req, res) => {
    const { dateRange = 30 } = req.query;

    const stats = await VideoCall.getCallStats(parseInt(dateRange));

    // Additional statistics
    const activeCalls = await VideoCall.countDocuments({
      status: 'active',
      isDeleted: false
    });

    const totalParticipants = await VideoCall.aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: null,
          totalParticipants: { $sum: { $size: '$participants' } }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        period: `${dateRange} days`,
        overview: stats,
        current: {
          activeCalls,
          totalParticipants: totalParticipants[0]?.totalParticipants || 0
        }
      }
    });
  });

  // ===============================
  // UTILITY METHODS
  // ===============================

  // Send call invitations
  async sendCallInvitations(videoCall, initiatorId) {
    const notifications = [];

    for (const participant of videoCall.participants) {
      if (participant.user.toString() !== initiatorId) {
        notifications.push(Notification.createNotification(participant.user, {
          type: 'video_call',
          category: 'transactional',
          title: 'Incoming Video Call',
          message: `You have an incoming ${videoCall.type} call`,
          data: {
            callId: videoCall.callId,
            callType: videoCall.type,
            initiatorId: initiatorId
          },
          priority: 'high',
          actions: [
            {
              type: 'button',
              label: 'Join Call',
              action: 'join_call',
              data: { callId: videoCall.callId }
            },
            {
              type: 'button',
              label: 'Decline',
              action: 'decline_call',
              data: { callId: videoCall.callId }
            }
          ]
        }));
      }
    }

    await Promise.all(notifications);
  },

  // Send call ended notifications
  async sendCallEndedNotifications(videoCall, endedBy) {
    const notifications = [];

    for (const participant of videoCall.participants) {
      notifications.push(Notification.createNotification(participant.user, {
        type: 'video_call',
        category: 'informational',
        title: 'Call Ended',
        message: `The ${videoCall.type} call has ended`,
        data: {
          callId: videoCall.callId,
          duration: videoCall.duration,
          endedBy
        },
        priority: 'normal'
      }));
    }

    await Promise.all(notifications);
  },

  // Send recording notifications
  async sendRecordingNotifications(videoCall, userId, action) {
    const notifications = [];

    for (const participant of videoCall.participants) {
      if (participant.user.toString() !== userId) {
        notifications.push(Notification.createNotification(participant.user, {
          type: 'video_call',
          category: 'informational',
          title: `Recording ${action}`,
          message: `Call recording has ${action}`,
          data: {
            callId: videoCall.callId,
            action,
            by: userId
          },
          priority: 'normal'
        }));
      }
    }

    await Promise.all(notifications);
  }
}

module.exports = new VideoCallController();
