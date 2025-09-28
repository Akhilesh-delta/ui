const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Category = require('../models/Category');
const Review = require('../models/Review');
const Cart = require('../models/Cart');
const { authenticate, requireAdmin, sanitizeInput } = require('../middleware/authMiddleware');
const { sendEmail } = require('../services/emailService');

// @desc    Get admin dashboard
// @route   GET /api/admin/dashboard
// @access  Private (Admin)
const getAdminDashboard = async (req, res) => {
  try {
    const { period = '30d' } = req.query;

    // Calculate date range
    const daysBack = parseInt(period.replace('d', ''));
    const startDate = new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000));
    const endDate = new Date();

    // Get key metrics
    const [
      userStats,
      productStats,
      orderStats,
      revenueStats,
      categoryStats,
      recentOrders,
      pendingVendors,
      lowStockProducts,
      pendingReviews
    ] = await Promise.all([
      getUserStatistics(startDate, endDate),
      getProductStatistics(startDate, endDate),
      getOrderStatistics(startDate, endDate),
      getRevenueStatistics(startDate, endDate),
      getCategoryStatistics(),
      getRecentOrders(10),
      getPendingVendors(),
      getLowStockProducts(10),
      getPendingReviews(10)
    ]);

    // Get system health
    const systemHealth = await getSystemHealth();

    res.json({
      success: true,
      data: {
        period,
        metrics: {
          users: userStats,
          products: productStats,
          orders: orderStats,
          revenue: revenueStats,
          categories: categoryStats
        },
        recentActivity: {
          orders: recentOrders,
          pendingVendors: pendingVendors.length,
          lowStockProducts: lowStockProducts.length,
          pendingReviews: pendingReviews.length
        },
        alerts: generateAlerts(pendingVendors, lowStockProducts, pendingReviews),
        systemHealth
      }
    });

  } catch (error) {
    console.error('Get admin dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch admin dashboard'
    });
  }
};

// @desc    Get user management data
// @route   GET /api/admin/users
// @access  Private (Admin)
const getUserManagement = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      role,
      status,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      emailVerified,
      lastLoginDays
    } = req.query;

    // Build query
    let query = {};

    if (role) {
      query.role = role;
    }

    if (status) {
      query.status = status;
    }

    if (emailVerified !== undefined) {
      query.emailVerified = emailVerified === 'true';
    }

    if (lastLoginDays) {
      const cutoffDate = new Date(Date.now() - (parseInt(lastLoginDays) * 24 * 60 * 60 * 1000));
      query.lastLogin = { $lt: cutoffDate };
    }

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { 'vendorProfile.businessName': { $regex: search, $options: 'i' } }
      ];
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const users = await User.find(query)
      .select('firstName lastName email role status emailVerified phone lastLogin createdAt vendorProfile.businessName')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(query);

    // Get user statistics
    const userStats = await User.getUserStats();

    res.json({
      success: true,
      data: {
        users,
        statistics: userStats,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get user management error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user management data'
    });
  }
};

// @desc    Get user details
// @route   GET /api/admin/users/:userId
// @access  Private (Admin)
const getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId)
      .populate('vendorProfile.verificationDocuments');

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Get user's recent orders
    const recentOrders = await Order.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('orderNumber status totalAmount createdAt');

    // Get user's activity log
    const activityLog = await getUserActivityLog(userId);

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          role: user.role,
          status: user.status,
          emailVerified: user.emailVerified,
          phoneVerified: user.phoneVerified,
          profile: user.profile,
          addresses: user.addresses,
          preferences: user.preferences,
          shopping: user.shopping,
          vendorProfile: user.role === 'vendor' ? user.vendorProfile : undefined,
          security: user.security,
          referral: user.referral,
          subscription: user.subscription,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt,
          statistics: user.getStatistics()
        },
        recentOrders,
        activityLog
      }
    });

  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user details'
    });
  }
};

// @desc    Update user status
// @route   PUT /api/admin/users/:userId/status
// @access  Private (Admin)
const updateUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, reason } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'Status is required'
      });
    }

    const validStatuses = ['active', 'inactive', 'suspended', 'pending', 'verified'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const oldStatus = user.status;
    user.status = status;
    await user.save();

    // Add admin note
    user.adminNotes.push({
      note: `Status changed from ${oldStatus} to ${status}${reason ? `: ${reason}` : ''}`,
      addedBy: req.user._id,
      type: status === 'suspended' ? 'suspension' : 'note'
    });
    await user.save();

    // Send notification email
    await sendEmail({
      to: user.email,
      subject: `Account Status Update`,
      template: 'accountStatusUpdate',
      data: {
        firstName: user.firstName,
        status,
        reason: reason || 'No reason provided',
        adminName: req.user.firstName + ' ' + req.user.lastName,
        contactUrl: `${process.env.FRONTEND_URL}/contact`
      }
    });

    res.json({
      success: true,
      message: 'User status updated successfully',
      data: {
        user: {
          id: user._id,
          status: user.status,
          adminNotes: user.adminNotes.slice(-1)
        }
      }
    });

  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user status'
    });
  }
};

// @desc    Delete user
// @route   DELETE /api/admin/users/:userId
// @access  Private (Admin)
const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Check if user has orders
    const hasOrders = await Order.exists({ user: userId });

    if (hasOrders) {
      // Anonymize instead of delete
      user.firstName = 'Deleted';
      user.lastName = 'User';
      user.email = `deleted_${userId}@deleted.local`;
      user.phone = undefined;
      user.status = 'inactive';
      user.profile = {};
      user.addresses = [];
      user.isDeleted = true;
      await user.save();

      return res.json({
        success: true,
        message: 'User anonymized successfully (cannot delete users with orders)',
        data: {
          anonymized: true
        }
      });
    }

    // Delete user and related data
    await Promise.all([
      User.findByIdAndDelete(userId),
      Cart.deleteMany({ user: userId }),
      Order.deleteMany({ user: userId }),
      Review.deleteMany({ user: userId })
    ]);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete user'
    });
  }
};

// @desc    Get order management data
// @route   GET /api/admin/orders
// @access  Private (Admin)
const getOrderManagement = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      user,
      vendor,
      startDate,
      endDate,
      minAmount,
      maxAmount,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    let query = {};

    if (status) {
      query.status = status;
    }

    if (user) {
      query.user = user;
    }

    if (vendor) {
      query.vendor = vendor;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    if (minAmount !== undefined || maxAmount !== undefined) {
      query.totalAmount = {};
      if (minAmount !== undefined) query.totalAmount.$gte = parseFloat(minAmount);
      if (maxAmount !== undefined) query.totalAmount.$lte = parseFloat(maxAmount);
    }

    if (search) {
      query.$or = [
        { orderNumber: { $regex: search, $options: 'i' } },
        { 'customer.email': { $regex: search, $options: 'i' } },
        { 'shippingAddress.city': { $regex: search, $options: 'i' } }
      ];
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const orders = await Order.find(query)
      .populate('user', 'firstName lastName email')
      .populate('vendor', 'firstName lastName businessName')
      .populate('items.product', 'name sku')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Order.countDocuments(query);

    // Get order statistics
    const orderStats = await Order.getOrderStats();

    res.json({
      success: true,
      data: {
        orders,
        statistics: orderStats,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get order management error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch order management data'
    });
  }
};

// @desc    Get order details
// @route   GET /api/admin/orders/:orderId
// @access  Private (Admin)
const getOrderDetails = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId)
      .populate('user', 'firstName lastName email phone profile')
      .populate('vendor', 'firstName lastName businessName email')
      .populate('items.product', 'name sku images price')
      .populate('statusHistory.changedBy', 'firstName lastName role');

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // Get order tracking
    const tracking = await getOrderTracking(orderId);

    // Get return information
    const returnInfo = order.returns && order.returns.length > 0 ? order.returns : [];

    res.json({
      success: true,
      data: {
        order: {
          id: order._id,
          orderNumber: order.orderNumber,
          status: order.status,
          items: order.items,
          subtotal: order.subtotal,
          tax: order.tax,
          shipping: order.shipping,
          discount: order.discount,
          totalAmount: order.totalAmount,
          currency: order.currency,
          shippingAddress: order.shippingAddress,
          payment: order.payment,
          notes: order.notes,
          isGift: order.isGift,
          giftMessage: order.giftMessage,
          customer: order.user,
          vendor: order.vendor,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
          statusHistory: order.statusHistory,
          timeline: order.timeline
        },
        tracking,
        returns: returnInfo
      }
    });

  } catch (error) {
    console.error('Get order details error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch order details'
    });
  }
};

// @desc    Update order status
// @route   PUT /api/admin/orders/:orderId/status
// @access  Private (Admin)
const updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'Status is required'
      });
    }

    const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned', 'refunded'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status'
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    const oldStatus = order.status;
    await order.addStatusChange(status, req.user._id, notes);

    // Add timeline event
    await order.addTimelineEvent(status, `Status changed from ${oldStatus} to ${status}`, 'Admin Panel', {
      changedBy: req.user._id,
      notes
    });

    // Send notification to customer
    const customer = await User.findById(order.user);
    await sendEmail({
      to: customer.email,
      subject: `Order ${order.orderNumber} Update`,
      template: 'orderStatusUpdate',
      data: {
        customerName: customer.firstName,
        orderNumber: order.orderNumber,
        status,
        statusDescription: `Your order status has been updated to ${status}`,
        notes,
        orderUrl: `${process.env.FRONTEND_URL}/orders/${order._id}`
      }
    });

    res.json({
      success: true,
      message: 'Order status updated successfully',
      data: {
        order: {
          id: order._id,
          orderNumber: order.orderNumber,
          status: order.status,
          statusHistory: order.statusHistory.slice(-1)
        }
      }
    });

  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update order status'
    });
  }
};

// @desc    Get product management data
// @route   GET /api/admin/products
// @access  Private (Admin)
const getProductManagement = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      category,
      vendor,
      featured,
      trending,
      lowStock,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    let query = {};

    if (status) {
      query.status = status;
    }

    if (category) {
      query.category = category;
    }

    if (vendor) {
      query.vendor = vendor;
    }

    if (featured !== undefined) {
      query.featured = featured === 'true';
    }

    if (trending !== undefined) {
      query.trending = trending === 'true';
    }

    if (lowStock === 'true') {
      query['inventory.quantity'] = { $lte: '$inventory.lowStockThreshold' };
      query['inventory.trackQuantity'] = true;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } }
      ];
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const products = await Product.find(query)
      .populate('category', 'name slug')
      .populate('vendor', 'firstName lastName businessName')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('name slug sku price inventory rating status category vendor featured trending createdAt');

    const total = await Product.countDocuments(query);

    // Get product statistics
    const productStats = await Product.getProductStats();

    res.json({
      success: true,
      data: {
        products,
        statistics: productStats,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get product management error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product management data'
    });
  }
};

// @desc    Approve vendor
// @route   PUT /api/admin/vendors/:vendorId/approve
// @access  Private (Admin)
const approveVendor = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { notes } = req.body;

    const vendor = await User.findById(vendorId);
    if (!vendor || vendor.role !== 'vendor') {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found'
      });
    }

    if (vendor.status === 'active') {
      return res.status(400).json({
        success: false,
        error: 'Vendor is already approved'
      });
    }

    // Approve vendor
    vendor.status = 'active';
    vendor.vendorProfile.isVerified = true;
    await vendor.save();

    // Add admin note
    vendor.adminNotes.push({
      note: `Vendor approved${notes ? `: ${notes}` : ''}`,
      addedBy: req.user._id,
      type: 'note'
    });
    await vendor.save();

    // Send approval email
    await sendEmail({
      to: vendor.email,
      subject: 'Vendor Application Approved!',
      template: 'vendorApproval',
      data: {
        firstName: vendor.firstName,
        businessName: vendor.vendorProfile.businessName,
        notes,
        loginUrl: `${process.env.FRONTEND_URL}/vendor/dashboard`
      }
    });

    res.json({
      success: true,
      message: 'Vendor approved successfully',
      data: {
        vendor: {
          id: vendor._id,
          status: vendor.status,
          isVerified: vendor.vendorProfile.isVerified
        }
      }
    });

  } catch (error) {
    console.error('Approve vendor error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve vendor'
    });
  }
};

// @desc    Reject vendor
// @route   PUT /api/admin/vendors/:vendorId/reject
// @access  Private (Admin)
const rejectVendor = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Reason for rejection is required'
      });
    }

    const vendor = await User.findById(vendorId);
    if (!vendor || vendor.role !== 'vendor') {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found'
      });
    }

    // Reject vendor
    vendor.status = 'inactive';
    await vendor.save();

    // Add admin note
    vendor.adminNotes.push({
      note: `Vendor application rejected: ${reason}`,
      addedBy: req.user._id,
      type: 'note'
    });
    await vendor.save();

    // Send rejection email
    await sendEmail({
      to: vendor.email,
      subject: 'Vendor Application Update',
      template: 'vendorRejection',
      data: {
        firstName: vendor.firstName,
        reason,
        contactUrl: `${process.env.FRONTEND_URL}/contact`
      }
    });

    res.json({
      success: true,
      message: 'Vendor rejected successfully'
    });

  } catch (error) {
    console.error('Reject vendor error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reject vendor'
    });
  }
};

// @desc    Get system analytics
// @route   GET /api/admin/analytics
// @access  Private (Admin)
const getSystemAnalytics = async (req, res) => {
  try {
    const { startDate, endDate, period = '30d' } = req.query;

    // Calculate date range
    const daysBack = parseInt(period.replace('d', ''));
    const start = startDate ? new Date(startDate) : new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000));
    const end = endDate ? new Date(endDate) : new Date();

    // Get comprehensive analytics
    const [
      userAnalytics,
      productAnalytics,
      orderAnalytics,
      revenueAnalytics,
      categoryAnalytics,
      vendorAnalytics
    ] = await Promise.all([
      getUserAnalytics(start, end),
      getProductAnalytics(start, end),
      getOrderAnalytics(start, end),
      getRevenueAnalytics(start, end),
      getCategoryAnalytics(),
      getVendorAnalytics(start, end)
    ]);

    res.json({
      success: true,
      data: {
        period: { start, end },
        analytics: {
          users: userAnalytics,
          products: productAnalytics,
          orders: orderAnalytics,
          revenue: revenueAnalytics,
          categories: categoryAnalytics,
          vendors: vendorAnalytics
        }
      }
    });

  } catch (error) {
    console.error('Get system analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch system analytics'
    });
  }
};

// @desc    Get system settings
// @route   GET /api/admin/settings
// @access  Private (Admin)
const getSystemSettings = async (req, res) => {
  try {
    // This would typically get settings from a Settings collection or config
    const settings = {
      general: {
        siteName: 'E-commerce Platform',
        siteDescription: 'Multi-vendor e-commerce platform',
        contactEmail: 'admin@example.com',
        supportPhone: '+1-555-0123',
        currency: 'USD',
        timezone: 'America/New_York'
      },
      features: {
        allowGuestCheckout: true,
        requireEmailVerification: true,
        allowVendorRegistration: true,
        enableReviews: true,
        enableWishlist: true,
        enableCompare: true,
        enableGiftWrapping: true,
        enableLoyaltyProgram: false
      },
      limits: {
        maxProductImages: 10,
        maxOrderItems: 50,
        maxCartItems: 100,
        maxWishlistItems: 50,
        minOrderAmount: 10,
        maxOrderAmount: 10000
      },
      policies: {
        returnDays: 30,
        shippingDays: 5,
        vendorCommission: 0.10,
        taxRate: 0.08
      },
      integrations: {
        stripeEnabled: !!process.env.STRIPE_SECRET_KEY,
        paypalEnabled: !!process.env.PAYPAL_CLIENT_ID,
        emailEnabled: true,
        smsEnabled: !!process.env.TWILIO_ACCOUNT_SID
      }
    };

    res.json({
      success: true,
      data: {
        settings
      }
    });

  } catch (error) {
    console.error('Get system settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch system settings'
    });
  }
};

// @desc    Update system settings
// @route   PUT /api/admin/settings
// @access  Private (Admin)
const updateSystemSettings = async (req, res) => {
  try {
    const updates = req.body;

    // Validate updates
    const allowedSettings = [
      'general.siteName', 'general.siteDescription', 'general.contactEmail',
      'general.supportPhone', 'general.currency', 'general.timezone',
      'features.allowGuestCheckout', 'features.requireEmailVerification',
      'features.allowVendorRegistration', 'features.enableReviews',
      'features.enableWishlist', 'features.enableCompare', 'features.enableGiftWrapping',
      'limits.maxProductImages', 'limits.maxOrderItems', 'limits.maxCartItems',
      'limits.minOrderAmount', 'limits.maxOrderAmount',
      'policies.returnDays', 'policies.shippingDays', 'policies.vendorCommission'
    ];

    const filteredUpdates = {};
    Object.keys(updates).forEach(key => {
      if (allowedSettings.includes(key)) {
        filteredUpdates[key] = updates[key];
      }
    });

    // Update settings (this would save to database in real implementation)
    // For now, just return success
    res.json({
      success: true,
      message: 'System settings updated successfully',
      data: {
        updatedSettings: filteredUpdates
      }
    });

  } catch (error) {
    console.error('Update system settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update system settings'
    });
  }
};

// @desc    Get reports
// @route   GET /api/admin/reports
// @access  Private (Admin)
const getReports = async (req, res) => {
  try {
    const { type, startDate, endDate, format = 'json' } = req.query;

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    let reportData;

    switch (type) {
      case 'sales':
        reportData = await generateSalesReport(start, end);
        break;
      case 'users':
        reportData = await generateUserReport(start, end);
        break;
      case 'products':
        reportData = await generateProductReport(start, end);
        break;
      case 'vendors':
        reportData = await generateVendorReport(start, end);
        break;
      case 'inventory':
        reportData = await generateInventoryReport();
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid report type'
        });
    }

    if (format === 'csv') {
      // Convert to CSV format
      const csvData = convertToCSV(reportData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-report-${new Date().toISOString().split('T')[0]}.csv"`);
      return res.send(csvData);
    }

    res.json({
      success: true,
      data: {
        report: {
          type,
          period: { start, end },
          generatedAt: new Date(),
          data: reportData
        }
      }
    });

  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate report'
    });
  }
};

// @desc    Send bulk notifications
// @route   POST /api/admin/notifications/bulk
// @access  Private (Admin)
const sendBulkNotification = async (req, res) => {
  try {
    const { type, target, title, message, filters = {} } = req.body;

    if (!type || !target || !title || !message) {
      return res.status(400).json({
        success: false,
        error: 'Type, target, title, and message are required'
      });
    }

    // Get target users
    let users;
    switch (target) {
      case 'all':
        users = await User.find({ status: 'active' }).select('email firstName');
        break;
      case 'customers':
        users = await User.find({ role: 'user', status: 'active' }).select('email firstName');
        break;
      case 'vendors':
        users = await User.find({ role: 'vendor', status: 'active' }).select('email firstName');
        break;
      case 'filtered':
        users = await getFilteredUsers(filters);
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid target'
        });
    }

    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No users found for the specified target'
      });
    }

    // Send notifications
    const results = [];
    for (const user of users) {
      try {
        if (type === 'email') {
          await sendEmail({
            to: user.email,
            subject: title,
            template: 'bulkNotification',
            data: {
              firstName: user.firstName,
              message
            }
          });
        } else if (type === 'sms') {
          await sendSMS({
            to: user.phone,
            message: `${title}: ${message}`
          });
        }

        results.push({ userId: user._id, success: true });
      } catch (error) {
        results.push({ userId: user._id, success: false, error: error.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    res.json({
      success: true,
      message: `Bulk notification sent to ${successCount} users`,
      data: {
        total: results.length,
        successful: successCount,
        failed: failureCount,
        results
      }
    });

  } catch (error) {
    console.error('Send bulk notification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send bulk notification'
    });
  }
};

// Helper functions
const getUserStatistics = async (startDate, endDate) => {
  const stats = await User.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: {
          role: '$role',
          status: '$status'
        },
        count: { $sum: 1 },
        verified: { $sum: { $cond: ['$emailVerified', 1, 0] } }
      }
    }
  ]);

  return {
    total: await User.countDocuments({ createdAt: { $gte: startDate, $lte: endDate } }),
    byRole: stats.reduce((acc, stat) => {
      if (!acc[stat._id.role]) acc[stat._id.role] = {};
      acc[stat._id.role][stat._id.status] = stat.count;
      return acc;
    }, {}),
    verified: stats.reduce((sum, stat) => sum + stat.verified, 0)
  };
};

const getProductStatistics = async (startDate, endDate) => {
  const stats = await Product.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        featured: { $sum: { $cond: ['$featured', 1, 0] } },
        averagePrice: { $avg: '$price' }
      }
    }
  ]);

  return {
    total: await Product.countDocuments({ createdAt: { $gte: startDate, $lte: endDate } }),
    byStatus: stats.reduce((acc, stat) => {
      acc[stat._id] = stat.count;
      return acc;
    }, {}),
    featured: stats.reduce((sum, stat) => sum + stat.featured, 0)
  };
};

const getOrderStatistics = async (startDate, endDate) => {
  const stats = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$totalAmount' }
      }
    }
  ]);

  return {
    total: await Order.countDocuments({ createdAt: { $gte: startDate, $lte: endDate } }),
    byStatus: stats.reduce((acc, stat) => {
      acc[stat._id] = stat.count;
      return acc;
    }, {}),
    totalValue: stats.reduce((sum, stat) => sum + stat.totalAmount, 0)
  };
};

const getRevenueStatistics = async (startDate, endDate) => {
  const revenue = await Order.aggregate([
    {
      $match: {
        'payment.status': 'completed',
        createdAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$totalAmount' },
        orderCount: { $sum: 1 },
        averageOrderValue: { $avg: '$totalAmount' }
      }
    }
  ]);

  return revenue[0] || { totalRevenue: 0, orderCount: 0, averageOrderValue: 0 };
};

const getCategoryStatistics = async () => {
  const stats = await Category.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        featured: { $sum: { $cond: ['$featured', 1, 0] } },
        totalProducts: { $sum: '$statistics.productCount' }
      }
    }
  ]);

  return {
    total: await Category.countDocuments(),
    byStatus: stats.reduce((acc, stat) => {
      acc[stat._id] = stat.count;
      return acc;
    }, {}),
    featured: stats.reduce((sum, stat) => sum + stat.featured, 0)
  };
};

const getRecentOrders = async (limit = 10) => {
  return await Order.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('user', 'firstName lastName')
    .populate('vendor', 'businessName')
    .select('orderNumber status totalAmount createdAt user vendor');
};

const getPendingVendors = async () => {
  return await User.find({
    role: 'vendor',
    status: 'pending'
  }).select('firstName lastName email vendorProfile.businessName createdAt');
};

const getLowStockProducts = async (limit = 10) => {
  return await Product.find({
    'inventory.quantity': { $lte: '$inventory.lowStockThreshold' },
    'inventory.trackQuantity': true,
    status: 'active'
  })
  .populate('vendor', 'businessName')
  .sort({ 'inventory.quantity': 1 })
  .limit(limit)
  .select('name sku inventory vendor');
};

const getPendingReviews = async (limit = 10) => {
  const Review = require('../models/Review');
  return await Review.find({ status: 'pending' })
    .populate('user', 'firstName lastName')
    .populate('product', 'name')
    .sort({ createdAt: 1 })
    .limit(limit)
    .select('rating title comment user product createdAt');
};

const getSystemHealth = async () => {
  const health = {
    database: false,
    redis: false,
    email: false,
    sms: false,
    payment: false,
    timestamp: new Date()
  };

  try {
    // Check database
    await User.findOne();
    health.database = true;
  } catch (error) {
    health.database = false;
  }

  // Check other services
  health.redis = !!process.env.REDIS_URL;
  health.email = true; // Assume working if no specific check
  health.sms = !!process.env.TWILIO_ACCOUNT_SID;
  health.payment = !!process.env.STRIPE_SECRET_KEY;

  return health;
};

const generateAlerts = (pendingVendors, lowStockProducts, pendingReviews) => {
  const alerts = [];

  if (pendingVendors.length > 0) {
    alerts.push({
      type: 'warning',
      message: `${pendingVendors.length} vendor applications pending review`,
      action: 'Review vendors',
      url: '/admin/vendors?status=pending'
    });
  }

  if (lowStockProducts.length > 0) {
    alerts.push({
      type: 'error',
      message: `${lowStockProducts.length} products are low in stock`,
      action: 'View products',
      url: '/admin/products?lowStock=true'
    });
  }

  if (pendingReviews.length > 0) {
    alerts.push({
      type: 'info',
      message: `${pendingReviews.length} reviews pending moderation`,
      action: 'Review content',
      url: '/admin/reviews?status=pending'
    });
  }

  return alerts;
};

const getUserActivityLog = async (userId) => {
  // This would typically be from an ActivityLog collection
  // For now, return basic activity
  return [
    {
      action: 'login',
      description: 'User logged in',
      timestamp: new Date(),
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0...'
    }
  ];
};

const getOrderTracking = async (orderId) => {
  // Implementation would go here
  return [];
};

module.exports = {
  getAdminDashboard,
  getUserManagement,
  getUserDetails,
  updateUserStatus,
  deleteUser,
  getOrderManagement,
  getOrderDetails,
  updateOrderStatus,
  getProductManagement,
  approveVendor,
  rejectVendor,
  getSystemAnalytics,
  getSystemSettings,
  updateSystemSettings,
  getReports,
  sendBulkNotification
};
