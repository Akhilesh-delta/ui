const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Import custom middleware and services
const { errorHandler } = require('./middleware/errorHandler');
const { requestLogger } = require('./middleware/requestLogger');
const { securityHeaders } = require('./middleware/securityHeaders');
const { initializeSocketIO } = require('./services/socketService');
const { initializeWebRTC } = require('./services/webrtcService');
const { startMetricsServer } = require('./services/metricsService');
const { initializeQueue } = require('./services/queueService');
const { initializeCache } = require('./services/cacheService');
const { scheduleJobs } = require('./services/schedulerService');

// Import routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const productRoutes = require('./routes/productRoutes');
const vendorRoutes = require('./routes/vendorRoutes');
const orderRoutes = require('./routes/orderRoutes');
const cartRoutes = require('./routes/cartRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const adminRoutes = require('./routes/adminRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const chatRoutes = require('./routes/chatRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');

// Import database connection
const connectDB = require('./config/database');

// Import logger
const logger = require('./utils/logger');

class EcommerceServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, {
      cors: {
        origin: process.env.CLIENT_URL || "http://localhost:3000",
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
        credentials: true
      },
      maxHttpBufferSize: 1e8, // 100MB for file uploads
      pingTimeout: 60000,
      pingInterval: 25000
    });

    this.port = process.env.PORT || 5000;
    this.isProduction = process.env.NODE_ENV === 'production';

    this.initializeMiddleware();
    this.initializeDatabase();
    this.initializeRoutes();
    this.initializeSocketHandlers();
    this.initializeServices();
    this.initializeErrorHandling();
    this.initializeGracefulShutdown();
  }

  initializeMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "https://api.stripe.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false
    }));

    // CORS configuration
    this.app.use(cors({
      origin: (origin, callback) => {
        const allowedOrigins = process.env.ALLOWED_ORIGINS ?
          process.env.ALLOWED_ORIGINS.split(',') :
          ['http://localhost:3000', 'http://localhost:3001'];

        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-client-id']
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: this.isProduction ? 100 : 1000, // limit each IP to 100 requests per windowMs
      message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: Math.ceil(15 * 60 / 1000)
      },
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        res.status(429).json({
          error: 'Too many requests from this IP, please try again later.',
          retryAfter: Math.ceil(15 * 60 / 1000)
        });
      }
    });

    this.app.use('/api/', limiter);

    // Stricter rate limiting for auth routes
    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 5, // 5 attempts per 15 minutes
      message: {
        error: 'Too many authentication attempts, please try again later.',
        retryAfter: Math.ceil(15 * 60 / 5)
      }
    });

    this.app.use('/api/auth/', authLimiter);

    // Body parsing middleware
    this.app.use(express.json({
      limit: '50mb',
      verify: (req, res, buf) => {
        req.rawBody = buf;
      }
    }));

    this.app.use(express.urlencoded({
      extended: true,
      limit: '50mb'
    }));

    // Cookie and session middleware
    this.app.use(cookieParser(process.env.COOKIE_SECRET || 'your-secret-key'));

    this.app.use(session({
      secret: process.env.SESSION_SECRET || 'your-session-secret',
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        ttl: 24 * 60 * 60, // 1 day
        autoRemove: 'native'
      }),
      cookie: {
        secure: this.isProduction,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 1 day
        sameSite: 'strict'
      }
    }));

    // Compression middleware
    this.app.use(compression({
      level: 6,
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      }
    }));

    // Logging middleware
    if (this.isProduction) {
      this.app.use(morgan('combined', {
        stream: { write: message => logger.info(message.trim()) }
      }));
    } else {
      this.app.use(morgan('dev'));
    }

    // Custom middleware
    this.app.use(requestLogger);
    this.app.use(securityHeaders);

    // Static file serving
    this.app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
    this.app.use('/public', express.static(path.join(__dirname, 'public')));

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.env.npm_package_version || '1.0.0'
      });
    });

    // API info endpoint
    this.app.get('/api', (req, res) => {
      res.status(200).json({
        name: 'Multi-Vendor E-commerce API',
        version: '1.0.0',
        description: 'Comprehensive e-commerce platform with multi-vendor support',
        documentation: '/api-docs',
        features: [
          'User Management & Authentication',
          'Multi-Vendor Marketplace',
          'Product Catalog',
          'Shopping Cart & Checkout',
          'Payment Processing (Stripe)',
          'Order Management',
          'Real-time Notifications',
          'Live Chat Support',
          'Video Calls (WebRTC)',
          'File Upload & Management',
          'Admin Dashboard',
          'Analytics & Reporting',
          'Review & Rating System',
          'Inventory Management',
          'Multi-language Support',
          'Multi-currency Support',
          'Mobile Responsive'
        ]
      });
    });
  }

  async initializeDatabase() {
    try {
      await connectDB();
      logger.info('Database connected successfully');

      // Run database migrations if needed
      if (process.env.RUN_MIGRATIONS === 'true') {
        const { runMigrations } = require('./scripts/migrateDatabase');
        await runMigrations();
      }
    } catch (error) {
      logger.error('Database connection failed:', error);
      process.exit(1);
    }
  }

  initializeRoutes() {
    // API routes
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/users', userRoutes);
    this.app.use('/api/products', productRoutes);
    this.app.use('/api/vendors', vendorRoutes);
    this.app.use('/api/orders', orderRoutes);
    this.app.use('/api/cart', cartRoutes);
    this.app.use('/api/payments', paymentRoutes);
    this.app.use('/api/admin', adminRoutes);
    this.app.use('/api/notifications', notificationRoutes);
    this.app.use('/api/reviews', reviewRoutes);
    this.app.use('/api/chat', chatRoutes);

    // API documentation
    if (process.env.NODE_ENV === 'development') {
      const swaggerUi = require('swagger-ui-express');
      const swaggerSpec = require('./config/swagger');
      this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    }

    // Catch-all handler for undefined routes
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Route not found',
        message: `Cannot ${req.method} ${req.originalUrl}`,
        availableRoutes: {
          auth: '/api/auth/*',
          users: '/api/users/*',
          products: '/api/products/*',
          vendors: '/api/vendors/*',
          orders: '/api/orders/*',
          cart: '/api/cart/*',
          payments: '/api/payments/*',
          admin: '/api/admin/*',
          notifications: '/api/notifications/*',
          reviews: '/api/reviews/*',
          chat: '/api/chat/*'
        }
      });
    });
  }

  initializeSocketHandlers() {
    // Initialize Socket.IO
    initializeSocketIO(this.io);

    // Initialize WebRTC
    initializeWebRTC(this.io);

    this.io.on('connection', (socket) => {
      logger.info(`New client connected: ${socket.id}`);

      socket.on('disconnect', (reason) => {
        logger.info(`Client disconnected: ${socket.id}, reason: ${reason}`);
      });

      socket.on('error', (error) => {
        logger.error(`Socket error for ${socket.id}:`, error);
      });
    });
  }

  async initializeServices() {
    try {
      // Initialize Redis cache
      await initializeCache();

      // Initialize job queue
      await initializeQueue();

      // Schedule background jobs
      scheduleJobs();

      // Start metrics server
      if (process.env.ENABLE_METRICS === 'true') {
        startMetricsServer();
      }

      logger.info('All services initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize services:', error);
    }
  }

  initializeErrorHandling() {
    // Global error handler
    this.app.use(errorHandler);

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (err, promise) => {
      logger.error('Unhandled Promise Rejection:', err.message);
      logger.error('Promise:', promise);
      // Close server gracefully
      this.server.close(() => {
        process.exit(1);
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception:', err.message);
      logger.error('Stack:', err.stack);
      process.exit(1);
    });

    // Handle SIGTERM
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully');
      this.server.close(() => {
        process.exit(0);
      });
    });

    // Handle SIGINT
    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down gracefully');
      this.server.close(() => {
        process.exit(0);
      });
    });
  }

  initializeGracefulShutdown() {
    const shutdown = async (signal) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);

      // Close HTTP server
      this.server.close(async () => {
        logger.info('HTTP server closed');

        // Close database connections
        await mongoose.connection.close();
        logger.info('Database connection closed');

        // Close Redis connections
        const { closeCache } = require('./services/cacheService');
        await closeCache();

        // Close queue connections
        const { closeQueue } = require('./services/queueService');
        await closeQueue();

        logger.info('Graceful shutdown completed');
        process.exit(0);
      });

      // Force close server after 10 seconds
      setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  async start() {
    try {
      this.server.listen(this.port, () => {
        logger.info(`🚀 Multi-Vendor E-commerce API Server running on port ${this.port}`);
        logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        logger.info(`🔗 API Base URL: http://localhost:${this.port}/api`);
        logger.info(`📚 API Documentation: http://localhost:${this.port}/api-docs`);
        logger.info(`❤️ Health Check: http://localhost:${this.port}/health`);
      });

      // Initialize Passport
      this.app.use(passport.initialize());
      this.app.use(passport.session());

      // Initialize authentication strategies
      require('./config/passport');

    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }
}

// Create and start the server
const server = new EcommerceServer();
server.start().catch(error => {
  logger.error('Server startup failed:', error);
  process.exit(1);
});

module.exports = server;
