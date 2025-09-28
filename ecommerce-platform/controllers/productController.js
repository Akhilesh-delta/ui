const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');
const Review = require('../models/Review');
const { 
  authenticate, 
  requireVendorOrAdmin,
  sanitizeInput
} = require('../middleware/authMiddleware');

// @desc    Create new product
// @route   POST /api/products
// @access  Private (Vendor/Admin)
const createProduct = async (req, res) => {
  try {
    const userId = req.user._id;
    const productData = req.body;

    // Check if user is vendor or admin
    const user = await User.findById(userId);
    if (!user || (user.role !== 'vendor' && user.role !== 'admin')) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Vendor access required.'
      });
    }

    // Validate required fields
    if (!productData.name || !productData.description || !productData.price || !productData.category) {
      return res.status(400).json({
        success: false,
        error: 'Please provide all required fields: name, description, price, category'
      });
    }

    // Validate category exists
    const category = await Category.findById(productData.category);
    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    // Sanitize inputs
    const sanitizedData = {
      name: sanitizeInput(productData.name),
      description: sanitizeInput(productData.description),
      shortDescription: productData.shortDescription ? sanitizeInput(productData.shortDescription) : undefined,
      sku: sanitizeInput(productData.sku),
      vendor: userId,
      category: productData.category,
      subCategory: productData.subCategory || undefined,
      brand: productData.brand ? sanitizeInput(productData.brand) : undefined,
      price: parseFloat(productData.price),
      compareAtPrice: productData.compareAtPrice ? parseFloat(productData.compareAtPrice) : undefined,
      costPrice: productData.costPrice ? parseFloat(productData.costPrice) : undefined,
      tags: productData.tags ? productData.tags.map(tag => sanitizeInput(tag).toLowerCase()) : [],
      features: productData.features ? productData.features.map(feature => sanitizeInput(feature)) : [],
      benefits: productData.benefits ? productData.benefits.map(benefit => sanitizeInput(benefit)) : []
    };

    // Validate price
    if (sanitizedData.price < 0) {
      return res.status(400).json({
        success: false,
        error: 'Price cannot be negative'
      });
    }

    // Validate inventory
    if (productData.inventory) {
      sanitizedData.inventory = {
        quantity: parseInt(productData.inventory.quantity) || 0,
        trackQuantity: productData.inventory.trackQuantity !== false,
        lowStockThreshold: parseInt(productData.inventory.lowStockThreshold) || 5,
        allowBackorder: productData.inventory.allowBackorder || false,
        maxOrderQuantity: parseInt(productData.inventory.maxOrderQuantity) || 10
      };
    }

    // Validate dimensions
    if (productData.dimensions) {
      sanitizedData.dimensions = {
        length: productData.dimensions.length ? parseFloat(productData.dimensions.length) : undefined,
        width: productData.dimensions.width ? parseFloat(productData.dimensions.width) : undefined,
        height: productData.dimensions.height ? parseFloat(productData.dimensions.height) : undefined,
        unit: productData.dimensions.unit || 'cm'
      };
    }

    // Validate weight
    if (productData.weight) {
      sanitizedData.weight = {
        value: parseFloat(productData.weight.value),
        unit: productData.weight.unit || 'kg'
      };
    }

    // Validate shipping
    if (productData.shipping) {
      sanitizedData.shipping = {
        requiresShipping: productData.shipping.requiresShipping !== false,
        shippingClass: productData.shipping.shippingClass || 'standard',
        handlingTime: parseInt(productData.shipping.handlingTime) || 1,
        freeShipping: productData.shipping.freeShipping || false,
        freeShippingMinimum: productData.shipping.freeShippingMinimum ? parseFloat(productData.shipping.freeShippingMinimum) : undefined
      };
    }

    // Validate specifications
    if (productData.specifications && Array.isArray(productData.specifications)) {
      sanitizedData.specifications = productData.specifications.map(spec => ({
        name: sanitizeInput(spec.name),
        value: sanitizeInput(spec.value),
        unit: spec.unit ? sanitizeInput(spec.unit) : undefined,
        group: spec.group ? sanitizeInput(spec.group) : undefined
      }));
    }

    // Validate attributes
    if (productData.attributes && Array.isArray(productData.attributes)) {
      sanitizedData.attributes = productData.attributes.map(attr => ({
        name: sanitizeInput(attr.name),
        value: sanitizeInput(attr.value),
        visible: attr.visible !== false,
        searchable: attr.searchable || false
      }));
    }

    // Create product
    const product = await Product.create(sanitizedData);

    // Populate category information
    await product.populate('category', 'name slug');
    if (product.subCategory) {
      await product.populate('subCategory', 'name slug');
    }

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: {
        product: {
          id: product._id,
          name: product.name,
          slug: product.slug,
          sku: product.sku,
          price: product.price,
          category: product.category,
          subCategory: product.subCategory,
          status: product.status,
          createdAt: product.createdAt
        }
      }
    });

  } catch (error) {
    console.error('Create product error:', error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'Product with this SKU already exists'
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to create product'
    });
  }
};

// @desc    Get all products
// @route   GET /api/products
// @access  Public
const getProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      subcategory,
      vendor,
      brand,
      minPrice,
      maxPrice,
      rating,
      inStock,
      featured,
      trending,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      tags
    } = req.query;

    // Build query
    let query = {
      status: 'active',
      visibility: 'public'
    };

    // Category filters
    if (category) {
      query.category = category;
    }

    if (subcategory) {
      query.subCategory = subcategory;
    }

    // Vendor filter
    if (vendor) {
      query.vendor = vendor;
    }

    // Brand filter
    if (brand) {
      query.brand = { $regex: brand, $options: 'i' };
    }

    // Price filters
    if (minPrice !== undefined || maxPrice !== undefined) {
      query.price = {};
      if (minPrice !== undefined) query.price.$gte = parseFloat(minPrice);
      if (maxPrice !== undefined) query.price.$lte = parseFloat(maxPrice);
    }

    // Rating filter
    if (rating) {
      query['rating.average'] = { $gte: parseInt(rating) };
    }

    // Stock filter
    if (inStock === 'true') {
      query['inventory.stockStatus'] = { $in: ['in_stock', 'low_stock'] };
    }

    // Featured/Trending filters
    if (featured === 'true') {
      query.featured = true;
    }

    if (trending === 'true') {
      query.trending = true;
    }

    // Tags filter
    if (tags) {
      const tagArray = tags.split(',').map(tag => tag.trim());
      query.tags = { $in: tagArray };
    }

    // Search functionality
    let products;
    let total;

    if (search) {
      const searchResults = await Product.search(search, {
        category: query.category,
        vendor: query.vendor,
        minPrice: query.price?.$gte,
        maxPrice: query.price?.$lte,
        inStock: inStock === 'true'
      });

      products = searchResults;
      total = products.length;
    } else {
      // Build sort object
      const sort = {};
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

      products = await Product.find(query)
        .populate('category', 'name slug')
        .populate('vendor', 'firstName lastName businessName')
        .sort(sort)
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .select('name slug sku price images rating category vendor featured trending createdAt');

      total = await Product.countDocuments(query);
    }

    // Get filter options for the response
    const filterOptions = await getFilterOptions();

    res.json({
      success: true,
      data: {
        products,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        },
        filters: filterOptions
      }
    });

  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch products'
    });
  }
};

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Public
const getProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { includeReviews = false } = req.query;

    const product = await Product.findOne({
      $or: [{ _id: id }, { slug: id }],
      status: 'active',
      visibility: 'public'
    })
    .populate('category', 'name slug')
    .populate('subCategory', 'name slug')
    .populate('vendor', 'firstName lastName businessName rating reviewCount');

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Add view to product statistics
    await product.addView();

    // Get related products
    const relatedProducts = await Product.find({
      category: product.category._id,
      _id: { $ne: product._id },
      status: 'active',
      visibility: 'public'
    })
    .limit(8)
    .select('name slug price images rating')
    .sort({ 'statistics.views': -1 });

    // Get recently viewed products for this user (if authenticated)
    let recentlyViewed = [];
    if (req.user) {
      const user = await User.findById(req.user._id);
      recentlyViewed = await Product.find({
        _id: { $in: user.shopping.recentlyViewed.slice(0, 5).map(item => item.product) }
      })
      .select('name slug price images rating');
    }

    // Get product reviews if requested
    let reviews = [];
    if (includeReviews === 'true') {
      reviews = await Review.find({ product: product._id })
        .populate('user', 'firstName lastName profile.avatar')
        .sort({ createdAt: -1 })
        .limit(10);
    }

    res.json({
      success: true,
      data: {
        product: {
          id: product._id,
          name: product.name,
          slug: product.slug,
          description: product.description,
          shortDescription: product.shortDescription,
          sku: product.sku,
          price: product.price,
          discountedPrice: product.discountedPrice,
          compareAtPrice: product.compareAtPrice,
          discount: product.discount,
          savingsAmount: product.savingsAmount,
          savingsPercentage: product.savingsPercentage,
          category: product.category,
          subCategory: product.subCategory,
          brand: product.brand,
          vendor: product.vendor,
          images: product.images,
          videos: product.videos,
          specifications: product.getFormattedSpecifications(),
          features: product.features,
          benefits: product.benefits,
          attributes: product.attributes,
          tags: product.tags,
          dimensions: product.dimensions,
          weight: product.weight,
          shipping: product.shipping,
          inventory: {
            quantity: product.inventory.quantity,
            stockStatus: product.inventory.stockStatus,
            allowBackorder: product.inventory.allowBackorder,
            maxOrderQuantity: product.inventory.maxOrderQuantity
          },
          rating: product.rating,
          status: product.status,
          featured: product.featured,
          trending: product.trending,
          options: product.options,
          seo: product.seo,
          createdAt: product.createdAt,
          updatedAt: product.updatedAt
        },
        relatedProducts,
        recentlyViewed,
        reviews: includeReviews === 'true' ? reviews : undefined,
        statistics: product.getAnalytics()
      }
    });

  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product'
    });
  }
};

// @desc    Update product
// @route   PUT /api/products/:id
// @access  Private (Vendor/Admin)
const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const userId = req.user._id;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Check ownership
    if (product.vendor.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only update your own products.'
      });
    }

    // Fields that can be updated
    const allowedUpdates = [
      'name', 'description', 'shortDescription', 'brand', 'price', 'compareAtPrice',
      'costPrice', 'category', 'subCategory', 'tags', 'features', 'benefits',
      'specifications', 'attributes', 'dimensions', 'weight', 'shipping',
      'inventory', 'options', 'seo', 'status', 'visibility', 'featured', 'trending'
    ];

    // Filter updates to only allowed fields
    const filteredUpdates = {};
    Object.keys(updates).forEach(key => {
      if (allowedUpdates.includes(key)) {
        if (key === 'name' || key === 'description' || key === 'shortDescription' || key === 'brand') {
          filteredUpdates[key] = sanitizeInput(updates[key]);
        } else if (key === 'price' || key === 'compareAtPrice' || key === 'costPrice') {
          filteredUpdates[key] = parseFloat(updates[key]);
        } else if (key === 'tags' && Array.isArray(updates[key])) {
          filteredUpdates[key] = updates[key].map(tag => sanitizeInput(tag).toLowerCase());
        } else if (key === 'features' && Array.isArray(updates[key])) {
          filteredUpdates[key] = updates[key].map(feature => sanitizeInput(feature));
        } else if (key === 'benefits' && Array.isArray(updates[key])) {
          filteredUpdates[key] = updates[key].map(benefit => sanitizeInput(benefit));
        } else {
          filteredUpdates[key] = updates[key];
        }
      }
    });

    // Validate category if being updated
    if (filteredUpdates.category) {
      const category = await Category.findById(filteredUpdates.category);
      if (!category) {
        return res.status(404).json({
          success: false,
          error: 'Category not found'
        });
      }
    }

    // Validate price
    if (filteredUpdates.price !== undefined && filteredUpdates.price < 0) {
      return res.status(400).json({
        success: false,
        error: 'Price cannot be negative'
      });
    }

    // Update product
    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      { $set: filteredUpdates },
      { new: true, runValidators: true }
    )
    .populate('category', 'name slug')
    .populate('subCategory', 'name slug');

    res.json({
      success: true,
      message: 'Product updated successfully',
      data: {
        product: updatedProduct
      }
    });

  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update product'
    });
  }
};

// @desc    Delete product
// @route   DELETE /api/products/:id
// @access  Private (Vendor/Admin)
const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Check ownership
    if (product.vendor.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only delete your own products.'
      });
    }

    // Check if product has orders
    const Order = require('../models/Order');
    const hasOrders = await Order.exists({ 'items.product': id });

    if (hasOrders) {
      // Archive instead of delete
      await Product.findByIdAndUpdate(id, { status: 'archived' });
      return res.json({
        success: true,
        message: 'Product archived successfully (cannot delete products with existing orders)'
      });
    }

    // Delete product
    await Product.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });

  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete product'
    });
  }
};

// @desc    Update product inventory
// @route   PUT /api/products/:id/inventory
// @access  Private (Vendor/Admin)
const updateProductInventory = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, operation = 'set', reason = '' } = req.body;
    const userId = req.user._id;

    if (quantity === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Quantity is required'
      });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Check ownership
    if (product.vendor.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only update inventory for your own products.'
      });
    }

    const oldQuantity = product.inventory.quantity;

    // Update inventory
    await product.updateInventory(quantity, operation);

    // Add history entry
    product.history.push({
      action: 'inventory_updated',
      oldValue: { quantity: oldQuantity },
      newValue: { quantity: product.inventory.quantity },
      changedBy: userId,
      metadata: { reason }
    });

    await product.save();

    res.json({
      success: true,
      message: 'Product inventory updated successfully',
      data: {
        product: {
          id: product._id,
          name: product.name,
          inventory: product.inventory,
          history: product.history.slice(-1) // Last history entry
        }
      }
    });

  } catch (error) {
    console.error('Update product inventory error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update product inventory'
    });
  }
};

// @desc    Add product images
// @route   POST /api/products/:id/images
// @access  Private (Vendor/Admin)
const addProductImages = async (req, res) => {
  try {
    const { id } = req.params;
    const { images } = req.body;
    const userId = req.user._id;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide images'
      });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Check ownership
    if (product.vendor.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only add images to your own products.'
      });
    }

    // Check max images limit
    const maxImages = 10;
    if (product.images.length + images.length > maxImages) {
      return res.status(400).json({
        success: false,
        error: `Maximum ${maxImages} images allowed per product`
      });
    }

    // Process images
    const processedImages = images.map((image, index) => ({
      url: image.url,
      alt: image.alt || `${product.name} - Image ${product.images.length + index + 1}`,
      isPrimary: image.isPrimary || (product.images.length === 0 && index === 0), // First image is primary if none exists
      order: product.images.length + index,
      metadata: image.metadata || {}
    }));

    // Add images to product
    product.images.push(...processedImages);
    await product.save();

    res.status(201).json({
      success: true,
      message: 'Images added successfully',
      data: {
        images: product.images.slice(-images.length) // Return only the added images
      }
    });

  } catch (error) {
    console.error('Add product images error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add product images'
    });
  }
};

// @desc    Remove product image
// @route   DELETE /api/products/:id/images/:imageId
// @access  Private (Vendor/Admin)
const removeProductImage = async (req, res) => {
  try {
    const { id, imageId } = req.params;
    const userId = req.user._id;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Check ownership
    if (product.vendor.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only remove images from your own products.'
      });
    }

    // Find and remove image
    const imageIndex = product.images.findIndex(img => img._id.toString() === imageId);
    if (imageIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Image not found'
      });
    }

    const removedImage = product.images.splice(imageIndex, 1)[0];

    // If removed image was primary, set new primary
    if (removedImage.isPrimary && product.images.length > 0) {
      product.images[0].isPrimary = true;
    }

    // Update order for remaining images
    product.images.forEach((img, index) => {
      img.order = index;
    });

    await product.save();

    res.json({
      success: true,
      message: 'Image removed successfully',
      data: {
        removedImage: {
          id: removedImage._id,
          url: removedImage.url,
          alt: removedImage.alt
        }
      }
    });

  } catch (error) {
    console.error('Remove product image error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove product image'
    });
  }
};

// @desc    Set primary image
// @route   PUT /api/products/:id/images/:imageId/primary
// @access  Private (Vendor/Admin)
const setPrimaryImage = async (req, res) => {
  try {
    const { id, imageId } = req.params;
    const userId = req.user._id;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Check ownership
    if (product.vendor.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only update images for your own products.'
      });
    }

    // Find image
    const image = product.images.id(imageId);
    if (!image) {
      return res.status(404).json({
        success: false,
        error: 'Image not found'
      });
    }

    // Remove primary from all images
    product.images.forEach(img => {
      img.isPrimary = false;
    });

    // Set new primary
    image.isPrimary = true;
    await product.save();

    res.json({
      success: true,
      message: 'Primary image updated successfully',
      data: {
        primaryImage: {
          id: image._id,
          url: image.url,
          alt: image.alt
        }
      }
    });

  } catch (error) {
    console.error('Set primary image error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set primary image'
    });
  }
};

// @desc    Add product variant
// @route   POST /api/products/:id/variants
// @access  Private (Vendor/Admin)
const addProductVariant = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, options } = req.body;
    const userId = req.user._id;

    if (!name || !type || !options || !Array.isArray(options) || options.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide variant name, type, and options'
      });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Check ownership
    if (product.vendor.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only add variants to your own products.'
      });
    }

    // Validate variant type
    const validTypes = ['color', 'size', 'material', 'style', 'weight', 'volume', 'other'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid variant type'
      });
    }

    // Check max variants limit
    const maxVariants = 100;
    if (product.variants.length >= maxVariants) {
      return res.status(400).json({
        success: false,
        error: `Maximum ${maxVariants} variants allowed per product`
      });
    }

    // Process options
    const processedOptions = options.map(option => ({
      value: sanitizeInput(option.value),
      priceModifier: option.priceModifier ? parseFloat(option.priceModifier) : 0,
      sku: option.sku ? sanitizeInput(option.sku) : undefined,
      inventory: {
        quantity: option.inventory?.quantity ? parseInt(option.inventory.quantity) : 0,
        sku: option.inventory?.sku ? sanitizeInput(option.inventory.sku) : undefined
      }
    }));

    // Create variant
    const variant = {
      name: sanitizeInput(name),
      type,
      options: processedOptions
    };

    product.variants.push(variant);
    await product.save();

    res.status(201).json({
      success: true,
      message: 'Variant added successfully',
      data: {
        variant: product.variants[product.variants.length - 1]
      }
    });

  } catch (error) {
    console.error('Add product variant error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add product variant'
    });
  }
};

// @desc    Update product variant
// @route   PUT /api/products/:id/variants/:variantId
// @access  Private (Vendor/Admin)
const updateProductVariant = async (req, res) => {
  try {
    const { id, variantId } = req.params;
    const updates = req.body;
    const userId = req.user._id;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Check ownership
    if (product.vendor.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only update variants for your own products.'
      });
    }

    // Find variant
    const variant = product.variants.id(variantId);
    if (!variant) {
      return res.status(404).json({
        success: false,
        error: 'Variant not found'
      });
    }

    // Update variant
    if (updates.name) variant.name = sanitizeInput(updates.name);
    if (updates.type) {
      const validTypes = ['color', 'size', 'material', 'style', 'weight', 'volume', 'other'];
      if (!validTypes.includes(updates.type)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid variant type'
        });
      }
      variant.type = updates.type;
    }

    // Update options if provided
    if (updates.options && Array.isArray(updates.options)) {
      variant.options = updates.options.map(option => ({
        value: sanitizeInput(option.value),
        priceModifier: option.priceModifier ? parseFloat(option.priceModifier) : 0,
        sku: option.sku ? sanitizeInput(option.sku) : undefined,
        inventory: {
          quantity: option.inventory?.quantity ? parseInt(option.inventory.quantity) : 0,
          sku: option.inventory?.sku ? sanitizeInput(option.inventory.sku) : undefined
        }
      }));
    }

    await product.save();

    res.json({
      success: true,
      message: 'Variant updated successfully',
      data: {
        variant
      }
    });

  } catch (error) {
    console.error('Update product variant error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update product variant'
    });
  }
};

// @desc    Remove product variant
// @route   DELETE /api/products/:id/variants/:variantId
// @access  Private (Vendor/Admin)
const removeProductVariant = async (req, res) => {
  try {
    const { id, variantId } = req.params;
    const userId = req.user._id;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Check ownership
    if (product.vendor.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only remove variants from your own products.'
      });
    }

    // Find and remove variant
    const variantIndex = product.variants.findIndex(v => v._id.toString() === variantId);
    if (variantIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Variant not found'
      });
    }

    const removedVariant = product.variants.splice(variantIndex, 1)[0];
    await product.save();

    res.json({
      success: true,
      message: 'Variant removed successfully',
      data: {
        removedVariant: {
          id: removedVariant._id,
          name: removedVariant.name,
          type: removedVariant.type
        }
      }
    });

  } catch (error) {
    console.error('Remove product variant error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove product variant'
    });
  }
};

// @desc    Get product reviews
// @route   GET /api/products/:id/reviews
// @access  Public
const getProductReviews = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10, rating, verified = false, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Build query
    let query = { product: id };

    if (rating) {
      query.rating = parseInt(rating);
    }

    if (verified === 'true') {
      query.verified = true;
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const reviews = await Review.find(query)
      .populate('user', 'firstName lastName profile.avatar')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Review.countDocuments(query);

    // Get rating distribution
    const ratingDistribution = await Review.aggregate([
      { $match: { product: product._id } },
      {
        $group: {
          _id: '$rating',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        reviews,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        },
        ratingDistribution,
        averageRating: product.rating.average,
        totalReviews: product.rating.count
      }
    });

  } catch (error) {
    console.error('Get product reviews error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product reviews'
    });
  }
};

// @desc    Add product review
// @route   POST /api/products/:id/reviews
// @access  Private
const addProductReview = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, title, comment, images, verified } = req.body;
    const userId = req.user._id;

    if (!rating || !title || !comment) {
      return res.status(400).json({
        success: false,
        error: 'Please provide rating, title, and comment'
      });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        error: 'Rating must be between 1 and 5'
      });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Check if user already reviewed this product
    const existingReview = await Review.findOne({ product: id, user: userId });
    if (existingReview) {
      return res.status(400).json({
        success: false,
        error: 'You have already reviewed this product'
      });
    }

    // Check if user has purchased this product
    const Order = require('../models/Order');
    const hasPurchased = await Order.exists({
      user: userId,
      'items.product': id,
      status: 'delivered'
    });

    // Create review
    const review = await Review.create({
      product: id,
      user: userId,
      rating: parseInt(rating),
      title: sanitizeInput(title),
      comment: sanitizeInput(comment),
      images: images || [],
      verified: hasPurchased || false,
      helpful: 0,
      notHelpful: 0
    });

    // Update product rating
    await product.addReview(rating, 1);

    // Populate user data
    await review.populate('user', 'firstName lastName profile.avatar');

    res.status(201).json({
      success: true,
      message: 'Review added successfully',
      data: {
        review
      }
    });

  } catch (error) {
    console.error('Add product review error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add review'
    });
  }
};

// @desc    Update product review
// @route   PUT /api/products/:id/reviews/:reviewId
// @access  Private
const updateProductReview = async (req, res) => {
  try {
    const { id, reviewId } = req.params;
    const { rating, title, comment, images } = req.body;
    const userId = req.user._id;

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({
        success: false,
        error: 'Review not found'
      });
    }

    if (review.user.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only update your own reviews.'
      });
    }

    if (review.product.toString() !== id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'Review does not belong to this product'
      });
    }

    // Store old rating for recalculation
    const oldRating = review.rating;

    // Update review
    if (rating) review.rating = parseInt(rating);
    if (title) review.title = sanitizeInput(title);
    if (comment) review.comment = sanitizeInput(comment);
    if (images) review.images = images;

    await review.save();

    // Update product rating if rating changed
    if (oldRating !== review.rating) {
      const product = await Product.findById(id);
      // Recalculate average rating
      const allReviews = await Review.find({ product: id });
      const newAverage = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;
      
      product.rating.average = Math.round(newAverage * 10) / 10;
      await product.save();
    }

    res.json({
      success: true,
      message: 'Review updated successfully',
      data: {
        review
      }
    });

  } catch (error) {
    console.error('Update product review error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update review'
    });
  }
};

// @desc    Delete product review
// @route   DELETE /api/products/:id/reviews/:reviewId
// @access  Private
const deleteProductReview = async (req, res) => {
  try {
    const { id, reviewId } = req.params;
    const userId = req.user._id;

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({
        success: false,
        error: 'Review not found'
      });
    }

    if (review.user.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only delete your own reviews.'
      });
    }

    if (review.product.toString() !== id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'Review does not belong to this product'
      });
    }

    // Delete review
    await Review.findByIdAndDelete(reviewId);

    // Update product rating
    const product = await Product.findById(id);
    const remainingReviews = await Review.find({ product: id });
    
    if (remainingReviews.length > 0) {
      const newAverage = remainingReviews.reduce((sum, r) => sum + r.rating, 0) / remainingReviews.length;
      product.rating.average = Math.round(newAverage * 10) / 10;
      product.rating.count = remainingReviews.length;
    } else {
      product.rating.average = 0;
      product.rating.count = 0;
    }

    await product.save();

    res.json({
      success: true,
      message: 'Review deleted successfully'
    });

  } catch (error) {
    console.error('Delete product review error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete review'
    });
  }
};

// @desc    Mark review as helpful
// @route   POST /api/products/:id/reviews/:reviewId/helpful
// @access  Private
const markReviewHelpful = async (req, res) => {
  try {
    const { id, reviewId } = req.params;
    const userId = req.user._id;

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({
        success: false,
        error: 'Review not found'
      });
    }

    if (review.product.toString() !== id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'Review does not belong to this product'
      });
    }

    // Check if user already marked as helpful
    if (review.helpfulUsers && review.helpfulUsers.includes(userId)) {
      return res.status(400).json({
        success: false,
        error: 'You have already marked this review as helpful'
      });
    }

    // Add user to helpful users
    if (!review.helpfulUsers) {
      review.helpfulUsers = [];
    }
    review.helpfulUsers.push(userId);
    review.helpful += 1;

    await review.save();

    res.json({
      success: true,
      message: 'Review marked as helpful',
      data: {
        helpful: review.helpful,
        notHelpful: review.notHelpful
      }
    });

  } catch (error) {
    console.error('Mark review helpful error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark review as helpful'
    });
  }
};

// @desc    Get featured products
// @route   GET /api/products/featured
// @access  Public
const getFeaturedProducts = async (req, res) => {
  try {
    const { limit = 20, category } = req.query;

    let query = {
      status: 'active',
      visibility: 'public',
      featured: true
    };

    if (category) {
      query.category = category;
    }

    const products = await Product.find(query)
      .populate('category', 'name slug')
      .populate('vendor', 'firstName lastName businessName')
      .sort({ 'statistics.views': -1 })
      .limit(parseInt(limit))
      .select('name slug sku price images rating category vendor featured trending');

    res.json({
      success: true,
      data: {
        products,
        count: products.length
      }
    });

  } catch (error) {
    console.error('Get featured products error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch featured products'
    });
  }
};

// @desc    Get trending products
// @route   GET /api/products/trending
// @access  Public
const getTrendingProducts = async (req, res) => {
  try {
    const { limit = 20, category } = req.query;

    let query = {
      status: 'active',
      visibility: 'public',
      trending: true
    };

    if (category) {
      query.category = category;
    }

    const products = await Product.find(query)
      .populate('category', 'name slug')
      .populate('vendor', 'firstName lastName businessName')
      .sort({ 'statistics.views': -1 })
      .limit(parseInt(limit))
      .select('name slug sku price images rating category vendor featured trending');

    res.json({
      success: true,
      data: {
        products,
        count: products.length
      }
    });

  } catch (error) {
    console.error('Get trending products error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trending products'
    });
  }
};

// @desc    Get products by category
// @route   GET /api/products/category/:categoryId
// @access  Public
const getProductsByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const {
      page = 1,
      limit = 20,
      subcategory,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    // Build query
    let query = {
      status: 'active',
      visibility: 'public'
    };

    if (subcategory) {
      query.subCategory = subcategory;
    } else {
      // Get products from category and all its subcategories
      const subcategories = await Category.find({ parent: categoryId }).select('_id');
      const subcategoryIds = subcategories.map(sub => sub._id);
      
      query.$or = [
        { category: categoryId },
        { subCategory: { $in: subcategoryIds } }
      ];
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const products = await Product.find(query)
      .populate('category', 'name slug')
      .populate('subCategory', 'name slug')
      .populate('vendor', 'firstName lastName businessName')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('name slug sku price images rating category subCategory vendor featured trending createdAt');

    const total = await Product.countDocuments(query);

    // Get subcategories for filter
    const subcategories = await Category.find({ parent: categoryId })
      .select('name slug')
      .sort({ name: 1 });

    res.json({
      success: true,
      data: {
        category: {
          id: category._id,
          name: category.name,
          slug: category.slug,
          description: category.description
        },
        products,
        subcategories,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get products by category error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch products by category'
    });
  }
};

// @desc    Get products by vendor
// @route   GET /api/products/vendor/:vendorId
// @access  Public
const getProductsByVendor = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const {
      page = 1,
      limit = 20,
      category,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const vendor = await User.findById(vendorId);
    if (!vendor || vendor.role !== 'vendor') {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found'
      });
    }

    // Build query
    let query = {
      vendor: vendorId,
      status: 'active',
      visibility: 'public'
    };

    if (category) {
      query.category = category;
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
      .select('name slug sku price images rating category subCategory featured trending createdAt');

    const total = await Product.countDocuments(query);

    res.json({
      success: true,
      data: {
        vendor: {
          id: vendor._id,
          firstName: vendor.firstName,
          lastName: vendor.lastName,
          businessName: vendor.vendorProfile?.businessName,
          rating: vendor.vendorProfile?.rating,
          reviewCount: vendor.vendorProfile?.reviewCount
        },
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
    console.error('Get products by vendor error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch products by vendor'
    });
  }
};

// @desc    Search products
// @route   GET /api/products/search
// @access  Public
const searchProducts = async (req, res) => {
  try {
    const {
      q: query,
      page = 1,
      limit = 20,
      category,
      minPrice,
      maxPrice,
      rating,
      inStock,
      sortBy = 'relevance',
      sortOrder = 'desc'
    } = req.query;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    // Use Product.search method
    const products = await Product.search(query, {
      category,
      minPrice,
      maxPrice,
      inStock: inStock === 'true'
    });

    // Apply sorting
    let sortedProducts = products;
    if (sortBy === 'price') {
      sortedProducts = products.sort((a, b) => sortOrder === 'desc' ? b.price - a.price : a.price - b.price);
    } else if (sortBy === 'rating') {
      sortedProducts = products.sort((a, b) => sortOrder === 'desc' ? b.rating.average - a.rating.average : a.rating.average - b.rating.average);
    } else if (sortBy === 'newest') {
      sortedProducts = products.sort((a, b) => sortOrder === 'desc' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt);
    } else if (sortBy === 'popular') {
      sortedProducts = products.sort((a, b) => sortOrder === 'desc' ? b.statistics.views - a.statistics.views : a.statistics.views - b.statistics.views);
    }

    // Apply pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedProducts = sortedProducts.slice(startIndex, endIndex);

    // Get filter options
    const filterOptions = await getFilterOptions();

    res.json({
      success: true,
      data: {
        query,
        products: paginatedProducts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: products.length,
          pages: Math.ceil(products.length / limit)
        },
        filters: filterOptions,
        suggestions: await getSearchSuggestions(query)
      }
    });

  } catch (error) {
    console.error('Search products error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search products'
    });
  }
};

// @desc    Get product recommendations
// @route   GET /api/products/:id/recommendations
// @access  Public
const getProductRecommendations = async (req, res) => {
  try {
    const { id } = req.params;
    const { type = 'related', limit = 10 } = req.query;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    let recommendations = [];

    switch (type) {
      case 'related':
        recommendations = await Product.find({
          category: product.category,
          _id: { $ne: product._id },
          status: 'active',
          visibility: 'public'
        })
        .limit(parseInt(limit))
        .select('name slug price images rating')
        .sort({ 'statistics.views': -1 });
        break;

      case 'frequently_bought_together':
        // This would require order analysis
        recommendations = await Product.find({
          _id: { $ne: product._id },
          status: 'active',
          visibility: 'public'
        })
        .limit(parseInt(limit))
        .select('name slug price images rating');
        break;

      case 'similar':
        recommendations = await Product.find({
          $or: [
            { brand: product.brand },
            { tags: { $in: product.tags } }
          ],
          _id: { $ne: product._id },
          status: 'active',
          visibility: 'public'
        })
        .limit(parseInt(limit))
        .select('name slug price images rating');
        break;

      case 'trending':
        recommendations = await Product.find({
          trending: true,
          status: 'active',
          visibility: 'public'
        })
        .limit(parseInt(limit))
        .select('name slug price images rating')
        .sort({ 'statistics.views': -1 });
        break;
    }

    res.json({
      success: true,
      data: {
        recommendations,
        type,
        count: recommendations.length
      }
    });

  } catch (error) {
    console.error('Get product recommendations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product recommendations'
    });
  }
};

// @desc    Get product statistics
// @route   GET /api/products/:id/statistics
// @access  Private (Vendor/Admin)
const getProductStatistics = async (req, res) => {
  try {
    const { id } = req.params;
    const { period = '30d' } = req.query;
    const userId = req.user._id;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Check ownership
    if (product.vendor.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only view statistics for your own products.'
      });
    }

    // Calculate date range
    const daysBack = parseInt(period.replace('d', ''));
    const startDate = new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000));

    // Get analytics data
    const analytics = product.getAnalytics(startDate);

    // Get review analytics
    const Review = require('../models/Review');
    const reviewAnalytics = await Review.aggregate([
      { $match: { product: product._id, createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: '$rating',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        product: {
          id: product._id,
          name: product.name,
          sku: product.sku
        },
        period,
        analytics: {
          ...analytics,
          reviewDistribution: reviewAnalytics,
          conversionRate: analytics.views > 0 ? (analytics.conversions / analytics.views) * 100 : 0
        }
      }
    });

  } catch (error) {
    console.error('Get product statistics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product statistics'
    });
  }
};

// @desc    Bulk update products
// @route   PUT /api/products/bulk-update
// @access  Private (Vendor/Admin)
const bulkUpdateProducts = async (req, res) => {
  try {
    const { productIds, updates } = req.body;
    const userId = req.user._id;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide product IDs'
      });
    }

    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide updates'
      });
    }

    // Verify ownership of all products
    const products = await Product.find({
      _id: { $in: productIds },
      vendor: userId
    });

    if (products.length !== productIds.length) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only update your own products.'
      });
    }

    // Apply updates
    const updateData = {};
    Object.keys(updates).forEach(key => {
      if (key === 'price' || key === 'compareAtPrice') {
        updateData[key] = parseFloat(updates[key]);
      } else if (key === 'status' || key === 'visibility' || key === 'featured' || key === 'trending') {
        updateData[key] = updates[key];
      }
    });

    const result = await Product.updateMany(
      { _id: { $in: productIds }, vendor: userId },
      { $set: updateData }
    );

    res.json({
      success: true,
      message: `${result.modifiedCount} products updated successfully`,
      data: {
        updatedCount: result.modifiedCount,
        matchedCount: result.matchedCount
      }
    });

  } catch (error) {
    console.error('Bulk update products error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to bulk update products'
    });
  }
};

// @desc    Get filter options
// @route   GET /api/products/filters
// @access  Public
const getFilterOptions = async (req, res) => {
  try {
    const categories = await Category.find({ status: 'active' })
      .select('name slug')
      .sort({ name: 1 });

    const brands = await Product.distinct('brand', {
      status: 'active',
      visibility: 'public',
      brand: { $ne: null, $ne: '' }
    });

    const priceRanges = [
      { min: 0, max: 25, label: 'Under $25' },
      { min: 25, max: 50, label: '$25 - $50' },
      { min: 50, max: 100, label: '$50 - $100' },
      { min: 100, max: 200, label: '$100 - $200' },
      { min: 200, max: 500, label: '$200 - $500' },
      { min: 500, max: null, label: 'Over $500' }
    ];

    res.json({
      success: true,
      data: {
        categories,
        brands: brands.filter(brand => brand).sort(),
        priceRanges,
        ratings: [5, 4, 3, 2, 1]
      }
    });

  } catch (error) {
    console.error('Get filter options error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch filter options'
    });
  }
};

// @desc    Get search suggestions
// @route   GET /api/products/search/suggestions
// @access  Public
const getSearchSuggestions = async (req, res) => {
  try {
    const { q: query } = req.query;

    if (!query || query.length < 2) {
      return res.json({
        success: true,
        data: {
          suggestions: []
        }
      });
    }

    // Get product name suggestions
    const productSuggestions = await Product.find({
      name: { $regex: query, $options: 'i' },
      status: 'active',
      visibility: 'public'
    })
    .limit(5)
    .select('name slug')
    .sort({ 'statistics.views': -1 });

    // Get category suggestions
    const categorySuggestions = await Category.find({
      name: { $regex: query, $options: 'i' },
      status: 'active'
    })
    .limit(3)
    .select('name slug');

    // Get brand suggestions
    const brandSuggestions = await Product.distinct('brand', {
      brand: { $regex: query, $options: 'i' },
      status: 'active',
      visibility: 'public'
    });

    const suggestions = [
      ...productSuggestions.map(p => ({ type: 'product', text: p.name, slug: p.slug })),
      ...categorySuggestions.map(c => ({ type: 'category', text: c.name, slug: c.slug })),
      ...brandSuggestions.slice(0, 3).map(b => ({ type: 'brand', text: b }))
    ];

    res.json({
      success: true,
      data: {
        suggestions: suggestions.slice(0, 8)
      }
    });

  } catch (error) {
    console.error('Get search suggestions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch search suggestions'
    });
  }
};

// @desc    Compare products
// @route   POST /api/products/compare
// @access  Public
const compareProducts = async (req, res) => {
  try {
    const { productIds } = req.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide product IDs'
      });
    }

    if (productIds.length > 4) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 4 products can be compared at once'
      });
    }

    const products = await Product.find({
      _id: { $in: productIds },
      status: 'active',
      visibility: 'public'
    })
    .populate('category', 'name slug')
    .populate('vendor', 'firstName lastName businessName')
    .select('name slug sku price compareAtPrice images rating category vendor specifications features benefits dimensions weight shipping');

    if (products.length !== productIds.length) {
      return res.status(404).json({
        success: false,
        error: 'Some products not found'
      });
    }

    // Group specifications for comparison
    const allSpecNames = [...new Set(products.flatMap(p => p.specifications.map(s => s.name)))];
    const comparisonData = {
      products: products.map(p => ({
        id: p._id,
        name: p.name,
        slug: p.slug,
        sku: p.sku,
        price: p.price,
        compareAtPrice: p.compareAtPrice,
        images: p.images,
        rating: p.rating,
        category: p.category,
        vendor: p.vendor,
        specifications: allSpecNames.reduce((acc, specName) => {
          const spec = p.specifications.find(s => s.name === specName);
          acc[specName] = spec ? spec.value : 'N/A';
          return acc;
        }, {}),
        features: p.features,
        benefits: p.benefits,
        dimensions: p.dimensions,
        weight: p.weight,
        shipping: p.shipping
      })),
      specificationNames: allSpecNames
    };

    res.json({
      success: true,
      data: comparisonData
    });

  } catch (error) {
    console.error('Compare products error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to compare products'
    });
  }
};

module.exports = {
  createProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  updateProductInventory,
  addProductImages,
  removeProductImage,
  setPrimaryImage,
  addProductVariant,
  updateProductVariant,
  removeProductVariant,
  getProductReviews,
  addProductReview,
  updateProductReview,
  deleteProductReview,
  markReviewHelpful,
  getFeaturedProducts,
  getTrendingProducts,
  getProductsByCategory,
  getProductsByVendor,
  searchProducts,
  getProductRecommendations,
  getProductStatistics,
  bulkUpdateProducts,
  getFilterOptions,
  getSearchSuggestions,
  compareProducts
};
