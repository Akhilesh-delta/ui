const mongoose = require('mongoose');
const validator = require('validator');

const reviewSchema = new mongoose.Schema({
  // Review Identification
  reviewId: {
    type: String,
    unique: true,
    required: true,
    default: () => `REV-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
  },

  // Review Author
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User is required']
  },

  // Review Target
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: [true, 'Product is required']
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Vendor is required']
  },
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: [true, 'Store is required']
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },

  // Review Content
  title: {
    type: String,
    required: [true, 'Review title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters'],
    minlength: [5, 'Title must be at least 5 characters']
  },
  content: {
    type: String,
    required: [true, 'Review content is required'],
    maxlength: [5000, 'Content cannot exceed 5000 characters'],
    minlength: [10, 'Content must be at least 10 characters']
  },
  rating: {
    type: Number,
    required: [true, 'Rating is required'],
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating cannot exceed 5']
  },

  // Detailed Ratings
  detailedRatings: {
    quality: {
      type: Number,
      min: 1,
      max: 5
    },
    value: {
      type: Number,
      min: 1,
      max: 5
    },
    shipping: {
      type: Number,
      min: 1,
      max: 5
    },
    packaging: {
      type: Number,
      min: 1,
      max: 5
    },
    customerService: {
      type: Number,
      min: 1,
      max: 5
    }
  },

  // Review Images and Media
  images: [{
    url: {
      type: String,
      required: true
    },
    public_id: {
      type: String,
      required: true
    },
    thumbnail: String,
    alt: String,
    caption: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  videos: [{
    url: String,
    public_id: String,
    thumbnail: String,
    caption: String,
    duration: Number,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],

  // Review Verification
  isVerifiedPurchase: {
    type: Boolean,
    default: false
  },
  isVerifiedReviewer: {
    type: Boolean,
    default: false
  },
  verificationMethod: {
    type: String,
    enum: ['order_verification', 'manual_verification', 'third_party'],
    default: 'order_verification'
  },

  // Review Status and Moderation
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'flagged', 'hidden', 'deleted'],
    default: 'pending'
  },
  moderation: {
    moderatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    moderatedAt: Date,
    reason: String,
    notes: String,
    flags: [{
      type: {
        type: String,
        enum: ['inappropriate', 'spam', 'fake', 'harassment', 'offensive', 'irrelevant'],
        required: true
      },
      reportedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      reason: String,
      reportedAt: {
        type: Date,
        default: Date.now
      },
      status: {
        type: String,
        enum: ['pending', 'reviewed', 'dismissed', 'actioned'],
        default: 'pending'
      }
    }]
  },

  // Review Engagement
  helpful: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    votedAt: {
      type: Date,
      default: Date.now
    }
  }],
  notHelpful: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    votedAt: {
      type: Date,
      default: Date.now
    }
  }],
  comments: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    content: {
      type: String,
      required: true,
      maxlength: [1000, 'Comment cannot exceed 1000 characters']
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: Date,
    status: {
      type: String,
      enum: ['active', 'hidden', 'deleted'],
      default: 'active'
    }
  }],

  // Review Analytics
  analytics: {
    views: {
      type: Number,
      default: 0
    },
    clicks: {
      type: Number,
      default: 0
    },
    shares: {
      type: Number,
      default: 0
    },
    helpfulVotes: {
      type: Number,
      default: 0
    },
    notHelpfulVotes: {
      type: Number,
      default: 0
    },
    lastViewed: Date,
    lastShared: Date
  },

  // Review Metadata
  pros: [{
    type: String,
    maxlength: [200, 'Pro cannot exceed 200 characters']
  }],
  cons: [{
    type: String,
    maxlength: [200, 'Con cannot exceed 200 characters']
  }],
  recommendation: {
    type: String,
    enum: ['yes', 'no', 'maybe'],
    required: [true, 'Recommendation is required']
  },
  purchaseInfo: {
    wouldBuyAgain: {
      type: Boolean,
      default: null
    },
    purchasePrice: Number,
    purchaseDate: Date,
    usageDuration: String
  },

  // Review Context
  context: {
    device: String,
    platform: {
      type: String,
      enum: ['web', 'mobile', 'ios', 'android']
    },
    location: String,
    language: String,
    userAgent: String,
    ipAddress: String
  },

  // Review Response (from vendor)
  response: {
    content: String,
    respondedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    respondedAt: Date,
    isPublic: {
      type: Boolean,
      default: true
    }
  },

  // Review Type and Purpose
  type: {
    type: String,
    enum: ['product', 'vendor', 'store', 'service', 'delivery'],
    default: 'product'
  },
  purpose: {
    type: String,
    enum: ['review', 'testimonial', 'complaint', 'suggestion', 'question'],
    default: 'review'
  },

  // Review Sentiment Analysis
  sentiment: {
    score: {
      type: Number,
      min: -1,
      max: 1
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1
    },
    keywords: [String],
    entities: [String],
    analyzedAt: Date
  },

  // Review Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  publishedAt: Date,
  editedAt: Date,

  // Audit Information
  editedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  editHistory: [{
    content: String,
    rating: Number,
    editedAt: {
      type: Date,
      default: Date.now
    },
    reason: String
  }],

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
reviewSchema.index({ user: 1 });
reviewSchema.index({ product: 1 });
reviewSchema.index({ vendor: 1 });
reviewSchema.index({ store: 1 });
reviewSchema.index({ order: 1 });
reviewSchema.index({ rating: 1 });
reviewSchema.index({ status: 1 });
reviewSchema.index({ isVerifiedPurchase: 1 });
reviewSchema.index({ recommendation: 1 });
reviewSchema.index({ createdAt: -1 });
reviewSchema.index({ 'analytics.helpfulVotes': -1 });

// Compound indexes
reviewSchema.index({ product: 1, status: 1, rating: -1 });
reviewSchema.index({ vendor: 1, status: 1, isVerifiedPurchase: 1 });
reviewSchema.index({ status: 1, createdAt: -1 });
reviewSchema.index({ 'sentiment.score': -1 });

// Virtual for helpfulness ratio
reviewSchema.virtual('helpfulnessRatio').get(function() {
  const totalVotes = this.analytics.helpfulVotes + this.analytics.notHelpfulVotes;
  if (totalVotes === 0) return 0;
  return this.analytics.helpfulVotes / totalVotes;
});

// Virtual for is recent
reviewSchema.virtual('isRecent').get(function() {
  const daysSinceCreated = Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24));
  return daysSinceCreated <= 30;
});

// Pre-save middleware
reviewSchema.pre('save', function(next) {
  // Update analytics helpful votes count
  this.analytics.helpfulVotes = this.helpful.length;
  this.analytics.notHelpfulVotes = this.notHelpful.length;

  // Set published date when approved
  if (this.isModified('status') && this.status === 'approved' && !this.publishedAt) {
    this.publishedAt = new Date();
  }

  next();
});

// Instance methods
reviewSchema.methods = {
  // Mark review as helpful
  async markAsHelpful(userId) {
    // Remove from not helpful if exists
    await this.updateOne({
      $pull: { notHelpful: { user: userId } }
    });

    // Add to helpful if not already there
    const alreadyHelpful = this.helpful.some(h => h.user.equals(userId));
    if (!alreadyHelpful) {
      await this.updateOne({
        $push: { helpful: { user: userId, votedAt: new Date() } }
      });
    }

    return this;
  },

  // Mark review as not helpful
  async markAsNotHelpful(userId) {
    // Remove from helpful if exists
    await this.updateOne({
      $pull: { helpful: { user: userId } }
    });

    // Add to not helpful if not already there
    const alreadyNotHelpful = this.notHelpful.some(nh => nh.user.equals(userId));
    if (!alreadyNotHelpful) {
      await this.updateOne({
        $push: { notHelpful: { user: userId, votedAt: new Date() } }
      });
    }

    return this;
  },

  // Add comment to review
  async addComment(userId, content) {
    const comment = {
      user: userId,
      content,
      createdAt: new Date()
    };

    await this.updateOne({
      $push: { comments: comment }
    });

    return comment;
  },

  // Edit review
  async editReview(updates, editedBy, reason = 'User edit') {
    const oldContent = this.content;
    const oldRating = this.rating;

    // Apply updates
    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        this[key] = updates[key];
      }
    });

    this.editedAt = new Date();
    this.editedBy = editedBy;

    // Add to edit history
    this.editHistory.push({
      content: oldContent,
      rating: oldRating,
      editedAt: new Date(),
      reason
    });

    await this.save();

    return this;
  },

  // Flag review for moderation
  async flagReview(flagType, reportedBy, reason = '') {
    const flag = {
      type: flagType,
      reportedBy,
      reason,
      reportedAt: new Date(),
      status: 'pending'
    };

    await this.updateOne({
      $push: { 'moderation.flags': flag },
      status: 'flagged'
    });

    return flag;
  },

  // Approve review
  async approveReview(moderatedBy, notes = '') {
    await this.updateOne({
      status: 'approved',
      'moderation.moderatedBy': moderatedBy,
      'moderation.moderatedAt': new Date(),
      'moderation.notes': notes
    });

    // Update product rating
    await this.updateProductRating();

    return this;
  },

  // Reject review
  async rejectReview(moderatedBy, reason, notes = '') {
    await this.updateOne({
      status: 'rejected',
      'moderation.moderatedBy': moderatedBy,
      'moderation.moderatedAt': new Date(),
      'moderation.reason': reason,
      'moderation.notes': notes
    });

    return this;
  },

  // Update product rating
  async updateProductRating() {
    const Product = mongoose.model('Product');
    const product = await Product.findById(this.product);

    if (product) {
      // Recalculate product rating
      const reviews = await mongoose.model('Review').find({
        product: this.product,
        status: 'approved'
      });

      if (reviews.length > 0) {
        const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
        const averageRating = totalRating / reviews.length;

        // Update rating distribution
        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        reviews.forEach(review => {
          distribution[review.rating]++;
        });

        await product.updateOne({
          rating: {
            average: Math.round(averageRating * 10) / 10,
            count: reviews.length,
            distribution
          }
        });
      }
    }
  },

  // Add response from vendor
  async addVendorResponse(content, respondedBy) {
    this.response = {
      content,
      respondedBy,
      respondedAt: new Date(),
      isPublic: true
    };

    await this.save();

    return this.response;
  },

  // Track view
  async trackView() {
    await this.updateOne({
      $inc: { 'analytics.views': 1 },
      'analytics.lastViewed': new Date()
    });
  },

  // Track share
  async trackShare() {
    await this.updateOne({
      $inc: { 'analytics.shares': 1 },
      'analytics.lastShared': new Date()
    });
  },

  // Get review summary
  getReviewSummary() {
    return {
      reviewId: this.reviewId,
      title: this.title,
      rating: this.rating,
      content: this.content.substring(0, 200) + (this.content.length > 200 ? '...' : ''),
      user: this.user,
      product: this.product,
      createdAt: this.createdAt,
      status: this.status,
      helpfulVotes: this.analytics.helpfulVotes,
      imageCount: this.images.length,
      isVerifiedPurchase: this.isVerifiedPurchase
    };
  }
};

// Static methods
reviewSchema.statics = {
  // Find reviews by product
  async findByProduct(productId, options = {}) {
    const {
      rating,
      verified = false,
      status = 'approved',
      sortBy = 'createdAt',
      limit = 20,
      skip = 0
    } = options;

    let query = { product: productId, status };

    if (rating) query.rating = rating;
    if (verified) query.isVerifiedPurchase = true;

    let sort = {};
    switch (sortBy) {
      case 'rating':
        sort = { rating: -1 };
        break;
      case 'helpful':
        sort = { 'analytics.helpfulVotes': -1 };
        break;
      case 'recent':
      default:
        sort = { createdAt: -1 };
    }

    return this.find(query)
      .populate('user', 'firstName lastName avatar')
      .sort(sort)
      .limit(limit)
      .skip(skip);
  },

  // Find reviews by user
  async findByUser(userId, options = {}) {
    const { status = 'approved', limit = 20, skip = 0 } = options;

    return this.find({ user: userId, status })
      .populate('product', 'name slug images')
      .populate('vendor', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip);
  },

  // Find reviews by vendor
  async findByVendor(vendorId, options = {}) {
    const { status = 'approved', limit = 20, skip = 0 } = options;

    return this.find({ vendor: vendorId, status })
      .populate('user', 'firstName lastName avatar')
      .populate('product', 'name slug images')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip);
  },

  // Get review statistics
  async getReviewStats(productId = null) {
    let matchStage = { status: 'approved' };

    if (productId) {
      matchStage.product = mongoose.Types.ObjectId(productId);
    }

    const stats = await this.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          averageRating: { $avg: '$rating' },
          ratingDistribution: {
            $push: '$rating'
          }
        }
      },
      {
        $project: {
          totalReviews: 1,
          averageRating: { $round: ['$averageRating', 2] },
          ratingDistribution: {
            1: { $size: { $filter: { input: '$ratingDistribution', cond: { $eq: ['$$this', 1] } } } },
            2: { $size: { $filter: { input: '$ratingDistribution', cond: { $eq: ['$$this', 2] } } } },
            3: { $size: { $filter: { input: '$ratingDistribution', cond: { $eq: ['$$this', 3] } } } },
            4: { $size: { $filter: { input: '$ratingDistribution', cond: { $eq: ['$$this', 4] } } } },
            5: { $size: { $filter: { input: '$ratingDistribution', cond: { $eq: ['$$this', 5] } } } }
          }
        }
      }
    ]);

    return stats[0] || {
      totalReviews: 0,
      averageRating: 0,
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    };
  },

  // Get reviews pending moderation
  async getPendingModeration() {
    return this.find({
      status: { $in: ['pending', 'flagged'] }
    })
    .populate('user', 'firstName lastName email')
    .populate('product', 'name slug images')
    .populate('vendor', 'firstName lastName')
    .sort({ createdAt: 1 });
  },

  // Get top rated reviews
  async getTopRatedReviews(limit = 10) {
    return this.find({
      status: 'approved',
      'analytics.helpfulVotes': { $gte: 5 }
    })
    .populate('user', 'firstName lastName avatar')
    .populate('product', 'name slug images')
    .sort({ 'analytics.helpfulVotes': -1, rating: -1 })
    .limit(limit);
  },

  // Get recent reviews
  async getRecentReviews(limit = 20) {
    return this.find({ status: 'approved' })
      .populate('user', 'firstName lastName avatar')
      .populate('product', 'name slug images')
      .sort({ createdAt: -1 })
      .limit(limit);
  },

  // Search reviews
  async searchReviews(searchTerm, options = {}) {
    const { productId, rating, limit = 20, skip = 0 } = options;

    let query = {
      $and: [
        {
          $or: [
            { title: { $regex: searchTerm, $options: 'i' } },
            { content: { $regex: searchTerm, $options: 'i' } }
          ]
        },
        { status: 'approved' }
      ]
    };

    if (productId) query.$and.push({ product: productId });
    if (rating) query.$and.push({ rating });

    return this.find(query)
      .populate('user', 'firstName lastName avatar')
      .populate('product', 'name slug images')
      .sort({ 'analytics.helpfulVotes': -1 })
      .limit(limit)
      .skip(skip);
  },

  // Get review analytics
  async getReviewAnalytics(dateRange = 30) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const analytics = await this.aggregate([
      {
        $match: {
          status: 'approved',
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            rating: '$rating'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          totalReviews: { $sum: '$count' },
          averageRating: { $avg: '$_id.rating' },
          ratings: {
            $push: {
              rating: '$_id.rating',
              count: '$count'
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return analytics;
  },

  // Bulk approve reviews
  async bulkApprove(reviewIds, approvedBy) {
    const result = await this.updateMany(
      { _id: { $in: reviewIds } },
      {
        status: 'approved',
        'moderation.moderatedBy': approvedBy,
        'moderation.moderatedAt': new Date()
      }
    );

    // Update product ratings for approved reviews
    const approvedReviews = await this.find({
      _id: { $in: reviewIds },
      status: 'approved'
    }).distinct('product');

    for (const productId of approvedReviews) {
      const review = await this.findOne({ product: productId, status: 'approved' });
      if (review) {
        await review.updateProductRating();
      }
    }

    return result.modifiedCount;
  },

  // Bulk reject reviews
  async bulkReject(reviewIds, rejectedBy, reason) {
    return this.updateMany(
      { _id: { $in: reviewIds } },
      {
        status: 'rejected',
        'moderation.moderatedBy': rejectedBy,
        'moderation.moderatedAt': new Date(),
        'moderation.reason': reason
      }
    );
  },

  // Get reviews by rating
  async getReviewsByRating(rating) {
    return this.find({
      rating,
      status: 'approved'
    })
    .populate('user', 'firstName lastName avatar')
    .populate('product', 'name slug images')
    .sort({ createdAt: -1 });
  },

  // Get verified purchase reviews
  async getVerifiedPurchaseReviews(productId = null, limit = 20) {
    let query = {
      isVerifiedPurchase: true,
      status: 'approved'
    };

    if (productId) query.product = productId;

    return this.find(query)
      .populate('user', 'firstName lastName avatar')
      .populate('product', 'name slug images')
      .sort({ createdAt: -1 })
      .limit(limit);
  }
};

module.exports = mongoose.model('Review', reviewSchema);
