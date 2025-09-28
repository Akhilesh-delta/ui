const mongoose = require('mongoose');

const analyticsSchema = new mongoose.Schema({
  // Analytics identification
  type: {
    type: String,
    required: true,
    enum: [
      'user_registration', 'user_login', 'user_activity',
      'product_view', 'product_purchase', 'product_rating',
      'order_placed', 'order_completed', 'order_cancelled',
      'vendor_registration', 'vendor_sale', 'vendor_payout',
      'payment_success', 'payment_failed', 'refund_processed',
      'cart_abandoned', 'cart_converted', 'wishlist_added',
      'review_posted', 'chat_message', 'video_call',
      'system_error', 'api_call', 'page_view',
      'search_performed', 'category_viewed', 'promotion_used'
    ]
  },

  // Related entity references
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store'
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  },
  chat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat'
  },
  videoCall: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'VideoCall'
  },

  // Analytics data
  data: {
    // User analytics
    userAgent: String,
    ipAddress: String,
    deviceType: String,
    browser: String,
    platform: String,
    location: {
      country: String,
      region: String,
      city: String,
      coordinates: {
        lat: Number,
        lng: Number
      }
    },

    // Product/Order analytics
    quantity: Number,
    price: Number,
    currency: String,
    discount: Number,
    tax: Number,
    shipping: Number,

    // Performance metrics
    responseTime: Number,
    errorCode: String,
    errorMessage: String,

    // Custom metrics
    metadata: mongoose.Schema.Types.Mixed
  },

  // Time-based tracking
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  date: {
    type: String,
    index: true // YYYY-MM-DD format for daily aggregations
  },
  hour: {
    type: Number,
    index: true // 0-23 for hourly aggregations
  },
  week: {
    type: String,
    index: true // YYYY-WW format for weekly aggregations
  },
  month: {
    type: String,
    index: true // YYYY-MM format for monthly aggregations
  },

  // Session tracking
  sessionId: {
    type: String,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },

  // Source tracking
  source: {
    type: String,
    enum: ['web', 'mobile', 'api', 'admin', 'system'],
    default: 'web'
  },
  referrer: String,
  utm_source: String,
  utm_medium: String,
  utm_campaign: String,
  utm_term: String,
  utm_content: String,

  // Value tracking
  value: {
    type: Number,
    default: 0
  },
  currency: {
    type: String,
    default: 'USD'
  },

  // Performance tracking
  performance: {
    pageLoadTime: Number,
    domContentLoaded: Number,
    firstPaint: Number,
    firstContentfulPaint: Number,
    largestContentfulPaint: Number,
    firstInputDelay: Number,
    cumulativeLayoutShift: Number
  },

  // Status and flags
  isProcessed: {
    type: Boolean,
    default: false,
    index: true
  },
  isAnomaly: {
    type: Boolean,
    default: false
  },
  anomalyScore: {
    type: Number,
    default: 0
  },

  // Aggregation flags
  requiresAggregation: {
    type: Boolean,
    default: true
  },
  aggregationDate: Date
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
analyticsSchema.index({ type: 1, timestamp: -1 });
analyticsSchema.index({ user: 1, timestamp: -1 });
analyticsSchema.index({ product: 1, timestamp: -1 });
analyticsSchema.index({ vendor: 1, timestamp: -1 });
analyticsSchema.index({ order: 1, timestamp: -1 });
analyticsSchema.index({ date: 1, type: 1 });
analyticsSchema.index({ sessionId: 1, timestamp: -1 });
analyticsSchema.index({ isProcessed: 1, timestamp: 1 });

// Compound indexes for complex queries
analyticsSchema.index({ type: 1, date: 1, user: 1 });
analyticsSchema.index({ product: 1, type: 1, timestamp: -1 });
analyticsSchema.index({ vendor: 1, type: 1, date: 1 });

// Virtual for formatted timestamp
analyticsSchema.virtual('formattedTimestamp').get(function() {
  return this.timestamp.toISOString();
});

// Instance methods
analyticsSchema.methods = {
  // Mark as processed
  async markProcessed() {
    this.isProcessed = true;
    this.aggregationDate = new Date();
    await this.save();
  },

  // Calculate value based on type
  calculateValue() {
    switch (this.type) {
      case 'product_purchase':
      case 'order_completed':
        this.value = this.data.price || 0;
        break;
      case 'vendor_sale':
        this.value = this.data.commission || 0;
        break;
      case 'payment_success':
        this.value = this.data.amount || 0;
        break;
      case 'refund_processed':
        this.value = -(this.data.amount || 0);
        break;
      default:
        this.value = 0;
    }
  },

  // Detect anomalies
  detectAnomaly(baseline = {}) {
    let score = 0;

    // Check for unusual values
    if (this.value > (baseline.averageValue || 0) * 3) {
      score += 30;
    }

    // Check for unusual frequency
    if (baseline.frequency && baseline.frequency > 10) {
      score += 20;
    }

    // Check for unusual location
    if (baseline.locations && !baseline.locations.includes(this.data.location?.country)) {
      score += 15;
    }

    // Check for unusual device
    if (baseline.devices && !baseline.devices.includes(this.data.deviceType)) {
      score += 10;
    }

    this.anomalyScore = score;
    this.isAnomaly = score > 50;

    return this.isAnomaly;
  }
};

// Static methods
analyticsSchema.statics = {
  // Track analytics event
  async track(event) {
    const analytics = new Analytics({
      ...event,
      date: new Date().toISOString().split('T')[0],
      hour: new Date().getHours(),
      week: this.getWeekOfYear(),
      month: new Date().toISOString().substring(0, 7),
      sessionId: event.sessionId,
      userId: event.user,
      source: event.source || 'web'
    });

    // Calculate value
    analytics.calculateValue();

    await analytics.save();

    // Process in background for real-time analytics
    this.processAnalyticsEvent(analytics);

    return analytics;
  },

  // Get week of year
  getWeekOfYear() {
    const d = new Date();
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNo = Math.ceil(((d - yearStart) / 86400000 + yearStart.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
  },

  // Process analytics event
  async processAnalyticsEvent(analytics) {
    try {
      // Update real-time metrics
      await this.updateRealTimeMetrics(analytics);

      // Check for anomalies
      const baseline = await this.getBaselineMetrics(analytics.type);
      analytics.detectAnomaly(baseline);

      if (analytics.isAnomaly) {
        await this.handleAnomaly(analytics);
      }

      // Mark as processed
      await analytics.markProcessed();

    } catch (error) {
      logger.error('Error processing analytics event:', error);
    }
  },

  // Update real-time metrics
  async updateRealTimeMetrics(analytics) {
    const cacheKey = `realtime_${analytics.type}`;
    const currentMetrics = await getCache(cacheKey) || {
      count: 0,
      value: 0,
      lastUpdated: new Date()
    };

    currentMetrics.count += 1;
    currentMetrics.value += analytics.value || 0;
    currentMetrics.lastUpdated = new Date();

    await setCache(cacheKey, currentMetrics, 300); // 5 minutes
  },

  // Get baseline metrics for anomaly detection
  async getBaselineMetrics(type) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const metrics = await this.aggregate([
      { $match: { type, timestamp: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: null,
          averageValue: { $avg: '$value' },
          totalCount: { $sum: 1 },
          locations: { $addToSet: '$data.location.country' },
          devices: { $addToSet: '$data.deviceType' }
        }
      }
    ]);

    return metrics[0] || {};
  },

  // Handle anomaly detection
  async handleAnomaly(analytics) {
    // Create notification for admin
    await Notification.createNotification(null, {
      type: 'system',
      category: 'security',
      title: 'Analytics Anomaly Detected',
      message: `Unusual activity detected: ${analytics.type} with value ${analytics.value}`,
      data: {
        analyticsId: analytics._id,
        type: analytics.type,
        value: analytics.value,
        anomalyScore: analytics.anomalyScore
      },
      priority: 'high'
    });

    logger.warn('Analytics anomaly detected', {
      analyticsId: analytics._id,
      type: analytics.type,
      value: analytics.value,
      anomalyScore: analytics.anomalyScore
    });
  },

  // Get analytics summary
  async getAnalyticsSummary(type, dateRange = 30) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const summary = await this.aggregate([
      { $match: { type, timestamp: { $gte: startDate } } },
      {
        $group: {
          _id: null,
          totalEvents: { $sum: 1 },
          totalValue: { $sum: '$value' },
          averageValue: { $avg: '$value' },
          uniqueUsers: { $addToSet: '$user' },
          uniqueSessions: { $addToSet: '$sessionId' }
        }
      },
      {
        $project: {
          totalEvents: 1,
          totalValue: 1,
          averageValue: 1,
          uniqueUsers: { $size: '$uniqueUsers' },
          uniqueSessions: { $size: '$uniqueSessions' }
        }
      }
    ]);

    return summary[0] || {
      totalEvents: 0,
      totalValue: 0,
      averageValue: 0,
      uniqueUsers: 0,
      uniqueSessions: 0
    };
  },

  // Get time series data
  async getTimeSeries(type, interval = 'day', dateRange = 30) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);
    const groupBy = this.getGroupByField(interval);

    const timeSeries = await this.aggregate([
      { $match: { type, timestamp: { $gte: startDate } } },
      {
        $group: {
          _id: groupBy,
          count: { $sum: 1 },
          value: { $sum: '$value' },
          uniqueUsers: { $addToSet: '$user' }
        }
      },
      {
        $project: {
          date: '$_id',
          count: 1,
          value: 1,
          uniqueUsers: { $size: '$uniqueUsers' }
        }
      },
      { $sort: { date: 1 } }
    ]);

    return timeSeries;
  },

  // Get group by field for aggregation
  getGroupByField(interval) {
    switch (interval) {
      case 'hour':
        return { $dateToString: { format: '%Y-%m-%d-%H', date: '$timestamp' } };
      case 'day':
        return { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } };
      case 'week':
        return '$week';
      case 'month':
        return '$month';
      default:
        return { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } };
    }
  },

  // Get top performers
  async getTopPerformers(type, field, limit = 10) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const topPerformers = await this.aggregate([
      { $match: { type, timestamp: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: `$${field}`,
          count: { $sum: 1 },
          totalValue: { $sum: '$value' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: field === 'user' ? 'users' : 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'entity'
        }
      },
      { $unwind: '$entity' }
    ]);

    return topPerformers;
  },

  // Get user behavior analytics
  async getUserBehaviorAnalytics(userId, dateRange = 30) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const behavior = await this.aggregate([
      { $match: { user: userId, timestamp: { $gte: startDate } } },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          totalValue: { $sum: '$value' },
          firstSeen: { $min: '$timestamp' },
          lastSeen: { $max: '$timestamp' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    return behavior;
  },

  // Get conversion funnel
  async getConversionFunnel(dateRange = 30) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const funnel = await this.aggregate([
      { $match: { timestamp: { $gte: startDate } } },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    return funnel;
  },

  // Get geographic analytics
  async getGeographicAnalytics(type, dateRange = 30) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const geoAnalytics = await this.aggregate([
      { $match: { type, timestamp: { $gte: startDate }, 'data.location.country': { $exists: true } } },
      {
        $group: {
          _id: '$data.location.country',
          count: { $sum: 1 },
          totalValue: { $sum: '$value' },
          uniqueUsers: { $addToSet: '$user' }
        }
      },
      {
        $project: {
          country: '$_id',
          count: 1,
          totalValue: 1,
          uniqueUsers: { $size: '$uniqueUsers' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    return geoAnalytics;
  },

  // Get device analytics
  async getDeviceAnalytics(type, dateRange = 30) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const deviceAnalytics = await this.aggregate([
      { $match: { type, timestamp: { $gte: startDate }, 'data.deviceType': { $exists: true } } },
      {
        $group: {
          _id: '$data.deviceType',
          count: { $sum: 1 },
          totalValue: { $sum: '$value' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    return deviceAnalytics;
  },

  // Clean up old analytics data
  async cleanupOldData(daysOld = 365) {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    const result = await this.deleteMany({
      timestamp: { $lt: cutoffDate },
      isProcessed: true
    });

    return result.deletedCount;
  },

  // Get real-time metrics
  async getRealTimeMetrics() {
    const cache = require('../services/cacheService');
    const { getCache } = cache;

    const metrics = {};

    // Get all real-time metrics from cache
    const realtimeKeys = await getCache('realtime_keys') || [];

    for (const key of realtimeKeys) {
      metrics[key] = await getCache(key);
    }

    return metrics;
  },

  // Export analytics data
  async exportAnalytics(type, format = 'json', dateRange = 30) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const data = await this.find({
      type,
      timestamp: { $gte: startDate }
    }).sort({ timestamp: 1 });

    if (format === 'csv') {
      return this.generateCSV(data);
    }

    return data;
  },

  // Generate CSV from analytics data
  generateCSV(data) {
    const headers = ['Type', 'Timestamp', 'User', 'Value', 'Source', 'Location'];
    const rows = data.map(item => [
      item.type,
      item.timestamp.toISOString(),
      item.user || '',
      item.value || 0,
      item.source || '',
      item.data?.location?.country || ''
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }
};

// Pre-save middleware
analyticsSchema.pre('save', function(next) {
  // Set date fields
  const now = new Date();
  this.date = now.toISOString().split('T')[0];
  this.hour = now.getHours();
  this.week = Analytics.getWeekOfYear();
  this.month = now.toISOString().substring(0, 7);

  next();
});

// Post-save middleware for processing
analyticsSchema.post('save', function(doc) {
  // Add to real-time metrics tracking
  if (!doc.isProcessed) {
    setTimeout(() => {
      Analytics.processAnalyticsEvent(doc);
    }, 100);
  }
});

const Analytics = mongoose.model('Analytics', analyticsSchema);

module.exports = Analytics;
