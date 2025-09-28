const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Category = require('../models/Category');
const Cart = require('../models/Cart');
const Review = require('../models/Review');
const { 
  authenticate, 
  requireVendorOrAdmin,
  generateToken,
  hashPassword,
  sanitizeInput,
  isValidEmail,
  isValidPhone
} = require('../middleware/authMiddleware');
const { sendEmail } = require('../services/emailService');
const { sendSMS } = require('../services/smsService');

// @desc    Vendor registration/onboarding
// @route   POST /api/vendors/register
// @access  Private (users can become vendors)
const registerVendor = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      businessName,
      businessType,
      businessDescription,
      taxId,
      businessLicense,
      businessAddress,
      bankAccount,
      website,
      socialMedia,
      businessHours,
      returnPolicy,
      shippingPolicy,
      acceptTerms
    } = req.body;

    // Validate required fields
    if (!businessName || !businessType || !businessAddress || !bankAccount || !acceptTerms) {
      return res.status(400).json({
        success: false,
        error: 'Please provide all required fields'
      });
    }

    // Sanitize inputs
    const sanitizedBusinessName = sanitizeInput(businessName);
    const sanitizedBusinessDescription = businessDescription ? sanitizeInput(businessDescription) : '';
    const sanitizedTaxId = taxId ? sanitizeInput(taxId) : '';
    const sanitizedBusinessLicense = businessLicense ? sanitizeInput(businessLicense) : '';
    const sanitizedWebsite = website ? sanitizeInput(website) : '';

    // Validate business type
    const validBusinessTypes = ['individual', 'business', 'nonprofit'];
    if (!validBusinessTypes.includes(businessType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid business type'
      });
    }

    // Validate website if provided
    if (sanitizedWebsite) {
      const websiteRegex = /^https?:\/\/.+/;
      if (!websiteRegex.test(sanitizedWebsite)) {
        return res.status(400).json({
          success: false,
          error: 'Please provide a valid website URL'
        });
      }
    }

    // Check if user is already a vendor
    const existingUser = await User.findById(userId);
    if (existingUser.role === 'vendor') {
      return res.status(400).json({
        success: false,
        error: 'User is already registered as a vendor'
      });
    }

    // Validate bank account information
    if (!bankAccount.accountNumber || !bankAccount.routingNumber || !bankAccount.bankName || !bankAccount.accountHolderName) {
      return res.status(400).json({
        success: false,
        error: 'Complete bank account information is required'
      });
    }

    // Update user to vendor role and add vendor profile
    const vendorProfile = {
      businessName: sanitizedBusinessName,
      businessType,
      businessAddress: {
        street: sanitizeInput(businessAddress.street),
        city: sanitizeInput(businessAddress.city),
        state: sanitizeInput(businessAddress.state),
        country: sanitizeInput(businessAddress.country) || 'US',
        zipCode: sanitizeInput(businessAddress.zipCode)
      },
      bankAccount: {
        accountNumber: sanitizeInput(bankAccount.accountNumber),
        routingNumber: sanitizeInput(bankAccount.routingNumber),
        bankName: sanitizeInput(bankAccount.bankName),
        accountHolderName: sanitizeInput(bankAccount.accountHolderName)
      },
      taxId: sanitizedTaxId,
      businessLicense: sanitizedBusinessLicense,
      website: sanitizedWebsite,
      businessDescription: sanitizedBusinessDescription,
      socialMedia: socialMedia || {},
      businessHours: businessHours || {},
      returnPolicy: returnPolicy || '',
      shippingPolicy: shippingPolicy || '',
      commissionRate: 0.10, // Default 10% commission
      isVerified: false
    };

    const user = await User.findByIdAndUpdate(
      userId,
      {
        role: 'vendor',
        vendorProfile,
        status: 'pending' // Require verification for vendors
      },
      { new: true }
    );

    // Create vendor verification documents placeholder
    const verificationDocuments = [];
    
    if (taxId) {
      verificationDocuments.push({
        type: 'tax_document',
        filename: `tax_document_${Date.now()}`,
        url: '',
        status: 'pending'
      });
    }
    
    if (businessLicense) {
      verificationDocuments.push({
        type: 'business_license',
        filename: `business_license_${Date.now()}`,
        url: '',
        status: 'pending'
      });
    }

    if (verificationDocuments.length > 0) {
      user.vendorProfile.verificationDocuments = verificationDocuments;
      await user.save();
    }

    // Send notification to admins about new vendor registration
    try {
      const admins = await User.find({ role: 'admin', status: 'active' });
      for (const admin of admins) {
        await sendEmail({
          to: admin.email,
          subject: 'New Vendor Registration',
          template: 'adminNotification',
          data: {
            type: 'vendor_registration',
            vendorName: user.firstName + ' ' + user.lastName,
            businessName: sanitizedBusinessName,
            email: user.email,
            registrationDate: user.updatedAt,
            adminUrl: `${process.env.FRONTEND_URL}/admin/vendors/${user._id}`
          }
        });
      }
    } catch (emailError) {
      console.error('Failed to send admin notification:', emailError);
    }

    res.status(201).json({
      success: true,
      message: 'Vendor registration submitted successfully! Your application is under review.',
      data: {
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          status: user.status,
          vendorProfile: user.vendorProfile
        }
      }
    });

  } catch (error) {
    console.error('Vendor registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Vendor registration failed. Please try again.'
    });
  }
};

// @desc    Get vendor profile
// @route   GET /api/vendors/profile
// @access  Private (Vendor/Admin)
const getVendorProfile = async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? req.query.vendorId : req.user._id;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Vendor ID is required'
      });
    }

    const user = await User.findById(userId)
      .populate('vendorProfile.verificationDocuments')
      .select('+vendorProfile');

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found'
      });
    }

    if (user.role !== 'vendor' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Vendor access required.'
      });
    }

    // Get vendor statistics
    const productCount = await Product.countDocuments({ vendor: userId });
    const orderStats = await Order.aggregate([
      { $match: { vendor: userId, 'payment.status': 'completed' } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$totalAmount' },
          averageOrderValue: { $avg: '$totalAmount' }
        }
      }
    ]);

    const stats = orderStats[0] || { totalOrders: 0, totalRevenue: 0, averageOrderValue: 0 };

    // Get recent orders
    const recentOrders = await Order.find({ vendor: userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('user', 'firstName lastName email')
      .select('orderNumber status totalAmount createdAt user');

    // Get top products
    const topProducts = await Product.find({ vendor: userId })
      .sort({ 'statistics.views': -1 })
      .limit(5)
      .select('name price rating statistics.views');

    res.json({
      success: true,
      data: {
        vendor: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          role: user.role,
          status: user.status,
          emailVerified: user.emailVerified,
          vendorProfile: user.vendorProfile,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        },
        statistics: {
          productCount,
          ...stats,
          earnings: stats.totalRevenue * (1 - (user.vendorProfile?.commissionRate || 0.10)),
          pendingEarnings: await getPendingEarnings(userId),
          rating: user.vendorProfile?.rating || 0,
          reviewCount: user.vendorProfile?.reviewCount || 0
        },
        recentOrders,
        topProducts
      }
    });

  } catch (error) {
    console.error('Get vendor profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch vendor profile'
    });
  }
};

// @desc    Update vendor profile
// @route   PUT /api/vendors/profile
// @access  Private (Vendor/Admin)
const updateVendorProfile = async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? req.body.vendorId : req.user._id;
    const updates = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Vendor ID is required'
      });
    }

    // Check if user is vendor or admin is updating
    if (req.user.role !== 'admin' && req.user._id.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only update your own vendor profile.'
      });
    }

    const user = await User.findById(userId);
    if (!user || user.role !== 'vendor') {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found'
      });
    }

    // Fields that can be updated in vendor profile
    const allowedUpdates = [
      'businessName', 'businessDescription', 'website', 'socialMedia',
      'businessHours', 'returnPolicy', 'shippingPolicy', 'businessAddress'
    ];

    // Filter vendor profile updates
    const vendorUpdates = {};
    Object.keys(updates).forEach(key => {
      if (allowedUpdates.includes(key)) {
        if (key === 'businessAddress' && typeof updates[key] === 'object') {
          vendorUpdates[`vendorProfile.${key}`] = {
            street: sanitizeInput(updates[key].street),
            city: sanitizeInput(updates[key].city),
            state: sanitizeInput(updates[key].state),
            country: sanitizeInput(updates[key].country) || 'US',
            zipCode: sanitizeInput(updates[key].zipCode)
          };
        } else {
          vendorUpdates[`vendorProfile.${key}`] = sanitizeInput(updates[key]);
        }
      }
    });

    // Update user
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: vendorUpdates },
      { new: true }
    );

    res.json({
      success: true,
      message: 'Vendor profile updated successfully',
      data: {
        vendorProfile: updatedUser.vendorProfile
      }
    });

  } catch (error) {
    console.error('Update vendor profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update vendor profile'
    });
  }
};

// @desc    Submit vendor verification documents
// @route   POST /api/vendors/verification-documents
// @access  Private (Vendor)
const submitVerificationDocuments = async (req, res) => {
  try {
    const userId = req.user._id;
    const { documents } = req.body;

    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide verification documents'
      });
    }

    const user = await User.findById(userId);
    if (!user || user.role !== 'vendor') {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found'
      });
    }

    // Process each document
    const processedDocuments = documents.map(doc => ({
      type: doc.type,
      filename: doc.filename,
      url: doc.url, // This would be the uploaded file URL
      uploadedAt: new Date(),
      status: 'pending'
    }));

    // Add to existing verification documents
    user.vendorProfile.verificationDocuments.push(...processedDocuments);
    await user.save();

    // Notify admins about new documents
    try {
      const admins = await User.find({ role: 'admin', status: 'active' });
      for (const admin of admins) {
        await sendEmail({
          to: admin.email,
          subject: 'New Vendor Verification Documents',
          template: 'adminNotification',
          data: {
            type: 'vendor_documents',
            vendorName: user.firstName + ' ' + user.lastName,
            businessName: user.vendorProfile.businessName,
            documentCount: processedDocuments.length,
            adminUrl: `${process.env.FRONTEND_URL}/admin/vendors/${user._id}`
          }
        });
      }
    } catch (emailError) {
      console.error('Failed to send admin notification:', emailError);
    }

    res.json({
      success: true,
      message: 'Verification documents submitted successfully',
      data: {
        documents: user.vendorProfile.verificationDocuments
      }
    });

  } catch (error) {
    console.error('Submit verification documents error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit verification documents'
    });
  }
};

// @desc    Get vendor dashboard
// @route   GET /api/vendors/dashboard
// @access  Private (Vendor/Admin)
const getVendorDashboard = async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? req.query.vendorId : req.user._id;
    const { period = '30d' } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Vendor ID is required'
      });
    }

    const user = await User.findById(userId);
    if (!user || user.role !== 'vendor') {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found'
      });
    }

    // Calculate date range
    const now = new Date();
    const daysBack = parseInt(period.replace('d', ''));
    const startDate = new Date(now.getTime() - (daysBack * 24 * 60 * 60 * 1000));

    // Get revenue analytics
    const revenueAnalytics = await Order.aggregate([
      {
        $match: {
          vendor: user._id,
          'payment.status': 'completed',
          orderDate: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$orderDate' },
            month: { $month: '$orderDate' },
            day: { $dayOfMonth: '$orderDate' }
          },
          revenue: { $sum: '$totalAmount' },
          orders: { $sum: 1 },
          averageOrderValue: { $avg: '$totalAmount' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    // Get product performance
    const productPerformance = await Product.aggregate([
      { $match: { vendor: user._id } },
      {
        $project: {
          name: 1,
          price: 1,
          'statistics.views': 1,
          'statistics.conversions': 1,
          'rating.average': 1,
          revenue: '$analytics.revenue'
        }
      },
      { $sort: { 'statistics.views': -1 } },
      { $limit: 10 }
    ]);

    // Get order status distribution
    const orderStatusStats = await Order.aggregate([
      { $match: { vendor: user._id } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get pending orders
    const pendingOrders = await Order.find({
      vendor: user._id,
      status: { $in: ['pending', 'confirmed', 'processing'] }
    })
    .sort({ createdAt: 1 })
    .limit(10)
    .populate('user', 'firstName lastName email')
    .select('orderNumber status totalAmount createdAt user');

    // Get low stock products
    const lowStockProducts = await Product.find({
      vendor: user._id,
      'inventory.quantity': { $lte: '$inventory.lowStockThreshold' },
      'inventory.trackQuantity': true,
      status: 'active'
    })
    .sort({ 'inventory.quantity': 1 })
    .limit(10)
    .select('name sku inventory.quantity inventory.lowStockThreshold');

    // Calculate key metrics
    const totalRevenue = revenueAnalytics.reduce((sum, day) => sum + day.revenue, 0);
    const totalOrders = revenueAnalytics.reduce((sum, day) => sum + day.orders, 0);
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    res.json({
      success: true,
      data: {
        period,
        metrics: {
          totalRevenue,
          totalOrders,
          averageOrderValue,
          productCount: await Product.countDocuments({ vendor: user._id, status: 'active' }),
          pendingOrdersCount: pendingOrders.length,
          lowStockCount: lowStockProducts.length
        },
        revenueAnalytics,
        productPerformance,
        orderStatusStats,
        pendingOrders,
        lowStockProducts,
        vendorProfile: user.vendorProfile
      }
    });

  } catch (error) {
    console.error('Get vendor dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch vendor dashboard'
    });
  }
};

// @desc    Get vendor products
// @route   GET /api/vendors/products
// @access  Private (Vendor/Admin)
const getVendorProducts = async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? req.query.vendorId : req.user._id;
    const {
      page = 1,
      limit = 20,
      status,
      category,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Vendor ID is required'
      });
    }

    const user = await User.findById(userId);
    if (!user || user.role !== 'vendor') {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found'
      });
    }

    // Build query
    let query = { vendor: userId };

    if (status) {
      query.status = status;
    }

    if (category) {
      query.category = category;
    }

    if (search) {
      query.$text = { $search: search };
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const products = await Product.find(query)
      .populate('category', 'name slug')
      .populate('subCategory', 'name slug')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('name slug sku price inventory rating status createdAt updatedAt');

    const total = await Product.countDocuments(query);

    res.json({
      success: true,
      data: {
        products,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get vendor products error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch vendor products'
    });
  }
};

// @desc    Get vendor orders
// @route   GET /api/vendors/orders
// @access  Private (Vendor/Admin)
const getVendorOrders = async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? req.query.vendorId : req.user._id;
    const {
      page = 1,
      limit = 20,
      status,
      startDate,
      endDate,
      search
    } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Vendor ID is required'
      });
    }

    const user = await User.findById(userId);
    if (!user || user.role !== 'vendor') {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found'
      });
    }

    // Build query
    let query = { vendor: userId };

    if (status) {
      query.status = status;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    if (search) {
      query.$or = [
        { orderNumber: { $regex: search, $options: 'i' } },
        { 'customer.email': { $regex: search, $options: 'i' } }
      ];
    }

    const orders = await Order.find(query)
      .populate('user', 'firstName lastName email')
      .populate('items.product', 'name sku images')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Order.countDocuments(query);

    res.json({
      success: true,
      data: {
        orders,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get vendor orders error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch vendor orders'
    });
  }
};

// @desc    Update order status
// @route   PUT /api/vendors/orders/:orderId/status
// @access  Private (Vendor/Admin)
const updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, notes } = req.body;
    const userId = req.user.role === 'admin' ? req.body.vendorId : req.user._id;

    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'Status is required'
      });
    }

    const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
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

    if (order.vendor.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only update your own orders.'
      });
    }

    // Update order status
    await order.addStatusChange(status, req.user._id, notes);

    // Add timeline event
    let eventDescription = '';
    switch (status) {
      case 'confirmed':
        eventDescription = 'Order has been confirmed by vendor';
        break;
      case 'processing':
        eventDescription = 'Order is being processed';
        break;
      case 'shipped':
        eventDescription = 'Order has been shipped';
        break;
      case 'delivered':
        eventDescription = 'Order has been delivered';
        break;
      case 'cancelled':
        eventDescription = 'Order has been cancelled';
        break;
    }

    if (eventDescription) {
      await order.addTimelineEvent(status, eventDescription);
    }

    // Send notification to customer
    try {
      await sendEmail({
        to: order.customer.email,
        subject: `Order ${order.orderNumber} Update`,
        template: 'orderStatusUpdate',
        data: {
          customerName: order.customer.name,
          orderNumber: order.orderNumber,
          status,
          statusDescription: eventDescription,
          orderUrl: `${process.env.FRONTEND_URL}/orders/${order._id}`
        }
      });
    } catch (emailError) {
      console.error('Failed to send order status email:', emailError);
    }

    res.json({
      success: true,
      message: 'Order status updated successfully',
      data: {
        order: {
          id: order._id,
          orderNumber: order.orderNumber,
          status: order.status,
          statusHistory: order.statusHistory
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

// @desc    Get vendor earnings
// @route   GET /api/vendors/earnings
// @access  Private (Vendor/Admin)
const getVendorEarnings = async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? req.query.vendorId : req.user._id;
    const { period = '30d', groupBy = 'day' } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Vendor ID is required'
      });
    }

    const user = await User.findById(userId);
    if (!user || user.role !== 'vendor') {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found'
      });
    }

    // Calculate date range
    const now = new Date();
    const daysBack = parseInt(period.replace('d', ''));
    const startDate = new Date(now.getTime() - (daysBack * 24 * 60 * 60 * 1000));

    // Get earnings data
    const earningsData = await Order.aggregate([
      {
        $match: {
          vendor: user._id,
          'payment.status': 'completed',
          orderDate: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: groupBy === 'month' ? 
            { year: { $year: '$orderDate' }, month: { $month: '$orderDate' } } :
            { year: { $year: '$orderDate' }, month: { $month: '$orderDate' }, day: { $dayOfMonth: '$orderDate' } },
          revenue: { $sum: '$totalAmount' },
          orders: { $sum: 1 },
          commission: { $sum: { $multiply: ['$totalAmount', user.vendorProfile.commissionRate || 0.10] } },
          earnings: { $sum: { $multiply: ['$totalAmount', 1 - (user.vendorProfile.commissionRate || 0.10)] } }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    // Calculate totals
    const totalRevenue = earningsData.reduce((sum, item) => sum + item.revenue, 0);
    const totalCommission = earningsData.reduce((sum, item) => sum + item.commission, 0);
    const totalEarnings = earningsData.reduce((sum, item) => sum + item.earnings, 0);
    const totalOrders = earningsData.reduce((sum, item) => sum + item.orders, 0);

    // Get pending earnings
    const pendingEarnings = await getPendingEarnings(userId);

    // Get withdrawal history (this would be from a separate Withdrawals collection)
    const withdrawalHistory = []; // Placeholder

    res.json({
      success: true,
      data: {
        period,
        summary: {
          totalRevenue,
          totalCommission,
          totalEarnings,
          totalOrders,
          pendingEarnings,
          availableBalance: user.vendorProfile.availableBalance || 0
        },
        earningsData,
        withdrawalHistory
      }
    });

  } catch (error) {
    console.error('Get vendor earnings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch vendor earnings'
    });
  }
};

// @desc    Request withdrawal
// @route   POST /api/vendors/withdrawals
// @access  Private (Vendor)
const requestWithdrawal = async (req, res) => {
  try {
    const userId = req.user._id;
    const { amount, method = 'bank_transfer', notes } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid withdrawal amount'
      });
    }

    const user = await User.findById(userId);
    if (!user || user.role !== 'vendor') {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found'
      });
    }

    const availableBalance = user.vendorProfile.availableBalance || 0;
    const minWithdrawal = 50; // Configurable
    const maxWithdrawal = 10000; // Configurable

    if (amount < minWithdrawal) {
      return res.status(400).json({
        success: false,
        error: `Minimum withdrawal amount is $${minWithdrawal}`
      });
    }

    if (amount > maxWithdrawal) {
      return res.status(400).json({
        success: false,
        error: `Maximum withdrawal amount is $${maxWithdrawal}`
      });
    }

    if (amount > availableBalance) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient balance for withdrawal'
      });
    }

    // Create withdrawal request (this would be stored in a Withdrawals collection)
    const withdrawalRequest = {
      vendor: userId,
      amount,
      method,
      status: 'pending',
      requestedAt: new Date(),
      notes: sanitizeInput(notes) || ''
    };

    // In a real implementation, you would save this to a Withdrawals collection
    // For now, we'll simulate the process

    // Deduct from available balance
    user.vendorProfile.availableBalance -= amount;
    await user.save();

    // Notify admins about withdrawal request
    try {
      const admins = await User.find({ role: 'admin', status: 'active' });
      for (const admin of admins) {
        await sendEmail({
          to: admin.email,
          subject: 'New Withdrawal Request',
          template: 'adminNotification',
          data: {
            type: 'withdrawal_request',
            vendorName: user.firstName + ' ' + user.lastName,
            businessName: user.vendorProfile.businessName,
            amount,
            method,
            adminUrl: `${process.env.FRONTEND_URL}/admin/withdrawals/${withdrawalRequest.id}`
          }
        });
      }
    } catch (emailError) {
      console.error('Failed to send admin notification:', emailError);
    }

    res.json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      data: {
        withdrawal: withdrawalRequest,
        remainingBalance: user.vendorProfile.availableBalance
      }
    });

  } catch (error) {
    console.error('Request withdrawal error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process withdrawal request'
    });
  }
};

// @desc    Get vendor analytics
// @route   GET /api/vendors/analytics
// @access  Private (Vendor/Admin)
const getVendorAnalytics = async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? req.query.vendorId : req.user._id;
    const { startDate, endDate, metrics = 'all' } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Vendor ID is required'
      });
    }

    const user = await User.findById(userId);
    if (!user || user.role !== 'vendor') {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found'
      });
    }

    const dateRange = {};
    if (startDate) dateRange.$gte = new Date(startDate);
    if (endDate) dateRange.$lte = new Date(endDate);

    const matchStage = {
      vendor: user._id,
      ...dateRange
    };

    // Get comprehensive analytics
    const analytics = {};

    if (metrics === 'all' || metrics.includes('revenue')) {
      analytics.revenue = await getRevenueAnalytics(userId, dateRange);
    }

    if (metrics === 'all' || metrics.includes('products')) {
      analytics.products = await getProductAnalytics(userId, dateRange);
    }

    if (metrics === 'all' || metrics.includes('orders')) {
      analytics.orders = await getOrderAnalytics(userId, dateRange);
    }

    if (metrics === 'all' || metrics.includes('customers')) {
      analytics.customers = await getCustomerAnalytics(userId, dateRange);
    }

    res.json({
      success: true,
      data: {
        vendorId: userId,
        period: { startDate, endDate },
        analytics
      }
    });

  } catch (error) {
    console.error('Get vendor analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch vendor analytics'
    });
  }
};

// Helper functions
const getPendingEarnings = async (vendorId) => {
  // This would calculate earnings from orders that are delivered but not yet paid out
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  const result = await Order.aggregate([
    {
      $match: {
        vendor: vendorId,
        'payment.status': 'completed',
        status: 'delivered',
        deliveredAt: { $gte: thirtyDaysAgo }
      }
    },
    {
      $group: {
        _id: null,
        totalEarnings: { $sum: { $multiply: ['$totalAmount', 0.90] } } // 10% commission
      }
    }
  ]);
  
  return result[0]?.totalEarnings || 0;
};

const getRevenueAnalytics = async (vendorId, dateRange) => {
  const revenueData = await Order.aggregate([
    {
      $match: {
        vendor: vendorId,
        'payment.status': 'completed',
        orderDate: dateRange
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$orderDate' },
          month: { $month: '$orderDate' },
          day: { $dayOfMonth: '$orderDate' }
        },
        revenue: { $sum: '$totalAmount' },
        orders: { $sum: 1 },
        averageOrderValue: { $avg: '$totalAmount' }
      }
    },
    { $sort: { '_id': 1 } }
  ]);

  return {
    data: revenueData,
    summary: {
      totalRevenue: revenueData.reduce((sum, day) => sum + day.revenue, 0),
      totalOrders: revenueData.reduce((sum, day) => sum + day.orders, 0),
      averageOrderValue: revenueData.length > 0 ? 
        revenueData.reduce((sum, day) => sum + day.revenue, 0) / revenueData.reduce((sum, day) => sum + day.orders, 0) : 0
    }
  };
};

const getProductAnalytics = async (vendorId, dateRange) => {
  const productData = await Product.aggregate([
    { $match: { vendor: vendorId } },
    {
      $project: {
        name: 1,
        price: 1,
        'statistics.views': 1,
        'statistics.conversions': 1,
        'rating.average': 1,
        revenue: '$analytics.revenue'
      }
    },
    { $sort: { 'statistics.views': -1 } }
  ]);

  return {
    topProducts: productData.slice(0, 10),
    summary: {
      totalProducts: productData.length,
      averageRating: productData.reduce((sum, p) => sum + (p.rating?.average || 0), 0) / productData.length || 0,
      totalViews: productData.reduce((sum, p) => sum + (p.statistics?.views || 0), 0),
      totalRevenue: productData.reduce((sum, p) => sum + (p.revenue || 0), 0)
    }
  };
};

const getOrderAnalytics = async (vendorId, dateRange) => {
  const orderData = await Order.aggregate([
    { $match: { vendor: vendorId, ...dateRange } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        revenue: { $sum: '$totalAmount' }
      }
    }
  ]);

  return {
    statusDistribution: orderData,
    summary: {
      totalOrders: orderData.reduce((sum, status) => sum + status.count, 0),
      totalRevenue: orderData.reduce((sum, status) => sum + status.revenue, 0)
    }
  };
};

const getCustomerAnalytics = async (vendorId, dateRange) => {
  const customerData = await Order.aggregate([
    { $match: { vendor: vendorId, ...dateRange } },
    {
      $group: {
        _id: '$user',
        orderCount: { $sum: 1 },
        totalSpent: { $sum: '$totalAmount' },
        lastOrderDate: { $max: '$orderDate' }
      }
    },
    { $sort: { totalSpent: -1 } }
  ]);

  return {
    topCustomers: customerData.slice(0, 10),
    summary: {
      uniqueCustomers: customerData.length,
      averageOrdersPerCustomer: customerData.length > 0 ? 
        customerData.reduce((sum, c) => sum + c.orderCount, 0) / customerData.length : 0,
      averageCustomerValue: customerData.length > 0 ? 
        customerData.reduce((sum, c) => sum + c.totalSpent, 0) / customerData.length : 0
    }
  };
};

// @desc    Update vendor settings
// @route   PUT /api/vendors/settings
// @access  Private (Vendor)
const updateVendorSettings = async (req, res) => {
  try {
    const userId = req.user._id;
    const settings = req.body;

    const user = await User.findById(userId);
    if (!user || user.role !== 'vendor') {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found'
      });
    }

    // Update allowed settings
    const allowedSettings = [
      'notifications', 'autoAcceptOrders', 'minimumOrderAmount',
      'processingTime', 'shippingMethods', 'returnPolicy',
      'storePolicies', 'businessHours'
    ];

    const filteredSettings = {};
    Object.keys(settings).forEach(key => {
      if (allowedSettings.includes(key)) {
        filteredSettings[`vendorProfile.settings.${key}`] = settings[key];
      }
    });

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: filteredSettings },
      { new: true }
    );

    res.json({
      success: true,
      message: 'Vendor settings updated successfully',
      data: {
        settings: updatedUser.vendorProfile.settings
      }
    });

  } catch (error) {
    console.error('Update vendor settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update vendor settings'
    });
  }
};

// @desc    Get vendor reviews
// @route   GET /api/vendors/reviews
// @access  Private (Vendor/Admin)
const getVendorReviews = async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? req.query.vendorId : req.user._id;
    const { page = 1, limit = 20, rating, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Vendor ID is required'
      });
    }

    const user = await User.findById(userId);
    if (!user || user.role !== 'vendor') {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found'
      });
    }

    // Get reviews for vendor's products
    const Review = require('../models/Review');
    const query = {
      product: { $in: await Product.find({ vendor: userId }).distinct('_id') }
    };

    if (rating) {
      query.rating = parseInt(rating);
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const reviews = await Review.find(query)
      .populate('user', 'firstName lastName profile.avatar')
      .populate('product', 'name slug')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Review.countDocuments(query);

    res.json({
      success: true,
      data: {
        reviews,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get vendor reviews error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch vendor reviews'
    });
  }
};

// @desc    Respond to review
// @route   POST /api/vendors/reviews/:reviewId/respond
// @access  Private (Vendor)
const respondToReview = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { response } = req.body;
    const userId = req.user._id;

    if (!response || response.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a response'
      });
    }

    const Review = require('../models/Review');
    const review = await Review.findById(reviewId)
      .populate('product', 'vendor');

    if (!review) {
      return res.status(404).json({
        success: false,
        error: 'Review not found'
      });
    }

    if (review.product.vendor.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only respond to reviews of your products.'
      });
    }

    // Add vendor response
    review.vendorResponse = {
      message: sanitizeInput(response),
      respondedAt: new Date(),
      respondedBy: userId
    };

    await review.save();

    res.json({
      success: true,
      message: 'Response added successfully',
      data: {
        review: {
          id: review._id,
          vendorResponse: review.vendorResponse
        }
      }
    });

  } catch (error) {
    console.error('Respond to review error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to respond to review'
    });
  }
};

// @desc    Get vendor notifications
// @route   GET /api/vendors/notifications
// @access  Private (Vendor)
const getVendorNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20, unreadOnly = false } = req.query;

    // This would typically be from a Notifications collection
    // For now, we'll simulate vendor-specific notifications
    const notifications = [
      {
        id: '1',
        type: 'order',
        title: 'New Order Received',
        message: 'You have received a new order #ORD123456',
        read: false,
        createdAt: new Date(),
        data: { orderId: 'order123' }
      },
      {
        id: '2',
        type: 'review',
        title: 'New Product Review',
        message: 'Your product "Wireless Headphones" received a 5-star review',
        read: false,
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        data: { productId: 'product123', reviewId: 'review123' }
      },
      {
        id: '3',
        type: 'payment',
        title: 'Payment Processed',
        message: 'Payment for order #ORD123456 has been processed',
        read: true,
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        data: { orderId: 'order123' }
      }
    ];

    let filteredNotifications = notifications;
    if (unreadOnly === 'true') {
      filteredNotifications = notifications.filter(n => !n.read);
    }

    const paginatedNotifications = filteredNotifications
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice((page - 1) * limit, page * limit);

    res.json({
      success: true,
      data: {
        notifications: paginatedNotifications,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: filteredNotifications.length,
          pages: Math.ceil(filteredNotifications.length / limit)
        },
        unreadCount: notifications.filter(n => !n.read).length
      }
    });

  } catch (error) {
    console.error('Get vendor notifications error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notifications'
    });
  }
};

// @desc    Mark notification as read
// @route   PUT /api/vendors/notifications/:notificationId/read
// @access  Private (Vendor)
const markNotificationAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user._id;

    // This would update the notification in the database
    // For now, we'll simulate the response
    res.json({
      success: true,
      message: 'Notification marked as read'
    });

  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark notification as read'
    });
  }
};

module.exports = {
  registerVendor,
  getVendorProfile,
  updateVendorProfile,
  submitVerificationDocuments,
  getVendorDashboard,
  getVendorProducts,
  getVendorOrders,
  updateOrderStatus,
  getVendorEarnings,
  requestWithdrawal,
  getVendorAnalytics,
  updateVendorSettings,
  getVendorReviews,
  respondToReview,
  getVendorNotifications,
  markNotificationAsRead
};
