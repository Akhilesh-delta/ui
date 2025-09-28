const mongoose = require('mongoose');

const videoCallSchema = new mongoose.Schema({
  // Call identification
  callId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // Call participants
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['initiator', 'participant'],
      default: 'participant'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    leftAt: Date,
    status: {
      type: String,
      enum: ['waiting', 'connected', 'disconnected', 'rejected'],
      default: 'waiting'
    },
    isMuted: {
      type: Boolean,
      default: false
    },
    isVideoEnabled: {
      type: Boolean,
      default: true
    },
    isScreenSharing: {
      type: Boolean,
      default: false
    }
  }],

  // Call metadata
  initiator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  type: {
    type: String,
    enum: ['audio', 'video', 'screen_share'],
    default: 'video'
  },

  status: {
    type: String,
    enum: ['pending', 'active', 'ended', 'cancelled', 'failed'],
    default: 'pending'
  },

  // Call timing
  startTime: Date,
  endTime: Date,
  duration: {
    type: Number, // in seconds
    default: 0
  },

  // Call context (conversation, order, etc.)
  context: {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Chat'
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order'
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    },
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store'
    }
  },

  // Call settings
  settings: {
    maxParticipants: {
      type: Number,
      default: 10,
      max: 50
    },
    isRecording: {
      type: Boolean,
      default: false
    },
    isPublic: {
      type: Boolean,
      default: false
    },
    requireApproval: {
      type: Boolean,
      default: false
    },
    quality: {
      type: String,
      enum: ['low', 'medium', 'high', 'auto'],
      default: 'auto'
    },
    features: {
      screenShare: { type: Boolean, default: true },
      chat: { type: Boolean, default: true },
      recording: { type: Boolean, default: false },
      fileShare: { type: Boolean, default: true }
    }
  },

  // Recording information
  recording: {
    isEnabled: {
      type: Boolean,
      default: false
    },
    url: String,
    fileSize: Number,
    duration: Number,
    format: String,
    quality: String
  },

  // Call statistics
  stats: {
    totalParticipants: {
      type: Number,
      default: 0
    },
    peakParticipants: {
      type: Number,
      default: 0
    },
    averageDuration: {
      type: Number,
      default: 0
    },
    connectionIssues: {
      type: Number,
      default: 0
    },
    qualityScore: {
      type: Number,
      default: 0
    }
  },

  // Call history and events
  events: [{
    type: {
      type: String,
      enum: ['participant_joined', 'participant_left', 'call_started', 'call_ended', 'recording_started', 'recording_ended', 'screen_share_started', 'screen_share_ended', 'mute_toggled', 'video_toggled']
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    data: mongoose.Schema.Types.Mixed
  }],

  // Technical details
  technical: {
    signalingServer: String,
    turnServer: String,
    stunServer: String,
    webrtcConfig: mongoose.Schema.Types.Mixed,
    bandwidth: {
      audio: Number,
      video: Number
    }
  },

  // Call metadata
  metadata: {
    deviceInfo: {
      userAgent: String,
      platform: String,
      browser: String
    },
    networkInfo: {
      ipAddress: String,
      connectionType: String,
      bandwidth: Number
    },
    location: {
      country: String,
      region: String,
      city: String
    }
  },

  // Administrative fields
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date,
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
videoCallSchema.index({ callId: 1 });
videoCallSchema.index({ 'participants.user': 1 });
videoCallSchema.index({ initiator: 1 });
videoCallSchema.index({ status: 1 });
videoCallSchema.index({ createdAt: -1 });
videoCallSchema.index({ startTime: -1 });

// Virtual for call duration calculation
videoCallSchema.virtual('calculatedDuration').get(function() {
  if (this.startTime && this.endTime) {
    return Math.floor((this.endTime - this.startTime) / 1000);
  }
  if (this.startTime && this.status === 'active') {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }
  return this.duration || 0;
});

// Instance methods
videoCallSchema.methods = {
  // Add participant to call
  async addParticipant(userId, role = 'participant') {
    const existingParticipant = this.participants.find(p => p.user.toString() === userId.toString());

    if (existingParticipant) {
      existingParticipant.status = 'connected';
      existingParticipant.joinedAt = new Date();
    } else {
      this.participants.push({
        user: userId,
        role,
        joinedAt: new Date(),
        status: 'connected'
      });
    }

    this.stats.totalParticipants = this.participants.length;
    this.stats.peakParticipants = Math.max(this.stats.peakParticipants, this.participants.length);

    await this.addEvent('participant_joined', userId);
    await this.save();
  },

  // Remove participant from call
  async removeParticipant(userId) {
    const participant = this.participants.find(p => p.user.toString() === userId.toString());

    if (participant) {
      participant.leftAt = new Date();
      participant.status = 'disconnected';

      await this.addEvent('participant_left', userId);
      await this.save();
    }
  },

  // Start the call
  async startCall() {
    this.status = 'active';
    this.startTime = new Date();

    await this.addEvent('call_started', this.initiator);
    await this.save();
  },

  // End the call
  async endCall() {
    this.status = 'ended';
    this.endTime = new Date();

    if (this.startTime) {
      this.duration = Math.floor((this.endTime - this.startTime) / 1000);
    }

    await this.addEvent('call_ended', this.initiator);
    await this.save();
  },

  // Add call event
  async addEvent(eventType, userId, data = {}) {
    this.events.push({
      type: eventType,
      user: userId,
      timestamp: new Date(),
      data
    });

    // Keep only last 100 events to prevent bloat
    if (this.events.length > 100) {
      this.events = this.events.slice(-100);
    }

    await this.save();
  },

  // Toggle mute for participant
  async toggleMute(userId, muted) {
    const participant = this.participants.find(p => p.user.toString() === userId.toString());

    if (participant) {
      participant.isMuted = muted;

      await this.addEvent(muted ? 'mute_toggled' : 'unmute_toggled', userId, { muted });
      await this.save();
    }
  },

  // Toggle video for participant
  async toggleVideo(userId, enabled) {
    const participant = this.participants.find(p => p.user.toString() === userId.toString());

    if (participant) {
      participant.isVideoEnabled = enabled;

      await this.addEvent(enabled ? 'video_enabled' : 'video_disabled', userId, { enabled });
      await this.save();
    }
  },

  // Start screen sharing
  async startScreenShare(userId) {
    // Stop other screen sharing
    this.participants.forEach(p => {
      p.isScreenSharing = false;
    });

    const participant = this.participants.find(p => p.user.toString() === userId.toString());
    if (participant) {
      participant.isScreenSharing = true;

      await this.addEvent('screen_share_started', userId);
      await this.save();
    }
  },

  // Stop screen sharing
  async stopScreenShare(userId) {
    const participant = this.participants.find(p => p.user.toString() === userId.toString());

    if (participant) {
      participant.isScreenSharing = false;

      await this.addEvent('screen_share_ended', userId);
      await this.save();
    }
  },

  // Start recording
  async startRecording(userId) {
    this.settings.isRecording = true;
    this.recording.isEnabled = true;

    await this.addEvent('recording_started', userId);
    await this.save();
  },

  // Stop recording
  async stopRecording(userId) {
    this.settings.isRecording = false;
    this.recording.isEnabled = false;

    await this.addEvent('recording_ended', userId);
    await this.save();
  },

  // Update call statistics
  async updateStats() {
    const connectedParticipants = this.participants.filter(p => p.status === 'connected').length;
    this.stats.totalParticipants = connectedParticipants;
    this.stats.peakParticipants = Math.max(this.stats.peakParticipants, connectedParticipants);

    await this.save();
  },

  // Get call summary
  getCallSummary() {
    return {
      callId: this.callId,
      type: this.type,
      status: this.status,
      initiator: this.initiator,
      participantCount: this.participants.length,
      connectedCount: this.participants.filter(p => p.status === 'connected').length,
      startTime: this.startTime,
      duration: this.calculatedDuration,
      isRecording: this.settings.isRecording,
      hasScreenShare: this.participants.some(p => p.isScreenSharing)
    };
  }
};

// Static methods
videoCallSchema.statics = {
  // Generate unique call ID
  async generateCallId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `call_${timestamp}_${random}`.toUpperCase();
  },

  // Find active calls for user
  async findActiveCallsForUser(userId) {
    return await this.find({
      'participants.user': userId,
      status: { $in: ['pending', 'active'] },
      isDeleted: false
    }).populate('participants.user', 'firstName lastName avatar');
  },

  // Get call statistics
  async getCallStats(dateRange = 30) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const stats = await this.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          totalDuration: { $sum: '$duration' },
          averageDuration: { $avg: '$duration' },
          callsByType: {
            $push: '$type'
          },
          callsByStatus: {
            $push: '$status'
          }
        }
      }
    ]);

    return stats[0] || {
      totalCalls: 0,
      totalDuration: 0,
      averageDuration: 0,
      callsByType: [],
      callsByStatus: []
    };
  },

  // Clean up old calls
  async cleanupOldCalls(daysOld = 90) {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    const result = await this.updateMany(
      {
        createdAt: { $lt: cutoffDate },
        status: { $in: ['ended', 'cancelled', 'failed'] }
      },
      {
        isDeleted: true,
        deletedAt: new Date()
      }
    );

    return result.modifiedCount;
  }
};

// Pre-save middleware
videoCallSchema.pre('save', async function(next) {
  if (this.isNew && !this.callId) {
    this.callId = await VideoCall.generateCallId();
  }

  // Update duration if call is ending
  if (this.isModified('endTime') && this.startTime && this.endTime) {
    this.duration = Math.floor((this.endTime - this.startTime) / 1000);
  }

  next();
});

// Post-save middleware for notifications
videoCallSchema.post('save', async function(doc) {
  // Trigger real-time notifications for call events
  if (doc.events && doc.events.length > 0) {
    const lastEvent = doc.events[doc.events.length - 1];

    // Emit socket event for real-time updates
    const io = require('../server').io;
    if (io) {
      io.to(doc.callId).emit('call_event', {
        callId: doc.callId,
        event: lastEvent,
        call: doc.getCallSummary()
      });
    }
  }
});

const VideoCall = mongoose.model('VideoCall', videoCallSchema);

module.exports = VideoCall;
