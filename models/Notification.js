const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // Notification Identification
  notificationId: {
    type: String,
    unique: true,
    required: true,
    default: () => `NOT-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
  },

  // Notification Recipient
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User is required']
  },

  // Notification Type and Category
  type: {
    type: String,
    enum: [
      'order', 'payment', 'product', 'vendor', 'review', 'chat',
      'promotion', 'system', 'security', 'account', 'shipping',
      'refund', 'dispute', 'wishlist', 'cart', 'recommendation'
    ],
    required: [true, 'Notification type is required']
  },
  category: {
    type: String,
    enum: ['informational', 'promotional', 'transactional', 'security', 'social'],
    default: 'informational'
  },

  // Notification Content
  title: {
    type: String,
    required: [true, 'Title is required'],
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  message: {
    type: String,
    required: [true, 'Message is required'],
    maxlength: [1000, 'Message cannot exceed 1000 characters']
  },
  summary: {
    type: String,
    maxlength: [100, 'Summary cannot exceed 100 characters']
  },

  // Rich Content
  content: {
    html: String,
    text: String,
    image: String,
    video: String,
    audio: String,
    attachments: [{
      filename: String,
      url: String,
      size: Number,
      type: String
    }]
  },

  // Notification Data and Context
  data: {
    // Order related
    orderId: String,
    orderNumber: String,
    orderAmount: Number,

    // Product related
    productId: String,
    productName: String,
    productImage: String,

    // User related
    relatedUserId: String,
    relatedUserName: String,

    // Vendor related
    vendorId: String,
    storeId: String,
    storeName: String,

    // Payment related
    paymentId: String,
    paymentAmount: Number,

    // Chat related
    chatId: String,
    messageId: String,

    // Generic data
    action: String,
    target: String,
    metadata: mongoose.Schema.Types.Mixed
  },

  // Notification Priority and Urgency
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  urgency: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },

  // Delivery Channels
  channels: {
    email: {
      enabled: {
        type: Boolean,
        default: true
      },
      sent: {
        type: Boolean,
        default: false
      },
      sentAt: Date,
      delivered: {
        type: Boolean,
        default: false
      },
      deliveredAt: Date,
      opened: {
        type: Boolean,
        default: false
      },
      openedAt: Date,
      clicked: {
        type: Boolean,
        default: false
      },
      clickedAt: Date,
      bounced: {
        type: Boolean,
        default: false
      },
      bouncedAt: Date,
      complaint: {
        type: Boolean,
        default: false
      },
      complainedAt: Date
    },
    sms: {
      enabled: {
        type: Boolean,
        default: false
      },
      sent: {
        type: Boolean,
        default: false
      },
      sentAt: Date,
      delivered: {
        type: Boolean,
        default: false
      },
      deliveredAt: Date,
      failed: {
        type: Boolean,
        default: false
      },
      failedAt: Date
    },
    push: {
      enabled: {
        type: Boolean,
        default: true
      },
      sent: {
        type: Boolean,
        default: false
      },
      sentAt: Date,
      delivered: {
        type: Boolean,
        default: false
      },
      deliveredAt: Date,
      opened: {
        type: Boolean,
        default: false
      },
      openedAt: Date,
      dismissed: {
        type: Boolean,
        default: false
      },
      dismissedAt: Date
    },
    inApp: {
      enabled: {
        type: Boolean,
        default: true
      },
      read: {
        type: Boolean,
        default: false
      },
      readAt: Date,
      dismissed: {
        type: Boolean,
        default: false
      },
      dismissedAt: Date,
      clicked: {
        type: Boolean,
        default: false
      },
      clickedAt: Date
    },
    webhook: {
      enabled: {
        type: Boolean,
        default: false
      },
      url: String,
      sent: {
        type: Boolean,
        default: false
      },
      sentAt: Date,
      response: mongoose.Schema.Types.Mixed
    }
  },

  // Notification Status
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'read', 'failed', 'expired'],
    default: 'pending'
  },

  // Scheduling and Timing
  scheduledFor: Date,
  expiresAt: Date,
  sentAt: Date,

  // User Preferences Override
  preferencesOverride: {
    email: Boolean,
    sms: Boolean,
    push: Boolean,
    inApp: Boolean
  },

  // Notification Grouping
  group: {
    groupId: String,
    groupName: String,
    isGroup: {
      type: Boolean,
      default: false
    },
    groupCount: {
      type: Number,
      default: 1
    }
  },

  // Action and Interaction
  actions: [{
    type: {
      type: String,
      enum: ['button', 'link', 'dismiss', 'snooze'],
      required: true
    },
    label: String,
    url: String,
    action: String,
    primary: {
      type: Boolean,
      default: false
    },
    style: {
      type: String,
      enum: ['primary', 'secondary', 'destructive'],
      default: 'primary'
    }
  }],
  requiresAction: {
    type: Boolean,
    default: false
  },
  actionTaken: {
    type: Boolean,
    default: false
  },
  actionTakenAt: Date,
  actionData: mongoose.Schema.Types.Mixed,

  // Notification Source and Context
  source: {
    type: String,
    enum: ['system', 'user', 'vendor', 'admin', 'api', 'webhook'],
    default: 'system'
  },
  triggeredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  context: {
    ipAddress: String,
    userAgent: String,
    device: String,
    platform: String,
    location: String,
    sessionId: String,
    requestId: String
  },

  // Notification Template
  template: {
    templateId: String,
    templateName: String,
    variables: mongoose.Schema.Types.Mixed,
    language: {
      type: String,
      default: 'en'
    }
  },

  // Tracking and Analytics
  tracking: {
    campaignId: String,
    campaignName: String,
    utmSource: String,
    utmMedium: String,
    utmCampaign: String,
    utmTerm: String,
    utmContent: String,
    clicks: {
      type: Number,
      default: 0
    },
    impressions: {
      type: Number,
      default: 0
    }
  },

  // Notification Tags and Labels
  tags: [String],
  labels: [String],

  // Notification Frequency and Throttling
  frequency: {
    daily: {
      type: Number,
      default: 0
    },
    weekly: {
      type: Number,
      default: 0
    },
    monthly: {
      type: Number,
      default: 0
    },
    lastSent: Date
  },

  // A/B Testing
  experiment: {
    experimentId: String,
    variant: String,
    group: String
  },

  // Notification Preferences
  preferences: {
    globalEnabled: {
      type: Boolean,
      default: true
    },
    typePreferences: {
      order: { type: Boolean, default: true },
      payment: { type: Boolean, default: true },
      product: { type: Boolean, default: true },
      vendor: { type: Boolean, default: true },
      review: { type: Boolean, default: true },
      chat: { type: Boolean, default: true },
      promotion: { type: Boolean, default: true },
      system: { type: Boolean, default: true },
      security: { type: Boolean, default: true }
    },
    channelPreferences: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      push: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true }
    },
    quietHours: {
      enabled: { type: Boolean, default: false },
      start: String, // HH:MM format
      end: String,   // HH:MM format
      timezone: String
    },
    frequencyLimit: {
      daily: { type: Number, default: 10 },
      hourly: { type: Number, default: 5 }
    }
  },

  // Notification History and Audit
  history: [{
    action: {
      type: String,
      enum: ['created', 'sent', 'delivered', 'read', 'clicked', 'dismissed', 'failed', 'expired'],
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    channel: String,
    details: mongoose.Schema.Types.Mixed,
    error: String
  }],

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  readAt: Date,
  dismissedAt: Date,
  expiredAt: Date,

  // Soft Delete
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

// Indexes for performance
notificationSchema.index({ user: 1 });
notificationSchema.index({ type: 1 });
notificationSchema.index({ category: 1 });
notificationSchema.index({ status: 1 });
notificationSchema.index({ priority: 1 });
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ scheduledFor: 1 });
notificationSchema.index({ expiresAt: 1 });
notificationSchema.index({ 'channels.inApp.read': 1 });
notificationSchema.index({ 'channels.email.sent': 1 });

// Compound indexes
notificationSchema.index({ user: 1, status: 1, createdAt: -1 });
notificationSchema.index({ user: 1, type: 1, 'channels.inApp.read': 1 });
notificationSchema.index({ status: 1, scheduledFor: 1 });
notificationSchema.index({ user: 1, 'preferences.globalEnabled': 1 });

// Virtual for is read
notificationSchema.virtual('isRead').get(function() {
  return this.channels.inApp.read || this.readAt;
});

// Virtual for is expired
notificationSchema.virtual('isExpired').get(function() {
  return this.expiresAt && Date.now() > this.expiresAt;
});

// Virtual for delivery status
notificationSchema.virtual('deliveryStatus').get(function() {
  if (this.channels.inApp.read) return 'read';
  if (this.channels.inApp.sent) return 'delivered';
  if (this.status === 'sent') return 'sent';
  return 'pending';
});

// Pre-save middleware
notificationSchema.pre('save', function(next) {
  // Set default expiration based on type
  if (!this.expiresAt) {
    let expiryDays = 30; // Default

    switch (this.type) {
      case 'promotion':
        expiryDays = 7;
        break;
      case 'security':
        expiryDays = 90;
        break;
      case 'system':
        expiryDays = 60;
        break;
    }

    this.expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
  }

  next();
});

// Instance methods
notificationSchema.methods = {
  // Mark as read
  async markAsRead() {
    if (!this.channels.inApp.read) {
      await this.updateOne({
        'channels.inApp.read': true,
        'channels.inApp.readAt': new Date(),
        readAt: new Date()
      });

      // Add to history
      await this.addHistoryEntry('read', 'inApp');
    }
    return this;
  },

  // Mark as dismissed
  async markAsDismissed() {
    if (!this.channels.inApp.dismissed) {
      await this.updateOne({
        'channels.inApp.dismissed': true,
        'channels.inApp.dismissedAt': new Date(),
        dismissedAt: new Date()
      });

      // Add to history
      await this.addHistoryEntry('dismissed', 'inApp');
    }
    return this;
  },

  // Track click
  async trackClick(channel = 'inApp') {
    const updateField = `channels.${channel}.clicked`;
    const updateTimeField = `channels.${channel}.clickedAt`;

    await this.updateOne({
      $inc: { 'tracking.clicks': 1 },
      $set: {
        [updateField]: true,
        [updateTimeField]: new Date(),
        'channels.inApp.clicked': true,
        'channels.inApp.clickedAt': new Date()
      }
    });

    // Add to history
    await this.addHistoryEntry('clicked', channel);

    return this;
  },

  // Track impression
  async trackImpression() {
    await this.updateOne({
      $inc: { 'tracking.impressions': 1 }
    });

    return this;
  },

  // Add action taken
  async addActionTaken(actionData) {
    await this.updateOne({
      actionTaken: true,
      actionTakenAt: new Date(),
      actionData
    });

    // Add to history
    await this.addHistoryEntry('action_taken', 'system', actionData);

    return this;
  },

  // Send via email
  async sendEmail() {
    if (!this.channels.email.enabled) return false;

    try {
      // Email sending logic would go here
      await this.updateOne({
        'channels.email.sent': true,
        'channels.email.sentAt': new Date(),
        status: 'sent'
      });

      await this.addHistoryEntry('sent', 'email');
      return true;
    } catch (error) {
      await this.updateOne({
        'channels.email.failed': true,
        'channels.email.failedAt': new Date(),
        status: 'failed'
      });

      await this.addHistoryEntry('failed', 'email', { error: error.message });
      return false;
    }
  },

  // Send via SMS
  async sendSMS() {
    if (!this.channels.sms.enabled) return false;

    try {
      // SMS sending logic would go here
      await this.updateOne({
        'channels.sms.sent': true,
        'channels.sms.sentAt': new Date(),
        status: 'sent'
      });

      await this.addHistoryEntry('sent', 'sms');
      return true;
    } catch (error) {
      await this.updateOne({
        'channels.sms.failed': true,
        'channels.sms.failedAt': new Date(),
        status: 'failed'
      });

      await this.addHistoryEntry('failed', 'sms', { error: error.message });
      return false;
    }
  },

  // Send push notification
  async sendPush() {
    if (!this.channels.push.enabled) return false;

    try {
      // Push notification logic would go here
      await this.updateOne({
        'channels.push.sent': true,
        'channels.push.sentAt': new Date(),
        status: 'sent'
      });

      await this.addHistoryEntry('sent', 'push');
      return true;
    } catch (error) {
      await this.addHistoryEntry('failed', 'push', { error: error.message });
      return false;
    }
  },

  // Add history entry
  async addHistoryEntry(action, channel, details = {}) {
    await this.updateOne({
      $push: {
        history: {
          action,
          channel,
          timestamp: new Date(),
          details
        }
      }
    });
  },

  // Check if user preferences allow this notification
  shouldSend() {
    // Check global preferences
    if (!this.preferencesOverride && !this.preferences.globalEnabled) {
      return false;
    }

    // Check type preferences
    if (!this.preferencesOverride && !this.preferences.typePreferences[this.type]) {
      return false;
    }

    // Check quiet hours
    if (this.preferences.quietHours.enabled) {
      const now = new Date();
      const currentTime = now.getHours() * 60 + now.getMinutes();
      const [startHour, startMin] = this.preferences.quietHours.start.split(':').map(Number);
      const [endHour, endMin] = this.preferences.quietHours.end.split(':').map(Number);

      const quietStart = startHour * 60 + startMin;
      const quietEnd = endHour * 60 + endMin;

      if (currentTime >= quietStart && currentTime <= quietEnd) {
        return false;
      }
    }

    // Check frequency limits
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // This would need to be implemented with actual counting logic
    // For now, return true
    return true;
  },

  // Get notification summary
  getNotificationSummary() {
    return {
      notificationId: this.notificationId,
      type: this.type,
      title: this.title,
      message: this.message,
      priority: this.priority,
      createdAt: this.createdAt,
      isRead: this.isRead,
      hasActions: this.actions.length > 0,
      channels: {
        inApp: this.channels.inApp.sent,
        email: this.channels.email.sent,
        sms: this.channels.sms.sent,
        push: this.channels.push.sent
      }
    };
  }
};

// Static methods
notificationSchema.statics = {
  // Find notifications by user
  async findByUser(userId, options = {}) {
    const {
      type,
      status = 'sent',
      unreadOnly = false,
      limit = 20,
      skip = 0,
      sortBy = 'createdAt'
    } = options;

    let query = { user: userId, isDeleted: false };

    if (type) query.type = type;
    if (status) query.status = status;
    if (unreadOnly) query['channels.inApp.read'] = false;

    let sort = {};
    switch (sortBy) {
      case 'priority':
        sort = { priority: -1, createdAt: -1 };
        break;
      case 'read':
        sort = { 'channels.inApp.read': 1, createdAt: -1 };
        break;
      case 'date':
      default:
        sort = { createdAt: -1 };
    }

    return this.find(query)
      .sort(sort)
      .limit(limit)
      .skip(skip);
  },

  // Get unread count by user
  async getUnreadCount(userId) {
    return this.countDocuments({
      user: userId,
      'channels.inApp.read': false,
      'channels.inApp.sent': true,
      isDeleted: false
    });
  },

  // Create notification
  async createNotification(userId, notificationData) {
    const notification = new this({
      user: userId,
      ...notificationData
    });

    return notification.save();
  },

  // Create bulk notifications
  async createBulkNotifications(users, notificationData) {
    const notifications = users.map(userId => ({
      user: userId,
      ...notificationData
    }));

    return this.insertMany(notifications);
  },

  // Get notifications by type
  async getByType(type, options = {}) {
    const { limit = 20, skip = 0 } = options;

    return this.find({ type, isDeleted: false })
      .populate('user', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip);
  },

  // Get notifications pending delivery
  async getPendingDelivery() {
    return this.find({
      status: 'pending',
      scheduledFor: { $lte: new Date() },
      isDeleted: false
    })
    .sort({ priority: -1, createdAt: 1 });
  },

  // Get expired notifications
  async getExpiredNotifications() {
    return this.find({
      expiresAt: { $lt: new Date() },
      status: { $ne: 'expired' },
      isDeleted: false
    });
  },

  // Mark expired notifications
  async markExpiredNotifications() {
    const expiredNotifications = await this.getExpiredNotifications();

    if (expiredNotifications.length > 0) {
      const ids = expiredNotifications.map(n => n._id);

      await this.updateMany(
        { _id: { $in: ids } },
        {
          status: 'expired',
          expiredAt: new Date()
        }
      );
    }

    return expiredNotifications.length;
  },

  // Clean up old notifications
  async cleanupOldNotifications(daysOld = 90) {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    const result = await this.updateMany(
      {
        createdAt: { $lt: cutoffDate },
        status: { $in: ['read', 'dismissed'] },
        isDeleted: false
      },
      {
        isDeleted: true,
        deletedAt: new Date()
      }
    );

    return result.modifiedCount;
  },

  // Get notification statistics
  async getNotificationStats(dateRange = 30) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const stats = await this.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          isDeleted: false
        }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          sentCount: {
            $sum: { $cond: ['$channels.inApp.sent', 1, 0] }
          },
          readCount: {
            $sum: { $cond: ['$channels.inApp.read', 1, 0] }
          },
          emailSent: {
            $sum: { $cond: ['$channels.email.sent', 1, 0] }
          },
          smsSent: {
            $sum: { $cond: ['$channels.sms.sent', 1, 0] }
          },
          pushSent: {
            $sum: { $cond: ['$channels.push.sent', 1, 0] }
          }
        }
      }
    ]);

    return stats;
  },

  // Get user engagement stats
  async getUserEngagementStats(userId, dateRange = 30) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const stats = await this.aggregate([
      {
        $match: {
          user: userId,
          createdAt: { $gte: startDate },
          'channels.inApp.sent': true,
          isDeleted: false
        }
      },
      {
        $group: {
          _id: null,
          totalNotifications: { $sum: 1 },
          readNotifications: {
            $sum: { $cond: ['$channels.inApp.read', 1, 0] }
          },
          clickedNotifications: {
            $sum: { $cond: ['$channels.inApp.clicked', 1, 0] }
          },
          dismissedNotifications: {
            $sum: { $cond: ['$channels.inApp.dismissed', 1, 0] }
          }
        }
      }
    ]);

    return stats[0] || {
      totalNotifications: 0,
      readNotifications: 0,
      clickedNotifications: 0,
      dismissedNotifications: 0
    };
  },

  // Schedule notification
  async scheduleNotification(userId, notificationData, scheduledFor) {
    const notification = new this({
      user: userId,
      ...notificationData,
      status: 'pending',
      scheduledFor
    });

    return notification.save();
  },

  // Send real-time notification
  async sendRealTimeNotification(userId, notificationData) {
    const notification = await this.createNotification(userId, {
      ...notificationData,
      status: 'sent',
      'channels.inApp.sent': true,
      'channels.inApp.sentAt': new Date()
    });

    // Emit real-time notification via Socket.IO
    // This would be handled by the notification service

    return notification;
  },

  // Update user preferences
  async updateUserPreferences(userId, preferences) {
    return this.updateMany(
      { user: userId },
      { preferences }
    );
  }
};

module.exports = mongoose.model('Notification', notificationSchema);
