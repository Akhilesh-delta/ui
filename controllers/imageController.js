const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const Product = require('../models/Product');
const { authenticate, requireVendorOrAdmin, sanitizeInput } = require('../middleware/authMiddleware');

// Configure Cloudinary storage
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'ecommerce-products',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    transformation: [{ width: 1000, height: 1000, crop: 'limit' }]
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 10 // Maximum 10 files
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// @desc    Add product images
// @route   POST /api/products/:id/images
// @access  Private (Vendor/Admin)
const addProductImages = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide image files'
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
    if (product.images.length + req.files.length > maxImages) {
      return res.status(400).json({
        success: false,
        error: `Maximum ${maxImages} images allowed per product`
      });
    }

    // Process uploaded images
    const processedImages = [];

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];

      // Generate alt text
      const altText = req.body.alt ? req.body.alt[i] : `${product.name} - Image ${product.images.length + i + 1}`;

      // Check if this should be primary image
      const isPrimary = req.body.isPrimary ?
        req.body.isPrimary[i] === 'true' :
        (product.images.length === 0 && i === 0);

      // Get image metadata
      const metadata = {
        originalName: file.originalname,
        size: file.size,
        format: file.format,
        width: file.width,
        height: file.height,
        publicId: file.filename
      };

      processedImages.push({
        url: file.path, // Cloudinary URL
        alt: sanitizeInput(altText),
        isPrimary: isPrimary,
        order: product.images.length + i,
        metadata: metadata
      });
    }

    // Add images to product
    product.images.push(...processedImages);

    // If this is the first image, make it primary
    if (product.images.length === processedImages.length) {
      product.images[0].isPrimary = true;
    }

    await product.save();

    res.status(201).json({
      success: true,
      message: 'Images added successfully',
      data: {
        images: processedImages.map(img => ({
          id: img._id,
          url: img.url,
          alt: img.alt,
          isPrimary: img.isPrimary,
          order: img.order,
          metadata: img.metadata
        }))
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

    // Find image
    const image = product.images.id(imageId);
    if (!image) {
      return res.status(404).json({
        success: false,
        error: 'Image not found'
      });
    }

    // Delete from Cloudinary if public ID exists
    if (image.metadata?.publicId) {
      try {
        await cloudinary.uploader.destroy(image.metadata.publicId);
      } catch (cloudinaryError) {
        console.error('Failed to delete image from Cloudinary:', cloudinaryError);
        // Don't fail the request if Cloudinary deletion fails
      }
    }

    // Remove image from product
    product.images.pull(imageId);

    // If removed image was primary and there are other images, set new primary
    if (image.isPrimary && product.images.length > 0) {
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
          id: image._id,
          url: image.url,
          alt: image.alt
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

// @desc    Get upload signature for direct upload to Cloudinary
// @route   GET /api/products/upload-signature
// @access  Private (Vendor/Admin)
const getUploadSignature = async (req, res) => {
  try {
    const timestamp = Math.round((new Date).getTime() / 1000);
    const signature = cloudinary.utils.api_sign_request(
      {
        timestamp: timestamp,
        folder: 'ecommerce-products',
        allowed_formats: 'jpg,jpeg,png,gif,webp'
      },
      process.env.CLOUDINARY_API_SECRET
    );

    res.json({
      success: true,
      data: {
        signature,
        timestamp,
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        apiKey: process.env.CLOUDINARY_API_KEY,
        folder: 'ecommerce-products',
        allowedFormats: ['jpg', 'jpeg', 'png', 'gif', 'webp']
      }
    });

  } catch (error) {
    console.error('Get upload signature error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get upload signature'
    });
  }
};

module.exports = {
  addProductImages,
  removeProductImage,
  setPrimaryImage,
  getUploadSignature,
  upload
};
