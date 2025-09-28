const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      // Connection options for better performance and reliability
      maxPoolSize: 20, // Maintain up to 20 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      bufferCommands: false, // Disable mongoose buffering
      bufferMaxEntries: 0, // Disable mongoose buffering
      useNewUrlParser: true,
      useUnifiedTopology: true,
      retryWrites: true,
      w: 'majority',
      maxIdleTimeMS: 30000,
      compressors: 'zlib',
      zlibCompressionLevel: 6
    });

    logger.info(`MongoDB Connected: ${conn.connection.host}`);

    // Connection event listeners
    mongoose.connection.on('connected', () => {
      logger.info('Mongoose connected to MongoDB');
    });

    mongoose.connection.on('error', (err) => {
      logger.error('Mongoose connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('Mongoose disconnected from MongoDB');
    });

    // Handle application termination
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      logger.info('Mongoose connection closed due to app termination');
    });

    // Enable mongoose debug mode in development
    if (process.env.NODE_ENV === 'development') {
      mongoose.set('debug', (collectionName, method, query, doc) => {
        logger.debug(`${collectionName}.${method}`, { query, doc });
      });
    }

    return conn;
  } catch (error) {
    logger.error('Error connecting to MongoDB:', error.message);

    // Retry connection with exponential backoff
    const retryConnection = async (attempt = 1, maxAttempts = 5) => {
      const delay = Math.min(1000 * Math.pow(2, attempt), 30000); // Max 30 seconds

      logger.info(`Retrying MongoDB connection in ${delay}ms (attempt ${attempt}/${maxAttempts})`);

      setTimeout(async () => {
        try {
          await connectDB();
        } catch (retryError) {
          if (attempt < maxAttempts) {
            await retryConnection(attempt + 1, maxAttempts);
          } else {
            logger.error('Max retry attempts reached. Could not connect to MongoDB');
            process.exit(1);
          }
        }
      }, delay);
    };

    if (process.env.NODE_ENV === 'production') {
      await retryConnection();
    } else {
      throw error;
    }
  }
};

// Database health check
const checkDatabaseHealth = async () => {
  try {
    const start = Date.now();
    await mongoose.connection.db.admin().ping();
    const responseTime = Date.now() - start;

    return {
      status: 'healthy',
      responseTime,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Database health check failed:', error);
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
};

// Get database statistics
const getDatabaseStats = async () => {
  try {
    const db = mongoose.connection.db;
    const stats = await db.stats();

    return {
      collections: stats.collections,
      dataSize: stats.dataSize,
      storageSize: stats.storageSize,
      indexes: stats.indexes,
      indexSize: stats.indexSize,
      objects: stats.objects,
      avgObjSize: stats.avgObjSize,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Error getting database stats:', error);
    return null;
  }
};

// Optimize database performance
const optimizeDatabase = async () => {
  try {
    const db = mongoose.connection.db;

    // Rebuild indexes for better performance
    const collections = await db.collections();
    for (const collection of collections) {
      try {
        await collection.reIndex();
        logger.info(`Reindexed collection: ${collection.collectionName}`);
      } catch (error) {
        logger.warn(`Failed to reindex collection ${collection.collectionName}:`, error.message);
      }
    }

    // Update collection statistics
    await db.command({ dbStats: 1 });

    logger.info('Database optimization completed');
  } catch (error) {
    logger.error('Error optimizing database:', error);
  }
};

// Backup database (for development/testing)
const backupDatabase = async () => {
  try {
    const db = mongoose.connection.db;
    const collections = await db.collections();

    const backup = {};
    for (const collection of collections) {
      const data = await collection.find({}).toArray();
      backup[collection.collectionName] = data;
    }

    const fs = require('fs').promises;
    const path = require('path');

    const backupDir = path.join(__dirname, '../backups');
    await fs.mkdir(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `backup-${timestamp}.json`);

    await fs.writeFile(backupPath, JSON.stringify(backup, null, 2));
    logger.info(`Database backup created: ${backupPath}`);

    return backupPath;
  } catch (error) {
    logger.error('Error creating database backup:', error);
    throw error;
  }
};

// Restore database from backup
const restoreDatabase = async (backupPath) => {
  try {
    const fs = require('fs').promises;
    const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));

    const db = mongoose.connection.db;

    for (const [collectionName, data] of Object.entries(backup)) {
      const collection = db.collection(collectionName);

      // Clear existing data
      await collection.deleteMany({});

      // Insert backup data
      if (data.length > 0) {
        await collection.insertMany(data);
      }

      logger.info(`Restored collection: ${collectionName} (${data.length} documents)`);
    }

    logger.info('Database restore completed');
  } catch (error) {
    logger.error('Error restoring database:', error);
    throw error;
  }
};

// Clean up old data
const cleanupOldData = async (daysOld = 30) => {
  try {
    const db = mongoose.connection.db;
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    const collections = await db.collections();
    let totalDeleted = 0;

    for (const collection of collections) {
      // Define cleanup rules based on collection name
      let query = {};

      if (collection.collectionName.includes('logs')) {
        query.createdAt = { $lt: cutoffDate };
      } else if (collection.collectionName.includes('temp')) {
        query.createdAt = { $lt: cutoffDate };
      } else if (collection.collectionName.includes('sessions')) {
        query.expires = { $lt: new Date() };
      }

      if (Object.keys(query).length > 0) {
        const result = await collection.deleteMany(query);
        totalDeleted += result.deletedCount;
        if (result.deletedCount > 0) {
          logger.info(`Cleaned up ${result.deletedCount} documents from ${collection.collectionName}`);
        }
      }
    }

    logger.info(`Database cleanup completed. Total documents deleted: ${totalDeleted}`);
    return totalDeleted;
  } catch (error) {
    logger.error('Error cleaning up old data:', error);
    throw error;
  }
};

module.exports = {
  connectDB,
  checkDatabaseHealth,
  getDatabaseStats,
  optimizeDatabase,
  backupDatabase,
  restoreDatabase,
  cleanupOldData
};
