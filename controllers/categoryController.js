const Category = require('../models/Category');
const Product = require('../models/Product');
const User = require('../models/User');
const Store = require('../models/Store');
const { validationResult } = require('express-validator');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

class CategoryController {
  // ===============================
  // CATEGORY MANAGEMENT
  // ===============================

  // Create new category
  createCategory = catchAsync(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      name,
      description,
      shortDescription,
      parent,
      type = 'product',
      purpose = 'selling',
      icon,
      color = '#3498db',
      position = 0,
      displaySettings = {},
      seo = {},
      content = {},
      businessRules = {}
    } = req.body;

    // Check if parent category exists
    if (parent) {
      const parentCategory = await Category.findById(parent);
      if (!parentCategory) {
        throw new AppError('Parent category not found', 404, true, 'PARENT_CATEGORY_NOT_FOUND');
      }

      // Check level limit
      if (parentCategory.level >= 4) {
        throw new AppError('Maximum category depth exceeded', 400, true, 'MAX_DEPTH_EXCEEDED');
      }
    }

    // Check for duplicate name at same level
    const existingCategory = await Category.findOne({
      name: { $regex: `^${name}$`, $options: 'i' },
      parent,
      isDeleted: false
    });

    if (existingCategory) {
      throw new AppError('Category with this name already exists at this level', 400, true, 'CATEGORY_EXISTS');
    }

    const category = new Category({
      name,
      description,
      shortDescription,
      parent,
      type,
      purpose,
      icon,
      color,
      position,
      displaySettings: {
        showInMenu: true,
        showInSearch: true,
        showProductCount: true,
        showSubcategories: true,
        sortOrder: 'position',
        defaultView: 'grid',
        ...displaySettings
      },
      seo: {
        metaTitle: name,
        metaDescription: description?.substring(0, 160),
        ...seo
      },
      content: {
        overview: description,
        ...content
      },
      businessRules: {
        commissionRate: 10,
        ...businessRules
      },
      createdBy: req.user.id
    });

    await category.save();

    // Update parent children array
    if (parent) {
      await Category.findByIdAndUpdate(parent, {
        $push: { children: category._id }
      });
    }

    // Update category hierarchy
    await this.updateCategoryHierarchy(category);

    logger.info('Category created', {
      categoryId: category._id,
      name,
      parent,
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: category
    });
  });

  // Get all categories
  getCategories = catchAsync(async (req, res) => {
    const {
      status = 'active',
      type,
      parent,
      includeInactive = false,
      includeTree = false,
      search,
      sortBy = 'position',
      page = 1,
      limit = 20
    } = req.query;

    let query = { isDeleted: false };

    if (status) query.status = status;
    if (type) query.type = type;
    if (parent) query.parent = parent;
    if (!includeInactive && status === 'active') query.status = 'active';

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    let sort = {};
    sort[sortBy] = 1;

    const categories = await Category.find(query)
      .populate('parent', 'name slug')
      .populate('children', 'name slug')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Category.countDocuments(query);

    let categoryTree = null;
    if (includeTree === 'true') {
      categoryTree = await Category.getCategoryTree();
    }

    res.status(200).json({
      success: true,
      data: {
        categories,
        categoryTree,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalCategories: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Get category by ID or slug
  getCategory = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { includeProducts = false, includeSubcategories = false, includeAnalytics = false } = req.query;

    // Find category by ID or slug
    let category;
    if (mongoose.Types.ObjectId.isValid(id)) {
      category = await Category.findById(id);
    } else {
      category = await Category.findOne({ slug: id });
    }

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check if category is accessible
    if (category.status !== 'active' && req.user?.role !== 'admin') {
      throw new AppError('Category not available', 404, true, 'CATEGORY_NOT_AVAILABLE');
    }

    // Get subcategories if requested
    let subcategories = [];
    if (includeSubcategories === 'true') {
      subcategories = await Category.find({
        parent: category._id,
        status: 'active',
        isDeleted: false
      }).sort({ position: 1 });
    }

    // Get products if requested
    let products = [];
    if (includeProducts === 'true') {
      products = await category.getProducts({
        limit: 20,
        includeSubcategories: true
      });
    }

    // Get analytics if requested and user has permission
    let analytics = null;
    if (includeAnalytics === 'true' && req.user?.role === 'admin') {
      analytics = await this.getCategoryAnalytics(category._id);
    }

    res.status(200).json({
      success: true,
      data: {
        category,
        subcategories: subcategories || [],
        products: products || [],
        analytics,
        breadcrumbs: await this.getCategoryBreadcrumbs(category._id),
        relatedCategories: await this.getRelatedCategories(category._id)
      }
    });
  });

  // Update category
  updateCategory = catchAsync(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { id } = req.params;
    const updates = req.body;

    const category = await Category.findById(id);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to update categories', 403, true, 'NOT_AUTHORIZED');
    }

    // Track changes
    const oldCategory = category.toObject();
    const changes = [];

    // Update allowed fields
    const allowedFields = [
      'name', 'description', 'shortDescription', 'type', 'purpose',
      'icon', 'color', 'position', 'displaySettings', 'seo',
      'content', 'businessRules', 'status', 'featured'
    ];

    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        const oldValue = category[field];
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

        category[field] = newValue;
      }
    });

    // Add to history
    if (changes.length > 0) {
      await category.addHistoryEntry('updated', req.user.id, { changes });
    }

    await category.save();

    // Update hierarchy if parent changed
    if (updates.parent && updates.parent !== oldCategory.parent?.toString()) {
      await this.handleParentChange(category, oldCategory.parent);
    }

    // Update statistics
    await category.updateStats();

    logger.info('Category updated', {
      categoryId: id,
      updatedBy: req.user.id,
      changes: changes.length
    });

    res.status(200).json({
      success: true,
      message: 'Category updated successfully',
      data: {
        category,
        changes: changes.length
      }
    });
  });

  // Delete category
  deleteCategory = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { moveProductsTo } = req.body;

    const category = await Category.findById(id);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to delete categories', 403, true, 'NOT_AUTHORIZED');
    }

    // Check if category has products
    const productCount = await Product.countDocuments({ category: id });

    if (productCount > 0) {
      if (!moveProductsTo) {
        throw new AppError('Category has products. Please specify a category to move products to.', 400, true, 'CATEGORY_HAS_PRODUCTS');
      }

      // Move products to new category
      await Product.updateMany(
        { category: id },
        { category: moveProductsTo }
      );

      // Update new category stats
      const newCategory = await Category.findById(moveProductsTo);
      if (newCategory) await newCategory.updateStats();
    }

    // Archive category
    await category.archive();

    logger.info('Category deleted', {
      categoryId: id,
      deletedBy: req.user.id,
      movedProductsTo: moveProductsTo
    });

    res.status(200).json({
      success: true,
      message: 'Category deleted successfully',
      data: {
        categoryId: id,
        productsMoved: productCount,
        movedTo: moveProductsTo
      }
    });
  });

  // ===============================
  // CATEGORY HIERARCHY MANAGEMENT
  // ===============================

  // Move category
  moveCategory = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { newParentId, position } = req.body;

    const category = await Category.findById(categoryId);
    const newParent = newParentId ? await Category.findById(newParentId) : null;

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    if (newParentId && !newParent) {
      throw new AppError('New parent category not found', 404, true, 'NEW_PARENT_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to move categories', 403, true, 'NOT_AUTHORIZED');
    }

    const oldParentId = category.parent;

    // Move category
    await category.moveToParent(newParentId);

    // Update position if specified
    if (position !== undefined) {
      category.position = position;
      await category.save();
    }

    // Update old parent
    if (oldParentId) {
      await Category.findByIdAndUpdate(oldParentId, {
        $pull: { children: category._id }
      });
    }

    // Update new parent
    if (newParentId) {
      await Category.findByIdAndUpdate(newParentId, {
        $push: { children: category._id }
      });
    }

    logger.info('Category moved', {
      categoryId,
      oldParent: oldParentId,
      newParent: newParentId,
      movedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Category moved successfully',
      data: {
        category: category.name,
        newParent: newParent?.name || 'Root',
        position: category.position
      }
    });
  });

  // Rebuild category hierarchy
  rebuildHierarchy = catchAsync(async (req, res) => {
    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to rebuild hierarchy', 403, true, 'NOT_AUTHORIZED');
    }

    await Category.rebuildHierarchy();

    logger.info('Category hierarchy rebuilt', {
      rebuiltBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Category hierarchy rebuilt successfully'
    });
  });

  // Get category tree
  getCategoryTree = catchAsync(async (req, res) => {
    const { includeInactive = false, maxDepth = 5 } = req.query;

    const tree = await Category.getCategoryTree();

    // Filter tree based on options
    let filteredTree = tree;

    if (!includeInactive) {
      filteredTree = this.filterActiveCategories(tree);
    }

    if (maxDepth) {
      filteredTree = this.limitTreeDepth(filteredTree, parseInt(maxDepth));
    }

    res.status(200).json({
      success: true,
      data: {
        tree: filteredTree,
        totalCategories: await this.countTreeCategories(filteredTree),
        maxDepth: this.getTreeDepth(filteredTree)
      }
    });
  });

  // Filter active categories
  filterActiveCategories(tree) {
    return tree.filter(category => category.status === 'active')
      .map(category => ({
        ...category,
        children: this.filterActiveCategories(category.children || [])
      }));
  }

  // Limit tree depth
  limitTreeDepth(tree, maxDepth) {
    if (maxDepth <= 0) return [];

    return tree.map(category => ({
      ...category,
      children: this.limitTreeDepth(category.children || [], maxDepth - 1)
    }));
  }

  // Count tree categories
  countTreeCategories(tree) {
    return tree.reduce((count, category) => {
      return count + 1 + this.countTreeCategories(category.children || []);
    }, 0);
  }

  // Get tree depth
  getTreeDepth(tree) {
    if (tree.length === 0) return 0;

    return 1 + Math.max(...tree.map(category =>
      this.getTreeDepth(category.children || [])
    ));
  }

  // ===============================
  // CATEGORY ANALYTICS
  // ===============================

  // Get category analytics
  getCategoryAnalytics = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { dateRange = 30 } = req.query;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to view analytics', 403, true, 'NOT_AUTHORIZED');
    }

    const analytics = await this.generateCategoryAnalytics(categoryId, parseInt(dateRange));

    res.status(200).json({
      success: true,
      data: analytics
    });
  });

  // Generate comprehensive category analytics
  async generateCategoryAnalytics(categoryId, dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    // Get performance metrics
    const performance = await category.getPerformanceMetrics(dateRange);

    // Get subcategory performance
    const subcategories = await Category.find({
      parent: categoryId,
      status: 'active',
      isDeleted: false
    });

    const subcategoryAnalytics = await Promise.all(
      subcategories.map(async (subcategory) => {
        const metrics = await subcategory.getPerformanceMetrics(dateRange);
        return {
          category: subcategory.name,
          metrics
        };
      })
    );

    // Get product analytics
    const productAnalytics = await this.getCategoryProductAnalytics(categoryId, startDate);

    // Get traffic analytics
    const trafficAnalytics = await this.getCategoryTrafficAnalytics(categoryId, startDate);

    return {
      category: await Category.findById(categoryId).select('name slug'),
      period: `${dateRange} days`,
      performance,
      subcategories: subcategoryAnalytics,
      products: productAnalytics,
      traffic: trafficAnalytics,
      insights: await this.getCategoryInsights(categoryId)
    };
  }

  // Get category product analytics
  async getCategoryProductAnalytics(categoryId, startDate) {
    const analytics = await Product.aggregate([
      {
        $match: {
          category: mongoose.Types.ObjectId(categoryId),
          status: 'published',
          isDeleted: false,
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          averagePrice: { $avg: '$price' },
          totalViews: { $sum: '$stats.views' },
          totalSales: { $sum: '$stats.salesCount' },
          totalRevenue: { $sum: '$stats.revenue' }
        }
      }
    ]);

    return analytics[0] || {};
  }

  // Get category traffic analytics
  async getCategoryTrafficAnalytics(categoryId, startDate) {
    // Mock implementation for traffic analytics
    return {
      pageViews: 2500,
      uniqueVisitors: 1800,
      bounceRate: 0.25,
      avgTimeOnPage: 145,
      topReferrers: [
        { source: 'Google', visits: 1200 },
        { source: 'Direct', visits: 800 },
        { source: 'Facebook', visits: 300 }
      ]
    };
  }

  // Get category insights
  async getCategoryInsights(categoryId) {
    const insights = {
      opportunities: [],
      recommendations: [],
      competitors: []
    };

    // Get trending products in category
    const trendingProducts = await Product.find({
      category: categoryId,
      status: 'published',
      isDeleted: false
    })
    .sort({ 'stats.views': -1 })
    .limit(5)
    .select('name stats.views stats.salesCount');

    insights.opportunities = trendingProducts.map(product => ({
      type: 'trending_product',
      product: product.name,
      views: product.stats.views,
      sales: product.stats.salesCount,
      opportunity: 'High engagement product'
    }));

    return insights;
  }

  // ===============================
  // CATEGORY CONTENT MANAGEMENT
  // ===============================

  // Update category content
  updateCategoryContent = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { overview, features, benefits, specifications, faqs, guides } = req.body;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to update category content', 403, true, 'NOT_AUTHORIZED');
    }

    category.content = {
      overview,
      features: features || category.content.features,
      benefits: benefits || category.content.benefits,
      specifications: specifications || category.content.specifications,
      faqs: faqs || category.content.faqs,
      guides: guides || category.content.guides
    };

    await category.save();

    logger.info('Category content updated', {
      categoryId,
      updatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Category content updated successfully',
      data: category.content
    });
  });

  // Add FAQ to category
  addCategoryFAQ = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { question, answer } = req.body;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to add FAQs', 403, true, 'NOT_AUTHORIZED');
    }

    if (!category.content.faqs) {
      category.content.faqs = [];
    }

    category.content.faqs.push({
      question,
      answer
    });

    await category.save();

    logger.info('Category FAQ added', {
      categoryId,
      question,
      addedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'FAQ added successfully',
      data: category.content.faqs[category.content.faqs.length - 1]
    });
  });

  // Add guide to category
  addCategoryGuide = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { title, content, type = 'text', media } = req.body;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to add guides', 403, true, 'NOT_AUTHORIZED');
    }

    if (!category.content.guides) {
      category.content.guides = [];
    }

    category.content.guides.push({
      title,
      content,
      type,
      media
    });

    await category.save();

    logger.info('Category guide added', {
      categoryId,
      title,
      addedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Guide added successfully',
      data: category.content.guides[category.content.guides.length - 1]
    });
  });

  // ===============================
  // CATEGORY SEO MANAGEMENT
  // ===============================

  // Update category SEO
  updateCategorySEO = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { metaTitle, metaDescription, keywords, canonicalUrl, ogImage, ogTitle, ogDescription } = req.body;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to update SEO', 403, true, 'NOT_AUTHORIZED');
    }

    category.seo = {
      metaTitle,
      metaDescription,
      keywords,
      canonicalUrl,
      ogImage,
      ogTitle,
      ogDescription
    };

    await category.save();

    logger.info('Category SEO updated', {
      categoryId,
      updatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Category SEO updated successfully',
      data: category.seo
    });
  });

  // Get category search keywords
  getCategorySearchKeywords = catchAsync(async (req, res) => {
    const { categoryId } = req.params;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Get popular search terms for this category
    const searchKeywords = await this.getPopularSearchTerms(categoryId);

    res.status(200).json({
      success: true,
      data: {
        category: category.name,
        searchKeywords,
        relatedTerms: await this.getRelatedSearchTerms(categoryId)
      }
    });
  });

  // Get popular search terms
  async getPopularSearchTerms(categoryId) {
    // Mock implementation
    return [
      { term: 'electronics', count: 1250 },
      { term: 'smartphones', count: 890 },
      { term: 'laptops', count: 650 },
      { term: 'accessories', count: 430 }
    ];
  }

  // Get related search terms
  async getRelatedSearchTerms(categoryId) {
    // Mock implementation
    return [
      'mobile phones',
      'computers',
      'gadgets',
      'tech accessories'
    ];
  }

  // ===============================
  // CATEGORY RELATIONSHIPS
  // ===============================

  // Add related category
  addRelatedCategory = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { relatedCategoryId, type = 'related', strength = 0.5 } = req.body;

    const category = await Category.findById(categoryId);
    const relatedCategory = await Category.findById(relatedCategoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    if (!relatedCategory) {
      throw new AppError('Related category not found', 404, true, 'RELATED_CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to add related categories', 403, true, 'NOT_AUTHORIZED');
    }

    // Check if relationship already exists
    const existingRelationship = category.relatedCategories.find(
      rc => rc.category.toString() === relatedCategoryId
    );

    if (existingRelationship) {
      throw new AppError('Relationship already exists', 400, true, 'RELATIONSHIP_EXISTS');
    }

    category.relatedCategories.push({
      category: relatedCategoryId,
      type,
      strength
    });

    await category.save();

    logger.info('Related category added', {
      categoryId,
      relatedCategoryId,
      type,
      addedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Related category added successfully',
      data: {
        category: category.name,
        relatedCategory: relatedCategory.name,
        type,
        strength
      }
    });
  });

  // Remove related category
  removeRelatedCategory = catchAsync(async (req, res) => {
    const { categoryId, relatedCategoryId } = req.params;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to remove related categories', 403, true, 'NOT_AUTHORIZED');
    }

    category.relatedCategories = category.relatedCategories.filter(
      rc => rc.category.toString() !== relatedCategoryId
    );

    await category.save();

    logger.info('Related category removed', {
      categoryId,
      relatedCategoryId,
      removedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Related category removed successfully'
    });
  });

  // Get related categories
  getRelatedCategories = catchAsync(async (req, res) => {
    const { categoryId } = req.params;

    const category = await Category.findById(categoryId).populate('relatedCategories.category', 'name slug icon');

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    const relatedCategories = category.relatedCategories.map(rc => ({
      category: rc.category,
      type: rc.type,
      strength: rc.strength
    }));

    res.status(200).json({
      success: true,
      data: {
        category: category.name,
        relatedCategories
      }
    });
  });

  // ===============================
  // CATEGORY SEARCH & DISCOVERY
  // ===============================

  // Search categories
  searchCategories = catchAsync(async (req, res) => {
    const {
      q: searchTerm,
      type,
      status = 'active',
      includeInactive = false,
      sortBy = 'name',
      page = 1,
      limit = 20
    } = req.query;

    if (!searchTerm) {
      throw new AppError('Search term is required', 400, true, 'SEARCH_TERM_REQUIRED');
    }

    const categories = await Category.search(searchTerm, {
      includeInactive
    });

    // Apply additional filters
    let filteredCategories = categories;

    if (type) {
      filteredCategories = filteredCategories.filter(cat => cat.type === type);
    }

    if (status && !includeInactive) {
      filteredCategories = filteredCategories.filter(cat => cat.status === status);
    }

    // Sorting
    filteredCategories.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'products':
          return b.stats.productCount - a.stats.productCount;
        case 'created':
          return new Date(b.createdAt) - new Date(a.createdAt);
        default:
          return 0;
      }
    });

    // Pagination
    const total = filteredCategories.length;
    const paginatedCategories = filteredCategories.slice((page - 1) * limit, page * limit);

    res.status(200).json({
      success: true,
      data: {
        searchTerm,
        categories: paginatedCategories,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalCategories: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Get featured categories
  getFeaturedCategories = catchAsync(async (req, res) => {
    const { limit = 10 } = req.query;

    const categories = await Category.getFeaturedCategories(parseInt(limit));

    res.status(200).json({
      success: true,
      data: categories
    });
  });

  // Get popular categories
  getPopularCategories = catchAsync(async (req, res) => {
    const { limit = 10 } = req.query;

    const categories = await Category.getPopularCategories(parseInt(limit));

    res.status(200).json({
      success: true,
      data: categories
    });
  });

  // Get category recommendations
  getCategoryRecommendations = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { limit = 5 } = req.query;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Get recommendations based on user behavior and category relationships
    const recommendations = await this.generateCategoryRecommendations(category, parseInt(limit));

    res.status(200).json({
      success: true,
      data: {
        category: category.name,
        recommendations
      }
    });
  });

  // Generate category recommendations
  async generateCategoryRecommendations(category, limit) {
    const recommendations = [];

    // Get related categories
    for (const related of category.relatedCategories) {
      const relatedCategory = await Category.findById(related.category);
      if (relatedCategory) {
        recommendations.push({
          category: relatedCategory,
          reason: `Related: ${related.type}`,
          confidence: related.strength
        });
      }
    }

    // Get trending categories in same parent
    if (category.parent) {
      const siblingCategories = await Category.find({
        parent: category.parent,
        _id: { $ne: category._id },
        status: 'active',
        isDeleted: false
      })
      .sort({ 'stats.productCount': -1 })
      .limit(limit);

      recommendations.push(...siblingCategories.map(cat => ({
        category: cat,
        reason: 'Popular in same category group',
        confidence: 0.7
      })));
    }

    return recommendations.slice(0, limit);
  });

  // ===============================
  // CATEGORY BULK OPERATIONS
  // ===============================

  // Bulk update categories
  bulkUpdateCategories = catchAsync(async (req, res) => {
    const { categoryIds, updates } = req.body;

    if (!categoryIds || !Array.isArray(categoryIds) || categoryIds.length === 0) {
      throw new AppError('Category IDs array is required', 400, true, 'INVALID_CATEGORY_IDS');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to perform bulk operations', 403, true, 'NOT_AUTHORIZED');
    }

    const result = await Category.bulkUpdate(categoryIds, updates);

    logger.info('Categories bulk updated', {
      adminId: req.user.id,
      categoryCount: categoryIds.length,
      updates: Object.keys(updates)
    });

    res.status(200).json({
      success: true,
      message: 'Categories updated successfully',
      data: {
        updatedCount: result.modifiedCount,
        categoryIds
      }
    });
  });

  // Bulk delete categories
  bulkDeleteCategories = catchAsync(async (req, res) => {
    const { categoryIds, moveProductsTo } = req.body;

    if (!categoryIds || !Array.isArray(categoryIds) || categoryIds.length === 0) {
      throw new AppError('Category IDs array is required', 400, true, 'INVALID_CATEGORY_IDS');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to perform bulk operations', 403, true, 'NOT_AUTHORIZED');
    }

    let deletedCount = 0;
    let totalProductsMoved = 0;

    for (const categoryId of categoryIds) {
      const category = await Category.findById(categoryId);

      if (category) {
        // Check products in category
        const productCount = await Product.countDocuments({ category: categoryId });

        if (productCount > 0) {
          if (moveProductsTo) {
            // Move products to new category
            await Product.updateMany(
              { category: categoryId },
              { category: moveProductsTo }
            );
            totalProductsMoved += productCount;

            // Update new category stats
            const newCategory = await Category.findById(moveProductsTo);
            if (newCategory) await newCategory.updateStats();
          } else {
            throw new AppError(`Category ${category.name} has products. Please specify a category to move products to.`, 400, true, 'CATEGORY_HAS_PRODUCTS');
          }
        }

        await category.archive();
        deletedCount++;
      }
    }

    logger.info('Categories bulk deleted', {
      adminId: req.user.id,
      deletedCount,
      productsMoved: totalProductsMoved
    });

    res.status(200).json({
      success: true,
      message: 'Categories deleted successfully',
      data: {
        deletedCount,
        productsMoved: totalProductsMoved,
        categoryIds
      }
    });
  });

  // ===============================
  // CATEGORY IMPORT/EXPORT
  // ===============================

  // Export categories
  exportCategories = catchAsync(async (req, res) => {
    const { format = 'json', includeProducts = false, includeSubcategories = true } = req.query;

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to export categories', 403, true, 'NOT_AUTHORIZED');
    }

    let query = { isDeleted: false };

    const categories = await Category.find(query)
      .populate('parent', 'name slug')
      .populate('children', 'name slug');

    let exportData = {
      categories,
      exportedAt: new Date(),
      exportedBy: req.user.id
    };

    if (includeProducts === 'true') {
      exportData.products = await Promise.all(
        categories.map(async (category) => {
          const products = await category.getProducts({ limit: 1000 });
          return {
            category: category.name,
            products: products.map(p => p.name)
          };
        })
      );
    }

    if (format === 'csv') {
      const csvData = this.generateCategoryCSV(categories);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="categories.${format}"`);
      res.status(200).send(csvData);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="categories.json"`);
      res.status(200).json(exportData);
    }
  });

  // Generate category CSV
  generateCategoryCSV(categories) {
    const headers = ['Name', 'Description', 'Parent', 'Type', 'Status', 'Product Count'];
    const rows = categories.map(category => [
      category.name,
      category.description || '',
      category.parent?.name || 'Root',
      category.type,
      category.status,
      category.stats.productCount
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  // Import categories
  importCategories = catchAsync(async (req, res) => {
    if (!req.file) {
      throw new AppError('No import file provided', 400, true, 'NO_IMPORT_FILE');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to import categories', 403, true, 'NOT_AUTHORIZED');
    }

    // Parse import file
    const importData = await this.parseCategoryImportFile(req.file.path);

    let imported = 0;
    let errors = [];

    for (const categoryData of importData.categories) {
      try {
        // Find parent if specified
        let parent = null;
        if (categoryData.parent) {
          parent = await Category.findOne({
            name: { $regex: `^${categoryData.parent}$`, $options: 'i' },
            isDeleted: false
          });
        }

        const category = new Category({
          ...categoryData,
          parent: parent?._id,
          createdBy: req.user.id
        });

        await category.save();

        // Update parent children
        if (parent) {
          await Category.findByIdAndUpdate(parent._id, {
            $push: { children: category._id }
          });
        }

        imported++;
      } catch (error) {
        errors.push({
          data: categoryData,
          error: error.message
        });
      }
    }

    // Rebuild hierarchy
    await Category.rebuildHierarchy();

    logger.info('Categories imported', {
      adminId: req.user.id,
      imported,
      errors: errors.length
    });

    res.status(200).json({
      success: true,
      message: 'Categories imported successfully',
      data: {
        imported,
        errors,
        total: importData.categories.length
      }
    });
  });

  // Parse category import file
  async parseCategoryImportFile(filePath) {
    // Implementation for parsing category import files
    return { categories: [] };
  }

  // ===============================
  // CATEGORY PRODUCTS MANAGEMENT
  // ===============================

  // Get category products
  getCategoryProducts = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const {
      sortBy = 'createdAt',
      includeSubcategories = true,
      filters = {},
      page = 1,
      limit = 20
    } = req.query;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    const products = await category.getProducts({
      limit: parseInt(limit),
      skip: (page - 1) * limit,
      sortBy,
      includeSubcategories: includeSubcategories === 'true'
    });

    const total = await Product.countDocuments({
      category: includeSubcategories === 'true' ? await category.getAllSubcategoryIds() : categoryId,
      status: 'published',
      isDeleted: false
    });

    res.status(200).json({
      success: true,
      data: {
        category: category.name,
        products,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalProducts: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        },
        filters: {
          available: await this.getCategoryFilters(categoryId)
        }
      }
    });
  });

  // Get category filters
  async getCategoryFilters(categoryId) {
    const category = await Category.findById(categoryId);

    if (!category) return {};

    const subcategoryIds = await category.getAllSubcategoryIds();

    const filters = await Product.aggregate([
      {
        $match: {
          category: { $in: subcategoryIds },
          status: 'published',
          isDeleted: false
        }
      },
      {
        $group: {
          _id: null,
          brands: { $addToSet: '$brand' },
          priceRange: {
            $push: '$price'
          },
          tags: { $addToSet: '$tags' }
        }
      }
    ]);

    const filterData = filters[0] || {};

    return {
      brands: filterData.brands?.filter(Boolean) || [],
      priceRange: filterData.priceRange?.length > 0 ? {
        min: Math.min(...filterData.priceRange),
        max: Math.max(...filterData.priceRange)
      } : null,
      tags: filterData.tags?.flat().filter(Boolean) || []
    };
  }

  // ===============================
  // CATEGORY STATISTICS
  // ===============================

  // Get category statistics
  getCategoryStatistics = catchAsync(async (req, res) => {
    const { dateRange = 30 } = req.query;

    const stats = await Category.getCategoryStats();

    const totalCategories = await Category.countDocuments({ isDeleted: false });
    const activeCategories = await Category.countDocuments({ status: 'active', isDeleted: false });

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalCategories,
          activeCategories,
          inactiveCategories: totalCategories - activeCategories,
          averageProductsPerCategory: await this.getAverageProductsPerCategory()
        },
        statusDistribution: stats,
        popularCategories: await this.getPopularCategories(),
        topPerformingCategories: await this.getTopPerformingCategories(parseInt(dateRange))
      }
    });
  });

  // Get average products per category
  async getAverageProductsPerCategory() {
    const result = await Category.aggregate([
      {
        $match: { isDeleted: false }
      },
      {
        $group: {
          _id: null,
          averageProducts: { $avg: '$stats.productCount' }
        }
      }
    ]);

    return Math.round((result[0]?.averageProducts || 0) * 100) / 100;
  }

  // Get top performing categories
  async getTopPerformingCategories(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const topCategories = await Category.find({
      status: 'active',
      isDeleted: false
    })
    .sort({ 'stats.productCount': -1 })
    .limit(10)
    .select('name stats.productCount stats.viewCount');

    return topCategories;
  }

  // ===============================
  // CATEGORY MODERATION
  // ===============================

  // Approve category
  approveCategory = catchAsync(async (req, res) => {
    const { categoryId } = req.params;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to approve categories', 403, true, 'NOT_AUTHORIZED');
    }

    category.status = 'active';
    await category.addHistoryEntry('approved', req.user.id);

    await category.save();

    logger.info('Category approved', {
      categoryId,
      approvedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Category approved successfully',
      data: category
    });
  });

  // Reject category
  rejectCategory = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { reason } = req.body;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to reject categories', 403, true, 'NOT_AUTHORIZED');
    }

    category.status = 'inactive';
    await category.addHistoryEntry('rejected', req.user.id, { reason });

    await category.save();

    logger.info('Category rejected', {
      categoryId,
      rejectedBy: req.user.id,
      reason
    });

    res.status(200).json({
      success: true,
      message: 'Category rejected successfully'
    });
  });

  // ===============================
  // CATEGORY UTILITIES
  // ===============================

  // Get category breadcrumbs
  async getCategoryBreadcrumbs(categoryId) {
    const category = await Category.findById(categoryId);

    if (!category) return [];

    const breadcrumbs = [];

    let currentCategory = category;
    while (currentCategory) {
      breadcrumbs.unshift({
        _id: currentCategory._id,
        name: currentCategory.name,
        slug: currentCategory.slug
      });

      if (currentCategory.parent) {
        currentCategory = await Category.findById(currentCategory.parent);
      } else {
        break;
      }
    }

    return breadcrumbs;
  }

  // Update category hierarchy
  async updateCategoryHierarchy(category) {
    const hierarchy = await category.getHierarchy();

    category.ancestors = hierarchy.slice(0, -1);
    category.level = hierarchy.length - 1;

    await category.save();
  }

  // Handle parent change
  async handleParentChange(category, oldParentId) {
    // Remove from old parent
    if (oldParentId) {
      await Category.findByIdAndUpdate(oldParentId, {
        $pull: { children: category._id }
      });
    }

    // Add to new parent
    if (category.parent) {
      await Category.findByIdAndUpdate(category.parent, {
        $push: { children: category._id }
      });
    }

    // Update hierarchy
    await this.updateCategoryHierarchy(category);

    // Update all descendants
    await category.updateDescendantsHierarchy();
  }

  // Get category by slug
  getCategoryBySlug = catchAsync(async (req, res) => {
    const { slug } = req.params;

    const category = await Category.findOne({ slug })
      .populate('parent', 'name slug')
      .populate('children', 'name slug');

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: category
    });
  });

  // Get category children
  getCategoryChildren = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { recursive = false, page = 1, limit = 20 } = req.query;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    let children = [];

    if (recursive === 'true') {
      // Get all descendants
      const allDescendantIds = await category.getAllSubcategoryIds();
      children = await Category.find({
        _id: { $in: allDescendantIds },
        status: 'active',
        isDeleted: false
      })
      .populate('parent', 'name slug')
      .sort({ level: 1, position: 1 });
    } else {
      // Get direct children only
      children = await Category.find({
        parent: categoryId,
        status: 'active',
        isDeleted: false
      })
      .populate('parent', 'name slug')
      .sort({ position: 1 });
    }

    const total = children.length;
    const paginatedChildren = children.slice((page - 1) * limit, page * limit);

    res.status(200).json({
      success: true,
      data: {
        parentCategory: category.name,
        children: paginatedChildren,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalChildren: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        },
        recursive: recursive === 'true'
      }
    });
  });

  // Get category path
  getCategoryPath = catchAsync(async (req, res) => {
    const { categoryId } = req.params;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    const path = await category.getHierarchy();

    res.status(200).json({
      success: true,
      data: {
        category: category.name,
        path: path.map(cat => ({
          id: cat._id,
          name: cat.name,
          slug: cat.slug,
          level: cat.level
        }))
      }
    });
  });

  // ===============================
  // CATEGORY API INTEGRATIONS
  // ===============================

  // Get category feed
  getCategoryFeed = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { format = 'json', limit = 50 } = req.query;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    const products = await category.getProducts({
      limit: parseInt(limit),
      includeSubcategories: true
    });

    const feedData = {
      category: {
        id: category._id,
        name: category.name,
        slug: category.slug,
        description: category.description
      },
      products: products.map(product => ({
        id: product._id,
        name: product.name,
        slug: product.slug,
        price: product.price,
        images: product.images,
        rating: product.rating,
        vendor: product.vendor,
        store: product.store
      })),
      generatedAt: new Date(),
      format
    };

    if (format === 'xml') {
      const xmlData = this.generateCategoryXML(feedData);
      res.setHeader('Content-Type', 'application/xml');
      res.status(200).send(xmlData);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.status(200).json(feedData);
    }
  });

  // Generate category XML feed
  generateCategoryXML(feedData) {
    // Implementation for XML feed generation
    return `<?xml version="1.0" encoding="UTF-8"?>
<category>
  <name>${feedData.category.name}</name>
  <products>
    ${feedData.products.map(product => `
    <product>
      <name>${product.name}</name>
      <price>${product.price}</price>
    </product>`).join('')}
  </products>
</category>`;
  }

  // ===============================
  // CATEGORY PERFORMANCE
  // ===============================

  // Get category performance report
  getCategoryPerformanceReport = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { dateRange = 30, format = 'json' } = req.query;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to view performance reports', 403, true, 'NOT_AUTHORIZED');
    }

    const report = await this.generateCategoryPerformanceReport(categoryId, parseInt(dateRange));

    if (format === 'csv') {
      const csvData = this.generateCategoryReportCSV(report);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="category-report.csv"`);
      res.status(200).send(csvData);
    } else {
      res.status(200).json({
        success: true,
        data: report
      });
    }
  });

  // Generate category performance report
  async generateCategoryPerformanceReport(categoryId, dateRange) {
    const category = await Category.findById(categoryId);
    const performance = await category.getPerformanceMetrics(dateRange);

    return {
      category: category.name,
      period: `${dateRange} days`,
      performance,
      insights: await this.getCategoryInsights(categoryId),
      recommendations: await this.getCategoryRecommendations(categoryId),
      generatedAt: new Date()
    };
  }

  // Generate category report CSV
  generateCategoryReportCSV(report) {
    // Implementation for CSV generation
    return 'category report data...';
  }

  // ===============================
  // CATEGORY CLEANUP
  // ===============================

  // Clean up orphaned categories
  cleanupOrphanedCategories = catchAsync(async (req, res) => {
    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to cleanup categories', 403, true, 'NOT_AUTHORIZED');
    }

    const cleanedCount = await Category.cleanupOrphaned();

    logger.info('Orphaned categories cleaned up', {
      adminId: req.user.id,
      cleanedCount
    });

    res.status(200).json({
      success: true,
      message: 'Orphaned categories cleaned up successfully',
      data: {
        cleanedCount
      }
    });
  });

  // Archive old categories
  archiveOldCategories = catchAsync(async (req, res) => {
    const { daysOld = 365 } = req.query;

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to archive categories', 403, true, 'NOT_AUTHORIZED');
    }

    const cutoffDate = new Date(Date.now() - parseInt(daysOld) * 24 * 60 * 60 * 1000);

    const result = await Category.updateMany(
      {
        status: { $ne: 'active' },
        updatedAt: { $lt: cutoffDate },
        isDeleted: false
      },
      {
        status: 'archived'
      }
    );

    logger.info('Old categories archived', {
      adminId: req.user.id,
      archivedCount: result.modifiedCount,
      daysOld
    });

    res.status(200).json({
      success: true,
      message: 'Old categories archived successfully',
      data: {
        archivedCount: result.modifiedCount
      }
    });
  });

  // ===============================
  // CATEGORY TAGS & LABELS
  // ===============================

  // Add tags to category
  addCategoryTags = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { tags } = req.body;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to add tags', 403, true, 'NOT_AUTHORIZED');
    }

    // Add new tags
    const newTags = tags.filter(tag => !category.tags.includes(tag.toLowerCase()));
    category.tags.push(...newTags.map(tag => tag.toLowerCase()));

    await category.save();

    logger.info('Category tags added', {
      categoryId,
      tags: newTags,
      addedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Tags added successfully',
      data: {
        category: category.name,
        tags: category.tags
      }
    });
  });

  // Remove tags from category
  removeCategoryTags = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { tags } = req.body;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to remove tags', 403, true, 'NOT_AUTHORIZED');
    }

    category.tags = category.tags.filter(tag => !tags.includes(tag));
    await category.save();

    logger.info('Category tags removed', {
      categoryId,
      tags,
      removedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Tags removed successfully',
      data: {
        category: category.name,
        remainingTags: category.tags
      }
    });
  });

  // ===============================
  // CATEGORY LOCALIZATION
  // ===============================

  // Add category localization
  addCategoryLocalization = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { language, name, description } = req.body;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to add localizations', 403, true, 'NOT_AUTHORIZED');
    }

    // Remove existing localization for this language
    category.localizedNames = category.localizedNames.filter(loc => loc.language !== language);

    // Add new localization
    category.localizedNames.push({
      language,
      name,
      description
    });

    await category.save();

    logger.info('Category localization added', {
      categoryId,
      language,
      addedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Localization added successfully',
      data: category.localizedNames[category.localizedNames.length - 1]
    });
  });

  // Get category localizations
  getCategoryLocalizations = catchAsync(async (req, res) => {
    const { categoryId } = req.params;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: {
        category: category.name,
        localizations: category.localizedNames
      }
    });
  });

  // ===============================
  // CATEGORY BUSINESS RULES
  // ===============================

  // Update category business rules
  updateCategoryBusinessRules = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { commissionRate, shippingRules, returnPolicy } = req.body;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to update business rules', 403, true, 'NOT_AUTHORIZED');
    }

    category.businessRules = {
      commissionRate,
      shippingRules,
      returnPolicy
    };

    await category.save();

    logger.info('Category business rules updated', {
      categoryId,
      updatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Business rules updated successfully',
      data: category.businessRules
    });
  });

  // Get category business rules
  getCategoryBusinessRules = catchAsync(async (req, res) => {
    const { categoryId } = req.params;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: {
        category: category.name,
        businessRules: category.businessRules
      }
    });
  });

  // ===============================
  // CATEGORY PROMOTIONS
  // ===============================

  // Add category promotion
  addCategoryPromotion = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { title, description, type, discount, startDate, endDate, banner } = req.body;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to add promotions', 403, true, 'NOT_AUTHORIZED');
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

    category.promotions.push(promotion);
    await category.save();

    logger.info('Category promotion added', {
      categoryId,
      promotionTitle: title,
      addedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Promotion added successfully',
      data: promotion
    });
  });

  // Get category promotions
  getCategoryPromotions = catchAsync(async (req, res) => {
    const { categoryId } = req.params;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    const activePromotions = category.promotions.filter(promo => promo.isActive);

    res.status(200).json({
      success: true,
      data: {
        category: category.name,
        promotions: activePromotions
      }
    });
  });

  // ===============================
  // CATEGORY HISTORY
  // ===============================

  // Get category history
  getCategoryHistory = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    const history = category.history.slice((page - 1) * limit, page * limit);

    res.status(200).json({
      success: true,
      data: {
        category: category.name,
        history,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(category.history.length / limit),
          totalItems: category.history.length,
          hasNext: page * limit < category.history.length,
          hasPrev: page > 1
        }
      }
    });
  });

  // ===============================
  // CATEGORY UTILITIES
  // ===============================

  // Get category by name
  getCategoryByName = catchAsync(async (req, res) => {
    const { name } = req.params;

    const category = await Category.findOne({
      name: { $regex: `^${name}$`, $options: 'i' },
      status: 'active',
      isDeleted: false
    });

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: category
    });
  });

  // Get categories by type
  getCategoriesByType = catchAsync(async (req, res) => {
    const { type } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const categories = await Category.getByType(type);

    const total = categories.length;
    const paginatedCategories = categories.slice((page - 1) * limit, page * limit);

    res.status(200).json({
      success: true,
      data: {
        type,
        categories: paginatedCategories,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalCategories: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Get category autocomplete
  getCategoryAutocomplete = catchAsync(async (req, res) => {
    const { q: searchTerm } = req.query;
    const { limit = 10 } = req.query;

    if (!searchTerm || searchTerm.length < 2) {
      return res.status(200).json({
        success: true,
        data: { suggestions: [] }
      });
    }

    const categories = await Category.find({
      name: { $regex: searchTerm, $options: 'i' },
      status: 'active',
      isDeleted: false
    })
    .limit(parseInt(limit))
    .select('name slug icon');

    const suggestions = categories.map(category => ({
      id: category._id,
      name: category.name,
      slug: category.slug,
      icon: category.icon
    }));

    res.status(200).json({
      success: true,
      data: { suggestions }
    });
  });

  // Get category navigation
  getCategoryNavigation = catchAsync(async (req, res) => {
    const { categoryId } = req.params;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Get navigation structure
    const navigation = {
      current: category,
      breadcrumbs: await this.getCategoryBreadcrumbs(categoryId),
      siblings: [],
      children: [],
      parent: null
    };

    // Get siblings
    if (category.parent) {
      navigation.siblings = await Category.find({
        parent: category.parent,
        _id: { $ne: category._id },
        status: 'active',
        isDeleted: false
      }).select('name slug icon');
    }

    // Get parent
    if (category.parent) {
      navigation.parent = await Category.findById(category.parent).select('name slug');
    }

    // Get children
    navigation.children = await Category.find({
      parent: categoryId,
      status: 'active',
      isDeleted: false
    }).select('name slug icon');

    res.status(200).json({
      success: true,
      data: navigation
    });
  });

  // ===============================
  // CATEGORY MAINTENANCE
  // ===============================

  // Update category statistics
  updateCategoryStatistics = catchAsync(async (req, res) => {
    const { categoryId } = req.params;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to update statistics', 403, true, 'NOT_AUTHORIZED');
    }

    await category.updateStats();

    logger.info('Category statistics updated', {
      categoryId,
      updatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Category statistics updated successfully',
      data: category.stats
    });
  });

  // Optimize category performance
  optimizeCategoryPerformance = catchAsync(async (req, res) => {
    const { categoryId } = req.params;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to optimize categories', 403, true, 'NOT_AUTHORIZED');
    }

    // Perform optimization tasks
    const optimizations = {
      statsUpdated: await category.updateStats(),
      hierarchyValidated: await this.validateCategoryHierarchy(categoryId),
      relationshipsOptimized: await this.optimizeCategoryRelationships(categoryId)
    };

    logger.info('Category performance optimized', {
      categoryId,
      optimizedBy: req.user.id,
      optimizations: Object.keys(optimizations)
    });

    res.status(200).json({
      success: true,
      message: 'Category performance optimized successfully',
      data: optimizations
    });
  });

  // Validate category hierarchy
  async validateCategoryHierarchy(categoryId) {
    // Implementation for hierarchy validation
    return true;
  }

  // Optimize category relationships
  async optimizeCategoryRelationships(categoryId) {
    // Implementation for relationship optimization
    return true;
  }

  // ===============================
  // CATEGORY REPORTING
  // ===============================

  // Generate category report
  generateCategoryReport = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { dateRange = 30, format = 'json' } = req.query;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to generate reports', 403, true, 'NOT_AUTHORIZED');
    }

    const report = {
      category: category.name,
      period: `${dateRange} days`,
      generatedAt: new Date(),
      stats: category.stats,
      performance: await category.getPerformanceMetrics(parseInt(dateRange)),
      products: await this.getCategoryProductSummary(categoryId),
      subcategories: await this.getCategorySubcategorySummary(categoryId)
    };

    if (format === 'csv') {
      const csvData = this.generateCategoryReportCSV(report);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="category-report.csv"`);
      res.status(200).send(csvData);
    } else {
      res.status(200).json({
        success: true,
        data: report
      });
    }
  });

  // Get category product summary
  async getCategoryProductSummary(categoryId) {
    const summary = await Product.aggregate([
      {
        $match: {
          category: mongoose.Types.ObjectId(categoryId),
          status: 'published',
          isDeleted: false
        }
      },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          averagePrice: { $avg: '$price' },
          totalViews: { $sum: '$stats.views' },
          totalSales: { $sum: '$stats.salesCount' }
        }
      }
    ]);

    return summary[0] || {};
  }

  // Get category subcategory summary
  async getCategorySubcategorySummary(categoryId) {
    const subcategories = await Category.find({
      parent: categoryId,
      status: 'active',
      isDeleted: false
    }).select('name stats.productCount');

    return subcategories;
  }

  // Generate category report CSV
  generateCategoryReportCSV(report) {
    // Implementation for CSV generation
    return 'category report data...';
  }

  // ===============================
  // CATEGORY API ENDPOINTS
  // ===============================

  // Get category API data
  getCategoryAPI = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { format = 'json' } = req.query;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    const apiData = {
      id: category._id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      parent: category.parent,
      level: category.level,
      type: category.type,
      status: category.status,
      stats: category.stats,
      seo: category.seo,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt
    };

    if (format === 'xml') {
      const xmlData = this.generateCategoryXML(apiData);
      res.setHeader('Content-Type', 'application/xml');
      res.status(200).send(xmlData);
    } else {
      res.status(200).json({
        success: true,
        data: apiData
      });
    }
  });

  // Generate category XML
  generateCategoryXML(categoryData) {
    // Implementation for XML generation
    return `<?xml version="1.0" encoding="UTF-8"?>
<category>
  <id>${categoryData.id}</id>
  <name>${categoryData.name}</name>
  <slug>${categoryData.slug}</slug>
  <type>${categoryData.type}</type>
  <stats>
    <products>${categoryData.stats.productCount}</products>
    <views>${categoryData.stats.viewCount}</views>
  </stats>
</category>`;
  }

  // ===============================
  // CATEGORY SEARCH ENGINE
  // ===============================

  // Get category search suggestions
  getCategorySearchSuggestions = catchAsync(async (req, res) => {
    const { q: searchTerm } = req.query;
    const { limit = 10 } = req.query;

    if (!searchTerm || searchTerm.length < 2) {
      return res.status(200).json({
        success: true,
        data: { suggestions: [] }
      });
    }

    const categories = await Category.find({
      $or: [
        { name: { $regex: searchTerm, $options: 'i' } },
        { description: { $regex: searchTerm, $options: 'i' } },
        { tags: { $in: [new RegExp(searchTerm, 'i')] } }
      ],
      status: 'active',
      isDeleted: false
    })
    .limit(parseInt(limit))
    .select('name slug icon stats.productCount');

    const suggestions = categories.map(category => ({
      id: category._id,
      name: category.name,
      slug: category.slug,
      icon: category.icon,
      productCount: category.stats.productCount,
      type: 'category'
    }));

    res.status(200).json({
      success: true,
      data: { suggestions }
    });
  });

  // Get category related searches
  getCategoryRelatedSearches = catchAsync(async (req, res) => {
    const { categoryId } = req.params;

    const category = await Category.findById(categoryId);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Get related search terms
    const relatedSearches = await this.getCategoryRelatedSearchTerms(categoryId);

    res.status(200).json({
      success: true,
      data: {
        category: category.name,
        relatedSearches
      }
    });
  });

  // Get category related search terms
  async getCategoryRelatedSearchTerms(categoryId) {
    // Implementation for related search terms
    return [
      'electronics',
      'gadgets',
      'accessories',
      'devices'
    ];
  }
}

module.exports = new CategoryController();
