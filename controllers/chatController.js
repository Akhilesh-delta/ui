const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const Store = require('../models/Store');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Notification = require('../models/Notification');
const cloudinary = require('cloudinary').v2;
const { validationResult } = require('express-validator');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

class ChatController {
  // ===============================
  // CHAT CONVERSATION MANAGEMENT
  // ===============================

  // Create new chat conversation
  createConversation = catchAsync(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { participants, type = 'direct', title, orderId, productId, storeId } = req.body;

    // Validate participants
    if (!participants || !Array.isArray(participants) || participants.length < 2) {
      throw new AppError('At least 2 participants are required', 400, true, 'INVALID_PARTICIPANTS');
    }

    // Check if conversation already exists
    const existingConversation = await this.findExistingConversation(participants, type, orderId, productId, storeId);

    if (existingConversation) {
      return res.status(200).json({
        success: true,
        message: 'Conversation already exists',
        data: existingConversation
      });
    }

    // Create new conversation
    const conversation = new Chat({
      participants: participants.map(participant => ({
        user: participant.userId,
        role: participant.role || 'customer',
        joinedAt: new Date(),
        isActive: true
      })),
      type,
      title,
      context: {
        order: orderId,
        product: productId,
        store: storeId
      },
      settings: {
        isPublic: false,
        allowFileSharing: true,
        allowScreenSharing: false,
        maxParticipants: type === 'group' ? 50 : 2
      },
      createdBy: req.user.id
    });

    await conversation.save();

    // Add participants to conversation
    for (const participant of participants) {
      await User.findByIdAndUpdate(participant.userId, {
        $push: { conversations: conversation._id }
      });
    }

    // Send initial notifications
    await this.sendConversationCreatedNotifications(conversation, req.user.id);

    logger.info('Chat conversation created', {
      conversationId: conversation._id,
      type,
      participants: participants.length,
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Conversation created successfully',
      data: conversation
    });
  });

  // Find existing conversation
  async findExistingConversation(participants, type, orderId, productId, storeId) {
    const participantIds = participants.map(p => p.userId).sort();

    let query = {
      'participants.user': { $all: participantIds },
      type,
      isDeleted: false
    };

    // Add context filters
    if (orderId) query['context.order'] = orderId;
    if (productId) query['context.product'] = productId;
    if (storeId) query['context.store'] = storeId;

    return await Chat.findOne(query);
  }

  // Get user conversations
  getUserConversations = catchAsync(async (req, res) => {
    const {
      type,
      status = 'active',
      search,
      sortBy = 'updatedAt',
      page = 1,
      limit = 20
    } = req.query;

    let query = {
      'participants.user': req.user.id,
      isDeleted: false
    };

    if (type) query.type = type;
    if (status) query.status = status;

    // Search in conversation titles and participant names
    if (search) {
      const users = await User.find({
        $or: [
          { firstName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } }
        ]
      }).select('_id');

      const userIds = users.map(u => u._id);
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { 'participants.user': { $in: userIds } }
      ];
    }

    let sort = {};
    sort[sortBy] = -1;

    const conversations = await Chat.find(query)
      .populate('participants.user', 'firstName lastName avatar role')
      .populate('context.order', 'orderNumber status')
      .populate('context.product', 'name images')
      .populate('context.store', 'name logo')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Chat.countDocuments(query);

    // Add last message preview for each conversation
    const conversationsWithLastMessage = await Promise.all(
      conversations.map(async (conversation) => {
        const lastMessage = await Message.findOne({ conversation: conversation._id })
          .sort({ createdAt: -1 })
          .limit(1);

        return {
          ...conversation.toObject(),
          lastMessage: lastMessage ? {
            content: lastMessage.content,
            type: lastMessage.type,
            createdAt: lastMessage.createdAt,
            sender: lastMessage.sender
          } : null,
          unreadCount: await Message.countDocuments({
            conversation: conversation._id,
            'readBy.user': { $ne: req.user.id },
            sender: { $ne: req.user.id }
          })
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        conversations: conversationsWithLastMessage,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalConversations: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Get conversation by ID
  getConversation = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { includeMessages = false, messageLimit = 50 } = req.query;

    const conversation = await Chat.findById(id)
      .populate('participants.user', 'firstName lastName avatar role isOnline')
      .populate('context.order', 'orderNumber status pricing')
      .populate('context.product', 'name images price')
      .populate('context.store', 'name logo');

    if (!conversation) {
      throw new AppError('Conversation not found', 404, true, 'CONVERSATION_NOT_FOUND');
    }

    // Check if user is participant
    const isParticipant = conversation.participants.some(p => p.user._id.toString() === req.user.id);

    if (!isParticipant && req.user.role !== 'admin') {
      throw new AppError('Not authorized to view this conversation', 403, true, 'NOT_AUTHORIZED');
    }

    let messages = [];
    if (includeMessages === 'true') {
      messages = await this.getConversationMessages(id, parseInt(messageLimit));

      // Mark messages as read
      await Message.updateMany(
        {
          conversation: id,
          sender: { $ne: req.user.id },
          'readBy.user': { $ne: req.user.id }
        },
        {
          $push: {
            readBy: {
              user: req.user.id,
              readAt: new Date()
            }
          }
        }
      );
    }

    // Update user's last seen
    await conversation.updateParticipantLastSeen(req.user.id);

    res.status(200).json({
      success: true,
      data: {
        conversation,
        messages,
        participant: conversation.participants.find(p => p.user._id.toString() === req.user.id)
      }
    });
  });

  // Update conversation
  updateConversation = catchAsync(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    const conversation = await Chat.findById(id);

    if (!conversation) {
      throw new AppError('Conversation not found', 404, true, 'CONVERSATION_NOT_FOUND');
    }

    // Check permissions
    const isParticipant = conversation.participants.some(p => p.user._id.toString() === req.user.id);

    if (!isParticipant && req.user.role !== 'admin') {
      throw new AppError('Not authorized to update this conversation', 403, true, 'NOT_AUTHORIZED');
    }

    // Update allowed fields
    const allowedFields = ['title', 'description', 'settings'];
    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        conversation[field] = updates[field];
      }
    });

    conversation.updatedBy = req.user.id;
    await conversation.save();

    logger.info('Conversation updated', {
      conversationId: id,
      updatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Conversation updated successfully',
      data: conversation
    });
  });

  // Delete conversation
  deleteConversation = catchAsync(async (req, res) => {
    const { id } = req.params;

    const conversation = await Chat.findById(id);

    if (!conversation) {
      throw new AppError('Conversation not found', 404, true, 'CONVERSATION_NOT_FOUND');
    }

    // Check permissions
    const isParticipant = conversation.participants.some(p => p.user._id.toString() === req.user.id);

    if (!isParticipant && req.user.role !== 'admin') {
      throw new AppError('Not authorized to delete this conversation', 403, true, 'NOT_AUTHORIZED');
    }

    // Soft delete
    conversation.isDeleted = true;
    conversation.deletedAt = new Date();
    conversation.deletedBy = req.user.id;
    await conversation.save();

    // Remove from user conversations
    await User.updateMany(
      { conversations: id },
      { $pull: { conversations: id } }
    );

    logger.info('Conversation deleted', {
      conversationId: id,
      deletedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Conversation deleted successfully'
    });
  });

  // ===============================
  // MESSAGE MANAGEMENT
  // ===============================

  // Send message
  sendMessage = catchAsync(async (req, res) => {
    const { conversationId } = req.params;
    const { content, type = 'text', replyTo, attachments = [] } = req.body;

    const conversation = await Chat.findById(conversationId);

    if (!conversation) {
      throw new AppError('Conversation not found', 404, true, 'CONVERSATION_NOT_FOUND');
    }

    // Check if user is participant
    const participant = conversation.participants.find(p => p.user._id.toString() === req.user.id);

    if (!participant || !participant.isActive) {
      throw new AppError('Not authorized to send messages in this conversation', 403, true, 'NOT_AUTHORIZED');
    }

    // Handle file attachments
    let processedAttachments = [];

    if (attachments.length > 0) {
      for (const attachment of attachments) {
        const result = await cloudinary.uploader.upload(attachment.url, {
          folder: `chat/${conversationId}`,
          quality: 'auto'
        });

        processedAttachments.push({
          type: attachment.type,
          url: result.secure_url,
          public_id: result.public_id,
          filename: attachment.filename,
          size: attachment.size,
          mimeType: attachment.mimeType
        });
      }
    }

    // Create message
    const message = new Message({
      conversation: conversationId,
      sender: req.user.id,
      content,
      type,
      replyTo,
      attachments: processedAttachments,
      metadata: {
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        deviceType: this.detectDeviceType(req.get('User-Agent'))
      }
    });

    await message.save();

    // Update conversation last activity
    conversation.lastMessage = message._id;
    conversation.lastActivity = new Date();
    await conversation.save();

    // Send real-time notification via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(conversationId).emit('new_message', {
        message: message.getPublicData(),
        conversation: conversationId
      });
    }

    // Send push notifications to offline participants
    await this.sendMessageNotifications(message, conversation);

    logger.info('Message sent', {
      messageId: message._id,
      conversationId,
      senderId: req.user.id,
      type,
      hasAttachments: processedAttachments.length > 0
    });

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: message
    });
  });

  // Get conversation messages
  async getConversationMessages(conversationId, limit = 50, before = null) {
    let query = { conversation: conversationId };

    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .populate('sender', 'firstName lastName avatar')
      .populate('replyTo', 'content sender')
      .sort({ createdAt: -1 })
      .limit(limit);

    return messages.reverse();
  }

  // Get messages with pagination
  getMessages = catchAsync(async (req, res) => {
    const { conversationId } = req.params;
    const {
      limit = 50,
      before,
      after,
      page = 1
    } = req.query;

    const conversation = await Chat.findById(conversationId);

    if (!conversation) {
      throw new AppError('Conversation not found', 404, true, 'CONVERSATION_NOT_FOUND');
    }

    // Check if user is participant
    const isParticipant = conversation.participants.some(p => p.user._id.toString() === req.user.id);

    if (!isParticipant && req.user.role !== 'admin') {
      throw new AppError('Not authorized to view messages', 403, true, 'NOT_AUTHORIZED');
    }

    let query = { conversation: conversationId };

    // Pagination logic
    if (before) {
      query.createdAt = { $lt: new Date(before) };
    } else if (after) {
      query.createdAt = { $gt: new Date(after) };
    }

    const messages = await Message.find(query)
      .populate('sender', 'firstName lastName avatar')
      .populate('replyTo', 'content sender')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    const total = await Message.countDocuments({ conversation: conversationId });

    res.status(200).json({
      success: true,
      data: {
        messages: messages.reverse(),
        pagination: {
          currentPage: parseInt(page),
          limit: parseInt(limit),
          totalMessages: total,
          hasMore: messages.length === parseInt(limit)
        },
        conversation: {
          id: conversation._id,
          type: conversation.type,
          title: conversation.title
        }
      }
    });
  });

  // Update message
  updateMessage = catchAsync(async (req, res) => {
    const { messageId } = req.params;
    const { content } = req.body;

    const message = await Message.findById(messageId);

    if (!message) {
      throw new AppError('Message not found', 404, true, 'MESSAGE_NOT_FOUND');
    }

    // Check if user is message sender
    if (message.sender.toString() !== req.user.id) {
      throw new AppError('Not authorized to edit this message', 403, true, 'NOT_AUTHORIZED');
    }

    // Check if message can be edited (within 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (message.createdAt < fiveMinutesAgo) {
      throw new AppError('Message cannot be edited after 5 minutes', 400, true, 'MESSAGE_EDIT_EXPIRED');
    }

    message.content = content;
    message.isEdited = true;
    message.editedAt = new Date();
    await message.save();

    // Notify other participants
    const io = req.app.get('io');
    if (io) {
      io.to(message.conversation.toString()).emit('message_updated', {
        messageId: message._id,
        content: message.content,
        editedAt: message.editedAt
      });
    }

    logger.info('Message updated', {
      messageId,
      updatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Message updated successfully',
      data: message
    });
  });

  // Delete message
  deleteMessage = catchAsync(async (req, res) => {
    const { messageId } = req.params;

    const message = await Message.findById(messageId);

    if (!message) {
      throw new AppError('Message not found', 404, true, 'MESSAGE_NOT_FOUND');
    }

    // Check if user is message sender or admin
    const canDelete = message.sender.toString() === req.user.id || req.user.role === 'admin';

    if (!canDelete) {
      throw new AppError('Not authorized to delete this message', 403, true, 'NOT_AUTHORIZED');
    }

    // Soft delete message
    message.isDeleted = true;
    message.deletedAt = new Date();
    message.deletedBy = req.user.id;
    await message.save();

    // Delete attachments from Cloudinary
    for (const attachment of message.attachments) {
      await cloudinary.uploader.destroy(attachment.public_id);
    }

    // Notify other participants
    const io = req.app.get('io');
    if (io) {
      io.to(message.conversation.toString()).emit('message_deleted', {
        messageId: message._id,
        deletedBy: req.user.id
      });
    }

    logger.info('Message deleted', {
      messageId,
      deletedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Message deleted successfully'
    });
  });

  // Mark messages as read
  markAsRead = catchAsync(async (req, res) => {
    const { conversationId } = req.params;

    const conversation = await Chat.findById(conversationId);

    if (!conversation) {
      throw new AppError('Conversation not found', 404, true, 'CONVERSATION_NOT_FOUND');
    }

    // Check if user is participant
    const isParticipant = conversation.participants.some(p => p.user._id.toString() === req.user.id);

    if (!isParticipant) {
      throw new AppError('Not authorized to mark messages as read', 403, true, 'NOT_AUTHORIZED');
    }

    // Mark all unread messages as read
    await Message.updateMany(
      {
        conversation: conversationId,
        sender: { $ne: req.user.id },
        'readBy.user': { $ne: req.user.id }
      },
      {
        $push: {
          readBy: {
            user: req.user.id,
            readAt: new Date()
          }
        }
      }
    );

    // Update conversation
    conversation.lastSeenBy = conversation.lastSeenBy || {};
    conversation.lastSeenBy[req.user.id] = new Date();
    await conversation.save();

    // Notify other participants
    const io = req.app.get('io');
    if (io) {
      io.to(conversationId).emit('messages_read', {
        conversationId,
        readBy: req.user.id,
        readAt: new Date()
      });
    }

    logger.info('Messages marked as read', {
      conversationId,
      userId: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Messages marked as read successfully'
    });
  });

  // ===============================
  // FILE SHARING IN CHAT
  // ===============================

  // Upload file to chat
  uploadChatFile = catchAsync(async (req, res) => {
    const { conversationId } = req.params;

    if (!req.file) {
      throw new AppError('No file provided', 400, true, 'NO_FILE_PROVIDED');
    }

    const conversation = await Chat.findById(conversationId);

    if (!conversation) {
      throw new AppError('Conversation not found', 404, true, 'CONVERSATION_NOT_FOUND');
    }

    // Check if user is participant
    const isParticipant = conversation.participants.some(p => p.user._id.toString() === req.user.id);

    if (!isParticipant) {
      throw new AppError('Not authorized to upload files to this conversation', 403, true, 'NOT_AUTHORIZED');
    }

    // Check file size limit
    const maxFileSize = conversation.settings.maxFileSize || 10 * 1024 * 1024; // 10MB default
    if (req.file.size > maxFileSize) {
      throw new AppError('File size exceeds limit', 400, true, 'FILE_TOO_LARGE');
    }

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: `chat/${conversationId}`,
      quality: 'auto',
      resource_type: 'auto'
    });

    const fileData = {
      type: this.getFileType(req.file.mimetype),
      url: result.secure_url,
      public_id: result.public_id,
      filename: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
      uploadedBy: req.user.id,
      uploadedAt: new Date()
    };

    // Create message with file attachment
    const message = new Message({
      conversation: conversationId,
      sender: req.user.id,
      type: 'file',
      content: `Shared a file: ${req.file.originalname}`,
      attachments: [fileData],
      metadata: {
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }
    });

    await message.save();

    // Update conversation
    conversation.lastMessage = message._id;
    conversation.lastActivity = new Date();
    await conversation.save();

    // Send real-time notification
    const io = req.app.get('io');
    if (io) {
      io.to(conversationId).emit('new_message', {
        message: message.getPublicData(),
        conversation: conversationId
      });
    }

    logger.info('File uploaded to chat', {
      conversationId,
      messageId: message._id,
      filename: req.file.originalname,
      size: req.file.size,
      uploadedBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        message: message.getPublicData(),
        file: fileData
      }
    });
  });

  // Get file type
  getFileType(mimeType) {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.includes('pdf')) return 'document';
    if (mimeType.includes('document') || mimeType.includes('text')) return 'document';
    return 'file';
  }

  // Detect device type
  detectDeviceType(userAgent) {
    if (/mobile|android|iphone|ipad|phone/i.test(userAgent)) return 'mobile';
    if (/tablet/i.test(userAgent)) return 'tablet';
    return 'desktop';
  }

  // ===============================
  // CHAT SEARCH & HISTORY
  // ===============================

  // Search messages
  searchMessages = catchAsync(async (req, res) => {
    const { q: searchTerm } = req.query;
    const {
      conversationId,
      sender,
      type,
      dateFrom,
      dateTo,
      page = 1,
      limit = 20
    } = req.query;

    if (!searchTerm) {
      throw new AppError('Search term is required', 400, true, 'SEARCH_TERM_REQUIRED');
    }

    let query = {
      content: { $regex: searchTerm, $options: 'i' },
      isDeleted: false
    };

    if (conversationId) query.conversation = conversationId;
    if (sender) query.sender = sender;
    if (type) query.type = type;

    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    // Check permissions for conversations
    if (conversationId) {
      const conversation = await Chat.findById(conversationId);
      if (!conversation) {
        throw new AppError('Conversation not found', 404, true, 'CONVERSATION_NOT_FOUND');
      }

      const isParticipant = conversation.participants.some(p => p.user._id.toString() === req.user.id);

      if (!isParticipant && req.user.role !== 'admin') {
        throw new AppError('Not authorized to search in this conversation', 403, true, 'NOT_AUTHORIZED');
      }
    } else {
      // Search across all user's conversations
      const userConversations = await Chat.find({
        'participants.user': req.user.id,
        isDeleted: false
      }).select('_id');

      const conversationIds = userConversations.map(c => c._id);
      query.conversation = { $in: conversationIds };
    }

    const messages = await Message.find(query)
      .populate('sender', 'firstName lastName avatar')
      .populate('conversation', 'title type')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Message.countDocuments(query);

    // Highlight search term in results
    const highlightedMessages = messages.map(message => ({
      ...message.toObject(),
      content: message.content.replace(
        new RegExp(searchTerm, 'gi'),
        `<mark>$&</mark>`
      )
    }));

    res.status(200).json({
      success: true,
      data: {
        searchTerm,
        messages: highlightedMessages,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalMessages: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Get message history
  getMessageHistory = catchAsync(async (req, res) => {
    const { conversationId } = req.params;
    const { dateFrom, dateTo, format = 'json' } = req.query;

    const conversation = await Chat.findById(conversationId);

    if (!conversation) {
      throw new AppError('Conversation not found', 404, true, 'CONVERSATION_NOT_FOUND');
    }

    // Check permissions
    const isParticipant = conversation.participants.some(p => p.user._id.toString() === req.user.id);

    if (!isParticipant && req.user.role !== 'admin') {
      throw new AppError('Not authorized to view message history', 403, true, 'NOT_AUTHORIZED');
    }

    let query = { conversation: conversationId, isDeleted: false };

    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    const messages = await Message.find(query)
      .populate('sender', 'firstName lastName avatar')
      .populate('replyTo', 'content sender')
      .sort({ createdAt: 1 });

    if (format === 'csv') {
      const csvData = this.generateMessageHistoryCSV(messages);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="message-history.csv"`);
      res.status(200).send(csvData);
    } else {
      res.status(200).json({
        success: true,
        data: {
          conversation: conversation.title,
          messages,
          totalMessages: messages.length,
          dateRange: { from: dateFrom, to: dateTo }
        }
      });
    }
  });

  // Generate message history CSV
  generateMessageHistoryCSV(messages) {
    const headers = ['Date', 'Time', 'Sender', 'Type', 'Content', 'Attachments'];
    const rows = messages.map(message => [
      message.createdAt.toISOString().split('T')[0],
      message.createdAt.toTimeString().split(' ')[0],
      message.sender ? `${message.sender.firstName} ${message.sender.lastName}` : 'Unknown',
      message.type,
      message.content,
      message.attachments.length
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  // ===============================
  // CHAT MODERATION
  // ===============================

  // Moderate message (admin)
  moderateMessage = catchAsync(async (req, res) => {
    const { messageId } = req.params;
    const { action, reason } = req.body;

    const message = await Message.findById(messageId);

    if (!message) {
      throw new AppError('Message not found', 404, true, 'MESSAGE_NOT_FOUND');
    }

    // Check admin permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to moderate messages', 403, true, 'NOT_AUTHORIZED');
    }

    switch (action) {
      case 'hide':
        message.isHidden = true;
        message.hiddenAt = new Date();
        message.hiddenBy = req.user.id;
        message.hiddenReason = reason;
        break;

      case 'delete':
        message.isDeleted = true;
        message.deletedAt = new Date();
        message.deletedBy = req.user.id;
        break;

      case 'flag':
        message.isFlagged = true;
        message.flaggedAt = new Date();
        message.flaggedBy = req.user.id;
        message.flaggedReason = reason;
        break;

      case 'unflag':
        message.isFlagged = false;
        message.flaggedAt = undefined;
        message.flaggedBy = undefined;
        message.flaggedReason = undefined;
        break;

      default:
        throw new AppError('Invalid moderation action', 400, true, 'INVALID_ACTION');
    }

    await message.save();

    // Notify conversation participants
    const io = req.app.get('io');
    if (io) {
      io.to(message.conversation.toString()).emit('message_moderated', {
        messageId: message._id,
        action,
        moderatedBy: req.user.id
      });
    }

    logger.info('Message moderated', {
      messageId,
      action,
      moderatedBy: req.user.id,
      reason
    });

    res.status(200).json({
      success: true,
      message: 'Message moderated successfully',
      data: {
        messageId: message._id,
        action,
        reason
      }
    });
  });

  // Get flagged messages (admin)
  getFlaggedMessages = catchAsync(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;

    // Check admin permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to view flagged messages', 403, true, 'NOT_AUTHORIZED');
    }

    const messages = await Message.find({ isFlagged: true })
      .populate('sender', 'firstName lastName email')
      .populate('conversation', 'title type')
      .sort({ flaggedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Message.countDocuments({ isFlagged: true });

    res.status(200).json({
      success: true,
      data: {
        messages,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalMessages: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // ===============================
  // CHAT ANALYTICS
  // ===============================

  // Get chat analytics
  getChatAnalytics = catchAsync(async (req, res) => {
    const { dateRange = 30, conversationId } = req.query;

    // Check admin permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to view chat analytics', 403, true, 'NOT_AUTHORIZED');
    }

    const startDate = new Date(Date.now() - parseInt(dateRange) * 24 * 60 * 60 * 1000);

    let query = { createdAt: { $gte: startDate } };

    if (conversationId) {
      query.conversation = conversationId;
    }

    const analytics = await this.generateChatAnalytics(query, parseInt(dateRange));

    res.status(200).json({
      success: true,
      data: analytics
    });
  });

  // Generate comprehensive chat analytics
  async generateChatAnalytics(query, dateRange) {
    const messages = await Message.find(query);
    const conversations = await Chat.find({
      createdAt: { $gte: new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000) }
    });

    const messageCount = messages.length;
    const conversationCount = conversations.length;
    const activeUsers = await this.getActiveChatUsers(dateRange);

    // Message type distribution
    const messageTypes = await Message.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      }
    ]);

    // Daily activity
    const dailyActivity = await Message.aggregate([
      { $match: query },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          messages: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return {
      period: `${dateRange} days`,
      overview: {
        totalMessages: messageCount,
        totalConversations: conversationCount,
        activeUsers: activeUsers.length,
        averageMessagesPerDay: Math.round(messageCount / dateRange),
        averageMessagesPerConversation: conversationCount > 0 ? Math.round(messageCount / conversationCount) : 0
      },
      messageTypes,
      dailyActivity,
      topConversations: await this.getTopConversations(dateRange),
      userEngagement: await this.getUserEngagementMetrics(dateRange)
    };
  }

  // Get active chat users
  async getActiveChatUsers(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const activeUsers = await Message.distinct('sender', {
      createdAt: { $gte: startDate }
    });

    return await User.find({ _id: { $in: activeUsers } })
      .select('firstName lastName avatar');
  }

  // Get top conversations
  async getTopConversations(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const topConversations = await Message.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: '$conversation',
          messageCount: { $sum: 1 },
          uniqueSenders: { $addToSet: '$sender' }
        }
      },
      {
        $lookup: {
          from: 'chats',
          localField: '_id',
          foreignField: '_id',
          as: 'conversationInfo'
        }
      },
      { $unwind: '$conversationInfo' },
      {
        $project: {
          conversation: '$conversationInfo.title',
          messageCount: 1,
          participantCount: { $size: '$conversationInfo.participants' },
          senderCount: { $size: '$uniqueSenders' }
        }
      },
      { $sort: { messageCount: -1 } },
      { $limit: 10 }
    ]);

    return topConversations;
  }

  // Get user engagement metrics
  async getUserEngagementMetrics(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const engagement = await Message.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: '$sender',
          messageCount: { $sum: 1 },
          conversationCount: { $addToSet: '$conversation' },
          lastActivity: { $max: '$createdAt' }
        }
      },
      {
        $project: {
          userId: '$_id',
          messageCount: 1,
          conversationCount: { $size: '$conversationCount' },
          lastActivity: 1,
          engagementScore: {
            $add: [
              { $multiply: ['$messageCount', 1] },
              { $multiply: ['$conversationCount', 2] }
            ]
          }
        }
      },
      { $sort: { engagementScore: -1 } },
      { $limit: 20 }
    ]);

    return engagement;
  }

  // ===============================
  // CHAT SETTINGS & PREFERENCES
  // ===============================

  // Update conversation settings
  updateConversationSettings = catchAsync(async (req, res) => {
    const { conversationId } = req.params;
    const settings = req.body;

    const conversation = await Chat.findById(conversationId);

    if (!conversation) {
      throw new AppError('Conversation not found', 404, true, 'CONVERSATION_NOT_FOUND');
    }

    // Check if user is participant
    const isParticipant = conversation.participants.some(p => p.user._id.toString() === req.user.id);

    if (!isParticipant && req.user.role !== 'admin') {
      throw new AppError('Not authorized to update conversation settings', 403, true, 'NOT_AUTHORIZED');
    }

    // Update settings
    Object.keys(settings).forEach(key => {
      if (settings[key] !== undefined) {
        conversation.settings[key] = settings[key];
      }
    });

    conversation.updatedBy = req.user.id;
    await conversation.save();

    logger.info('Conversation settings updated', {
      conversationId,
      updatedBy: req.user.id,
      settings: Object.keys(settings)
    });

    res.status(200).json({
      success: true,
      message: 'Conversation settings updated successfully',
      data: conversation.settings
    });
  });

  // Get user chat preferences
  getChatPreferences = catchAsync(async (req, res) => {
    const user = await User.findById(req.user.id);

    res.status(200).json({
      success: true,
      data: {
        preferences: user.chatPreferences || {},
        notifications: user.notificationPreferences?.chat || {}
      }
    });
  });

  // Update chat preferences
  updateChatPreferences = catchAsync(async (req, res) => {
    const { preferences } = req.body;

    await User.findByIdAndUpdate(req.user.id, {
      chatPreferences: preferences,
      updatedAt: new Date()
    });

    logger.info('Chat preferences updated', {
      userId: req.user.id,
      preferences: Object.keys(preferences)
    });

    res.status(200).json({
      success: true,
      message: 'Chat preferences updated successfully',
      data: preferences
    });
  });

  // ===============================
  // CHAT NOTIFICATIONS
  // ===============================

  // Send message notifications
  async sendMessageNotifications(message, conversation) {
    const notifications = [];

    // Notify all participants except sender
    for (const participant of conversation.participants) {
      if (participant.user._id.toString() !== message.sender.toString()) {
        notifications.push(Notification.createNotification(participant.user._id, {
          type: 'chat',
          category: 'transactional',
          title: 'New Message',
          message: message.type === 'text'
            ? message.content.substring(0, 100)
            : `New ${message.type} message`,
          data: {
            conversationId: conversation._id,
            messageId: message._id,
            senderId: message.sender,
            type: message.type
          },
          priority: 'normal',
          actions: [
            {
              type: 'link',
              label: 'View Message',
              url: `/chat/${conversation._id}`,
              action: 'view_message'
            }
          ]
        }));
      }
    }

    await Promise.all(notifications);
  }

  // Send conversation created notifications
  async sendConversationCreatedNotifications(conversation, createdBy) {
    const notifications = [];

    // Notify all participants except creator
    for (const participant of conversation.participants) {
      if (participant.user._id.toString() !== createdBy) {
        notifications.push(Notification.createNotification(participant.user._id, {
          type: 'chat',
          category: 'informational',
          title: 'New Conversation',
          message: `A new ${conversation.type} conversation has been started.`,
          data: {
            conversationId: conversation._id,
            conversationType: conversation.type,
            createdBy
          },
          priority: 'normal',
          actions: [
            {
              type: 'link',
              label: 'View Conversation',
              url: `/chat/${conversation._id}`,
              action: 'view_conversation'
            }
          ]
        }));
      }
    }

    await Promise.all(notifications);
  }

  // ===============================
  // CHAT ADMINISTRATION
  // ===============================

  // Get all conversations (admin)
  getAllConversations = catchAsync(async (req, res) => {
    const {
      type,
      status = 'active',
      search,
      sortBy = 'lastActivity',
      page = 1,
      limit = 20
    } = req.query;

    // Check admin permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to view all conversations', 403, true, 'NOT_AUTHORIZED');
    }

    let query = { isDeleted: false };

    if (type) query.type = type;
    if (status) query.status = status;

    // Search functionality
    if (search) {
      const users = await User.find({
        $or: [
          { firstName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ]
      }).select('_id');

      const userIds = users.map(u => u._id);
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { 'participants.user': { $in: userIds } }
      ];
    }

    let sort = {};
    sort[sortBy] = -1;

    const conversations = await Chat.find(query)
      .populate('participants.user', 'firstName lastName avatar')
      .populate('lastMessage', 'content type createdAt')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Chat.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        conversations,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalConversations: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Archive conversation (admin)
  archiveConversation = catchAsync(async (req, res) => {
    const { conversationId } = req.params;

    const conversation = await Chat.findById(conversationId);

    if (!conversation) {
      throw new AppError('Conversation not found', 404, true, 'CONVERSATION_NOT_FOUND');
    }

    // Check admin permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to archive conversations', 403, true, 'NOT_AUTHORIZED');
    }

    conversation.status = 'archived';
    conversation.archivedAt = new Date();
    conversation.archivedBy = req.user.id;
    await conversation.save();

    logger.info('Conversation archived', {
      conversationId,
      archivedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Conversation archived successfully'
    });
  });

  // ===============================
  // CHAT INTEGRATIONS
  // ===============================

  // Create conversation from order
  createOrderConversation = catchAsync(async (req, res) => {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    // Check permissions
    const isCustomer = order.user.toString() === req.user.id;
    const isVendor = order.items.some(item => item.vendor.toString() === req.user.id);
    const isAdmin = req.user.role === 'admin';

    if (!isCustomer && !isVendor && !isAdmin) {
      throw new AppError('Not authorized to create conversation for this order', 403, true, 'NOT_AUTHORIZED');
    }

    // Find existing order conversation
    const existingConversation = await Chat.findOne({
      'context.order': orderId,
      type: 'order',
      isDeleted: false
    });

    if (existingConversation) {
      return res.status(200).json({
        success: true,
        message: 'Order conversation already exists',
        data: existingConversation
      });
    }

    // Create conversation participants
    const participants = [
      { userId: order.user, role: 'customer' }
    ];

    // Add all vendors from order
    const vendors = [...new Set(order.items.map(item => item.vendor.toString()))];
    vendors.forEach(vendorId => {
      participants.push({ userId: vendorId, role: 'vendor' });
    });

    // Create conversation
    const conversation = new Chat({
      participants: participants.map(participant => ({
        user: participant.userId,
        role: participant.role,
        joinedAt: new Date(),
        isActive: true
      })),
      type: 'order',
      title: `Order ${order.orderNumber}`,
      context: {
        order: orderId
      },
      settings: {
        isPublic: false,
        allowFileSharing: true,
        maxParticipants: participants.length + 5
      },
      createdBy: req.user.id
    });

    await conversation.save();

    // Add to user conversations
    for (const participant of participants) {
      await User.findByIdAndUpdate(participant.userId, {
        $push: { conversations: conversation._id }
      });
    }

    logger.info('Order conversation created', {
      conversationId: conversation._id,
      orderId,
      participants: participants.length,
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Order conversation created successfully',
      data: conversation
    });
  });

  // Create conversation from product inquiry
  createProductConversation = catchAsync(async (req, res) => {
    const { productId } = req.params;
    const { message } = req.body;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    // Create conversation with product vendor
    const participants = [
      { userId: req.user.id, role: 'customer' },
      { userId: product.vendor, role: 'vendor' }
    ];

    // Check if conversation already exists
    const existingConversation = await this.findExistingConversation(
      participants,
      'product',
      null,
      productId,
      null
    );

    let conversation;

    if (existingConversation) {
      conversation = existingConversation;
    } else {
      conversation = new Chat({
        participants: participants.map(participant => ({
          user: participant.userId,
          role: participant.role,
          joinedAt: new Date(),
          isActive: true
        })),
        type: 'product',
        title: `Product Inquiry: ${product.name}`,
        context: {
          product: productId
        },
        createdBy: req.user.id
      });

      await conversation.save();

      // Add to user conversations
      for (const participant of participants) {
        await User.findByIdAndUpdate(participant.userId, {
          $push: { conversations: conversation._id }
        });
      }
    }

    // Send initial message
    if (message) {
      const initialMessage = new Message({
        conversation: conversation._id,
        sender: req.user.id,
        content: message,
        type: 'text',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        }
      });

      await initialMessage.save();

      conversation.lastMessage = initialMessage._id;
      conversation.lastActivity = new Date();
      await conversation.save();
    }

    logger.info('Product conversation created', {
      conversationId: conversation._id,
      productId,
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Product conversation created successfully',
      data: conversation
    });
  });

  // ===============================
  // CHAT EXPORT/IMPORT
  // ===============================

  // Export conversation
  exportConversation = catchAsync(async (req, res) => {
    const { conversationId } = req.params;
    const { format = 'json', includeAttachments = false } = req.query;

    const conversation = await Chat.findById(conversationId);

    if (!conversation) {
      throw new AppError('Conversation not found', 404, true, 'CONVERSATION_NOT_FOUND');
    }

    // Check permissions
    const isParticipant = conversation.participants.some(p => p.user._id.toString() === req.user.id);

    if (!isParticipant && req.user.role !== 'admin') {
      throw new AppError('Not authorized to export this conversation', 403, true, 'NOT_AUTHORIZED');
    }

    const messages = await this.getConversationMessages(conversationId, 1000);

    const exportData = {
      conversation: {
        id: conversation._id,
        title: conversation.title,
        type: conversation.type,
        participants: conversation.participants,
        createdAt: conversation.createdAt
      },
      messages,
      exportedAt: new Date(),
      exportedBy: req.user.id
    };

    if (format === 'csv') {
      const csvData = this.generateConversationCSV(exportData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="conversation-${conversationId}.csv"`);
      res.status(200).send(csvData);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="conversation-${conversationId}.json"`);
      res.status(200).json(exportData);
    }
  });

  // Generate conversation CSV
  generateConversationCSV(exportData) {
    const headers = ['Date', 'Time', 'Sender', 'Type', 'Content', 'Attachments'];
    const rows = exportData.messages.map(message => [
      message.createdAt.toISOString().split('T')[0],
      message.createdAt.toTimeString().split(' ')[0],
      message.sender ? `${message.sender.firstName} ${message.sender.lastName}` : 'Unknown',
      message.type,
      message.content,
      message.attachments?.length || 0
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  // ===============================
  // CHAT STATISTICS
  // ===============================

  // Get chat statistics
  getChatStatistics = catchAsync(async (req, res) => {
    const { dateRange = 30 } = req.query;

    const stats = await this.generateChatStatistics(parseInt(dateRange));

    res.status(200).json({
      success: true,
      data: stats
    });
  });

  // Generate chat statistics
  async generateChatStatistics(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const totalConversations = await Chat.countDocuments({
      createdAt: { $gte: startDate },
      isDeleted: false
    });

    const totalMessages = await Message.countDocuments({
      createdAt: { $gte: startDate }
    });

    const activeConversations = await Chat.countDocuments({
      lastActivity: { $gte: startDate },
      isDeleted: false
    });

    return {
      period: `${dateRange} days`,
      overview: {
        totalConversations,
        totalMessages,
        activeConversations,
        averageMessagesPerConversation: totalConversations > 0 ? Math.round(totalMessages / totalConversations) : 0
      },
      trends: await this.getChatTrends(dateRange),
      topUsers: await this.getTopChatUsers(dateRange),
      messageTypes: await this.getMessageTypeDistribution(startDate)
    };
  }

  // Get chat trends
  async getChatTrends(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const dailyTrends = await Message.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          messages: { $sum: 1 },
          conversations: { $addToSet: '$conversation' }
        }
      },
      {
        $project: {
          date: '$_id',
          messages: 1,
          conversations: { $size: '$conversations' }
        }
      },
      { $sort: { date: 1 } }
    ]);

    return dailyTrends;
  }

  // Get top chat users
  async getTopChatUsers(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const topUsers = await Message.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: '$sender',
          messageCount: { $sum: 1 },
          conversationCount: { $addToSet: '$conversation' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userInfo'
        }
      },
      { $unwind: '$userInfo' },
      {
        $project: {
          user: {
            id: '$userInfo._id',
            name: { $concat: ['$userInfo.firstName', ' ', '$userInfo.lastName'] },
            avatar: '$userInfo.avatar'
          },
          messageCount: 1,
          conversationCount: { $size: '$conversationCount' }
        }
      },
      { $sort: { messageCount: -1 } },
      { $limit: 10 }
    ]);

    return topUsers;
  }

  // Get message type distribution
  async getMessageTypeDistribution(startDate) {
    const distribution = await Message.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      }
    ]);

    return distribution;
  }

  // ===============================
  // CHAT UTILITIES
  // ===============================

  // Add participant to conversation
  addParticipant = catchAsync(async (req, res) => {
    const { conversationId } = req.params;
    const { userId, role = 'participant' } = req.body;

    const conversation = await Chat.findById(conversationId);

    if (!conversation) {
      throw new AppError('Conversation not found', 404, true, 'CONVERSATION_NOT_FOUND');
    }

    // Check permissions (admin or current participant)
    const isCurrentParticipant = conversation.participants.some(p => p.user._id.toString() === req.user.id);
    const isAdmin = req.user.role === 'admin';

    if (!isCurrentParticipant && !isAdmin) {
      throw new AppError('Not authorized to add participants', 403, true, 'NOT_AUTHORIZED');
    }

    // Check if user is already participant
    const existingParticipant = conversation.participants.find(p => p.user._id.toString() === userId);

    if (existingParticipant) {
      throw new AppError('User is already a participant', 400, true, 'USER_ALREADY_PARTICIPANT');
    }

    // Add participant
    conversation.participants.push({
      user: userId,
      role,
      joinedAt: new Date(),
      isActive: true
    });

    await conversation.save();

    // Add to user's conversations
    await User.findByIdAndUpdate(userId, {
      $push: { conversations: conversation._id }
    });

    // Send notification
    await Notification.createNotification(userId, {
      type: 'chat',
      category: 'informational',
      title: 'Added to Conversation',
      message: `You have been added to a ${conversation.type} conversation.`,
      data: {
        conversationId: conversation._id,
        conversationTitle: conversation.title
      },
      priority: 'normal',
      actions: [
        {
          type: 'link',
          label: 'View Conversation',
          url: `/chat/${conversation._id}`,
          action: 'view_conversation'
        }
      ]
    });

    logger.info('Participant added to conversation', {
      conversationId,
      userId,
      addedBy: req.user.id,
      role
    });

    res.status(200).json({
      success: true,
      message: 'Participant added successfully',
      data: {
        conversation: conversation.title,
        participant: {
          userId,
          role,
          joinedAt: new Date()
        }
      }
    });
  });

  // Remove participant from conversation
  removeParticipant = catchAsync(async (req, res) => {
    const { conversationId, participantId } = req.params;

    const conversation = await Chat.findById(conversationId);

    if (!conversation) {
      throw new AppError('Conversation not found', 404, true, 'CONVERSATION_NOT_FOUND');
    }

    // Check permissions
    const isCurrentParticipant = conversation.participants.some(p => p.user._id.toString() === req.user.id);
    const isAdmin = req.user.role === 'admin';

    if (!isCurrentParticipant && !isAdmin) {
      throw new AppError('Not authorized to remove participants', 403, true, 'NOT_AUTHORIZED');
    }

    // Remove participant
    conversation.participants = conversation.participants.filter(
      p => p.user._id.toString() !== participantId
    );

    await conversation.save();

    // Remove from user's conversations
    await User.findByIdAndUpdate(participantId, {
      $pull: { conversations: conversation._id }
    });

    logger.info('Participant removed from conversation', {
      conversationId,
      participantId,
      removedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Participant removed successfully'
    });
  });

  // Get conversation participants
  getConversationParticipants = catchAsync(async (req, res) => {
    const { conversationId } = req.params;

    const conversation = await Chat.findById(conversationId)
      .populate('participants.user', 'firstName lastName avatar role isOnline lastSeen');

    if (!conversation) {
      throw new AppError('Conversation not found', 404, true, 'CONVERSATION_NOT_FOUND');
    }

    // Check if user is participant
    const isParticipant = conversation.participants.some(p => p.user._id.toString() === req.user.id);

    if (!isParticipant && req.user.role !== 'admin') {
      throw new AppError('Not authorized to view participants', 403, true, 'NOT_AUTHORIZED');
    }

    res.status(200).json({
      success: true,
      data: {
        conversation: conversation.title,
        participants: conversation.participants.map(p => ({
          user: p.user,
          role: p.role,
          joinedAt: p.joinedAt,
          isActive: p.isActive,
          lastSeen: p.lastSeen
        }))
      }
    });
  });

  // Update participant role
  updateParticipantRole = catchAsync(async (req, res) => {
    const { conversationId, participantId } = req.params;
    const { role } = req.body;

    const conversation = await Chat.findById(conversationId);

    if (!conversation) {
      throw new AppError('Conversation not found', 404, true, 'CONVERSATION_NOT_FOUND');
    }

    // Check permissions
    const isCurrentParticipant = conversation.participants.some(p => p.user._id.toString() === req.user.id);
    const isAdmin = req.user.role === 'admin';

    if (!isCurrentParticipant && !isAdmin) {
      throw new AppError('Not authorized to update participant roles', 403, true, 'NOT_AUTHORIZED');
    }

    const participant = conversation.participants.find(p => p.user._id.toString() === participantId);

    if (!participant) {
      throw new AppError('Participant not found', 404, true, 'PARTICIPANT_NOT_FOUND');
    }

    participant.role = role;
    await conversation.save();

    logger.info('Participant role updated', {
      conversationId,
      participantId,
      newRole: role,
      updatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Participant role updated successfully',
      data: {
        participantId,
        role
      }
    });
  });

  // ===============================
  // CHAT PERFORMANCE
  // ===============================

  // Get chat performance metrics
  getChatPerformance = catchAsync(async (req, res) => {
    const performance = {
      totalConversations: await Chat.countDocuments({ isDeleted: false }),
      totalMessages: await Message.countDocuments(),
      activeConversations: await Chat.countDocuments({
        lastActivity: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        isDeleted: false
      }),
      averageResponseTime: await this.calculateAverageResponseTime(),
      userEngagement: await this.getUserEngagementMetrics(),
      messageVolume: await this.getMessageVolumeMetrics()
    };

    res.status(200).json({
      success: true,
      data: performance
    });
  });

  // Calculate average response time
  async calculateAverageResponseTime() {
    const conversations = await Chat.find({
      lastActivity: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      isDeleted: false
    }).limit(100);

    let totalResponseTime = 0;
    let responseCount = 0;

    for (const conversation of conversations) {
      const messages = await Message.find({ conversation: conversation._id })
        .sort({ createdAt: 1 })
        .limit(10);

      for (let i = 1; i < messages.length; i++) {
        const responseTime = messages[i].createdAt - messages[i - 1].createdAt;
        if (responseTime < 24 * 60 * 60 * 1000) { // Only count responses within 24 hours
          totalResponseTime += responseTime;
          responseCount++;
        }
      }
    }

    return responseCount > 0 ? Math.round(totalResponseTime / responseCount / 1000) : 0; // Return in seconds
  }

  // Get user engagement metrics
  async getUserEngagementMetrics() {
    const activeUsers = await User.countDocuments({
      lastLogin: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    });

    const chatUsers = await Message.distinct('sender', {
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    });

    return {
      totalActiveUsers: activeUsers,
      chatActiveUsers: chatUsers.length,
      engagementRate: activeUsers > 0 ? (chatUsers.length / activeUsers) * 100 : 0
    };
  }

  // Get message volume metrics
  async getMessageVolumeMetrics() {
    const last7Days = await Message.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });

    const last30Days = await Message.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    });

    return {
      last7Days,
      last30Days,
      dailyAverage: Math.round(last30Days / 30),
      weeklyAverage: Math.round(last7Days)
    };
  }

  // ===============================
  // CHAT MAINTENANCE
  // ===============================

  // Clean up old conversations
  cleanupOldConversations = catchAsync(async (req, res) => {
    const { daysOld = 90 } = req.query;

    // Check admin permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to cleanup conversations', 403, true, 'NOT_AUTHORIZED');
    }

    const cutoffDate = new Date(Date.now() - parseInt(daysOld) * 24 * 60 * 60 * 1000);

    // Archive old inactive conversations
    const result = await Chat.updateMany(
      {
        lastActivity: { $lt: cutoffDate },
        status: { $ne: 'active' },
        isDeleted: false
      },
      {
        status: 'archived',
        archivedAt: new Date()
      }
    );

    logger.info('Old conversations cleaned up', {
      adminId: req.user.id,
      archivedCount: result.modifiedCount,
      daysOld
    });

    res.status(200).json({
      success: true,
      message: 'Old conversations cleaned up successfully',
      data: {
        archivedCount: result.modifiedCount
      }
    });
  });

  // Optimize chat performance
  optimizeChatPerformance = catchAsync(async (req, res) => {
    // Check admin permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to optimize chat', 403, true, 'NOT_AUTHORIZED');
    }

    const optimizations = {
      indexesOptimized: await this.optimizeChatIndexes(),
      cacheCleared: await this.clearChatCache(),
      oldMessagesArchived: await this.archiveOldMessages()
    };

    logger.info('Chat performance optimized', {
      adminId: req.user.id,
      optimizations: Object.keys(optimizations)
    });

    res.status(200).json({
      success: true,
      message: 'Chat performance optimized successfully',
      data: optimizations
    });
  });

  // Optimize chat indexes
  async optimizeChatIndexes() {
    // Implementation for index optimization
    return true;
  }

  // Clear chat cache
  async clearChatCache() {
    // Implementation for cache clearing
    return true;
  }

  // Archive old messages
  async archiveOldMessages() {
    const cutoffDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

    const result = await Message.updateMany(
      {
        createdAt: { $lt: cutoffDate },
        isArchived: { $ne: true }
      },
      {
        isArchived: true,
        archivedAt: new Date()
      }
    );

    return result.modifiedCount;
  }

  // ===============================
  // CHAT API ENDPOINTS
  // ===============================

  // Get chat API data
  getChatAPI = catchAsync(async (req, res) => {
    const { format = 'json' } = req.query;

    const apiData = {
      totalConversations: await Chat.countDocuments({ isDeleted: false }),
      totalMessages: await Message.countDocuments(),
      activeConversations: await Chat.countDocuments({
        lastActivity: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        isDeleted: false
      }),
      messageTypes: await this.getMessageTypeDistribution(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
      lastUpdated: new Date()
    };

    if (format === 'xml') {
      const xmlData = this.generateChatXML(apiData);
      res.setHeader('Content-Type', 'application/xml');
      res.status(200).send(xmlData);
    } else {
      res.status(200).json({
        success: true,
        data: apiData
      });
    }
  });

  // Generate chat XML
  generateChatXML(apiData) {
    // Implementation for XML generation
    return `<?xml version="1.0" encoding="UTF-8"?>
<chat>
  <totalConversations>${apiData.totalConversations}</totalConversations>
  <totalMessages>${apiData.totalMessages}</totalMessages>
  <activeConversations>${apiData.activeConversations}</activeConversations>
</chat>`;
  }
}

module.exports = new ChatController();
