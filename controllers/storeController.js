const Store = require('../models/Store');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Category = require('../models/Category');
const Review = require('../models/Review');
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

class StoreController {
  // ===============================
  // STORE MANAGEMENT
  // ===============================

  // Create new store
  createStore = catchAsync(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const user = await User.findById(req.user.id);

    if (user.role !== 'vendor' && user.role !== 'admin') {
      throw new AppError('Only vendors can create stores', 403, true, 'VENDOR_REQUIRED');
    }

    // Check if user already has a store
    if (user.vendorProfile?.store) {
      throw new AppError('User already has a store', 400, true, 'STORE_ALREADY_EXISTS');
    }

    const {
      name,
      description,
      tagline,
      businessType,
      businessRegistration,
      taxId,
      contact,
      address,
      businessInfo,
      settings,
      policies,
      financial
    } = req.body;

    // Handle logo upload
    let logo = null;
    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: 'stores/logos',
        quality: 'auto',
        format: 'webp'
      });

      logo = {
        url: result.secure_url,
        public_id: result.public_id,
        thumbnail: result.secure_url.replace('/upload/', '/upload/w_300,h_300,c_fill/')
      };
    }

    // Create store
    const store = new Store({
      name,
      description,
      tagline,
      owner: user._id,
      contact,
      address,
      businessInfo: {
        businessType,
        businessRegistration,
        taxId,
        ...businessInfo
      },
      settings: {
        currency: 'USD',
        language: 'en',
        timezone: 'UTC',
        ...settings
      },
      policies: {
        returnPolicy: {
          days: 30,
          conditions: ['Items must be in original condition'],
          ...policies?.returnPolicy
        },
        shippingPolicy: {
          processingTime: 1,
          ...policies?.shippingPolicy
        },
        ...policies
      },
      financial: {
        payoutSettings: {
          method: 'bank_transfer',
          frequency: 'weekly',
          minimumAmount: 10
        },
        taxSettings: {
          collectTax: false,
          taxRate: 0
        },
        ...financial
      },
      branding: {
        logo,
        primaryColor: '#3498db',
        theme: 'modern'
      },
      status: 'pending',
      verificationStatus: 'unverified'
    });

    await store.save();

    // Update user with store reference
    user.vendorProfile = {
      store: store._id,
      storeName: name,
      storeDescription: description,
      businessType,
      businessRegistration,
      taxId,
      isVerified: false,
      performance: {
        rating: 0,
        totalSales: 0,
        totalOrders: 0,
        joinedAt: new Date()
      }
    };

    await user.save();

    // Send welcome notification
    await Notification.createNotification(user._id, {
      type: 'vendor',
      category: 'informational',
      title: 'Store Created Successfully!',
      message: `Your store "${name}" has been created and is pending review.`,
      data: {
        storeId: store._id,
        storeName: name
      },
      priority: 'normal',
      actions: [
        {
          type: 'link',
          label: 'Manage Store',
          url: `/vendor/store`,
          action: 'manage_store'
        }
      ]
    });

    logger.info('Store created', {
      storeId: store._id,
      ownerId: user._id,
      name
    });

    res.status(201).json({
      success: true,
      message: 'Store created successfully',
      data: {
        store,
        user: user.getPublicProfile()
      }
    });
  });

  // Get store details
  getStore = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { includeProducts = false, includeReviews = false, includeAnalytics = false } = req.query;

    const store = await Store.findById(id)
      .populate('owner', 'firstName lastName email')
      .populate('categories.category', 'name slug');

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check if store is accessible
    if (store.status !== 'active' && store.owner._id.toString() !== req.user?.id && req.user?.role !== 'admin') {
      throw new AppError('Store not available', 404, true, 'STORE_NOT_AVAILABLE');
    }

    let products = [];
    let reviews = [];
    let analytics = null;

    if (includeProducts === 'true') {
      products = await store.getProducts({ limit: 20 });
    }

    if (includeReviews === 'true') {
      reviews = await store.getReviews({ limit: 10 });
    }

    if (includeAnalytics === 'true' && (store.owner._id.toString() === req.user?.id || req.user?.role === 'admin')) {
      analytics = await store.getDashboardData(30);
    }

    res.status(200).json({
      success: true,
      data: {
        store,
        products: products || [],
        reviews: reviews || [],
        analytics,
        stats: {
          productCount: store.analytics.totalProducts,
          orderCount: store.analytics.totalOrders,
          rating: store.analytics.rating,
          totalSales: store.analytics.totalSales
        }
      }
    });
  });

  // Update store
  updateStore = catchAsync(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { id } = req.params;
    const updates = req.body;

    const store = await Store.findById(id);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to update this store', 403, true, 'NOT_AUTHORIZED');
    }

    // Handle logo upload
    if (req.file) {
      // Delete old logo
      if (store.branding.logo?.public_id) {
        await cloudinary.uploader.destroy(store.branding.logo.public_id);
      }

      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: 'stores/logos',
        quality: 'auto',
        format: 'webp'
      });

      updates.branding = {
        ...store.branding,
        logo: {
          url: result.secure_url,
          public_id: result.public_id,
          thumbnail: result.secure_url.replace('/upload/', '/upload/w_300,h_300,c_fill/')
        }
      };
    }

    // Handle banner upload
    if (req.files?.banner) {
      const bannerFile = Array.isArray(req.files.banner) ? req.files.banner[0] : req.files.banner;

      if (store.branding.banner?.public_id) {
        await cloudinary.uploader.destroy(store.branding.banner.public_id);
      }

      const result = await cloudinary.uploader.upload(bannerFile.path, {
        folder: 'stores/banners',
        quality: 'auto',
        format: 'webp'
      });

      updates.branding = {
        ...updates.branding,
        banner: {
          url: result.secure_url,
          public_id: result.public_id,
          alt: `${store.name} banner`
        }
      };
    }

    const store = await Store.findByIdAndUpdate(
      id,
      { ...updates, updatedAt: new Date(), updatedBy: req.user.id },
      { new: true, runValidators: true }
    );

    // Update user vendor profile
    if (updates.name || updates.description) {
      await User.findByIdAndUpdate(store.owner, {
        'vendorProfile.storeName': updates.name || store.name,
        'vendorProfile.storeDescription': updates.description || store.description
      });
    }

    logger.info('Store updated', {
      storeId: id,
      updatedBy: req.user.id,
      updates: Object.keys(updates)
    });

    res.status(200).json({
      success: true,
      message: 'Store updated successfully',
      data: store
    });
  });

  // Delete store
  deleteStore = catchAsync(async (req, res) => {
    const { id } = req.params;

    const store = await Store.findById(id);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to delete this store', 403, true, 'NOT_AUTHORIZED');
    }

    // Soft delete store
    store.isDeleted = true;
    store.deletedAt = new Date();
    store.deletedBy = req.user.id;
    await store.save();

    // Update user
    await User.findByIdAndUpdate(store.owner, {
      'vendorProfile.store': null,
      'vendorProfile.storeName': null,
      'vendorProfile.storeDescription': null
    });

    logger.info('Store deleted', {
      storeId: id,
      deletedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Store deleted successfully'
    });
  });

  // ===============================
  // STORE SETTINGS MANAGEMENT
  // ===============================

  // Get store settings
  getStoreSettings = catchAsync(async (req, res) => {
    const { storeId } = req.params;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to view store settings', 403, true, 'NOT_AUTHORIZED');
    }

    res.status(200).json({
      success: true,
      data: {
        settings: store.settings,
        policies: store.policies,
        financial: store.financial,
        branding: store.branding,
        businessHours: store.businessHours,
        features: store.features
      }
    });
  });

  // Update store settings
  updateStoreSettings = catchAsync(async (req, res) => {
    const { storeId } = req.params;
    const { settings, policies, businessHours } = req.body;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to update store settings', 403, true, 'NOT_AUTHORIZED');
    }

    if (settings) {
      store.settings = { ...store.settings, ...settings };
    }

    if (policies) {
      store.policies = { ...store.policies, ...policies };
    }

    if (businessHours) {
      store.businessHours = { ...store.businessHours, ...businessHours };
    }

    await store.save();

    logger.info('Store settings updated', {
      storeId,
      updatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Store settings updated successfully',
      data: {
        settings: store.settings,
        policies: store.policies,
        businessHours: store.businessHours
      }
    });
  });

  // Update store branding
  updateStoreBranding = catchAsync(async (req, res) => {
    const { storeId } = req.params;
    const { primaryColor, secondaryColor, theme, customCSS } = req.body;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to update store branding', 403, true, 'NOT_AUTHORIZED');
    }

    store.branding = {
      ...store.branding,
      primaryColor: primaryColor || store.branding.primaryColor,
      secondaryColor: secondaryColor || store.branding.secondaryColor,
      theme: theme || store.branding.theme,
      customCSS: customCSS || store.branding.customCSS
    };

    await store.save();

    logger.info('Store branding updated', {
      storeId,
      updatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Store branding updated successfully',
      data: store.branding
    });
  });

  // ===============================
  // VENDOR DASHBOARD
  // ===============================

  // Get vendor dashboard
  getVendorDashboard = catchAsync(async (req, res) => {
    const user = await User.findById(req.user.id);
    const store = await Store.findById(user.vendorProfile.store);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Get dashboard data
    const dashboardData = await store.getDashboardData(30);

    // Get recent orders
    const recentOrders = await Order.findByVendor(user._id, { limit: 10 });

    // Get pending orders
    const pendingOrders = await Order.findByVendor(user._id, {
      status: { $in: ['pending', 'processing', 'ready'] },
      limit: 5
    });

    // Get low stock products
    const lowStockProducts = await Product.getLowStockProducts(user._id);

    // Get recent reviews
    const recentReviews = await Review.findByVendor(user._id, { limit: 5 });

    // Get notifications
    const notifications = await Notification.findByUser(user._id, {
      type: { $in: ['order', 'product', 'vendor', 'payment'] },
      limit: 10
    });

    res.status(200).json({
      success: true,
      data: {
        store: {
          ...store.toObject(),
          isActive: store.isActive
        },
        dashboard: dashboardData,
        recentOrders,
        pendingOrders,
        lowStockProducts,
        recentReviews,
        notifications,
        stats: {
          totalProducts: store.analytics.totalProducts,
          totalOrders: store.analytics.totalOrders,
          totalSales: store.analytics.totalSales,
          averageOrderValue: store.analytics.averageOrderValue,
          rating: store.analytics.rating,
          customerCount: store.analytics.customerCount
        }
      }
    });
  });

  // Get vendor analytics
  getVendorAnalytics = catchAsync(async (req, res) => {
    const { storeId } = req.params;
    const { dateRange = 30, type = 'overview' } = req.query;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to view analytics', 403, true, 'NOT_AUTHORIZED');
    }

    let analytics = {};

    switch (type) {
      case 'sales':
        analytics = await this.getSalesAnalytics(storeId, parseInt(dateRange));
        break;
      case 'products':
        analytics = await this.getProductAnalytics(storeId, parseInt(dateRange));
        break;
      case 'customers':
        analytics = await this.getCustomerAnalytics(storeId, parseInt(dateRange));
        break;
      case 'traffic':
        analytics = await this.getTrafficAnalytics(storeId, parseInt(dateRange));
        break;
      default:
        analytics = await this.getOverviewAnalytics(storeId, parseInt(dateRange));
    }

    res.status(200).json({
      success: true,
      data: {
        type,
        dateRange: parseInt(dateRange),
        analytics,
        store: store.name
      }
    });
  });

  // Get overview analytics
  async getOverviewAnalytics(storeId, dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const salesData = await Order.aggregate([
      {
        $match: {
          'items.store': mongoose.Types.ObjectId(storeId),
          status: { $in: ['completed', 'delivered'] },
          orderedAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$pricing.totalAmount' },
          averageOrderValue: { $avg: '$pricing.totalAmount' }
        }
      }
    ]);

    const productData = await Product.aggregate([
      {
        $match: {
          store: mongoose.Types.ObjectId(storeId),
          isDeleted: false
        }
      },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          publishedProducts: {
            $sum: { $cond: ['$status', 'published', 1, 0] }
          },
          totalViews: { $sum: '$stats.views' }
        }
      }
    ]);

    const sales = salesData[0] || {};
    const products = productData[0] || {};

    return {
      sales: {
        totalOrders: sales.totalOrders || 0,
        totalRevenue: sales.totalRevenue || 0,
        averageOrderValue: Math.round((sales.averageOrderValue || 0) * 100) / 100
      },
      products: {
        totalProducts: products.totalProducts || 0,
        publishedProducts: products.publishedProducts || 0,
        totalViews: products.totalViews || 0
      },
      trends: await this.getStoreTrends(storeId, dateRange)
    };
  }

  // Get sales analytics
  async getSalesAnalytics(storeId, dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const dailySales = await Order.aggregate([
      {
        $match: {
          'items.store': mongoose.Types.ObjectId(storeId),
          status: { $in: ['completed', 'delivered'] },
          orderedAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$orderedAt' } },
          orders: { $sum: 1 },
          revenue: { $sum: '$pricing.totalAmount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return {
      dailySales,
      summary: {
        totalOrders: dailySales.reduce((sum, day) => sum + day.orders, 0),
        totalRevenue: dailySales.reduce((sum, day) => sum + day.revenue, 0),
        averageDaily: dailySales.length > 0 ?
          dailySales.reduce((sum, day) => sum + day.revenue, 0) / dailySales.length : 0
      }
    };
  }

  // Get product analytics
  async getProductAnalytics(storeId, dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const topProducts = await Product.find({
      store: storeId,
      isDeleted: false
    })
    .sort({ 'stats.salesCount': -1 })
    .limit(10)
    .select('name stats.salesCount stats.views price');

    const categoryBreakdown = await Product.aggregate([
      {
        $match: {
          store: mongoose.Types.ObjectId(storeId),
          isDeleted: false
        }
      },
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'categoryInfo'
        }
      },
      {
        $unwind: '$categoryInfo'
      },
      {
        $group: {
          _id: '$categoryInfo.name',
          count: { $sum: 1 },
          revenue: { $sum: '$stats.revenue' }
        }
      }
    ]);

    return {
      topProducts,
      categoryBreakdown,
      insights: await this.getProductInsights(storeId)
    };
  }

  // Get customer analytics
  async getCustomerAnalytics(storeId, dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const customerStats = await Order.aggregate([
      {
        $match: {
          'items.store': mongoose.Types.ObjectId(storeId),
          status: { $in: ['completed', 'delivered'] },
          orderedAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$user',
          orderCount: { $sum: 1 },
          totalSpent: { $sum: '$pricing.totalAmount' },
          firstOrder: { $min: '$orderedAt' },
          lastOrder: { $max: '$orderedAt' }
        }
      }
    ]);

    return {
      customerStats,
      summary: {
        totalCustomers: customerStats.length,
        averageOrdersPerCustomer: customerStats.length > 0 ?
          customerStats.reduce((sum, c) => sum + c.orderCount, 0) / customerStats.length : 0,
        averageSpentPerCustomer: customerStats.length > 0 ?
          customerStats.reduce((sum, c) => sum + c.totalSpent, 0) / customerStats.length : 0
      }
    };
  }

  // Get traffic analytics
  async getTrafficAnalytics(storeId, dateRange) {
    // Mock implementation for traffic analytics
    return {
      pageViews: 1250,
      uniqueVisitors: 890,
      bounceRate: 0.35,
      topPages: [
        { page: '/store', views: 450 },
        { page: '/products', views: 320 },
        { page: '/about', views: 180 }
      ]
    };
  }

  // Get store trends
  async getStoreTrends(storeId, dateRange) {
    // Mock implementation for trends
    return {
      sales: 'increasing',
      orders: 'stable',
      customers: 'growing',
      products: 'expanding'
    };
  }

  // Get product insights
  async getProductInsights(storeId) {
    const insights = {
      bestSellers: [],
      underperforming: [],
      recommendations: []
    };

    // Get best selling products
    insights.bestSellers = await Product.find({
      store: storeId,
      'stats.salesCount': { $gt: 0 },
      isDeleted: false
    })
    .sort({ 'stats.salesCount': -1 })
    .limit(5)
    .select('name stats.salesCount price');

    // Get underperforming products
    insights.underperforming = await Product.find({
      store: storeId,
      'stats.views': { $gt: 10 },
      'stats.salesCount': 0,
      isDeleted: false
    })
    .sort({ 'stats.views': -1 })
    .limit(5)
    .select('name stats.views price');

    return insights;
  }

  // ===============================
  // STORE PRODUCT MANAGEMENT
  // ===============================

  // Get store products
  getStoreProducts = catchAsync(async (req, res) => {
    const { storeId } = req.params;
    const {
      status = 'published',
      category,
      search,
      sortBy = 'createdAt',
      page = 1,
      limit = 20
    } = req.query;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    let query = { store: storeId, isDeleted: false };

    if (status !== 'all') {
      query.status = status;
    }

    if (category) {
      query.category = category;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    let sort = {};
    switch (sortBy) {
      case 'name':
        sort = { name: 1 };
        break;
      case 'price':
        sort = { price: -1 };
        break;
      case 'stock':
        sort = { 'inventory.quantity': 1 };
        break;
      case 'sales':
        sort = { 'stats.salesCount': -1 };
        break;
      case 'updated':
        sort = { updatedAt: -1 };
        break;
      default:
        sort = { createdAt: -1 };
    }

    const products = await Product.find(query)
      .populate('category', 'name slug')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Product.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        store: store.name,
        products,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalProducts: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Add product to store
  addProductToStore = catchAsync(async (req, res) => {
    const { storeId, productId } = req.params;

    const store = await Store.findById(storeId);
    const product = await Product.findById(productId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to add products to this store', 403, true, 'NOT_AUTHORIZED');
    }

    // Update product store reference
    product.store = storeId;
    await product.save();

    // Update store product count
    await store.updateAnalytics();

    logger.info('Product added to store', {
      storeId,
      productId,
      addedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Product added to store successfully',
      data: {
        store: store.name,
        product: product.name
      }
    });
  });

  // Remove product from store
  removeProductFromStore = catchAsync(async (req, res) => {
    const { storeId, productId } = req.params;

    const store = await Store.findById(storeId);
    const product = await Product.findById(productId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to remove products from this store', 403, true, 'NOT_AUTHORIZED');
    }

    // Remove store reference from product
    product.store = null;
    await product.save();

    // Update store analytics
    await store.updateAnalytics();

    logger.info('Product removed from store', {
      storeId,
      productId,
      removedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Product removed from store successfully'
    });
  });

  // ===============================
  // STORE ORDER MANAGEMENT
  // ===============================

  // Get store orders
  getStoreOrders = catchAsync(async (req, res) => {
    const { storeId } = req.params;
    const {
      status,
      dateFrom,
      dateTo,
      sortBy = 'orderedAt',
      page = 1,
      limit = 20
    } = req.query;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to view store orders', 403, true, 'NOT_AUTHORIZED');
    }

    const orders = await store.getOrders({
      status,
      startDate: dateFrom ? new Date(dateFrom) : undefined,
      endDate: dateTo ? new Date(dateTo) : undefined,
      limit: parseInt(limit),
      skip: (page - 1) * limit
    });

    const total = await Order.countDocuments({
      'items.store': storeId,
      isDeleted: false,
      ...(status && { status })
    });

    res.status(200).json({
      success: true,
      data: {
        store: store.name,
        orders,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalOrders: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Update order status (vendor)
  updateOrderStatus = catchAsync(async (req, res) => {
    const { orderId } = req.params;
    const { status, notes, trackingNumber, trackingUrl, carrier } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    // Check if user owns any items in the order
    const userItems = order.items.filter(item => item.vendor.toString() === req.user.id);

    if (userItems.length === 0 && req.user.role !== 'admin') {
      throw new AppError('Not authorized to update this order', 403, true, 'NOT_AUTHORIZED');
    }

    // Update vendor-specific order status
    const vendorOrder = order.vendorOrders.find(vo => vo.vendor.toString() === req.user.id);
    if (vendorOrder) {
      vendorOrder.status = status;

      if (trackingNumber || trackingUrl || carrier) {
        vendorOrder.tracking = {
          number: trackingNumber || vendorOrder.tracking?.number,
          url: trackingUrl || vendorOrder.tracking?.url,
          carrier: carrier || vendorOrder.tracking?.carrier
        };
      }

      if (status === 'shipped') {
        vendorOrder.shippedAt = new Date();
      } else if (status === 'delivered') {
        vendorOrder.deliveredAt = new Date();
      }
    }

    await order.save();

    // Update main order status if all vendor orders are completed
    await this.updateMainOrderStatus(order);

    // Send notifications
    await this.sendOrderNotifications(order, 'vendor_status_updated');

    logger.info('Order status updated by vendor', {
      orderId,
      vendorId: req.user.id,
      status,
      notes
    });

    res.status(200).json({
      success: true,
      message: 'Order status updated successfully',
      data: {
        order: order.getPublicData(),
        vendorOrder
      }
    });
  });

  // Update main order status based on vendor orders
  async updateMainOrderStatus(order) {
    const vendorStatuses = order.vendorOrders.map(vo => vo.status);
    const allShipped = vendorStatuses.every(status => status === 'shipped' || status === 'delivered');
    const allDelivered = vendorStatuses.every(status => status === 'delivered');

    if (allDelivered && order.status !== 'delivered') {
      await order.updateStatus('delivered', null, 'All vendor orders delivered');
    } else if (allShipped && order.status === 'ready') {
      await order.updateStatus('shipped', null, 'All vendor orders shipped');
    }
  }

  // ===============================
  // STORE FINANCIAL MANAGEMENT
  // ===============================

  // Get store earnings
  getStoreEarnings = catchAsync(async (req, res) => {
    const { storeId } = req.params;
    const { dateRange = 30 } = req.query;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to view earnings', 403, true, 'NOT_AUTHORIZED');
    }

    const startDate = new Date(Date.now() - parseInt(dateRange) * 24 * 60 * 60 * 1000);

    const earnings = await Order.aggregate([
      {
        $match: {
          'items.store': mongoose.Types.ObjectId(storeId),
          status: { $in: ['completed', 'delivered'] },
          orderedAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$pricing.totalAmount' },
          totalOrders: { $sum: 1 },
          averageOrderValue: { $avg: '$pricing.totalAmount' }
        }
      }
    ]);

    const dailyEarnings = await Order.aggregate([
      {
        $match: {
          'items.store': mongoose.Types.ObjectId(storeId),
          status: { $in: ['completed', 'delivered'] },
          orderedAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$orderedAt' } },
          earnings: { $sum: '$pricing.totalAmount' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const data = earnings[0] || {};

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalEarnings: data.totalEarnings || 0,
          totalOrders: data.totalOrders || 0,
          averageOrderValue: Math.round((data.averageOrderValue || 0) * 100) / 100,
          period: `${dateRange} days`
        },
        dailyEarnings,
        payoutInfo: {
          availableForPayout: data.totalEarnings * 0.85, // After platform fee
          nextPayoutDate: this.calculateNextPayoutDate(),
          payoutMethod: store.financial.payoutSettings.method
        }
      }
    });
  });

  // Request payout
  requestPayout = catchAsync(async (req, res) => {
    const { storeId } = req.params;
    const { amount } = req.body;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to request payout', 403, true, 'NOT_AUTHORIZED');
    }

    // Validate payout amount
    const availableAmount = store.analytics.totalSales * 0.85; // After platform fee
    const minimumAmount = store.financial.payoutSettings.minimumAmount;

    if (amount > availableAmount) {
      throw new AppError('Insufficient funds for payout', 400, true, 'INSUFFICIENT_FUNDS');
    }

    if (amount < minimumAmount) {
      throw new AppError(`Minimum payout amount is $${minimumAmount}`, 400, true, 'AMOUNT_TOO_LOW');
    }

    // Process payout request
    const payoutResult = await store.processPayout(amount, store.financial.payoutSettings.method);

    // Send notification
    await Notification.createNotification(store.owner, {
      type: 'payment',
      category: 'transactional',
      title: 'Payout Requested',
      message: `Your payout request for $${amount} has been submitted and is being processed.`,
      data: {
        amount,
        method: store.financial.payoutSettings.method
      },
      priority: 'normal'
    });

    logger.info('Payout requested', {
      storeId,
      vendorId: req.user.id,
      amount
    });

    res.status(200).json({
      success: true,
      message: 'Payout request submitted successfully',
      data: payoutResult
    });
  });

  // Get payout history
  getPayoutHistory = catchAsync(async (req, res) => {
    const { storeId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to view payout history', 403, true, 'NOT_AUTHORIZED');
    }

    // Get payout records (mock implementation)
    const payouts = []; // This would be from a separate Payout model

    res.status(200).json({
      success: true,
      data: {
        payouts,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(payouts.length / limit),
          totalPayouts: payouts.length
        }
      }
    });
  });

  // ===============================
  // STORE CATEGORIES MANAGEMENT
  // ===============================

  // Get store categories
  getStoreCategories = catchAsync(async (req, res) => {
    const { storeId } = req.params;

    const store = await Store.findById(storeId).populate('categories.category', 'name slug');

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: {
        store: store.name,
        categories: store.categories
      }
    });
  });

  // Add category to store
  addStoreCategory = catchAsync(async (req, res) => {
    const { storeId } = req.params;
    const { categoryId, isPrimary = false, commissionRate = 10 } = req.body;

    const store = await Store.findById(storeId);
    const category = await Category.findById(categoryId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to add categories to this store', 403, true, 'NOT_AUTHORIZED');
    }

    await store.addCategory(categoryId, isPrimary, commissionRate);

    logger.info('Category added to store', {
      storeId,
      categoryId,
      addedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Category added to store successfully',
      data: {
        store: store.name,
        category: category.name,
        isPrimary,
        commissionRate
      }
    });
  });

  // Update store category
  updateStoreCategory = catchAsync(async (req, res) => {
    const { storeId, categoryId } = req.params;
    const { isPrimary, commissionRate } = req.body;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    const category = store.categories.id(categoryId);
    if (!category) {
      throw new AppError('Category not found in store', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to update store categories', 403, true, 'NOT_AUTHORIZED');
    }

    // If setting as primary, remove primary flag from others
    if (isPrimary) {
      store.categories.forEach(cat => {
        cat.isPrimary = false;
      });
    }

    category.isPrimary = isPrimary;
    category.commissionRate = commissionRate;

    await store.save();

    logger.info('Store category updated', {
      storeId,
      categoryId,
      updatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Store category updated successfully',
      data: category
    });
  });

  // Remove category from store
  removeStoreCategory = catchAsync(async (req, res) => {
    const { storeId, categoryId } = req.params;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to remove categories from this store', 403, true, 'NOT_AUTHORIZED');
    }

    store.categories.pull(categoryId);
    await store.save();

    logger.info('Category removed from store', {
      storeId,
      categoryId,
      removedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Category removed from store successfully'
    });
  });

  // ===============================
  // STORE PROMOTIONS
  // ===============================

  // Get store promotions
  getStorePromotions = catchAsync(async (req, res) => {
    const { storeId } = req.params;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to view store promotions', 403, true, 'NOT_AUTHORIZED');
    }

    res.status(200).json({
      success: true,
      data: {
        store: store.name,
        promotions: store.promotions || []
      }
    });
  });

  // Create store promotion
  createStorePromotion = catchAsync(async (req, res) => {
    const { storeId } = req.params;
    const { title, description, type, discount, startDate, endDate, banner } = req.body;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to create promotions', 403, true, 'NOT_AUTHORIZED');
    }

    const promotion = {
      title,
      description,
      type,
      discount: {
        percentage: discount.percentage,
        fixedAmount: discount.fixedAmount
      },
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      isActive: true,
      banner
    };

    store.promotions.push(promotion);
    await store.save();

    logger.info('Store promotion created', {
      storeId,
      promotionTitle: title,
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Promotion created successfully',
      data: promotion
    });
  });

  // Update store promotion
  updateStorePromotion = catchAsync(async (req, res) => {
    const { storeId, promotionId } = req.params;
    const updates = req.body;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    const promotion = store.promotions.id(promotionId);
    if (!promotion) {
      throw new AppError('Promotion not found', 404, true, 'PROMOTION_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to update promotions', 403, true, 'NOT_AUTHORIZED');
    }

    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        promotion[key] = updates[key];
      }
    });

    await store.save();

    logger.info('Store promotion updated', {
      storeId,
      promotionId,
      updatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Promotion updated successfully',
      data: promotion
    });
  });

  // Delete store promotion
  deleteStorePromotion = catchAsync(async (req, res) => {
    const { storeId, promotionId } = req.params;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to delete promotions', 403, true, 'NOT_AUTHORIZED');
    }

    store.promotions.pull(promotionId);
    await store.save();

    logger.info('Store promotion deleted', {
      storeId,
      promotionId,
      deletedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Promotion deleted successfully'
    });
  });

  // ===============================
  // STORE REVIEWS MANAGEMENT
  // ===============================

  // Get store reviews
  getStoreReviews = catchAsync(async (req, res) => {
    const { storeId } = req.params;
    const { rating, sortBy = 'createdAt', page = 1, limit = 20 } = req.query;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    const reviews = await store.getReviews({
      rating,
      limit: parseInt(limit),
      skip: (page - 1) * limit
    });

    const total = await Review.countDocuments({ store: storeId });

    res.status(200).json({
      success: true,
      data: {
        store: store.name,
        reviews,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalReviews: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        },
        stats: {
          averageRating: store.analytics.rating,
          totalReviews: store.analytics.reviewCount
        }
      }
    });
  });

  // Respond to review
  respondToReview = catchAsync(async (req, res) => {
    const { reviewId } = req.params;
    const { content } = req.body;

    const review = await Review.findById(reviewId);

    if (!review) {
      throw new AppError('Review not found', 404, true, 'REVIEW_NOT_FOUND');
    }

    // Check permissions (store owner or admin)
    const store = await Store.findById(review.store);
    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to respond to this review', 403, true, 'NOT_AUTHORIZED');
    }

    await review.addVendorResponse(content, req.user.id);

    // Send notification to reviewer
    await Notification.createNotification(review.user, {
      type: 'review',
      category: 'informational',
      title: 'Store Responded to Your Review',
      message: `The store has responded to your review for "${review.product.name}".`,
      data: {
        reviewId: review._id,
        productName: review.product.name,
        storeName: store.name
      },
      priority: 'normal',
      actions: [
        {
          type: 'link',
          label: 'View Review',
          url: `/products/${review.product.slug}/reviews`,
          action: 'view_review'
        }
      ]
    });

    logger.info('Review response added', {
      reviewId,
      respondedBy: req.user.id,
      storeId: store._id
    });

    res.status(200).json({
      success: true,
      message: 'Response added successfully',
      data: review.response
    });
  });

  // ===============================
  // STORE SEARCH & DISCOVERY
  // ===============================

  // Search stores
  searchStores = catchAsync(async (req, res) => {
    const {
      q: searchTerm,
      category,
      location,
      rating,
      verified = true,
      sortBy = 'rating',
      page = 1,
      limit = 20
    } = req.query;

    if (!searchTerm) {
      throw new AppError('Search term is required', 400, true, 'SEARCH_TERM_REQUIRED');
    }

    const stores = await Store.search(searchTerm, {
      category,
      verified,
      limit: parseInt(limit),
      skip: (page - 1) * limit
    });

    const total = await Store.countDocuments({
      $or: [
        { name: { $regex: searchTerm, $options: 'i' } },
        { description: { $regex: searchTerm, $options: 'i' } },
        { 'contact.email': { $regex: searchTerm, $options: 'i' } }
      ],
      isDeleted: false
    });

    res.status(200).json({
      success: true,
      data: {
        searchTerm,
        stores,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalStores: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Get featured stores
  getFeaturedStores = catchAsync(async (req, res) => {
    const { limit = 20 } = req.query;

    const stores = await Store.getVerifiedStores({
      limit: parseInt(limit),
      sortBy: 'rating'
    });

    res.status(200).json({
      success: true,
      data: stores
    });
  });

  // Get stores by category
  getStoresByCategory = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { sortBy = 'rating', page = 1, limit = 20 } = req.query;

    const stores = await Store.getVerifiedStores({
      category: categoryId,
      limit: parseInt(limit),
      skip: (page - 1) * limit,
      sortBy
    });

    const total = await Store.countDocuments({
      'categories.category': categoryId,
      verificationStatus: 'verified',
      status: 'active',
      isDeleted: false
    });

    res.status(200).json({
      success: true,
      data: {
        categoryId,
        stores,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalStores: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Get top stores
  getTopStores = catchAsync(async (req, res) => {
    const { limit = 10 } = req.query;

    const stores = await Store.getTopStores(parseInt(limit));

    res.status(200).json({
      success: true,
      data: stores
    });
  });

  // ===============================
  // STORE BULK OPERATIONS
  // ===============================

  // Bulk update store settings
  bulkUpdateStoreSettings = catchAsync(async (req, res) => {
    const { storeIds, updates } = req.body;

    if (!storeIds || !Array.isArray(storeIds) || storeIds.length === 0) {
      throw new AppError('Store IDs array is required', 400, true, 'INVALID_STORE_IDS');
    }

    const result = await Store.updateMany(
      { _id: { $in: storeIds }, isDeleted: false },
      { $set: updates }
    );

    logger.info('Stores bulk updated', {
      adminId: req.user.id,
      storeCount: storeIds.length,
      updates: Object.keys(updates)
    });

    res.status(200).json({
      success: true,
      message: 'Stores updated successfully',
      data: {
        updatedCount: result.modifiedCount,
        storeIds
      }
    });
  });

  // Bulk approve stores
  bulkApproveStores = catchAsync(async (req, res) => {
    const { storeIds } = req.body;

    if (!storeIds || !Array.isArray(storeIds) || storeIds.length === 0) {
      throw new AppError('Store IDs array is required', 400, true, 'INVALID_STORE_IDS');
    }

    const result = await Store.updateMany(
      { _id: { $in: storeIds } },
      {
        verificationStatus: 'verified',
        status: 'active'
      }
    );

    // Send notifications to store owners
    const stores = await Store.find({ _id: { $in: storeIds } });
    for (const store of stores) {
      await Notification.createNotification(store.owner, {
        type: 'vendor',
        category: 'informational',
        title: 'Store Approved',
        message: `Your store "${store.name}" has been approved and is now active.`,
        priority: 'normal'
      });
    }

    logger.info('Stores bulk approved', {
      adminId: req.user.id,
      approvedCount: result.modifiedCount
    });

    res.status(200).json({
      success: true,
      message: 'Stores approved successfully',
      data: {
        approvedCount: result.modifiedCount,
        storeIds
      }
    });
  });

  // ===============================
  // STORE IMPORT/EXPORT
  // ===============================

  // Export store data
  exportStoreData = catchAsync(async (req, res) => {
    const { storeId } = req.params;
    const { format = 'json', includeProducts = false, includeOrders = false } = req.query;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to export store data', 403, true, 'NOT_AUTHORIZED');
    }

    let exportData = {
      store: store.toObject(),
      exportedAt: new Date(),
      exportedBy: req.user.id
    };

    if (includeProducts === 'true') {
      exportData.products = await store.getProducts({ limit: 1000 });
    }

    if (includeOrders === 'true') {
      exportData.orders = await store.getOrders({ limit: 1000 });
    }

    if (format === 'csv') {
      // Generate CSV export
      const csvData = this.generateStoreCSVExport(exportData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="store-${store.slug}.${format}"`);
      res.status(200).send(csvData);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="store-${store.slug}.json"`);
      res.status(200).json(exportData);
    }
  });

  // Generate CSV export
  generateStoreCSVExport(data) {
    // Implementation for CSV generation
    return 'store data...';
  }

  // Import store data
  importStoreData = catchAsync(async (req, res) => {
    const { storeId } = req.params;

    if (!req.file) {
      throw new AppError('No import file provided', 400, true, 'NO_IMPORT_FILE');
    }

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to import store data', 403, true, 'NOT_AUTHORIZED');
    }

    // Parse import file
    const importData = await this.parseStoreImportFile(req.file.path);

    // Import products if included
    if (importData.products) {
      let imported = 0;
      for (const productData of importData.products) {
        const product = new Product({
          ...productData,
          vendor: store.owner,
          store: storeId,
          status: 'draft'
        });
        await product.save();
        imported++;
      }

      await store.updateAnalytics();

      logger.info('Store products imported', {
        storeId,
        imported,
        importedBy: req.user.id
      });
    }

    res.status(200).json({
      success: true,
      message: 'Store data imported successfully',
      data: {
        store: store.name,
        importedProducts: importData.products?.length || 0
      }
    });
  });

  // Parse import file
  async parseStoreImportFile(filePath) {
    // Implementation for parsing import files
    return {};
  }

  // ===============================
  // STORE MANAGER MANAGEMENT
  // ===============================

  // Add store manager
  addStoreManager = catchAsync(async (req, res) => {
    const { storeId } = req.params;
    const { userId, role = 'manager', permissions = [] } = req.body;

    const store = await Store.findById(storeId);
    const user = await User.findById(userId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    if (!user) {
      throw new AppError('User not found', 404, true, 'USER_NOT_FOUND');
    }

    // Check permissions (store owner or admin)
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to add managers to this store', 403, true, 'NOT_AUTHORIZED');
    }

    await store.addManager(userId, role, permissions);

    // Send notification to new manager
    await Notification.createNotification(userId, {
      type: 'vendor',
      category: 'informational',
      title: 'Added as Store Manager',
      message: `You have been added as a ${role} for the store "${store.name}".`,
      data: {
        storeId: store._id,
        storeName: store.name,
        role
      },
      priority: 'normal'
    });

    logger.info('Store manager added', {
      storeId,
      managerId: userId,
      role,
      addedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Manager added successfully',
      data: {
        store: store.name,
        manager: `${user.firstName} ${user.lastName}`,
        role
      }
    });
  });

  // Remove store manager
  removeStoreManager = catchAsync(async (req, res) => {
    const { storeId, managerId } = req.params;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to remove managers from this store', 403, true, 'NOT_AUTHORIZED');
    }

    await store.removeManager(managerId);

    // Send notification to removed manager
    await Notification.createNotification(managerId, {
      type: 'vendor',
      category: 'informational',
      title: 'Removed as Store Manager',
      message: `You have been removed as a manager for the store "${store.name}".`,
      data: {
        storeId: store._id,
        storeName: store.name
      },
      priority: 'normal'
    });

    logger.info('Store manager removed', {
      storeId,
      managerId,
      removedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Manager removed successfully'
    });
  });

  // Update manager permissions
  updateManagerPermissions = catchAsync(async (req, res) => {
    const { storeId, managerId } = req.params;
    const { permissions } = req.body;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to update manager permissions', 403, true, 'NOT_AUTHORIZED');
    }

    await store.updateManagerPermissions(managerId, permissions);

    logger.info('Manager permissions updated', {
      storeId,
      managerId,
      updatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Manager permissions updated successfully'
    });
  });

  // ===============================
  // STORE VERIFICATION
  // ===============================

  // Submit store for verification
  submitForVerification = catchAsync(async (req, res) => {
    const { storeId } = req.params;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to submit store for verification', 403, true, 'NOT_AUTHORIZED');
    }

    if (store.verificationStatus === 'verified') {
      throw new AppError('Store is already verified', 400, true, 'STORE_ALREADY_VERIFIED');
    }

    await store.submitForVerification();

    logger.info('Store submitted for verification', {
      storeId,
      submittedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Store submitted for verification successfully',
      data: {
        store: store.name,
        status: store.verificationStatus
      }
    });
  });

  // Verify store (admin)
  verifyStore = catchAsync(async (req, res) => {
    const { storeId } = req.params;
    const { documents = [] } = req.body;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    await store.verifyStore(req.user.id, documents);

    // Update user verification status
    await User.findByIdAndUpdate(store.owner, {
      isVerified: true
    });

    logger.info('Store verified by admin', {
      storeId,
      verifiedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Store verified successfully',
      data: store
    });
  });

  // ===============================
  // STORE COMMUNICATIONS
  // ===============================

  // Send message to store
  sendMessageToStore = catchAsync(async (req, res) => {
    const { storeId } = req.params;
    const { message, type = 'inquiry' } = req.body;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Send notification to store owner
    await Notification.createNotification(store.owner, {
      type: 'vendor',
      category: 'informational',
      title: 'New Message from Customer',
      message: `You have received a ${type} message: ${message.substring(0, 100)}...`,
      data: {
        storeId: store._id,
        storeName: store.name,
        message,
        type
      },
      priority: 'normal',
      actions: [
        {
          type: 'link',
          label: 'View Message',
          url: `/vendor/messages`,
          action: 'view_message'
        }
      ]
    });

    logger.info('Message sent to store', {
      storeId,
      fromUserId: req.user.id,
      type
    });

    res.status(200).json({
      success: true,
      message: 'Message sent to store successfully'
    });
  });

  // ===============================
  // STORE STATISTICS
  // ===============================

  // Get store statistics
  getStoreStatistics = catchAsync(async (req, res) => {
    const { storeId } = req.params;
    const { dateRange = 30 } = req.query;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to view store statistics', 403, true, 'NOT_AUTHORIZED');
    }

    const stats = await Store.getStoreStats();

    res.status(200).json({
      success: true,
      data: {
        store: store.name,
        overview: {
          totalProducts: store.analytics.totalProducts,
          totalOrders: store.analytics.totalOrders,
          totalSales: store.analytics.totalSales,
          averageOrderValue: store.analytics.averageOrderValue,
          rating: store.analytics.rating,
          customerCount: store.analytics.customerCount
        },
        trends: await this.getStoreTrends(storeId, parseInt(dateRange)),
        topProducts: await this.getStoreTopProducts(storeId),
        topCustomers: await this.getStoreTopCustomers(storeId)
      }
    });
  });

  // Get store trends
  async getStoreTrends(storeId, dateRange) {
    // Mock implementation for store trends
    return {
      sales: 'increasing',
      orders: 'stable',
      customers: 'growing',
      products: 'expanding'
    };
  }

  // Get store top products
  async getStoreTopProducts(storeId) {
    const topProducts = await Product.find({
      store: storeId,
      isDeleted: false
    })
    .sort({ 'stats.salesCount': -1 })
    .limit(10)
    .select('name stats.salesCount stats.views price');

    return topProducts;
  }

  // Get store top customers
  async getStoreTopCustomers(storeId) {
    const topCustomers = await Order.aggregate([
      {
        $match: {
          'items.store': mongoose.Types.ObjectId(storeId),
          status: { $in: ['completed', 'delivered'] },
          isDeleted: false
        }
      },
      {
        $group: {
          _id: '$user',
          orderCount: { $sum: 1 },
          totalSpent: { $sum: '$pricing.totalAmount' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'customerInfo'
        }
      },
      {
        $unwind: '$customerInfo'
      },
      {
        $project: {
          customer: {
            name: { $concat: ['$customerInfo.firstName', ' ', '$customerInfo.lastName'] },
            email: '$customerInfo.email'
          },
          orderCount: 1,
          totalSpent: 1
        }
      },
      { $sort: { totalSpent: -1 } },
      { $limit: 10 }
    ]);

    return topCustomers;
  }

  // ===============================
  // STORE UTILITIES
  // ===============================

  // Calculate next payout date
  calculateNextPayoutDate() {
    const today = new Date();
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    return nextWeek;
  }

  // Send order notifications
  async sendOrderNotifications(order, event) {
    const notifications = [];

    // Notify store owner
    notifications.push(Notification.createNotification(order.items[0]?.vendor, {
      type: 'order',
      category: 'transactional',
      title: this.getOrderNotificationTitle(event, 'vendor'),
      message: this.getOrderNotificationMessage(event, order, 'vendor'),
      data: { orderId: order._id, orderNumber: order.orderNumber },
      priority: 'normal'
    }));

    await Promise.all(notifications);
  }

  // Get notification titles and messages
  getOrderNotificationTitle(event, recipient = 'vendor') {
    const titles = {
      'created': { vendor: 'New Order Received' },
      'payment_confirmed': { vendor: 'Payment Received' },
      'shipped': { vendor: 'Order Shipped' },
      'delivered': { vendor: 'Order Completed' },
      'cancelled': { vendor: 'Order Cancelled' },
      'return_requested': { vendor: 'Return Requested' }
    };
    return titles[event]?.[recipient] || 'Order Update';
  }

  getOrderNotificationMessage(event, order, recipient = 'vendor') {
    const messages = {
      'created': {
        vendor: `You have received a new order ${order.orderNumber} for ${order.items.length} items.`
      },
      'payment_confirmed': {
        vendor: `Payment for order ${order.orderNumber} has been confirmed.`
      },
      'shipped': {
        vendor: `Order ${order.orderNumber} has been shipped.`
      }
    };
    return messages[event]?.[recipient] || 'Your order has been updated.';
  }

  // Get store by slug
  getStoreBySlug = catchAsync(async (req, res) => {
    const { slug } = req.params;

    const store = await Store.findOne({ slug })
      .populate('owner', 'firstName lastName')
      .populate('categories.category', 'name slug');

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check if store is accessible
    if (store.status !== 'active' && store.owner._id.toString() !== req.user?.id && req.user?.role !== 'admin') {
      throw new AppError('Store not available', 404, true, 'STORE_NOT_AVAILABLE');
    }

    res.status(200).json({
      success: true,
      data: store
    });
  });

  // Get user stores
  getUserStores = catchAsync(async (req, res) => {
    const stores = await Store.findByOwner(req.user.id);

    res.status(200).json({
      success: true,
      data: {
        stores,
        count: stores.length
      }
    });
  });

  // Duplicate store
  duplicateStore = catchAsync(async (req, res) => {
    const { storeId } = req.params;
    const { name, modifications = {} } = req.body;

    const originalStore = await Store.findById(storeId);

    if (!originalStore) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (originalStore.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to duplicate this store', 403, true, 'NOT_AUTHORIZED');
    }

    // Create duplicate store
    const duplicatedStore = new Store({
      ...originalStore.toObject(),
      _id: undefined,
      name: name || `${originalStore.name} (Copy)`,
      slug: undefined,
      owner: req.user.id,
      status: 'draft',
      verificationStatus: 'unverified',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Apply modifications
    Object.keys(modifications).forEach(key => {
      if (modifications[key] !== undefined) {
        duplicatedStore[key] = modifications[key];
      }
    });

    await duplicatedStore.save();

    logger.info('Store duplicated', {
      originalStoreId: storeId,
      newStoreId: duplicatedStore._id,
      duplicatedBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Store duplicated successfully',
      data: duplicatedStore
    });
  });

  // Archive store
  archiveStore = catchAsync(async (req, res) => {
    const { storeId } = req.params;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to archive this store', 403, true, 'NOT_AUTHORIZED');
    }

    await store.archive();

    logger.info('Store archived', {
      storeId,
      archivedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Store archived successfully'
    });
  });

  // Get store performance report
  getStorePerformanceReport = catchAsync(async (req, res) => {
    const { storeId } = req.params;
    const { dateRange = 30, format = 'json' } = req.query;

    const store = await Store.findById(storeId);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (store.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to view performance report', 403, true, 'NOT_AUTHORIZED');
    }

    const report = await this.generateStorePerformanceReport(storeId, parseInt(dateRange));

    if (format === 'csv') {
      const csvData = this.generateStoreReportCSV(report);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="store-report.csv"`);
      res.status(200).send(csvData);
    } else {
      res.status(200).json({
        success: true,
        data: report
      });
    }
  });

  // Generate store performance report
  async generateStorePerformanceReport(storeId, dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const salesData = await Order.aggregate([
      {
        $match: {
          'items.store': mongoose.Types.ObjectId(storeId),
          status: { $in: ['completed', 'delivered'] },
          orderedAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$pricing.totalAmount' },
          averageOrderValue: { $avg: '$pricing.totalAmount' }
        }
      }
    ]);

    const productData = await Product.aggregate([
      {
        $match: {
          store: mongoose.Types.ObjectId(storeId),
          isDeleted: false
        }
      },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          publishedProducts: {
            $sum: { $cond: ['$status', 'published', 1, 0] }
          },
          totalViews: { $sum: '$stats.views' }
        }
      }
    ]);

    return {
      storeId,
      dateRange,
      generatedAt: new Date(),
      sales: salesData[0] || {},
      products: productData[0] || {},
      insights: await this.getStoreInsights(storeId)
    };
  }

  // Get store insights
  async getStoreInsights(storeId) {
    // Implementation for store insights
    return {
      recommendations: [],
      opportunities: [],
      risks: []
    };
  }

  // Generate CSV report
  generateStoreReportCSV(report) {
    // Implementation for CSV generation
    return 'store report data...';
  }
}

module.exports = new StoreController();
