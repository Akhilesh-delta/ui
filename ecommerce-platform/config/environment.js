require('dotenv').config();

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 5000,
  
  // Database
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce-platform',
  
  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
  JWT_EXPIRE: process.env.JWT_EXPIRE || '30d',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key',
  JWT_REFRESH_EXPIRE: process.env.JWT_REFRESH_EXPIRE || '7d',
  
  // Session
  SESSION_SECRET: process.env.SESSION_SECRET || 'your-session-secret-key',
  
  // Cloudinary
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  
  // Stripe
  STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  
  // AWS S3 (for file storage)
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
  S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
  
  // Email service
  EMAIL_SERVICE: process.env.EMAIL_SERVICE || 'gmail',
  EMAIL_USER: process.env.EMAIL_USER,
  EMAIL_PASS: process.env.EMAIL_PASS,
  
  // SMS service
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
  
  // Redis (for caching)
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  
  // Elasticsearch (for advanced search)
  ELASTICSEARCH_URL: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
  
  // Amazon API
  AMAZON_ACCESS_KEY: process.env.AMAZON_ACCESS_KEY,
  AMAZON_SECRET_KEY: process.env.AMAZON_SECRET_KEY,
  AMAZON_ASSOCIATE_ID: process.env.AMAZON_ASSOCIATE_ID,
  AMAZON_MARKETPLACE_ID: process.env.AMAZON_MARKETPLACE_ID,
  
  // PayPal
  PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
  PAYPAL_MODE: process.env.PAYPAL_MODE || 'sandbox',
  
  // Google APIs
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
  
  // Facebook APIs
  FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID,
  FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET,
  
  // Rate limiting
  RATE_LIMIT_WINDOW: process.env.RATE_LIMIT_WINDOW || 15 * 60 * 1000,
  RATE_LIMIT_MAX_REQUESTS: process.env.RATE_LIMIT_MAX_REQUESTS || 1000,
  
  // File upload limits
  MAX_FILE_SIZE: process.env.MAX_FILE_SIZE || 50 * 1024 * 1024, // 50MB
  ALLOWED_FILE_TYPES: process.env.ALLOWED_FILE_TYPES || 'image/jpeg,image/png,image/gif,image/webp,application/pdf',
  
  // Admin settings
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  
  // Security
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS) || 12,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'your-32-character-encryption-key!!',
  
  // API Keys
  WEATHER_API_KEY: process.env.WEATHER_API_KEY,
  CURRENCY_API_KEY: process.env.CURRENCY_API_KEY,
  GEO_LOCATION_API_KEY: process.env.GEO_LOCATION_API_KEY,
  
  // Notification services
  ONESIGNAL_APP_ID: process.env.ONESIGNAL_APP_ID,
  ONESIGNAL_REST_API_KEY: process.env.ONESIGNAL_REST_API_KEY,
  FIREBASE_SERVER_KEY: process.env.FIREBASE_SERVER_KEY,
  
  // Analytics
  GOOGLE_ANALYTICS_ID: process.env.GOOGLE_ANALYTICS_ID,
  MIXPANEL_TOKEN: process.env.MIXPANEL_TOKEN,
  
  // Cache settings
  CACHE_TTL: parseInt(process.env.CACHE_TTL) || 3600, // 1 hour
  CACHE_MAX_SIZE: parseInt(process.env.CACHE_MAX_SIZE) || 1000,
  
  // Pagination defaults
  DEFAULT_PAGE_SIZE: parseInt(process.env.DEFAULT_PAGE_SIZE) || 20,
  MAX_PAGE_SIZE: parseInt(process.env.MAX_PAGE_SIZE) || 100,
  
  // WebRTC settings
  WEBRTC_ICE_SERVERS: process.env.WEBRTC_ICE_SERVERS || '[{"urls": "stun:stun.l.google.com:19302"}]',
  
  // Chat settings
  MAX_CHAT_MESSAGE_LENGTH: parseInt(process.env.MAX_CHAT_MESSAGE_LENGTH) || 1000,
  CHAT_RETENTION_DAYS: parseInt(process.env.CHAT_RETENTION_DAYS) || 90,
  
  // Order settings
  MAX_ORDER_ITEMS: parseInt(process.env.MAX_ORDER_ITEMS) || 50,
  ORDER_TIMEOUT_MINUTES: parseInt(process.env.ORDER_TIMEOUT_MINUTES) || 30,
  
  // Vendor settings
  VENDOR_COMMISSION_RATE: parseFloat(process.env.VENDOR_COMMISSION_RATE) || 0.10,
  VENDOR_MIN_WITHDRAWAL: parseFloat(process.env.VENDOR_MIN_WITHDRAWAL) || 50,
  VENDOR_MAX_WITHDRAWAL: parseFloat(process.env.VENDOR_MAX_WITHDRAWAL) || 10000,
  
  // Product settings
  MAX_PRODUCT_IMAGES: parseInt(process.env.MAX_PRODUCT_IMAGES) || 10,
  MAX_PRODUCT_VARIANTS: parseInt(process.env.MAX_PRODUCT_VARIANTS) || 100,
  PRODUCT_NAME_MAX_LENGTH: parseInt(process.env.PRODUCT_NAME_MAX_LENGTH) || 200,
  PRODUCT_DESCRIPTION_MAX_LENGTH: parseInt(process.env.PRODUCT_DESCRIPTION_MAX_LENGTH) || 5000,
};
