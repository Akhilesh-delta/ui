const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');
const Order = require('../models/Order');
const Review = require('../models/Review');
const { authenticate, optionalAuth, sanitizeInput } = require('../middleware/authMiddleware');

// @desc    Advanced product search
// @route   GET /api/search/products
// @access  Public
const advancedProductSearch = async (req, res) => {
  try {
    const {
      q: query,
      page = 1,
      limit = 20,
      category,
      subcategory,
      brand,
      minPrice,
      maxPrice,
      rating,
      inStock,
      featured,
      trending,
      sortBy = 'relevance',
      sortOrder = 'desc',
      attributes = [],
      location,
      distance,
      tags = [],
      excludeIds = []
    } = req.query;

    if (!query && !category && !brand && attributes.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a search query, category, brand, or attributes'
      });
    }

    // Build search query
    const searchQuery = {
      status: 'active',
      visibility: 'public'
    };

    // Add location-based search if provided
    if (location && distance) {
      const locationQuery = await buildLocationQuery(location, distance);
      if (locationQuery) {
        searchQuery['shippingAddress.city'] = locationQuery;
      }
    }

    // Add category filters
    if (category) {
      searchQuery.category = category;
    }

    if (subcategory) {
      searchQuery.subCategory = subcategory;
    }

    // Add brand filter
    if (brand) {
      searchQuery.brand = { $regex: brand, $options: 'i' };
    }

    // Add price filters
    if (minPrice !== undefined || maxPrice !== undefined) {
      searchQuery.price = {};
      if (minPrice !== undefined) searchQuery.price.$gte = parseFloat(minPrice);
      if (maxPrice !== undefined) searchQuery.price.$lte = parseFloat(maxPrice);
    }

    // Add rating filter
    if (rating) {
      searchQuery['rating.average'] = { $gte: parseInt(rating) };
    }

    // Add stock filter
    if (inStock === 'true') {
      searchQuery['inventory.stockStatus'] = { $in: ['in_stock', 'low_stock'] };
    }

    // Add featured/trending filters
    if (featured === 'true') {
      searchQuery.featured = true;
    }

    if (trending === 'true') {
      searchQuery.trending = true;
    }

    // Add tags filter
    if (tags.length > 0) {
      searchQuery.tags = { $in: tags };
    }

    // Add attribute filters
    if (attributes.length > 0) {
      const attributeConditions = attributes.map(attr => ({
        'attributes.name': attr.name,
        'attributes.value': { $regex: attr.value, $options: 'i' }
      }));
      searchQuery.$and = searchQuery.$and || [];
      searchQuery.$and.push({ $or: attributeConditions });
    }

    // Exclude specific products
    if (excludeIds.length > 0) {
      searchQuery._id = { $nin: excludeIds };
    }

    let products;
    let total;

    if (query) {
      // Use MongoDB text search
      const searchResults = await Product.find({
        $and: [
          {
            $or: [
              { $text: { $search: query } },
              { name: { $regex: query, $options: 'i' } },
              { description: { $regex: query, $options: 'i' } },
              { brand: { $regex: query, $options: 'i' } },
              { tags: { $in: [new RegExp(query, 'i')] } }
            ]
          },
          searchQuery
        ]
      })
      .populate('category', 'name slug')
      .populate('vendor', 'businessName rating')
      .select('name slug sku price images rating category vendor featured trending createdAt');

      products = searchResults;
      total = products.length;
    } else {
      // Regular query without text search
      const sort = {};
      sort[sortBy === 'relevance' ? 'createdAt' : sortBy] = sortOrder === 'desc' ? -1 : 1;

      products = await Product.find(searchQuery)
        .populate('category', 'name slug')
        .populate('vendor', 'businessName rating')
        .sort(sort)
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .select('name slug sku price images rating category vendor featured trending createdAt');

      total = await Product.countDocuments(searchQuery);
    }

    // Get search suggestions
    const suggestions = await generateSearchSuggestions(query, {
      category,
      brand,
      attributes
    });

    // Get related searches
    const relatedSearches = await getRelatedSearches(query);

    // Get search filters
    const availableFilters = await getAvailableFilters(searchQuery);

    res.json({
      success: true,
      data: {
        query,
        products,
        suggestions,
        relatedSearches,
        filters: availableFilters,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        },
        searchMetadata: {
          totalResults: total,
          searchTime: Date.now(),
          appliedFilters: {
            category,
            subcategory,
            brand,
            minPrice,
            maxPrice,
            rating,
            inStock,
            featured,
            trending,
            tags,
            attributes
          }
        }
      }
    });

  } catch (error) {
    console.error('Advanced product search error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform search'
    });
  }
};

// @desc    Get search suggestions
// @route   GET /api/search/suggestions
// @access  Public
const getSearchSuggestions = async (req, res) => {
  try {
    const { q: query, limit = 10, type = 'all' } = req.query;

    if (!query || query.length < 2) {
      return res.json({
        success: true,
        data: {
          suggestions: []
        }
      });
    }

    const suggestions = await generateSearchSuggestions(query, {}, limit, type);

    res.json({
      success: true,
      data: {
        query,
        suggestions
      }
    });

  } catch (error) {
    console.error('Get search suggestions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get search suggestions'
    });
  }
};

// @desc    Get search history
// @route   GET /api/search/history
// @access  Private
const getSearchHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const { limit = 20 } = req.query;

    // This would typically be stored in a SearchHistory collection
    // For now, return mock data
    const searchHistory = [
      {
        query: 'wireless headphones',
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
        resultCount: 45
      },
      {
        query: 'smartphone cases',
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
        resultCount: 123
      },
      {
        query: 'laptop stands',
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        resultCount: 28
      }
    ];

    res.json({
      success: true,
      data: {
        history: searchHistory.slice(0, limit)
      }
    });

  } catch (error) {
    console.error('Get search history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get search history'
    });
  }
};

// @desc    Clear search history
// @route   DELETE /api/search/history
// @access  Private
const clearSearchHistory = async (req, res) => {
  try {
    const userId = req.user._id;

    // This would clear search history from database
    // For now, return success
    res.json({
      success: true,
      message: 'Search history cleared successfully'
    });

  } catch (error) {
    console.error('Clear search history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear search history'
    });
  }
};

// @desc    Get popular searches
// @route   GET /api/search/popular
// @access  Public
const getPopularSearches = async (req, res) => {
  try {
    const { limit = 10, category } = req.query;

    // This would typically get from a PopularSearches collection
    // For now, return mock data
    const popularSearches = [
      { query: 'wireless earbuds', count: 1250 },
      { query: 'smartphone', count: 980 },
      { query: 'laptop', count: 750 },
      { query: 'headphones', count: 650 },
      { query: 'tablet', count: 520 },
      { query: 'smart watch', count: 480 },
      { query: 'bluetooth speaker', count: 420 },
      { query: 'gaming mouse', count: 380 },
      { query: 'mechanical keyboard', count: 340 },
      { query: 'webcam', count: 290 }
    ];

    let filteredSearches = popularSearches;

    if (category) {
      // Filter by category context
      filteredSearches = popularSearches.filter(search =>
        search.query.includes(category.toLowerCase()) ||
        category.toLowerCase().includes(search.query)
      );
    }

    res.json({
      success: true,
      data: {
        popularSearches: filteredSearches.slice(0, limit)
      }
    });

  } catch (error) {
    console.error('Get popular searches error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get popular searches'
    });
  }
};

// @desc    Get related searches
// @route   GET /api/search/related
// @access  Public
// const getRelatedSearches = async (req, res) => {
//   try {
//     const { q: query, limit = 8 } = req.query;

//     if (!query) {
//       return res.status(400).json({
//         success: false,
//         error: 'Query is required'
//       });
//     }

//     const relatedSearches = await generateRelatedSearches(query, limit);

//     res.json({
//       success: true,
//       data: {
//         query,
//         relatedSearches
//       }
//     });

//   } catch (error) {
//     console.error('Get related searches error:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to get related searches'
//     });
//   }
// };

// @desc    Get search analytics
// @route   GET /api/search/analytics
// @access  Private (Admin)
const getSearchAnalytics = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin access required.'
      });
    }

    const { startDate, endDate, period = '30d' } = req.query;

    // Calculate date range
    const daysBack = parseInt(period.replace('d', ''));
    const start = startDate ? new Date(startDate) : new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000));
    const end = endDate ? new Date(endDate) : new Date();

    // This would typically get from a SearchAnalytics collection
    // For now, return mock data
    const analytics = {
      period: { start, end },
      summary: {
        totalSearches: 15420,
        uniqueUsers: 8934,
        averageResultsPerSearch: 23.5,
        noResultsSearches: 2340,
        popularQueries: [
          { query: 'wireless headphones', count: 1250 },
          { query: 'smartphone cases', count: 980 },
          { query: 'laptop stands', count: 750 }
        ]
      },
      trends: [
        { date: '2024-01-01', searches: 450 },
        { date: '2024-01-02', searches: 520 },
        { date: '2024-01-03', searches: 480 }
      ],
      categoryBreakdown: [
        { category: 'Electronics', searches: 5420 },
        { category: 'Clothing', searches: 3890 },
        { category: 'Home & Garden', searches: 3120 }
      ]
    };

    res.json({
      success: true,
      data: {
        analytics
      }
    });

  } catch (error) {
    console.error('Get search analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get search analytics'
    });
  }
};

// @desc    Get product recommendations
// @route   GET /api/search/recommendations
// @access  Public
const getProductRecommendations = async (req, res) => {
  try {
    const {
      productId,
      userId,
      type = 'personalized',
      limit = 10,
      category,
      excludeViewed = false
    } = req.query;

    let recommendations = [];

    switch (type) {
      case 'personalized':
        recommendations = await getPersonalizedRecommendations(userId, limit, category);
        break;

      case 'related':
        if (!productId) {
          return res.status(400).json({
            success: false,
            error: 'Product ID is required for related recommendations'
          });
        }
        recommendations = await getRelatedProducts(productId, limit, excludeViewed);
        break;

      case 'trending':
        recommendations = await getTrendingProducts(limit, category);
        break;

      case 'frequently_bought_together':
        if (!productId) {
          return res.status(400).json({
            success: false,
            error: 'Product ID is required for frequently bought together recommendations'
          });
        }
        recommendations = await getFrequentlyBoughtTogether(productId, limit);
        break;

      case 'similar':
        if (!productId) {
          return res.status(400).json({
            success: false,
            error: 'Product ID is required for similar recommendations'
          });
        }
        recommendations = await getSimilarProducts(productId, limit);
        break;

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid recommendation type'
        });
    }

    res.json({
      success: true,
      data: {
        type,
        recommendations,
        count: recommendations.length
      }
    });

  } catch (error) {
    console.error('Get product recommendations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get product recommendations'
    });
  }
};

// @desc    Get category suggestions
// @route   GET /api/search/categories
// @access  Public
const getCategorySuggestions = async (req, res) => {
  try {
    const { q: query, limit = 10 } = req.query;

    let queryBuilder = Category.find({ status: 'active' });

    if (query) {
      queryBuilder = queryBuilder.find({
        $or: [
          { name: { $regex: query, $options: 'i' } },
          { description: { $regex: query, $options: 'i' } }
        ]
      });
    }

    const categories = await queryBuilder
      .sort({ 'statistics.totalViews': -1 })
      .limit(limit)
      .select('name slug description image statistics.productCount');

    res.json({
      success: true,
      data: {
        categories
      }
    });

  } catch (error) {
    console.error('Get category suggestions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get category suggestions'
    });
  }
};

// @desc    Get brand suggestions
// @route   GET /api/search/brands
// @access  Public
const getBrandSuggestions = async (req, res) => {
  try {
    const { q: query, limit = 10 } = req.query;

    let matchStage = {};

    if (query) {
      matchStage.brand = { $regex: query, $options: 'i' };
    }

    const brands = await Product.aggregate([
      { $match: { status: 'active', visibility: 'public', ...matchStage } },
      { $group: { _id: '$brand', count: { $sum: 1 } } },
      { $match: { _id: { $ne: null, $ne: '' } } },
      { $sort: { count: -1 } },
      { $limit: limit }
    ]);

    res.json({
      success: true,
      data: {
        brands: brands.map(brand => ({
          name: brand._id,
          productCount: brand.count
        }))
      }
    });

  } catch (error) {
    console.error('Get brand suggestions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get brand suggestions'
    });
  }
};

// @desc    Search with AI assistance
// @route   POST /api/search/ai-assist
// @access  Public
const searchWithAIAssist = async (req, res) => {
  try {
    const { query, context, preferences = {} } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query is required'
      });
    }

    // Analyze query intent
    const intent = await analyzeQueryIntent(query, context);

    // Get AI-powered suggestions
    const aiSuggestions = await getAISuggestions(query, intent, preferences);

    // Get enhanced results
    const enhancedResults = await getEnhancedSearchResults(query, intent, preferences);

    // Get smart filters
    const smartFilters = await getSmartFilters(query, intent);

    res.json({
      success: true,
      data: {
        query,
        intent,
        suggestions: aiSuggestions,
        results: enhancedResults,
        filters: smartFilters,
        aiInsights: {
          searchIntent: intent,
          suggestedQueries: aiSuggestions.queries,
          recommendedFilters: smartFilters
        }
      }
    });

  } catch (error) {
    console.error('Search with AI assist error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform AI-assisted search'
    });
  }
};

// @desc    Get search filters
// @route   GET /api/search/filters
// @access  Public
const getSearchFilters = async (req, res) => {
  try {
    const { category, query } = req.query;

    const filters = await getAvailableFilters({ category, query });

    res.json({
      success: true,
      data: {
        filters
      }
    });

  } catch (error) {
    console.error('Get search filters error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get search filters'
    });
  }
};

// Helper functions
const buildLocationQuery = async (location, distance) => {
  try {
    // This would use geocoding service to convert location to coordinates
    // and build a geo query
    // For now, return a simple text match
    return { $regex: location, $options: 'i' };
  } catch (error) {
    return null;
  }
};

const generateSearchSuggestions = async (query, filters = {}, limit = 10, type = 'all') => {
  const suggestions = {
    products: [],
    categories: [],
    brands: [],
    queries: []
  };

  if (type === 'all' || type === 'products') {
    const productSuggestions = await Product.find({
      name: { $regex: query, $options: 'i' },
      status: 'active',
      visibility: 'public'
    })
    .limit(Math.ceil(limit / 4))
    .select('name slug')
    .sort({ 'statistics.views': -1 });

    suggestions.products = productSuggestions.map(p => ({
      text: p.name,
      type: 'product',
      slug: p.slug
    }));
  }

  if (type === 'all' || type === 'categories') {
    const categorySuggestions = await Category.find({
      name: { $regex: query, $options: 'i' },
      status: 'active'
    })
    .limit(Math.ceil(limit / 4))
    .select('name slug')
    .sort({ 'statistics.totalViews': -1 });

    suggestions.categories = categorySuggestions.map(c => ({
      text: c.name,
      type: 'category',
      slug: c.slug
    }));
  }

  if (type === 'all' || type === 'brands') {
    const brandSuggestions = await Product.distinct('brand', {
      brand: { $regex: query, $options: 'i' },
      status: 'active',
      visibility: 'public'
    });

    suggestions.brands = brandSuggestions
      .filter(brand => brand)
      .slice(0, Math.ceil(limit / 4))
      .map(brand => ({
        text: brand,
        type: 'brand'
      }));
  }

  if (type === 'all' || type === 'queries') {
    // Generate query suggestions based on popular searches
    const querySuggestions = await generateQuerySuggestions(query);
    suggestions.queries = querySuggestions.slice(0, limit);
  }

  return suggestions;
};

const generateQuerySuggestions = async (query) => {
  // This would use NLP to generate better query suggestions
  // For now, return simple variations
  const variations = [
    `${query} for sale`,
    `best ${query}`,
    `${query} reviews`,
    `cheap ${query}`,
    `${query} online`,
    `${query} price`,
    `where to buy ${query}`,
    `${query} comparison`
  ];

  return variations.map(variation => ({
    text: variation,
    type: 'query'
  }));
};

const getRelatedSearches = async (query, limit = 8) => {
  // This would find related searches from search history/analytics
  // For now, return mock data
  const relatedQueries = {
    'wireless headphones': ['bluetooth earbuds', 'wireless earphones', 'noise cancelling headphones'],
    'smartphone': ['android phone', 'iphone', 'mobile phone'],
    'laptop': ['notebook computer', 'portable computer', 'ultrabook']
  };

  return relatedQueries[query.toLowerCase()] || [];
};

const getAvailableFilters = async (baseQuery = {}) => {
  try {
    const filters = {
      categories: [],
      brands: [],
      priceRanges: [],
      ratings: [],
      attributes: []
    };

    // Get categories
    const categories = await Category.find({ status: 'active' })
      .select('name slug')
      .sort({ name: 1 });
    filters.categories = categories;

    // Get brands
    const brands = await Product.distinct('brand', {
      status: 'active',
      visibility: 'public',
      brand: { $ne: null, $ne: '' }
    });
    filters.brands = brands.filter(brand => brand).sort();

    // Get price ranges
    const priceStats = await Product.aggregate([
      { $match: { status: 'active', visibility: 'public' } },
      {
        $group: {
          _id: null,
          minPrice: { $min: '$price' },
          maxPrice: { $max: '$price' }
        }
      }
    ]);

    if (priceStats.length > 0) {
      const { minPrice, maxPrice } = priceStats[0];
      const ranges = [
        { min: 0, max: 25, label: 'Under $25' },
        { min: 25, max: 50, label: '$25 - $50' },
        { min: 50, max: 100, label: '$50 - $100' },
        { min: 100, max: 200, label: '$100 - $200' },
        { min: 200, max: 500, label: '$200 - $500' },
        { min: 500, max: null, label: 'Over $500' }
      ];

      filters.priceRanges = ranges.filter(range =>
        (range.max === null || range.min <= maxPrice) &&
        (range.min <= minPrice || range.max === null)
      );
    }

    // Get ratings
    filters.ratings = [5, 4, 3, 2, 1];

    // Get common attributes
    const attributes = await Product.distinct('attributes.name', {
      status: 'active',
      visibility: 'public'
    });
    filters.attributes = attributes.filter(attr => attr).sort();

    return filters;

  } catch (error) {
    console.error('Get available filters error:', error);
    return {};
  }
};

const getPersonalizedRecommendations = async (userId, limit, category) => {
  try {
    if (!userId) {
      // Return trending products for anonymous users
      return await getTrendingProducts(limit, category);
    }

    const user = await User.findById(userId);

    // Get user's preferences
    const favoriteCategories = user.shopping.favoriteCategories;
    const recentlyViewed = user.shopping.recentlyViewed;
    const wishlist = user.shopping.wishList;

    let recommendations = [];

    // Recommend products from favorite categories
    if (favoriteCategories.length > 0) {
      const categoryProducts = await Product.find({
        category: { $in: favoriteCategories },
        status: 'active',
        visibility: 'public'
      })
      .limit(Math.ceil(limit / 3))
      .select('name slug price images rating')
      .sort({ 'statistics.views': -1 });

      recommendations.push(...categoryProducts);
    }

    // Recommend products similar to recently viewed
    if (recentlyViewed.length > 0) {
      const recentProductIds = recentlyViewed.map(item => item.product);
      const recentProducts = await Product.find({ _id: { $in: recentProductIds } });

      for (const product of recentProducts.slice(0, 3)) {
        const similarProducts = await Product.find({
          category: product.category,
          _id: { $ne: product._id },
          status: 'active',
          visibility: 'public'
        })
        .limit(2)
        .select('name slug price images rating');

        recommendations.push(...similarProducts);
      }
    }

    // Recommend products from wishlist categories
    if (wishlist.length > 0) {
      const wishlistProductIds = wishlist.map(item => item.product);
      const wishlistProducts = await Product.find({ _id: { $in: wishlistProductIds } });

      for (const product of wishlistProducts.slice(0, 2)) {
        const relatedProducts = await Product.find({
          category: product.category,
          _id: { $ne: product._id },
          status: 'active',
          visibility: 'public'
        })
        .limit(2)
        .select('name slug price images rating');

        recommendations.push(...relatedProducts);
      }
    }

    // Remove duplicates and limit
    const uniqueRecommendations = recommendations
      .filter((product, index, self) =>
        index === self.findIndex(p => p._id.toString() === product._id.toString())
      )
      .slice(0, limit);

    return uniqueRecommendations;

  } catch (error) {
    console.error('Get personalized recommendations error:', error);
    return [];
  }
};

const getRelatedProducts = async (productId, limit, excludeViewed = false) => {
  try {
    const product = await Product.findById(productId);
    if (!product) return [];

    const relatedProducts = await Product.find({
      category: product.category,
      _id: { $ne: product._id },
      status: 'active',
      visibility: 'public'
    })
    .limit(limit)
    .select('name slug price images rating')
    .sort({ 'statistics.views': -1 });

    return relatedProducts;

  } catch (error) {
    console.error('Get related products error:', error);
    return [];
  }
};

const getTrendingProducts = async (limit, category) => {
  try {
    let query = {
      trending: true,
      status: 'active',
      visibility: 'public'
    };

    if (category) {
      query.category = category;
    }

    const products = await Product.find(query)
      .limit(limit)
      .select('name slug price images rating')
      .sort({ 'statistics.views': -1 });

    return products;

  } catch (error) {
    console.error('Get trending products error:', error);
    return [];
  }
};

const getFrequentlyBoughtTogether = async (productId, limit) => {
  try {
    // This would analyze order data to find frequently bought together products
    // For now, return related products
    return await getRelatedProducts(productId, limit);

  } catch (error) {
    console.error('Get frequently bought together error:', error);
    return [];
  }
};

const getSimilarProducts = async (productId, limit) => {
  try {
    const product = await Product.findById(productId);
    if (!product) return [];

    const similarProducts = await Product.find({
      $or: [
        { brand: product.brand },
        { tags: { $in: product.tags } }
      ],
      _id: { $ne: product._id },
      status: 'active',
      visibility: 'public'
    })
    .limit(limit)
    .select('name slug price images rating');

    return similarProducts;

  } catch (error) {
    console.error('Get similar products error:', error);
    return [];
  }
};

const analyzeQueryIntent = async (query, context) => {
  try {
    // Simple intent analysis based on keywords
    const lowerQuery = query.toLowerCase();

    if (lowerQuery.includes('buy') || lowerQuery.includes('purchase') || lowerQuery.includes('price')) {
      return 'purchase_intent';
    }

    if (lowerQuery.includes('review') || lowerQuery.includes('rating') || lowerQuery.includes('opinion')) {
      return 'review_intent';
    }

    if (lowerQuery.includes('compare') || lowerQuery.includes('vs') || lowerQuery.includes('versus')) {
      return 'comparison_intent';
    }

    if (lowerQuery.includes('best') || lowerQuery.includes('top') || lowerQuery.includes('recommended')) {
      return 'recommendation_intent';
    }

    if (lowerQuery.includes('cheap') || lowerQuery.includes('affordable') || lowerQuery.includes('budget')) {
      return 'budget_intent';
    }

    return 'general_search';

  } catch (error) {
    return 'general_search';
  }
};

const getAISuggestions = async (query, intent, preferences) => {
  try {
    const suggestions = {
      queries: [],
      products: [],
      categories: []
    };

    // Generate contextual query suggestions based on intent
    switch (intent) {
      case 'purchase_intent':
        suggestions.queries = [
          `${query} for sale`,
          `best deals on ${query}`,
          `${query} price comparison`
        ];
        break;

      case 'review_intent':
        suggestions.queries = [
          `${query} reviews`,
          `${query} user ratings`,
          `is ${query} worth buying`
        ];
        break;

      case 'comparison_intent':
        suggestions.queries = [
          `${query} vs alternatives`,
          `best ${query} 2024`,
          `${query} comparison guide`
        ];
        break;

      default:
        suggestions.queries = [
          `${query} reviews`,
          `best ${query}`,
          `${query} guide`
        ];
    }

    // Get product suggestions
    const productSuggestions = await Product.find({
      name: { $regex: query, $options: 'i' },
      status: 'active',
      visibility: 'public'
    })
    .limit(3)
    .select('name slug price rating');

    suggestions.products = productSuggestions;

    // Get category suggestions
    const categorySuggestions = await Category.find({
      name: { $regex: query, $options: 'i' },
      status: 'active'
    })
    .limit(2)
    .select('name slug');

    suggestions.categories = categorySuggestions;

    return suggestions;

  } catch (error) {
    return { queries: [], products: [], categories: [] };
  }
};

const getEnhancedSearchResults = async (query, intent, preferences) => {
  try {
    // Enhanced search with intent-based boosting
    let boostField = 'statistics.views';
    let boostValue = 1;

    switch (intent) {
      case 'purchase_intent':
        boostField = 'statistics.conversions';
        boostValue = 2;
        break;
      case 'review_intent':
        boostField = 'rating.average';
        boostValue = 1.5;
        break;
      case 'recommendation_intent':
        boostField = 'featured';
        boostValue = 2;
        break;
    }

    const products = await Product.find({
      $or: [
        { $text: { $search: query } },
        { name: { $regex: query, $options: 'i' } }
      ],
      status: 'active',
      visibility: 'public'
    })
    .populate('category', 'name slug')
    .select('name slug sku price images rating category')
    .sort({ [boostField]: -1 })
    .limit(20);

    return products;

  } catch (error) {
    return [];
  }
};

const getSmartFilters = async (query, intent) => {
  try {
    const filters = {};

    // Intent-based filter suggestions
    switch (intent) {
      case 'purchase_intent':
        filters.priceRanges = [
          { min: 0, max: 100, label: 'Budget Options' },
          { min: 100, max: 500, label: 'Mid-Range' },
          { min: 500, max: null, label: 'Premium' }
        ];
        filters.sortOptions = [
          { value: 'price', label: 'Price: Low to High' },
          { value: 'rating', label: 'Highest Rated' }
        ];
        break;

      case 'review_intent':
        filters.ratings = [5, 4, 3];
        filters.sortOptions = [
          { value: 'rating', label: 'Highest Rated' },
          { value: 'createdAt', label: 'Most Recent' }
        ];
        break;

      case 'comparison_intent':
        filters.brands = await Product.distinct('brand', {
          status: 'active',
          visibility: 'public',
          brand: { $ne: null, $ne: '' }
        });
        filters.sortOptions = [
          { value: 'price', label: 'Price Comparison' },
          { value: 'rating', label: 'Best Rated' }
        ];
        break;

      default:
        filters.sortOptions = [
          { value: 'relevance', label: 'Most Relevant' },
          { value: 'price', label: 'Price: Low to High' },
          { value: 'rating', label: 'Highest Rated' }
        ];
    }

    return filters;

  } catch (error) {
    return {};
  }
};

const generateRelatedSearches = async (query, limit) => {
  try {
    // Use query analysis to find related searches
    const words = query.toLowerCase().split(' ');
    const relatedQueries = [];

    // Find products with similar words
    const relatedProducts = await Product.find({
      $or: words.map(word => ({
        name: { $regex: word, $options: 'i' }
      })),
      status: 'active',
      visibility: 'public'
    })
    .limit(limit * 2)
    .select('name');

    // Extract unique related terms
    const relatedTerms = new Set();
    relatedProducts.forEach(product => {
      const productWords = product.name.toLowerCase().split(' ');
      productWords.forEach(word => {
        if (word.length > 3 && !words.includes(word)) {
          relatedTerms.add(word);
        }
      });
    });

    return Array.from(relatedTerms).slice(0, limit);

  } catch (error) {
    return [];
  }
};

module.exports = {
  advancedProductSearch,
  getSearchSuggestions,
  getSearchHistory,
  clearSearchHistory,
  getPopularSearches,
  getRelatedSearches,
  getSearchAnalytics,
  getProductRecommendations,
  getCategorySuggestions,
  getBrandSuggestions,
  searchWithAIAssist,
  getSearchFilters
};
