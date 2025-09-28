const socketIo = require('socket.io');
const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Notification = require('../models/Notification');
const Chat = require('../models/Chat');
const logger = require('../utils/logger');

class RealTimeService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map();
    this.userRooms = new Map();
    this.activeChats = new Map();
    this.typingUsers = new Map();
  }

  // Initialize Socket.IO
  initialize(server) {
    this.io = socketIo(server, {
      cors: {
        origin: process.env.CLIENT_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
      },
      maxHttpBufferSize: 1e8, // 100MB for file uploads
      pingTimeout: 60000,
      pingInterval: 25000
    });

    this.setupConnectionHandlers();
    this.setupChatHandlers();
    this.setupNotificationHandlers();
    this.setupOrderHandlers();
    this.setupProductHandlers();
    this.setupWebRTCHandlers();
    this.setupPresenceHandlers();

    logger.info('Real-time service initialized');
  }

  // ===============================
  // CONNECTION MANAGEMENT
  // ===============================

  setupConnectionHandlers() {
    this.io.on('connection', (socket) => {
      logger.info(`User connected: ${socket.id}`);

      socket.on('authenticate', async (data) => {
        await this.handleAuthentication(socket, data);
      });

      socket.on('disconnect', () => {
        this.handleDisconnection(socket);
      });

      socket.on('ping', () => {
        socket.emit('pong', { timestamp: Date.now() });
      });

      // Heartbeat for connection monitoring
      const heartbeat = setInterval(() => {
        socket.emit('heartbeat', { timestamp: Date.now() });
      }, 30000);

      socket.on('disconnect', () => {
        clearInterval(heartbeat);
      });
    });
  }

  // Handle user authentication
  async handleAuthentication(socket, data) {
    try {
      const { userId, token } = data;

      if (!userId || !token) {
        socket.emit('auth_error', { message: 'Authentication data missing' });
        return;
      }

      // Verify user exists and is active
      const user = await User.findById(userId);
      if (!user || !user.isActive || user.isDeleted) {
        socket.emit('auth_error', { message: 'User not found or inactive' });
        return;
      }

      // Store user session
      socket.userId = userId;
      socket.userRole = user.role;
      this.connectedUsers.set(userId, {
        socketId: socket.id,
        userId,
        role: user.role,
        connectedAt: Date.now()
      });

      // Join user-specific rooms
      await this.joinUserRooms(socket, user);

      // Update user presence
      await this.updateUserPresence(userId, 'online');

      // Send welcome message
      socket.emit('authenticated', {
        userId,
        role: user.role,
        message: 'Connected successfully'
      });

      // Send initial data
      await this.sendInitialData(socket, user);

      logger.info('User authenticated via socket', {
        userId,
        socketId: socket.id,
        role: user.role
      });

    } catch (error) {
      logger.error('Socket authentication failed', { error: error.message });
      socket.emit('auth_error', { message: 'Authentication failed' });
    }
  }

  // Handle user disconnection
  async handleDisconnection(socket) {
    if (socket.userId) {
      // Update user presence
      await this.updateUserPresence(socket.userId, 'offline');

      // Remove from connected users
      this.connectedUsers.delete(socket.userId);

      // Leave all rooms
      const userRooms = this.userRooms.get(socket.userId);
      if (userRooms) {
        userRooms.forEach(room => {
          socket.leave(room);
        });
        this.userRooms.delete(socket.userId);
      }

      logger.info('User disconnected', {
        userId: socket.userId,
        socketId: socket.id
      });
    }
  }

  // Join user-specific rooms
  async joinUserRooms(socket, user) {
    const rooms = [`user_${user._id}`];

    // Role-based rooms
    if (user.role === 'admin') {
      rooms.push('admin');
    }
    if (user.role === 'vendor') {
      rooms.push('vendors');
      rooms.push(`vendor_${user._id}`);
    }
    if (user.role === 'customer') {
      rooms.push('customers');
    }

    // Store user rooms
    this.userRooms.set(user._id, rooms);

    // Join rooms
    rooms.forEach(room => {
      socket.join(room);
    });

    // Join notification room
    socket.join(`notifications_${user._id}`);
  }

  // Send initial data to connected user
  async sendInitialData(socket, user) {
    try {
      // Send unread notifications count
      const unreadCount = await Notification.getUnreadCount(user._id);
      socket.emit('notifications_count', { count: unreadCount });

      // Send recent notifications
      const recentNotifications = await Notification.findByUser(user._id, {
        limit: 10,
        unreadOnly: false
      });
      socket.emit('recent_notifications', recentNotifications);

      // Send active orders (for vendors)
      if (user.role === 'vendor') {
        const activeOrders = await Order.findByVendor(user._id, {
          status: { $in: ['pending', 'processing', 'ready', 'shipped'] },
          limit: 5
        });
        socket.emit('vendor_orders', activeOrders);
      }

      // Send system status
      socket.emit('system_status', {
        online: true,
        timestamp: Date.now()
      });

    } catch (error) {
      logger.error('Failed to send initial data', {
        userId: user._id,
        error: error.message
      });
    }
  }

  // ===============================
  // NOTIFICATION HANDLERS
  // ===============================

  setupNotificationHandlers() {
    // Handle notification read
    this.io.on('connection', (socket) => {
      socket.on('mark_notification_read', async (data) => {
        await this.handleNotificationRead(socket, data);
      });

      socket.on('mark_all_notifications_read', async () => {
        await this.handleMarkAllNotificationsRead(socket);
      });

      socket.on('delete_notification', async (data) => {
        await this.handleDeleteNotification(socket, data);
      });
    });
  }

  // Handle notification read
  async handleNotificationRead(socket, data) {
    try {
      const { notificationId } = data;

      const notification = await Notification.findById(notificationId);
      if (notification && notification.user.toString() === socket.userId) {
        await notification.markAsRead();

        // Update unread count
        const unreadCount = await Notification.getUnreadCount(socket.userId);
        socket.emit('notifications_count', { count: unreadCount });

        // Broadcast to user rooms
        this.io.to(`notifications_${socket.userId}`).emit('notification_read', {
          notificationId,
          readAt: new Date()
        });
      }
    } catch (error) {
      logger.error('Failed to mark notification as read', { error: error.message });
    }
  }

  // Handle mark all notifications as read
  async handleMarkAllNotificationsRead(socket) {
    try {
      // Update all unread notifications for user
      await Notification.updateMany(
        {
          user: socket.userId,
          'channels.inApp.read': false
        },
        {
          'channels.inApp.read': true,
          'channels.inApp.readAt': new Date(),
          readAt: new Date()
        }
      );

      // Update unread count
      socket.emit('notifications_count', { count: 0 });

      // Broadcast to user rooms
      this.io.to(`notifications_${socket.userId}`).emit('all_notifications_read', {
        readAt: new Date()
      });

    } catch (error) {
      logger.error('Failed to mark all notifications as read', { error: error.message });
    }
  }

  // Handle notification deletion
  async handleDeleteNotification(socket, data) {
    try {
      const { notificationId } = data;

      const notification = await Notification.findById(notificationId);
      if (notification && notification.user.toString() === socket.userId) {
        await notification.updateOne({
          isDeleted: true,
          deletedAt: new Date()
        });

        // Broadcast to user rooms
        this.io.to(`notifications_${socket.userId}`).emit('notification_deleted', {
          notificationId
        });
      }
    } catch (error) {
      logger.error('Failed to delete notification', { error: error.message });
    }
  }

  // Send real-time notification
  async sendNotificationToUser(userId, notificationData) {
    try {
      const notification = await Notification.createNotification(userId, notificationData);

      // Send to user's notification room
      this.io.to(`notifications_${userId}`).emit('new_notification', {
        id: notification._id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        priority: notification.priority,
        createdAt: notification.createdAt
      });

      // Update unread count
      const unreadCount = await Notification.getUnreadCount(userId);
      this.io.to(`notifications_${userId}`).emit('notifications_count', { count: unreadCount });

    } catch (error) {
      logger.error('Failed to send real-time notification', { error: error.message });
    }
  }

  // ===============================
  // CHAT HANDLERS
  // ===============================

  setupChatHandlers() {
    this.io.on('connection', (socket) => {
      socket.on('join_chat', async (data) => {
        await this.handleJoinChat(socket, data);
      });

      socket.on('leave_chat', async (data) => {
        await this.handleLeaveChat(socket, data);
      });

      socket.on('send_message', async (data) => {
        await this.handleSendMessage(socket, data);
      });

      socket.on('typing_start', async (data) => {
        await this.handleTypingStart(socket, data);
      });

      socket.on('typing_stop', async (data) => {
        await this.handleTypingStop(socket, data);
      });

      socket.on('mark_messages_read', async (data) => {
        await this.handleMarkMessagesRead(socket, data);
      });
    });
  }

  // Handle join chat
  async handleJoinChat(socket, data) {
    try {
      const { chatId, participantId } = data;

      const chatRoom = `chat_${chatId}`;
      socket.join(chatRoom);

      // Load recent messages
      const recentMessages = await this.getRecentChatMessages(chatId, 50);
      socket.emit('chat_history', { chatId, messages: recentMessages });

      // Update user presence in chat
      this.activeChats.set(`${socket.userId}_${chatId}`, {
        userId: socket.userId,
        chatId,
        joinedAt: Date.now()
      });

      logger.info('User joined chat', {
        userId: socket.userId,
        chatId,
        participantId
      });

    } catch (error) {
      logger.error('Failed to join chat', { error: error.message });
      socket.emit('chat_error', { message: 'Failed to join chat' });
    }
  }

  // Handle leave chat
  async handleLeaveChat(socket, data) {
    try {
      const { chatId } = data;

      const chatRoom = `chat_${chatId}`;
      socket.leave(chatRoom);

      // Remove from active chats
      this.activeChats.delete(`${socket.userId}_${chatId}`);

      logger.info('User left chat', {
        userId: socket.userId,
        chatId
      });

    } catch (error) {
      logger.error('Failed to leave chat', { error: error.message });
    }
  }

  // Handle send message
  async handleSendMessage(socket, data) {
    try {
      const { chatId, message, type = 'text', metadata = {} } = data;

      // Create message
      const messageData = {
        chatId,
        senderId: socket.userId,
        message,
        type,
        metadata,
        timestamp: new Date()
      };

      // Save message to database
      const savedMessage = await this.saveChatMessage(messageData);

      // Broadcast to chat room
      const chatRoom = `chat_${chatId}`;
      this.io.to(chatRoom).emit('new_message', {
        id: savedMessage._id,
        chatId,
        senderId: socket.userId,
        message,
        type,
        metadata,
        timestamp: savedMessage.timestamp
      });

      // Send notification to other participants
      await this.sendChatNotification(chatId, socket.userId, message);

      logger.info('Message sent', {
        chatId,
        senderId: socket.userId,
        messageType: type
      });

    } catch (error) {
      logger.error('Failed to send message', { error: error.message });
      socket.emit('message_error', { message: 'Failed to send message' });
    }
  }

  // Handle typing start
  async handleTypingStart(socket, data) {
    try {
      const { chatId } = data;

      // Store typing user
      if (!this.typingUsers.has(chatId)) {
        this.typingUsers.set(chatId, new Set());
      }
      this.typingUsers.get(chatId).add(socket.userId);

      // Broadcast typing indicator
      socket.to(`chat_${chatId}`).emit('user_typing', {
        chatId,
        userId: socket.userId,
        isTyping: true
      });

    } catch (error) {
      logger.error('Failed to handle typing start', { error: error.message });
    }
  }

  // Handle typing stop
  async handleTypingStop(socket, data) {
    try {
      const { chatId } = data;

      // Remove typing user
      if (this.typingUsers.has(chatId)) {
        this.typingUsers.get(chatId).delete(socket.userId);

        // Broadcast typing stop
        socket.to(`chat_${chatId}`).emit('user_typing', {
          chatId,
          userId: socket.userId,
          isTyping: false
        });
      }

    } catch (error) {
      logger.error('Failed to handle typing stop', { error: error.message });
    }
  }

  // Handle mark messages as read
  async handleMarkMessagesRead(socket, data) {
    try {
      const { chatId, messageIds } = data;

      // Update message read status
      await this.markChatMessagesAsRead(chatId, socket.userId, messageIds);

      // Broadcast read receipt
      socket.to(`chat_${chatId}`).emit('messages_read', {
        chatId,
        userId: socket.userId,
        messageIds,
        readAt: new Date()
      });

    } catch (error) {
      logger.error('Failed to mark messages as read', { error: error.message });
    }
  }

  // Save chat message
  async saveChatMessage(messageData) {
    // Implementation for saving chat message
    return {
      _id: `msg_${Date.now()}`,
      ...messageData
    };
  }

  // Get recent chat messages
  async getRecentChatMessages(chatId, limit) {
    // Implementation for getting chat messages
    return [];
  }

  // Mark chat messages as read
  async markChatMessagesAsRead(chatId, userId, messageIds) {
    // Implementation for marking messages as read
    logger.info('Messages marked as read', {
      chatId,
      userId,
      messageCount: messageIds.length
    });
  }

  // Send chat notification
  async sendChatNotification(chatId, senderId, message) {
    // Implementation for chat notifications
    logger.info('Chat notification sent', {
      chatId,
      senderId,
      message: message.substring(0, 50)
    });
  }

  // ===============================
  // ORDER HANDLERS
  // ===============================

  setupOrderHandlers() {
    this.io.on('connection', (socket) => {
      socket.on('subscribe_to_order', async (data) => {
        await this.handleSubscribeToOrder(socket, data);
      });

      socket.on('unsubscribe_from_order', async (data) => {
        await this.handleUnsubscribeFromOrder(socket, data);
      });
    });
  }

  // Handle subscribe to order
  async handleSubscribeToOrder(socket, data) {
    try {
      const { orderId } = data;

      const order = await Order.findById(orderId);
      if (!order) {
        socket.emit('subscription_error', { message: 'Order not found' });
        return;
      }

      // Check permissions
      const canAccess = order.user.toString() === socket.userId ||
        order.items.some(item => item.vendor.toString() === socket.userId) ||
        socket.userRole === 'admin';

      if (!canAccess) {
        socket.emit('subscription_error', { message: 'Not authorized to subscribe to this order' });
        return;
      }

      socket.join(`order_${orderId}`);

      // Send current order status
      socket.emit('order_status', {
        orderId,
        status: order.status,
        statusHistory: order.statusHistory,
        lastUpdated: order.updatedAt
      });

      logger.info('User subscribed to order', {
        userId: socket.userId,
        orderId
      });

    } catch (error) {
      logger.error('Failed to subscribe to order', { error: error.message });
      socket.emit('subscription_error', { message: 'Failed to subscribe to order' });
    }
  }

  // Handle unsubscribe from order
  async handleUnsubscribeFromOrder(socket, data) {
    try {
      const { orderId } = data;

      socket.leave(`order_${orderId}`);

      logger.info('User unsubscribed from order', {
        userId: socket.userId,
        orderId
      });

    } catch (error) {
      logger.error('Failed to unsubscribe from order', { error: error.message });
    }
  }

  // Broadcast order status update
  async broadcastOrderUpdate(orderId, updateData) {
    try {
      this.io.to(`order_${orderId}`).emit('order_updated', {
        orderId,
        ...updateData,
        timestamp: new Date()
      });

      logger.info('Order update broadcasted', { orderId });

    } catch (error) {
      logger.error('Failed to broadcast order update', { error: error.message });
    }
  }

  // ===============================
  // PRODUCT HANDLERS
  // ===============================

  setupProductHandlers() {
    this.io.on('connection', (socket) => {
      socket.on('subscribe_to_product', async (data) => {
        await this.handleSubscribeToProduct(socket, data);
      });

      socket.on('unsubscribe_from_product', async (data) => {
        await this.handleUnsubscribeFromProduct(socket, data);
      });

      socket.on('product_view', async (data) => {
        await this.handleProductView(socket, data);
      });
    });
  }

  // Handle subscribe to product
  async handleSubscribeToProduct(socket, data) {
    try {
      const { productId } = data;

      const product = await Product.findById(productId);
      if (!product) {
        socket.emit('subscription_error', { message: 'Product not found' });
        return;
      }

      socket.join(`product_${productId}`);

      // Send current product data
      socket.emit('product_data', {
        productId,
        data: product,
        lastUpdated: product.updatedAt
      });

      logger.info('User subscribed to product', {
        userId: socket.userId,
        productId
      });

    } catch (error) {
      logger.error('Failed to subscribe to product', { error: error.message });
      socket.emit('subscription_error', { message: 'Failed to subscribe to product' });
    }
  }

  // Handle unsubscribe from product
  async handleUnsubscribeFromProduct(socket, data) {
    try {
      const { productId } = data;

      socket.leave(`product_${productId}`);

      logger.info('User unsubscribed from product', {
        userId: socket.userId,
        productId
      });

    } catch (error) {
      logger.error('Failed to unsubscribe from product', { error: error.message });
    }
  }

  // Handle product view
  async handleProductView(socket, data) {
    try {
      const { productId } = data;

      // Track product view
      await Product.findByIdAndUpdate(productId, {
        $inc: { 'stats.views': 1 },
        $set: { 'stats.lastViewed': new Date() }
      });

      // Broadcast to product subscribers
      this.io.to(`product_${productId}`).emit('product_viewed', {
        productId,
        viewerId: socket.userId,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Failed to handle product view', { error: error.message });
    }
  }

  // Broadcast product update
  async broadcastProductUpdate(productId, updateData) {
    try {
      this.io.to(`product_${productId}`).emit('product_updated', {
        productId,
        ...updateData,
        timestamp: new Date()
      });

      logger.info('Product update broadcasted', { productId });

    } catch (error) {
      logger.error('Failed to broadcast product update', { error: error.message });
    }
  }

  // ===============================
  // WEBRTC HANDLERS
  // ===============================

  setupWebRTCHandlers() {
    this.io.on('connection', (socket) => {
      socket.on('webrtc_offer', async (data) => {
        await this.handleWebRTCOffer(socket, data);
      });

      socket.on('webrtc_answer', async (data) => {
        await this.handleWebRTCAnswer(socket, data);
      });

      socket.on('webrtc_ice_candidate', async (data) => {
        await this.handleWebRTCIceCandidate(socket, data);
      });

      socket.on('webrtc_hangup', async (data) => {
        await this.handleWebRTCHangup(socket, data);
      });

      socket.on('screen_share_start', async (data) => {
        await this.handleScreenShareStart(socket, data);
      });

      socket.on('screen_share_stop', async (data) => {
        await this.handleScreenShareStop(socket, data);
      });
    });
  }

  // Handle WebRTC offer
  async handleWebRTCOffer(socket, data) {
    try {
      const { targetUserId, offer } = data;

      // Forward offer to target user
      const targetUserSocket = this.getUserSocket(targetUserId);
      if (targetUserSocket) {
        targetUserSocket.emit('webrtc_offer', {
          fromUserId: socket.userId,
          offer
        });
      }

      logger.info('WebRTC offer forwarded', {
        fromUserId: socket.userId,
        toUserId: targetUserId
      });

    } catch (error) {
      logger.error('Failed to handle WebRTC offer', { error: error.message });
    }
  }

  // Handle WebRTC answer
  async handleWebRTCAnswer(socket, data) {
    try {
      const { targetUserId, answer } = data;

      // Forward answer to target user
      const targetUserSocket = this.getUserSocket(targetUserId);
      if (targetUserSocket) {
        targetUserSocket.emit('webrtc_answer', {
          fromUserId: socket.userId,
          answer
        });
      }

      logger.info('WebRTC answer forwarded', {
        fromUserId: socket.userId,
        toUserId: targetUserId
      });

    } catch (error) {
      logger.error('Failed to handle WebRTC answer', { error: error.message });
    }
  }

  // Handle WebRTC ICE candidate
  async handleWebRTCIceCandidate(socket, data) {
    try {
      const { targetUserId, candidate } = data;

      // Forward ICE candidate to target user
      const targetUserSocket = this.getUserSocket(targetUserId);
      if (targetUserSocket) {
        targetUserSocket.emit('webrtc_ice_candidate', {
          fromUserId: socket.userId,
          candidate
        });
      }

    } catch (error) {
      logger.error('Failed to handle WebRTC ICE candidate', { error: error.message });
    }
  }

  // Handle WebRTC hangup
  async handleWebRTCHangup(socket, data) {
    try {
      const { targetUserId } = data;

      // Notify target user of hangup
      const targetUserSocket = this.getUserSocket(targetUserId);
      if (targetUserSocket) {
        targetUserSocket.emit('webrtc_hangup', {
          fromUserId: socket.userId
        });
      }

      logger.info('WebRTC call ended', {
        fromUserId: socket.userId,
        toUserId: targetUserId
      });

    } catch (error) {
      logger.error('Failed to handle WebRTC hangup', { error: error.message });
    }
  }

  // Handle screen share start
  async handleScreenShareStart(socket, data) {
    try {
      const { targetUserId } = data;

      // Notify target user of screen share
      const targetUserSocket = this.getUserSocket(targetUserId);
      if (targetUserSocket) {
        targetUserSocket.emit('screen_share_started', {
          fromUserId: socket.userId
        });
      }

      logger.info('Screen share started', {
        fromUserId: socket.userId,
        toUserId: targetUserId
      });

    } catch (error) {
      logger.error('Failed to handle screen share start', { error: error.message });
    }
  }

  // Handle screen share stop
  async handleScreenShareStop(socket, data) {
    try {
      const { targetUserId } = data;

      // Notify target user of screen share stop
      const targetUserSocket = this.getUserSocket(targetUserId);
      if (targetUserSocket) {
        targetUserSocket.emit('screen_share_stopped', {
          fromUserId: socket.userId
        });
      }

      logger.info('Screen share stopped', {
        fromUserId: socket.userId,
        toUserId: targetUserId
      });

    } catch (error) {
      logger.error('Failed to handle screen share stop', { error: error.message });
    }
  }

  // Get user socket
  getUserSocket(userId) {
    const userSession = this.connectedUsers.get(userId);
    return userSession ? this.io.sockets.sockets.get(userSession.socketId) : null;
  }

  // ===============================
  // PRESENCE HANDLERS
  // ===============================

  setupPresenceHandlers() {
    this.io.on('connection', (socket) => {
      socket.on('update_presence', async (data) => {
        await this.handleUpdatePresence(socket, data);
      });

      socket.on('get_online_users', async () => {
        await this.handleGetOnlineUsers(socket);
      });
    });
  }

  // Handle update presence
  async handleUpdatePresence(socket, data) {
    try {
      const { status, customStatus } = data;

      // Update user presence
      await this.updateUserPresence(socket.userId, status, customStatus);

      // Broadcast presence update
      socket.broadcast.emit('user_presence_updated', {
        userId: socket.userId,
        status,
        customStatus,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Failed to update presence', { error: error.message });
    }
  }

  // Handle get online users
  async handleGetOnlineUsers(socket) {
    try {
      const onlineUsers = Array.from(this.connectedUsers.values()).map(user => ({
        userId: user.userId,
        role: user.role,
        connectedAt: user.connectedAt
      }));

      socket.emit('online_users', { users: onlineUsers });

    } catch (error) {
      logger.error('Failed to get online users', { error: error.message });
    }
  }

  // Update user presence
  async updateUserPresence(userId, status, customStatus = null) {
    try {
      // Update in database
      await User.findByIdAndUpdate(userId, {
        'preferences.privacy.showOnlineStatus': status === 'online',
        lastActivity: new Date()
      });

      // Broadcast to relevant rooms
      this.io.to(`user_${userId}`).emit('presence_updated', {
        userId,
        status,
        customStatus,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Failed to update user presence', { error: error.message });
    }
  }

  // ===============================
  // LIVE DASHBOARD UPDATES
  // ===============================

  // Broadcast dashboard update
  async broadcastDashboardUpdate(updateData) {
    try {
      // Broadcast to admin users
      this.io.to('admin').emit('dashboard_update', {
        ...updateData,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Failed to broadcast dashboard update', { error: error.message });
    }
  }

  // Broadcast live analytics
  async broadcastLiveAnalytics(analyticsData) {
    try {
      // Broadcast to admin users
      this.io.to('admin').emit('live_analytics', {
        ...analyticsData,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Failed to broadcast live analytics', { error: error.message });
    }
  }

  // ===============================
  // SYSTEM EVENTS
  // ===============================

  // Broadcast system announcement
  async broadcastSystemAnnouncement(announcement) {
    try {
      this.io.emit('system_announcement', {
        ...announcement,
        timestamp: new Date()
      });

      logger.info('System announcement broadcasted', { announcement });

    } catch (error) {
      logger.error('Failed to broadcast system announcement', { error: error.message });
    }
  }

  // Broadcast maintenance mode
  async broadcastMaintenanceMode(enabled, message) {
    try {
      this.io.emit('maintenance_mode', {
        enabled,
        message,
        timestamp: new Date()
      });

      logger.info('Maintenance mode broadcasted', { enabled, message });

    } catch (error) {
      logger.error('Failed to broadcast maintenance mode', { error: error.message });
    }
  }

  // ===============================
  // UTILITY METHODS
  // ===============================

  // Get connected users count
  getConnectedUsersCount() {
    return this.connectedUsers.size;
  }

  // Get online users by role
  getOnlineUsersByRole() {
    const usersByRole = {};

    this.connectedUsers.forEach(user => {
      if (!usersByRole[user.role]) {
        usersByRole[user.role] = 0;
      }
      usersByRole[user.role]++;
    });

    return usersByRole;
  }

  // Clean up inactive connections
  cleanupInactiveConnections() {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes

    this.connectedUsers.forEach((user, userId) => {
      if (now - user.connectedAt > timeout) {
        this.connectedUsers.delete(userId);
        logger.info('Inactive connection cleaned up', { userId });
      }
    });
  }

  // Send real-time notification to multiple users
  async sendBulkNotification(userIds, notificationData) {
    try {
      const notifications = userIds.map(userId =>
        Notification.createNotification(userId, notificationData)
      );

      await Promise.all(notifications);

      // Send to multiple notification rooms
      userIds.forEach(userId => {
        this.io.to(`notifications_${userId}`).emit('new_notification', notificationData);
      });

      logger.info('Bulk notification sent', {
        userCount: userIds.length,
        type: notificationData.type
      });

    } catch (error) {
      logger.error('Failed to send bulk notification', { error: error.message });
    }
  }

  // Get room statistics
  getRoomStatistics() {
    const rooms = this.io.sockets.adapter.rooms;
    const stats = {};

    rooms.forEach((sockets, roomName) => {
      if (roomName.startsWith('chat_') || roomName.startsWith('order_') || roomName.startsWith('product_')) {
        stats[roomName] = sockets.size;
      }
    });

    return stats;
  }

  // Broadcast to specific user roles
  async broadcastToRoles(roles, event, data) {
    try {
      roles.forEach(role => {
        this.io.to(role).emit(event, {
          ...data,
          timestamp: new Date()
        });
      });

      logger.info('Broadcast sent to roles', { roles, event });

    } catch (error) {
      logger.error('Failed to broadcast to roles', { error: error.message });
    }
  }

  // Handle file upload in real-time
  async handleRealTimeFileUpload(socket, data) {
    try {
      const { file, metadata } = data;

      // Process file upload
      const fileData = {
        id: `file_${Date.now()}`,
        name: file.name,
        size: file.size,
        type: file.type,
        uploadedBy: socket.userId,
        uploadedAt: new Date()
      };

      // Broadcast file upload
      socket.emit('file_uploaded', fileData);

      logger.info('Real-time file uploaded', {
        fileId: fileData.id,
        uploadedBy: socket.userId,
        size: file.size
      });

    } catch (error) {
      logger.error('Failed to handle real-time file upload', { error: error.message });
    }
  }

  // Start cleanup interval
  startCleanupInterval() {
    setInterval(() => {
      this.cleanupInactiveConnections();
    }, 10 * 60 * 1000); // Clean up every 10 minutes
  }

  // Get real-time statistics
  getRealTimeStatistics() {
    return {
      connectedUsers: this.getConnectedUsersCount(),
      usersByRole: this.getOnlineUsersByRole(),
      activeChats: this.activeChats.size,
      typingUsers: this.typingUsers.size,
      roomStats: this.getRoomStatistics(),
      timestamp: new Date()
    };
  }

  // Handle emergency broadcast
  async handleEmergencyBroadcast(message, priority = 'high') {
    try {
      this.io.emit('emergency_broadcast', {
        message,
        priority,
        timestamp: new Date()
      });

      logger.warn('Emergency broadcast sent', { message, priority });

    } catch (error) {
      logger.error('Failed to send emergency broadcast', { error: error.message });
    }
  }

  // Broadcast live order updates to vendors
  async broadcastLiveOrderUpdates() {
    try {
      // Get pending orders
      const pendingOrders = await Order.getPendingOrders();

      // Broadcast to vendors
      this.io.to('vendors').emit('live_order_updates', {
        pendingOrders: pendingOrders.length,
        orders: pendingOrders.slice(0, 10),
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Failed to broadcast live order updates', { error: error.message });
    }
  }

  // Start live update intervals
  startLiveUpdateIntervals() {
    // Broadcast order updates every 30 seconds
    setInterval(() => {
      this.broadcastLiveOrderUpdates();
    }, 30000);

    // Broadcast analytics every 60 seconds
    setInterval(async () => {
      const stats = this.getRealTimeStatistics();
      await this.broadcastLiveAnalytics(stats);
    }, 60000);

    // Broadcast dashboard updates every 60 seconds
    setInterval(async () => {
      const overview = await this.getDashboardOverview(1); // Last 1 day
      await this.broadcastDashboardUpdate(overview);
    }, 60000);
  }

  // Get dashboard overview for real-time updates
  async getDashboardOverview(days) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    return {
      activeUsers: this.getConnectedUsersCount(),
      newOrders: await Order.countDocuments({
        createdAt: { $gte: startDate },
        isDeleted: false
      }),
      completedOrders: await Order.countDocuments({
        status: { $in: ['completed', 'delivered'] },
        updatedAt: { $gte: startDate },
        isDeleted: false
      }),
      totalRevenue: await this.getTotalRevenue(startDate)
    };
  }

  // Get total revenue
  async getTotalRevenue(startDate) {
    const result = await Order.aggregate([
      {
        $match: {
          status: { $in: ['completed', 'delivered'] },
          orderedAt: { $gte: startDate },
          isDeleted: false
        }
      },
      { $group: { _id: null, total: { $sum: '$pricing.totalAmount' } } }
    ]);

    return result[0]?.total || 0;
  }

  // Initialize service
  initializeService(server) {
    this.initialize(server);
    this.startCleanupInterval();
    this.startLiveUpdateIntervals();

    logger.info('Real-time service fully initialized');
  }
}

// Create singleton instance
const realTimeService = new RealTimeService();

module.exports = realTimeService;
