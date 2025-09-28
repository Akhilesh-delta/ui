const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');
const Store = require('../models/Store');
const Review = require('../models/Review');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
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

class ProductController {
  // ===============================
  // BASIC CRUD OPERATIONS
  // ===============================

  // Create new product
  createProduct = catchAsync(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const user = await User.findById(req.user.id);
    const store = await Store.findById(user.vendorProfile.store);

    if (!store || !store.isActive) {
      throw new AppError('Store not found or inactive', 404, true, 'STORE_NOT_FOUND');
    }

    const {
      name,
      description,
      shortDescription,
      category,
      subcategories = [],
      tags = [],
      price,
      compareAtPrice,
      costPrice,
      currency = 'USD',
      variants = [],
      attributes = [],
      inventory = {},
      shipping = {},
      seo = {},
      options = {},
      customFields = []
    } = req.body;

    // Validate category exists
    const categoryDoc = await Category.findById(category);
    if (!categoryDoc) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Handle product images
    let productImages = [];
    if (req.files && req.files.images) {
      const imageFiles = Array.isArray(req.files.images) ? req.files.images : [req.files.images];

      for (const file of imageFiles) {
        const result = await cloudinary.uploader.upload(file.path, {
          folder: `products/${store._id}`,
          quality: 'auto',
          format: 'webp'
        });

        productImages.push({
          url: result.secure_url,
          public_id: result.public_id,
          thumbnail: result.secure_url.replace('/upload/', '/upload/w_300,h_300,c_fill/'),
          alt: `${name} - ${store.name}`,
          uploadedAt: new Date()
        });
      }
    }

    // Create product
    const product = new Product({
      name,
      description,
      shortDescription,
      vendor: user._id,
      store: store._id,
      category,
      subcategories,
      tags,
      price,
      compareAtPrice,
      costPrice,
      currency,
      variants,
      attributes,
      inventory: {
        quantity: inventory.quantity || 0,
        lowStockThreshold: inventory.lowStockThreshold || 5,
        trackQuantity: inventory.trackQuantity !== false,
        allowBackorders: inventory.allowBackorders || false,
        stockStatus: inventory.quantity > 0 ? 'in_stock' : 'out_of_stock',
        ...inventory
      },
      shipping,
      seo,
      options,
      customFields,
      images: productImages,
      status: store.settings.autoPublishProducts ? 'published' : 'draft',
      createdBy: user._id
    });

    await product.save();

    // Update category product count
    await categoryDoc.updateStats();

    // Update store product count
    await store.updateAnalytics();

    // Send notification to store owner
    await Notification.createNotification(user._id, {
      type: 'product',
      category: 'informational',
      title: 'Product Created',
      message: `Your product "${name}" has been created successfully.`,
      data: {
        productId: product._id,
        productName: name
      },
      priority: 'normal',
      actions: [
        {
          type: 'link',
          label: 'View Product',
          url: `/products/${product.slug}`,
          action: 'view_product'
        },
        {
          type: 'link',
          label: 'Edit Product',
          url: `/vendor/products/${product._id}/edit`,
          action: 'edit_product'
        }
      ]
    });

    logger.info('Product created', {
      productId: product._id,
      userId: user._id,
      storeId: store._id
    });

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: product
    });
  });

  // Get all products with advanced filtering
  getProducts = catchAsync(async (req, res) => {
    const {
      // Basic filters
      category,
      vendor,
      store,
      search,
      minPrice,
      maxPrice,
      rating,
      inStock,
      featured,
      status = 'published',

      // Advanced filters
      brand,
      tags,
      attributes,
      variants,
      shipping,
      location,

      // Sorting and pagination
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = 20,

      // Display options
      includeInactive = false,
      includeVariants = false,
      includeAnalytics = false
    } = req.query;

    let query = { isDeleted: false };

    // Status filter
    if (status) {
      query.status = status;
    }

    // Category filter
    if (category) {
      query.category = category;
    }

    // Vendor filter
    if (vendor) {
      query.vendor = vendor;
    }

    // Store filter
    if (store) {
      query.store = store;
    }

    // Price range filter
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = parseFloat(minPrice);
      if (maxPrice) query.price.$lte = parseFloat(maxPrice);
    }

    // Rating filter
    if (rating) {
      query['rating.average'] = { $gte: parseFloat(rating) };
    }

    // Stock filter
    if (inStock === 'true') {
      query['inventory.stockStatus'] = 'in_stock';
    }

    // Featured filter
    if (featured !== undefined) {
      query.featured = featured === 'true';
    }

    // Brand filter
    if (brand) {
      query.brand = { $regex: brand, $options: 'i' };
    }

    // Tags filter
    if (tags) {
      const tagArray = tags.split(',').map(tag => tag.trim());
      query.tags = { $in: tagArray };
    }

    // Text search
    if (search) {
      query.$text = { $search: search };
    }

    // Sorting
    let sort = {};
    const sortOptions = {
      'price': { price: sortOrder === 'desc' ? -1 : 1 },
      'rating': { 'rating.average': sortOrder === 'desc' ? -1 : 1 },
      'newest': { createdAt: sortOrder === 'desc' ? -1 : 1 },
      'popular': { 'stats.views': sortOrder === 'desc' ? -1 : 1 },
      'bestselling': { 'stats.salesCount': sortOrder === 'desc' ? -1 : 1 },
      'name': { name: sortOrder === 'desc' ? -1 : 1 }
    };

    if (sortOptions[sortBy]) {
      sort = sortOptions[sortBy];
    } else {
      sort = { createdAt: -1 };
    }

    // Populate options
    let populateOptions = [
      { path: 'vendor', select: 'firstName lastName' },
      { path: 'store', select: 'name slug' },
      { path: 'category', select: 'name slug' }
    ];

    if (includeVariants) {
      populateOptions.push({ path: 'variants' });
    }

    // Execute query
    const products = await Product.find(query)
      .populate(populateOptions)
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Product.countDocuments(query);

    // Get additional data if requested
    let enhancedProducts = products;

    if (includeAnalytics) {
      enhancedProducts = await Promise.all(products.map(async (product) => {
        const analytics = await this.getProductAnalytics(product._id);
        return { ...product.toObject(), analytics };
      }));
    }

    res.status(200).json({
      success: true,
      data: {
        products: enhancedProducts,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalProducts: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
          limit: parseInt(limit)
        },
        filters: {
          applied: {
            category,
            vendor,
            store,
            search,
            minPrice,
            maxPrice,
            rating,
            inStock,
            featured,
            brand,
            tags
          }
        }
      }
    });
  });

  // Get product by ID or slug
  getProduct = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { includeReviews = false, includeRelated = false, trackView = true } = req.query;

    // Find product by ID or slug
    let product;
    if (mongoose.Types.ObjectId.isValid(id)) {
      product = await Product.findById(id);
    } else {
      product = await Product.findOne({ slug: id });
    }

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    // Check if product is accessible
    if (product.status !== 'published' && product.vendor.toString() !== req.user?.id) {
      throw new AppError('Product not available', 404, true, 'PRODUCT_NOT_AVAILABLE');
    }

    // Track view if requested
    if (trackView) {
      await product.addView();
    }

    // Populate related data
    const populateOptions = [
      { path: 'vendor', select: 'firstName lastName store' },
      { path: 'store', select: 'name slug logo' },
      { path: 'category', select: 'name slug icon' },
      { path: 'subcategories', select: 'name slug' }
    ];

    await product.populate(populateOptions);

    // Get reviews if requested
    let reviews = [];
    if (includeReviews === 'true') {
      reviews = await Review.findByProduct(product._id, {
        limit: 10,
        sortBy: 'helpful'
      });
    }

    // Get related products if requested
    let relatedProducts = [];
    if (includeRelated === 'true') {
      relatedProducts = await this.getRelatedProducts(product._id);
    }

    // Get product recommendations
    const recommendations = await this.getProductRecommendations(product._id, req.user?.id);

    res.status(200).json({
      success: true,
      data: {
        product,
        reviews: reviews || [],
        relatedProducts: relatedProducts || [],
        recommendations: recommendations || [],
        meta: {
          viewCount: product.stats.views,
          salesCount: product.stats.salesCount,
          wishlistCount: product.stats.wishlistCount,
          lastViewed: product.stats.lastViewed
        }
      }
    });
  });

  // Update product
  updateProduct = catchAsync(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { id } = req.params;
    const updates = req.body;

    const product = await Product.findById(id);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    // Check permissions
    if (product.vendor.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to update this product', 403, true, 'NOT_AUTHORIZED');
    }

    // Track changes for history
    const oldProduct = product.toObject();
    const changes = [];

    // Handle image updates
    if (req.files && req.files.images) {
      const imageFiles = Array.isArray(req.files.images) ? req.files.images : [req.files.images];

      for (const file of imageFiles) {
        const result = await cloudinary.uploader.upload(file.path, {
          folder: `products/${product.store}`,
          quality: 'auto',
          format: 'webp'
        });

        product.images.push({
          url: result.secure_url,
          public_id: result.public_id,
          thumbnail: result.secure_url.replace('/upload/', '/upload/w_300,h_300,c_fill/'),
          alt: `${product.name} - ${product.store.name}`,
          uploadedAt: new Date()
        });
      }
    }

    // Handle image deletions
    if (req.body.deletedImages) {
      const deletedImages = JSON.parse(req.body.deletedImages);

      for (const imageId of deletedImages) {
        const image = product.images.id(imageId);
        if (image) {
          // Delete from Cloudinary
          await cloudinary.uploader.destroy(image.public_id);
          // Remove from product
          product.images.pull(imageId);
        }
      }
    }

    // Update allowed fields
    const allowedFields = [
      'name', 'description', 'shortDescription', 'category', 'subcategories',
      'tags', 'price', 'compareAtPrice', 'costPrice', 'currency',
      'variants', 'attributes', 'inventory', 'shipping', 'seo', 'options',
      'customFields', 'status', 'featured'
    ];

    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        const oldValue = product[field];
        const newValue = updates[field];

        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
          changes.push({
            field,
            oldValue,
            newValue,
            changedAt: new Date(),
            changedBy: req.user.id
          });
        }

        product[field] = newValue;
      }
    });

    // Update version history
    if (changes.length > 0) {
      product.versions.push({
        version: (product.versions.length || 0) + 1,
        changes,
        createdAt: new Date()
      });
    }

    product.updatedAt = new Date();
    product.updatedBy = req.user.id;

    await product.save();

    // Update related data
    if (updates.category && updates.category !== oldProduct.category?.toString()) {
      // Update old category stats
      if (oldProduct.category) {
        const oldCategory = await Category.findById(oldProduct.category);
        if (oldCategory) await oldCategory.updateStats();
      }

      // Update new category stats
      const newCategory = await Category.findById(updates.category);
      if (newCategory) await newCategory.updateStats();
    }

    // Update store analytics
    const store = await Store.findById(product.store);
    if (store) await store.updateAnalytics();

    // Send notification
    await Notification.createNotification(product.vendor, {
      type: 'product',
      category: 'informational',
      title: 'Product Updated',
      message: `Your product "${product.name}" has been updated.`,
      data: {
        productId: product._id,
        productName: product.name,
        changes: changes.length
      },
      priority: 'low'
    });

    logger.info('Product updated', {
      productId: product._id,
      userId: req.user.id,
      changes: changes.length
    });

    res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: {
        product,
        changes: changes.length
      }
    });
  });

  // Delete product
  deleteProduct = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { permanent = false } = req.query;

    const product = await Product.findById(id);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    // Check permissions
    if (product.vendor.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to delete this product', 403, true, 'NOT_AUTHORIZED');
    }

    if (permanent === 'true') {
      // Permanent deletion
      // Delete images from Cloudinary
      for (const image of product.images) {
        await cloudinary.uploader.destroy(image.public_id);
      }

      await Product.findByIdAndDelete(id);

      // Update category stats
      const category = await Category.findById(product.category);
      if (category) await category.updateStats();

      // Update store stats
      const store = await Store.findById(product.store);
      if (store) await store.updateAnalytics();

      logger.info('Product permanently deleted', {
        productId: id,
        userId: req.user.id
      });
    } else {
      // Soft deletion
      product.isDeleted = true;
      product.deletedAt = new Date();
      product.deletedBy = req.user.id;
      await product.save();

      // Archive product
      await product.archive();

      logger.info('Product soft deleted', {
        productId: id,
        userId: req.user.id
      });
    }

    res.status(200).json({
      success: true,
      message: permanent === 'true' ? 'Product permanently deleted' : 'Product deleted successfully'
    });
  });

  // ===============================
  // ADVANCED SEARCH & FILTERING
  // ===============================

  // Advanced search
  advancedSearch = catchAsync(async (req, res) => {
    const {
      q: searchTerm,
      category,
      subcategory,
      brand,
      priceMin,
      priceMax,
      rating,
      inStock,
      freeShipping,
      onSale,
      vendor,
      location,
      attributes,
      sortBy = 'relevance',
      page = 1,
      limit = 20
    } = req.query;

    // Build search query
    let searchQuery = { status: 'published', isDeleted: false };

    // Text search
    if (searchTerm) {
      searchQuery.$text = { $search: searchTerm };
    }

    // Category filter
    if (category) {
      searchQuery.category = category;
    }

    // Subcategory filter
    if (subcategory) {
      searchQuery.subcategories = subcategory;
    }

    // Brand filter
    if (brand) {
      searchQuery.brand = { $regex: brand, $options: 'i' };
    }

    // Price range
    if (priceMin || priceMax) {
      searchQuery.price = {};
      if (priceMin) searchQuery.price.$gte = parseFloat(priceMin);
      if (priceMax) searchQuery.price.$lte = parseFloat(priceMax);
    }

    // Rating filter
    if (rating) {
      searchQuery['rating.average'] = { $gte: parseFloat(rating) };
    }

    // Stock filter
    if (inStock === 'true') {
      searchQuery['inventory.stockStatus'] = 'in_stock';
    }

    // Sale filter
    if (onSale === 'true') {
      searchQuery.compareAtPrice = { $exists: true, $gt: '$price' };
    }

    // Free shipping filter
    if (freeShipping === 'true') {
      searchQuery['shipping.freeShipping'] = true;
    }

    // Vendor filter
    if (vendor) {
      searchQuery.vendor = vendor;
    }

    // Attributes filter
    if (attributes) {
      const attributeFilters = JSON.parse(attributes);
      Object.keys(attributeFilters).forEach(attr => {
        searchQuery[`attributes.${attr}`] = attributeFilters[attr];
      });
    }

    // Sorting
    let sort = {};
    switch (sortBy) {
      case 'price_asc':
        sort = { price: 1 };
        break;
      case 'price_desc':
        sort = { price: -1 };
        break;
      case 'rating':
        sort = { 'rating.average': -1 };
        break;
      case 'newest':
        sort = { createdAt: -1 };
        break;
      case 'popular':
        sort = { 'stats.views': -1 };
        break;
      case 'bestselling':
        sort = { 'stats.salesCount': -1 };
        break;
      case 'relevance':
      default:
        if (searchTerm) {
          sort = { score: { $meta: 'textScore' } };
        } else {
          sort = { createdAt: -1 };
        }
    }

    const products = await Product.find(searchQuery)
      .populate('vendor', 'firstName lastName')
      .populate('store', 'name slug')
      .populate('category', 'name slug')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Product.countDocuments(searchQuery);

    // Get search suggestions
    const suggestions = await this.getSearchSuggestions(searchTerm);

    // Get search analytics
    const analytics = await this.getSearchAnalytics(searchTerm);

    res.status(200).json({
      success: true,
      data: {
        products,
        suggestions,
        analytics,
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

  // Get search suggestions
  async getSearchSuggestions(searchTerm) {
    if (!searchTerm || searchTerm.length < 2) return [];

    const suggestions = await Product.aggregate([
      {
        $match: {
          status: 'published',
          isDeleted: false,
          $or: [
            { name: { $regex: searchTerm, $options: 'i' } },
            { brand: { $regex: searchTerm, $options: 'i' } },
            { tags: { $in: [new RegExp(searchTerm, 'i')] } }
          ]
        }
      },
      {
        $group: {
          _id: null,
          suggestions: { $addToSet: '$name' },
          brands: { $addToSet: '$brand' },
          categories: { $addToSet: '$category' }
        }
      }
    ]);

    return suggestions[0] || { suggestions: [], brands: [], categories: [] };
  }

  // Get search analytics
  async getSearchAnalytics(searchTerm) {
    // Implementation for search analytics
    return {
      totalSearches: 0,
      popularSearches: [],
      noResults: 0
    };
  }

  // ===============================
  // PRODUCT VARIANTS MANAGEMENT
  // ===============================

  // Create product variant
  createVariant = catchAsync(async (req, res) => {
    const { productId } = req.params;
    const { name, type, values } = req.body;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    // Check permissions
    if (product.vendor.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to modify this product', 403, true, 'NOT_AUTHORIZED');
    }

    // Add variant
    await product.createVariant({
      name,
      type,
      values
    });

    await product.save();

    logger.info('Product variant created', {
      productId,
      variantName: name,
      userId: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Variant created successfully',
      data: product.variants
    });
  });

  // Update product variant
  updateVariant = catchAsync(async (req, res) => {
    const { productId, variantId } = req.params;
    const updates = req.body;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    // Find and update variant
    const variant = product.variants.id(variantId);
    if (!variant) {
      throw new AppError('Variant not found', 404, true, 'VARIANT_NOT_FOUND');
    }

    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        variant[key] = updates[key];
      }
    });

    await product.save();

    logger.info('Product variant updated', {
      productId,
      variantId,
      userId: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Variant updated successfully',
      data: variant
    });
  });

  // Delete product variant
  deleteVariant = catchAsync(async (req, res) => {
    const { productId, variantId } = req.params;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    // Remove variant
    product.variants.pull(variantId);
    await product.save();

    logger.info('Product variant deleted', {
      productId,
      variantId,
      userId: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Variant deleted successfully'
    });
  });

  // ===============================
  // INVENTORY MANAGEMENT
  // ===============================

  // Update inventory
  updateInventory = catchAsync(async (req, res) => {
    const { productId } = req.params;
    const { quantity, reason, notes } = req.body;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    // Check permissions
    if (product.vendor.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to update inventory', 403, true, 'NOT_AUTHORIZED');
    }

    const oldQuantity = product.inventory.quantity;
    const quantityDiff = quantity - oldQuantity;

    // Update inventory
    product.inventory.quantity = quantity;

    // Update stock status
    if (quantity <= 0) {
      product.inventory.stockStatus = product.inventory.allowBackorders ? 'pre_order' : 'out_of_stock';
    } else if (quantity <= product.inventory.lowStockThreshold) {
      product.inventory.stockStatus = 'low_stock';
    } else {
      product.inventory.stockStatus = 'in_stock';
    }

    await product.save();

    // Add inventory history
    await this.addInventoryHistory(productId, {
      oldQuantity,
      newQuantity: quantity,
      difference: quantityDiff,
      reason,
      notes,
      updatedBy: req.user.id
    });

    // Send notifications
    if (quantity <= product.inventory.lowStockThreshold && oldQuantity > product.inventory.lowStockThreshold) {
      await Notification.createNotification(product.vendor, {
        type: 'product',
        category: 'informational',
        title: 'Low Stock Alert',
        message: `Your product "${product.name}" is running low on stock (${quantity} remaining).`,
        data: {
          productId: product._id,
          productName: product.name,
          quantity
        },
        priority: 'high',
        actions: [
          {
            type: 'link',
            label: 'Update Inventory',
            url: `/vendor/products/${product._id}/inventory`,
            action: 'update_inventory'
          }
        ]
      });
    }

    logger.info('Product inventory updated', {
      productId,
      oldQuantity,
      newQuantity: quantity,
      userId: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Inventory updated successfully',
      data: {
        product: product._id,
        oldQuantity,
        newQuantity: quantity,
        stockStatus: product.inventory.stockStatus
      }
    });
  });

  // Get inventory history
  getInventoryHistory = catchAsync(async (req, res) => {
    const { productId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    // This would typically be stored in a separate collection
    // For now, return mock data
    const history = [
      {
        date: new Date(),
        oldQuantity: 100,
        newQuantity: 95,
        difference: -5,
        reason: 'Sale',
        notes: 'Order #12345'
      }
    ];

    res.status(200).json({
      success: true,
      data: {
        history,
        pagination: {
          currentPage: 1,
          totalPages: 1,
          totalItems: history.length
        }
      }
    });
  });

  // Add inventory history entry
  async addInventoryHistory(productId, historyData) {
    // Implementation for inventory history tracking
    logger.info('Inventory history added', { productId, ...historyData });
  }

  // ===============================
  // PRODUCT ANALYTICS
  // ===============================

  // Get product analytics
  getProductAnalytics = catchAsync(async (req, res) => {
    const { productId } = req.params;
    const { dateRange = 30 } = req.query;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    // Check permissions
    if (product.vendor.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to view analytics', 403, true, 'NOT_AUTHORIZED');
    }

    const analytics = await this.generateProductAnalytics(productId, parseInt(dateRange));

    res.status(200).json({
      success: true,
      data: analytics
    });
  });

  // Generate comprehensive product analytics
  async generateProductAnalytics(productId, dateRange = 30) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    // Get view analytics
    const viewAnalytics = await this.getViewAnalytics(productId, startDate);

    // Get sales analytics
    const salesAnalytics = await this.getSalesAnalytics(productId, startDate);

    // Get conversion analytics
    const conversionAnalytics = await this.getConversionAnalytics(productId, startDate);

    // Get review analytics
    const reviewAnalytics = await this.getReviewAnalytics(productId, startDate);

    // Get traffic sources
    const trafficSources = await this.getTrafficSources(productId, startDate);

    return {
      overview: {
        totalViews: viewAnalytics.total,
        totalSales: salesAnalytics.total,
        conversionRate: conversionAnalytics.rate,
        averageRating: reviewAnalytics.average,
        revenue: salesAnalytics.revenue
      },
      views: viewAnalytics,
      sales: salesAnalytics,
      conversions: conversionAnalytics,
      reviews: reviewAnalytics,
      traffic: trafficSources,
      trends: await this.getAnalyticsTrends(productId, startDate),
      comparisons: await this.getProductComparisons(productId)
    };
  }

  // Get view analytics
  async getViewAnalytics(productId, startDate) {
    // Mock implementation
    return {
      total: 1250,
      daily: 42,
      unique: 890,
      bounceRate: 0.35,
      avgTimeOnPage: 125
    };
  }

  // Get sales analytics
  async getSalesAnalytics(productId, startDate) {
    const salesData = await Order.aggregate([
      {
        $match: {
          'items.product': mongoose.Types.ObjectId(productId),
          status: { $in: ['completed', 'delivered'] },
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalSales: { $sum: 1 },
          totalRevenue: { $sum: '$pricing.totalAmount' },
          totalQuantity: { $sum: { $sum: '$items.quantity' } }
        }
      }
    ]);

    return salesData[0] || { totalSales: 0, totalRevenue: 0, totalQuantity: 0 };
  }

  // Get conversion analytics
  async getConversionAnalytics(productId, startDate) {
    // Mock implementation
    return {
      rate: 0.032,
      cartAdditions: 156,
      wishlistAdditions: 89,
      shares: 23
    };
  }

  // Get review analytics
  async getReviewAnalytics(productId, startDate) {
    const reviewStats = await Review.getReviewStats(productId);
    return reviewStats;
  }

  // Get traffic sources
  async getTrafficSources(productId, startDate) {
    // Mock implementation
    return {
      direct: 45,
      search: 30,
      social: 15,
      referral: 10
    };
  }

  // Get analytics trends
  async getAnalyticsTrends(productId, startDate) {
    // Mock implementation
    return {
      views: 'increasing',
      sales: 'stable',
      rating: 'improving'
    };
  }

  // Get product comparisons
  async getProductComparisons(productId) {
    // Mock implementation
    return {
      categoryAverage: {
        price: 45.50,
        rating: 4.2,
        sales: 125
      },
      similarProducts: []
    };
  }

  // ===============================
  // PRODUCT RECOMMENDATIONS
  // ===============================

  // Get product recommendations
  getRecommendations = catchAsync(async (req, res) => {
    const { productId } = req.params;
    const { type = 'related', limit = 10 } = req.query;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    let recommendations = [];

    switch (type) {
      case 'related':
        recommendations = await this.getRelatedProducts(productId, limit);
        break;
      case 'upsell':
        recommendations = await this.getUpsellProducts(productId, limit);
        break;
      case 'cross_sell':
        recommendations = await this.getCrossSellProducts(productId, limit);
        break;
      case 'personalized':
        recommendations = await this.getPersonalizedRecommendations(productId, req.user?.id, limit);
        break;
      case 'trending':
        recommendations = await this.getTrendingProducts(limit);
        break;
      case 'bestsellers':
        recommendations = await this.getBestsellingProducts(productId, limit);
        break;
    }

    res.status(200).json({
      success: true,
      data: {
        recommendations,
        type,
        algorithm: this.getRecommendationAlgorithm(type)
      }
    });
  });

  // Get related products
  async getRelatedProducts(productId, limit = 10) {
    const product = await Product.findById(productId);

    if (!product.relatedProducts || product.relatedProducts.length === 0) {
      // Find products in same category
      return await Product.find({
        category: product.category,
        _id: { $ne: productId },
        status: 'published',
        isDeleted: false
      })
      .populate('vendor', 'firstName lastName')
      .populate('store', 'name slug')
      .limit(limit);
    }

    const relatedIds = product.relatedProducts.map(rp => rp.product);
    return await Product.find({
      _id: { $in: relatedIds },
      status: 'published',
      isDeleted: false
    })
    .populate('vendor', 'firstName lastName')
    .populate('store', 'name slug');
  }

  // Get upsell products
  async getUpsellProducts(productId, limit = 10) {
    const product = await Product.findById(productId);

    // Find higher-priced products in same category
    return await Product.find({
      category: product.category,
      price: { $gt: product.price },
      status: 'published',
      isDeleted: false
    })
    .populate('vendor', 'firstName lastName')
    .populate('store', 'name slug')
    .sort({ price: 1 })
    .limit(limit);
  }

  // Get cross-sell products
  async getCrossSellProducts(productId, limit = 10) {
    const product = await Product.findById(productId);

    // Find complementary products
    return await Product.find({
      tags: { $in: product.tags },
      _id: { $ne: productId },
      status: 'published',
      isDeleted: false
    })
    .populate('vendor', 'firstName lastName')
    .populate('store', 'name slug')
    .limit(limit);
  }

  // Get personalized recommendations
  async getPersonalizedRecommendations(productId, userId, limit = 10) {
    if (!userId) return [];

    // Get user's purchase history and preferences
    const userOrders = await Order.findByUser(userId, { limit: 50 });
    const userCart = await Cart.findOne({ user: userId });

    // Analyze user's preferences
    const preferences = await this.analyzeUserPreferences(userId, userOrders, userCart);

    // Find products matching preferences
    let query = {
      status: 'published',
      isDeleted: false,
      _id: { $ne: productId }
    };

    if (preferences.categories.length > 0) {
      query.category = { $in: preferences.categories };
    }

    if (preferences.priceRange) {
      query.price = {
        $gte: preferences.priceRange.min,
        $lte: preferences.priceRange.max
      };
    }

    return await Product.find(query)
      .populate('vendor', 'firstName lastName')
      .populate('store', 'name slug')
      .sort({ 'rating.average': -1 })
      .limit(limit);
  }

  // Analyze user preferences
  async analyzeUserPreferences(userId, orders, cart) {
    const categories = [];
    const priceRange = { min: 0, max: 1000 };

    // Analyze order history
    if (orders && orders.length > 0) {
      const allItems = orders.flatMap(order => order.items);

      // Get most purchased categories
      const categoryCount = {};
      allItems.forEach(item => {
        if (categoryCount[item.product.category]) {
          categoryCount[item.product.category]++;
        } else {
          categoryCount[item.product.category] = 1;
        }
      });

      categories.push(...Object.keys(categoryCount).slice(0, 3));

      // Get price range
      const prices = allItems.map(item => item.price);
      priceRange.min = Math.min(...prices) * 0.5;
      priceRange.max = Math.max(...prices) * 1.5;
    }

    return { categories, priceRange };
  }

  // Get trending products
  async getTrendingProducts(limit = 10) {
    return await Product.getTrendingProducts(7, limit);
  }

  // Get bestselling products
  async getBestsellingProducts(productId, limit = 10) {
    const product = await Product.findById(productId);

    return await Product.find({
      category: product.category,
      _id: { $ne: productId },
      status: 'published',
      isDeleted: false
    })
    .populate('vendor', 'firstName lastName')
    .populate('store', 'name slug')
    .sort({ 'stats.salesCount': -1 })
    .limit(limit);
  }

  // Get recommendation algorithm info
  getRecommendationAlgorithm(type) {
    const algorithms = {
      'related': 'Category and tag-based similarity',
      'upsell': 'Higher-priced products in same category',
      'cross_sell': 'Tag-based complementary products',
      'personalized': 'User behavior and purchase history analysis',
      'trending': 'Recent view and purchase activity',
      'bestsellers': 'Sales count ranking in category'
    };

    return algorithms[type] || 'General recommendation algorithm';
  }

  // ===============================
  // BULK OPERATIONS
  // ===============================

  // Bulk update products
  bulkUpdateProducts = catchAsync(async (req, res) => {
    const { productIds, updates } = req.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      throw new AppError('Product IDs array is required', 400, true, 'INVALID_PRODUCT_IDS');
    }

    // Verify permissions for all products
    const products = await Product.find({
      _id: { $in: productIds },
      isDeleted: false
    });

    for (const product of products) {
      if (product.vendor.toString() !== req.user.id && req.user.role !== 'admin') {
        throw new AppError(`Not authorized to update product ${product._id}`, 403, true, 'NOT_AUTHORIZED');
      }
    }

    const result = await Product.bulkUpdate(productIds, updates);

    logger.info('Products bulk updated', {
      userId: req.user.id,
      productCount: productIds.length,
      updates: Object.keys(updates)
    });

    res.status(200).json({
      success: true,
      message: 'Products updated successfully',
      data: {
        updatedCount: result.modifiedCount,
        productIds
      }
    });
  });

  // Bulk delete products
  bulkDeleteProducts = catchAsync(async (req, res) => {
    const { productIds, permanent = false } = req.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      throw new AppError('Product IDs array is required', 400, true, 'INVALID_PRODUCT_IDS');
    }

    // Verify permissions for all products
    const products = await Product.find({
      _id: { $in: productIds },
      isDeleted: false
    });

    for (const product of products) {
      if (product.vendor.toString() !== req.user.id && req.user.role !== 'admin') {
        throw new AppError(`Not authorized to delete product ${product._id}`, 403, true, 'NOT_AUTHORIZED');
      }
    }

    let deletedCount = 0;

    for (const product of products) {
      if (permanent) {
        // Permanent deletion
        await Product.findByIdAndDelete(product._id);
        deletedCount++;
      } else {
        // Soft deletion
        product.isDeleted = true;
        product.deletedAt = new Date();
        product.deletedBy = req.user.id;
        await product.save();
        await product.archive();
        deletedCount++;
      }
    }

    logger.info('Products bulk deleted', {
      userId: req.user.id,
      productCount: deletedCount,
      permanent
    });

    res.status(200).json({
      success: true,
      message: 'Products deleted successfully',
      data: {
        deletedCount,
        productIds
      }
    });
  });

  // Import products
  importProducts = catchAsync(async (req, res) => {
    if (!req.file) {
      throw new AppError('No import file provided', 400, true, 'NO_IMPORT_FILE');
    }

    const user = await User.findById(req.user.id);
    const store = await Store.findById(user.vendorProfile.store);

    // Parse CSV/Excel file
    const products = await this.parseImportFile(req.file.path);

    let imported = 0;
    let errors = [];

    for (const productData of products) {
      try {
        const product = new Product({
          ...productData,
          vendor: user._id,
          store: store._id,
          status: 'draft',
          createdBy: user._id
        });

        await product.save();
        imported++;
      } catch (error) {
        errors.push({
          data: productData,
          error: error.message
        });
      }
    }

    // Update store analytics
    await store.updateAnalytics();

    logger.info('Products imported', {
      userId: user._id,
      imported,
      errors: errors.length
    });

    res.status(200).json({
      success: true,
      message: 'Import completed',
      data: {
        imported,
        errors,
        total: products.length
      }
    });
  });

  // Export products
  exportProducts = catchAsync(async (req, res) => {
    const {
      format = 'csv',
      category,
      vendor,
      status,
      dateFrom,
      dateTo
    } = req.query;

    let query = { isDeleted: false };

    if (category) query.category = category;
    if (vendor) query.vendor = vendor;
    if (status) query.status = status;
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    const products = await Product.find(query)
      .populate('vendor', 'firstName lastName email')
      .populate('store', 'name')
      .populate('category', 'name');

    // Generate export file
    const exportData = await this.generateExportFile(products, format);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="products.${format}"`);

    res.status(200).send(exportData);
  });

  // Parse import file
  async parseImportFile(filePath) {
    // Implementation for parsing CSV/Excel files
    return [];
  }

  // Generate export file
  async generateExportFile(products, format) {
    // Implementation for generating CSV/Excel files
    return 'product data...';
  }

  // ===============================
  // VENDOR PRODUCT MANAGEMENT
  // ===============================

  // Get vendor products
  getVendorProducts = catchAsync(async (req, res) => {
    const user = await User.findById(req.user.id);
    const {
      status = 'all',
      category,
      search,
      sortBy = 'createdAt',
      page = 1,
      limit = 20
    } = req.query;

    let query = { vendor: user._id, isDeleted: false };

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

    // Get store analytics
    const store = await Store.findById(user.vendorProfile.store);
    const analytics = store ? await store.getDashboardData(30) : null;

    res.status(200).json({
      success: true,
      data: {
        products,
        analytics,
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

  // Duplicate product
  duplicateProduct = catchAsync(async (req, res) => {
    const { productId } = req.params;
    const { name, modifications = {} } = req.body;

    const originalProduct = await Product.findById(productId);

    if (!originalProduct) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    // Check permissions
    if (originalProduct.vendor.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to duplicate this product', 403, true, 'NOT_AUTHORIZED');
    }

    const duplicatedProduct = await originalProduct.clone();

    // Apply modifications
    if (name) {
      duplicatedProduct.name = name;
      duplicatedProduct.slug = undefined; // Will be regenerated
    }

    Object.keys(modifications).forEach(key => {
      if (modifications[key] !== undefined) {
        duplicatedProduct[key] = modifications[key];
      }
    });

    await duplicatedProduct.save();

    logger.info('Product duplicated', {
      originalProductId: productId,
      newProductId: duplicatedProduct._id,
      userId: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Product duplicated successfully',
      data: duplicatedProduct
    });
  });

  // ===============================
  // PRICE & PROMOTION MANAGEMENT
  // ===============================

  // Update product price
  updatePrice = catchAsync(async (req, res) => {
    const { productId } = req.params;
    const { price, compareAtPrice } = req.body;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    // Check permissions
    if (product.vendor.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to update price', 403, true, 'NOT_AUTHORIZED');
    }

    const oldPrice = product.price;
    product.price = price;
    if (compareAtPrice !== undefined) {
      product.compareAtPrice = compareAtPrice;
    }

    await product.save();

    // Add price history
    await this.addPriceHistory(productId, {
      oldPrice,
      newPrice: price,
      compareAtPrice,
      updatedBy: req.user.id
    });

    logger.info('Product price updated', {
      productId,
      oldPrice,
      newPrice: price,
      userId: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Price updated successfully',
      data: {
        product: product._id,
        oldPrice,
        newPrice: price,
        discount: product.discountPercentage
      }
    });
  });

  // Add price history
  async addPriceHistory(productId, historyData) {
    // Implementation for price history tracking
    logger.info('Price history added', { productId, ...historyData });
  }

  // Set product discount
  setDiscount = catchAsync(async (req, res) => {
    const { productId } = req.params;
    const { type, value, startDate, endDate } = req.body;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    // Check permissions
    if (product.vendor.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to set discount', 403, true, 'NOT_AUTHORIZED');
    }

    product.discount = {
      type,
      value,
      startDate: startDate ? new Date(startDate) : new Date(),
      endDate: endDate ? new Date(endDate) : null,
      isActive: true
    };

    await product.save();

    logger.info('Product discount set', {
      productId,
      discountType: type,
      discountValue: value,
      userId: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Discount set successfully',
      data: {
        product: product._id,
        discount: product.discount
      }
    });
  });

  // Remove product discount
  removeDiscount = catchAsync(async (req, res) => {
    const { productId } = req.params;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    product.discount = {
      type: 'percentage',
      value: 0,
      isActive: false
    };

    await product.save();

    logger.info('Product discount removed', {
      productId,
      userId: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Discount removed successfully'
    });
  });

  // ===============================
  // ADMIN PRODUCT MANAGEMENT
  // ===============================

  // Get all products (admin)
  getAllProductsAdmin = catchAsync(async (req, res) => {
    const {
      status,
      category,
      vendor,
      featured,
      search,
      sortBy = 'createdAt',
      page = 1,
      limit = 20
    } = req.query;

    let query = {};

    if (status) query.status = status;
    if (category) query.category = category;
    if (vendor) query.vendor = vendor;
    if (featured !== undefined) query.featured = featured === 'true';
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } }
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
      case 'sales':
        sort = { 'stats.salesCount': -1 };
        break;
      case 'rating':
        sort = { 'rating.average': -1 };
        break;
      default:
        sort = { createdAt: -1 };
    }

    const products = await Product.find(query)
      .populate('vendor', 'firstName lastName email')
      .populate('store', 'name')
      .populate('category', 'name')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Product.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
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

  // Approve product (admin)
  approveProduct = catchAsync(async (req, res) => {
    const { productId } = req.params;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    product.status = 'published';
    product.publishedAt = new Date();
    await product.save();

    // Update category stats
    const category = await Category.findById(product.category);
    if (category) await category.updateStats();

    // Update store stats
    const store = await Store.findById(product.store);
    if (store) await store.updateAnalytics();

    // Send notification to vendor
    await Notification.createNotification(product.vendor, {
      type: 'product',
      category: 'informational',
      title: 'Product Approved',
      message: `Your product "${product.name}" has been approved and is now live.`,
      data: {
        productId: product._id,
        productName: product.name
      },
      priority: 'normal',
      actions: [
        {
          type: 'link',
          label: 'View Product',
          url: `/products/${product.slug}`,
          action: 'view_product'
        }
      ]
    });

    logger.info('Product approved by admin', {
      productId,
      adminId: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Product approved successfully',
      data: product
    });
  });

  // Reject product (admin)
  rejectProduct = catchAsync(async (req, res) => {
    const { productId } = req.params;
    const { reason } = req.body;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    product.status = 'draft';
    await product.save();

    // Send notification to vendor
    await Notification.createNotification(product.vendor, {
      type: 'product',
      category: 'informational',
      title: 'Product Requires Changes',
      message: `Your product "${product.name}" needs revision. Reason: ${reason}`,
      data: {
        productId: product._id,
        productName: product.name,
        reason
      },
      priority: 'high',
      actions: [
        {
          type: 'link',
          label: 'Edit Product',
          url: `/vendor/products/${product._id}/edit`,
          action: 'edit_product'
        }
      ]
    });

    logger.info('Product rejected by admin', {
      productId,
      adminId: req.user.id,
      reason
    });

    res.status(200).json({
      success: true,
      message: 'Product rejected successfully'
    });
  });

  // Feature product (admin)
  featureProduct = catchAsync(async (req, res) => {
    const { productId } = req.params;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    product.featured = !product.featured;
    await product.save();

    logger.info('Product featured status changed', {
      productId,
      featured: product.featured,
      adminId: req.user.id
    });

    res.status(200).json({
      success: true,
      message: `Product ${product.featured ? 'featured' : 'unfeatured'} successfully`,
      data: { featured: product.featured }
    });
  });

  // Get product statistics (admin)
  getProductStatistics = catchAsync(async (req, res) => {
    const { dateRange = 30 } = req.query;

    const stats = await Product.getProductStats();

    // Get additional analytics
    const totalProducts = await Product.countDocuments({ isDeleted: false });
    const publishedProducts = await Product.countDocuments({ status: 'published', isDeleted: false });
    const draftProducts = await Product.countDocuments({ status: 'draft', isDeleted: false });
    const featuredProducts = await Product.countDocuments({ featured: true, isDeleted: false });

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalProducts,
          publishedProducts,
          draftProducts,
          featuredProducts
        },
        statusDistribution: stats,
        recentActivity: await this.getRecentProductActivity()
      }
    });
  });

  // Get recent product activity
  async getRecentProductActivity() {
    // Get recent product updates
    const recentProducts = await Product.find({ isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('vendor', 'firstName lastName')
      .populate('category', 'name');

    // Get recent price changes
    const recentPriceChanges = await Product.find({
      'versions.0': { $exists: true },
      isDeleted: false
    })
    .sort({ 'versions.0.createdAt': -1 })
    .limit(10)
    .populate('vendor', 'firstName lastName');

    return {
      recentProducts,
      recentPriceChanges
    };
  }

  // ===============================
  // UTILITY METHODS
  // ===============================

  // Get low stock products
  getLowStockProducts = catchAsync(async (req, res) => {
    const user = await User.findById(req.user.id);

    let query = {};
    if (user.role !== 'admin') {
      query.vendor = user._id;
    }

    const products = await Product.getLowStockProducts(user.role === 'admin' ? null : user._id);

    res.status(200).json({
      success: true,
      data: products
    });
  });

  // Get featured products
  getFeaturedProducts = catchAsync(async (req, res) => {
    const { limit = 20 } = req.query;

    const products = await Product.getFeaturedProducts(parseInt(limit));

    res.status(200).json({
      success: true,
      data: products
    });
  });

  // Get products by category
  getProductsByCategory = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { sortBy = 'createdAt', page = 1, limit = 20 } = req.query;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    const products = await Product.getByCategory(categoryId, {
      limit: parseInt(limit),
      skip: (page - 1) * limit,
      sortBy
    });

    const total = await Product.countDocuments({
      category: categoryId,
      status: 'published',
      isDeleted: false
    });

    res.status(200).json({
      success: true,
      data: {
        category,
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

  // Get products by price range
  getProductsByPriceRange = catchAsync(async (req, res) => {
    const { minPrice, maxPrice } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const products = await Product.getByPriceRange(
      parseFloat(minPrice),
      parseFloat(maxPrice),
      {
        limit: parseInt(limit),
        skip: (page - 1) * limit
      }
    );

    const total = await Product.countDocuments({
      price: { $gte: parseFloat(minPrice), $lte: parseFloat(maxPrice) },
      status: 'published',
      isDeleted: false
    });

    res.status(200).json({
      success: true,
      data: {
        priceRange: { min: parseFloat(minPrice), max: parseFloat(maxPrice) },
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

  // Search products
  searchProducts = catchAsync(async (req, res) => {
    const { q: searchTerm } = req.query;
    const { limit = 20, page = 1 } = req.query;

    if (!searchTerm) {
      throw new AppError('Search term is required', 400, true, 'SEARCH_TERM_REQUIRED');
    }

    const products = await Product.search(searchTerm, {
      limit: parseInt(limit),
      skip: (page - 1) * limit
    });

    const total = await Product.countDocuments({
      $text: { $search: searchTerm },
      status: 'published',
      isDeleted: false
    });

    res.status(200).json({
      success: true,
      data: {
        searchTerm,
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

  // Track product view
  trackView = catchAsync(async (req, res) => {
    const { productId } = req.params;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    await product.addView();

    res.status(200).json({
      success: true,
      message: 'View tracked successfully'
    });
  });

  // Add to wishlist
  addToWishlist = catchAsync(async (req, res) => {
    const { productId } = req.params;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    // Add to user's wishlist (implementation depends on how you store wishlists)
    // This could be in user model or separate collection

    res.status(200).json({
      success: true,
      message: 'Product added to wishlist'
    });
  });

  // Remove from wishlist
  removeFromWishlist = catchAsync(async (req, res) => {
    const { productId } = req.params;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    // Remove from user's wishlist

    res.status(200).json({
      success: true,
      message: 'Product removed from wishlist'
    });
  });

  // Get product reviews
  getProductReviews = catchAsync(async (req, res) => {
    const { productId } = req.params;
    const { sortBy = 'createdAt', page = 1, limit = 20 } = req.query;

    const reviews = await Review.findByProduct(productId, {
      sortBy,
      limit: parseInt(limit),
      skip: (page - 1) * limit
    });

    const total = await Review.countDocuments({
      product: productId,
      status: 'approved'
    });

    res.status(200).json({
      success: true,
      data: {
        reviews,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalReviews: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Create product review
  createProductReview = catchAsync(async (req, res) => {
    const { productId } = req.params;
    const { title, content, rating, detailedRatings, images } = req.body;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    // Check if user already reviewed this product
    const existingReview = await Review.findOne({
      user: req.user.id,
      product: productId
    });

    if (existingReview) {
      throw new AppError('You have already reviewed this product', 400, true, 'ALREADY_REVIEWED');
    }

    // Create review
    const review = new Review({
      user: req.user.id,
      product: productId,
      vendor: product.vendor,
      store: product.store,
      title,
      content,
      rating,
      detailedRatings,
      isVerifiedPurchase: false, // Would be determined by checking order history
      status: 'pending' // Reviews need moderation
    });

    await review.save();

    // Update product rating
    await review.updateProductRating();

    logger.info('Product review created', {
      reviewId: review._id,
      productId,
      userId: req.user.id,
      rating
    });

    res.status(201).json({
      success: true,
      message: 'Review submitted successfully and is pending approval',
      data: review
    });
  });

  // Get product comparison
  compareProducts = catchAsync(async (req, res) => {
    const { productIds } = req.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length < 2) {
      throw new AppError('At least 2 product IDs are required for comparison', 400, true, 'INVALID_PRODUCT_IDS');
    }

    const products = await Product.find({
      _id: { $in: productIds },
      status: 'published',
      isDeleted: false
    })
    .populate('vendor', 'firstName lastName')
    .populate('store', 'name')
    .populate('category', 'name');

    if (products.length !== productIds.length) {
      throw new AppError('Some products not found or not available', 404, true, 'PRODUCTS_NOT_FOUND');
    }

    // Generate comparison data
    const comparison = this.generateProductComparison(products);

    res.status(200).json({
      success: true,
      data: {
        products,
        comparison
      }
    });
  });

  // Generate product comparison
  generateProductComparison(products) {
    const features = [
      'price', 'rating', 'brand', 'shipping', 'warranty',
      'dimensions', 'weight', 'material', 'color'
    ];

    return {
      features: features.map(feature => ({
        name: feature,
        values: products.map(product => product[feature] || 'N/A')
      })),
      summary: {
        lowestPrice: Math.min(...products.map(p => p.price)),
        highestRating: Math.max(...products.map(p => p.rating?.average || 0)),
        totalProducts: products.length
      }
    };
  }
}

module.exports = new ProductController();
