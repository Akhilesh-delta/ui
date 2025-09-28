const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { authenticate, authorize } = require('../middleware/auth');
const { body, param, query } = require('express-validator');
const upload = require('../middleware/upload');

// ================================
// CONVERSATION MANAGEMENT
// ================================

// Create new conversation
router.post('/conversations', authenticate, [
  body('participants').isArray({ min: 2 }).withMessage('At least 2 participants are required'),
  body('participants.*.userId').isMongoId().withMessage('Valid user ID is required'),
  body('participants.*.role').optional().isIn(['customer', 'vendor', 'admin', 'participant']).withMessage('Invalid role'),
  body('type').optional().isIn(['direct', 'group', 'order', 'product', 'support']).withMessage('Invalid conversation type'),
  body('title').optional().isLength({ min: 3, max: 100 }).withMessage('Title must be between 3 and 100 characters'),
  body('orderId').optional().isMongoId().withMessage('Valid order ID is required'),
  body('productId').optional().isMongoId().withMessage('Valid product ID is required'),
  body('storeId').optional().isMongoId().withMessage('Valid store ID is required')
], chatController.createConversation);

// Get user conversations
router.get('/conversations', authenticate, [
  query('type').optional().isIn(['direct', 'group', 'order', 'product', 'support']).withMessage('Invalid conversation type'),
  query('status').optional().isIn(['active', 'archived', 'inactive']).withMessage('Invalid status'),
  query('search').optional().isLength({ min: 2 }).withMessage('Search term must be at least 2 characters'),
  query('sortBy').optional().isIn(['updatedAt', 'createdAt', 'lastActivity', 'title']).withMessage('Invalid sort field'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
], chatController.getUserConversations);

// Get conversation by ID
router.get('/conversations/:id', authenticate, [
  param('id').isMongoId().withMessage('Valid conversation ID is required'),
  query('includeMessages').optional().isIn(['true', 'false']).withMessage('includeMessages must be true or false'),
  query('messageLimit').optional().isInt({ min: 1, max: 100 }).withMessage('Message limit must be between 1 and 100')
], chatController.getConversation);

// Update conversation
router.put('/conversations/:id', authenticate, [
  param('id').isMongoId().withMessage('Valid conversation ID is required'),
  body('title').optional().isLength({ min: 3, max: 100 }).withMessage('Title must be between 3 and 100 characters'),
  body('description').optional().isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters'),
  body('settings').optional().isObject().withMessage('Settings must be an object')
], chatController.updateConversation);

// Delete conversation
router.delete('/conversations/:id', authenticate, [
  param('id').isMongoId().withMessage('Valid conversation ID is required')
], chatController.deleteConversation);

// ================================
// MESSAGE MANAGEMENT
// ================================

// Send message
router.post('/conversations/:conversationId/messages', authenticate, [
  param('conversationId').isMongoId().withMessage('Valid conversation ID is required'),
  body('content').trim().isLength({ min: 1, max: 2000 }).withMessage('Content must be between 1 and 2000 characters'),
  body('type').optional().isIn(['text', 'file', 'image', 'video', 'audio', 'system']).withMessage('Invalid message type'),
  body('replyTo').optional().isMongoId().withMessage('Valid message ID is required for reply'),
  body('attachments').optional().isArray().withMessage('Attachments must be an array')
], chatController.sendMessage);

// Get conversation messages
router.get('/conversations/:conversationId/messages', authenticate, [
  param('conversationId').isMongoId().withMessage('Valid conversation ID is required'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('before').optional().isISO8601().withMessage('Invalid date format'),
  query('after').optional().isISO8601().withMessage('Invalid date format'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer')
], chatController.getMessages);

// Update message
router.put('/messages/:messageId', authenticate, [
  param('messageId').isMongoId().withMessage('Valid message ID is required'),
  body('content').trim().isLength({ min: 1, max: 2000 }).withMessage('Content must be between 1 and 2000 characters')
], chatController.updateMessage);

// Delete message
router.delete('/messages/:messageId', authenticate, [
  param('messageId').isMongoId().withMessage('Valid message ID is required')
], chatController.deleteMessage);

// Mark messages as read
router.post('/conversations/:conversationId/read', authenticate, [
  param('conversationId').isMongoId().withMessage('Valid conversation ID is required')
], chatController.markAsRead);

// ================================
// FILE SHARING IN CHAT
// ================================

// Upload file to chat
router.post('/conversations/:conversationId/files', authenticate, upload.single('file'), [
  param('conversationId').isMongoId().withMessage('Valid conversation ID is required')
], chatController.uploadChatFile);

// ================================
// CHAT SEARCH & HISTORY
// ================================

// Search messages
router.get('/search/messages', authenticate, [
  query('q').notEmpty().withMessage('Search term is required'),
  query('conversationId').optional().isMongoId().withMessage('Valid conversation ID is required'),
  query('sender').optional().isMongoId().withMessage('Valid sender ID is required'),
  query('type').optional().isIn(['text', 'file', 'image', 'video', 'audio', 'system']).withMessage('Invalid message type'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
], chatController.searchMessages);

// Get message history
router.get('/conversations/:conversationId/history', authenticate, [
  param('conversationId').isMongoId().withMessage('Valid conversation ID is required'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  query('format').optional().isIn(['json', 'csv']).withMessage('Format must be json or csv')
], chatController.getMessageHistory);

// ================================
// CHAT MODERATION
// ================================

// Moderate message (admin)
router.post('/admin/messages/:messageId/moderate', authenticate, authorize(['admin']), [
  param('messageId').isMongoId().withMessage('Valid message ID is required'),
  body('action').isIn(['hide', 'delete', 'flag', 'unflag']).withMessage('Invalid moderation action'),
  body('reason').optional().isLength({ max: 500 }).withMessage('Reason cannot exceed 500 characters')
], chatController.moderateMessage);

// Get flagged messages (admin)
router.get('/admin/messages/flagged', authenticate, authorize(['admin']), [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
], chatController.getFlaggedMessages);

// ================================
// CHAT ANALYTICS
// ================================

// Get chat analytics (admin)
router.get('/admin/analytics', authenticate, authorize(['admin']), [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days'),
  query('conversationId').optional().isMongoId().withMessage('Valid conversation ID is required')
], chatController.getChatAnalytics);

// ================================
// CHAT SETTINGS & PREFERENCES
// ================================

// Update conversation settings
router.put('/conversations/:conversationId/settings', authenticate, [
  param('conversationId').isMongoId().withMessage('Valid conversation ID is required'),
  body('settings').isObject().withMessage('Settings must be an object')
], chatController.updateConversationSettings);

// Get user chat preferences
router.get('/preferences', authenticate, chatController.getChatPreferences);

// Update chat preferences
router.put('/preferences', authenticate, [
  body('preferences').isObject().withMessage('Preferences must be an object')
], chatController.updateChatPreferences);

// ================================
// ADMIN CHAT MANAGEMENT
// ================================

// Get all conversations (admin)
router.get('/admin/conversations', authenticate, authorize(['admin']), [
  query('type').optional().isIn(['direct', 'group', 'order', 'product', 'support']).withMessage('Invalid conversation type'),
  query('status').optional().isIn(['active', 'archived', 'inactive']).withMessage('Invalid status'),
  query('search').optional().isLength({ min: 2 }).withMessage('Search term must be at least 2 characters'),
  query('sortBy').optional().isIn(['updatedAt', 'createdAt', 'lastActivity', 'title']).withMessage('Invalid sort field'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
], chatController.getAllConversations);

// Archive conversation (admin)
router.post('/admin/conversations/:conversationId/archive', authenticate, authorize(['admin']), [
  param('conversationId').isMongoId().withMessage('Valid conversation ID is required')
], chatController.archiveConversation);

// ================================
// CHAT INTEGRATIONS
// ================================

// Create conversation from order
router.post('/orders/:orderId/conversation', authenticate, [
  param('orderId').isMongoId().withMessage('Valid order ID is required')
], chatController.createOrderConversation);

// Create conversation from product inquiry
router.post('/products/:productId/conversation', authenticate, [
  param('productId').isMongoId().withMessage('Valid product ID is required'),
  body('message').trim().isLength({ min: 1, max: 1000 }).withMessage('Message must be between 1 and 1000 characters')
], chatController.createProductConversation);

// ================================
// CHAT EXPORT/IMPORT
// ================================

// Export conversation
router.get('/conversations/:conversationId/export', authenticate, [
  param('conversationId').isMongoId().withMessage('Valid conversation ID is required'),
  query('format').optional().isIn(['json', 'csv']).withMessage('Format must be json or csv'),
  query('includeAttachments').optional().isIn(['true', 'false']).withMessage('includeAttachments must be true or false')
], chatController.exportConversation);

// ================================
// CHAT STATISTICS
// ================================

// Get chat statistics
router.get('/statistics', authenticate, authorize(['admin']), [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], chatController.getChatStatistics);

// ================================
// CONVERSATION PARTICIPANTS
// ================================

// Add participant to conversation
router.post('/conversations/:conversationId/participants', authenticate, [
  param('conversationId').isMongoId().withMessage('Valid conversation ID is required'),
  body('userId').isMongoId().withMessage('Valid user ID is required'),
  body('role').optional().isIn(['customer', 'vendor', 'admin', 'participant']).withMessage('Invalid role')
], chatController.addParticipant);

// Remove participant from conversation
router.delete('/conversations/:conversationId/participants/:participantId', authenticate, [
  param('conversationId').isMongoId().withMessage('Valid conversation ID is required'),
  param('participantId').isMongoId().withMessage('Valid participant ID is required')
], chatController.removeParticipant);

// Get conversation participants
router.get('/conversations/:conversationId/participants', authenticate, [
  param('conversationId').isMongoId().withMessage('Valid conversation ID is required')
], chatController.getConversationParticipants);

// Update participant role
router.put('/conversations/:conversationId/participants/:participantId/role', authenticate, [
  param('conversationId').isMongoId().withMessage('Valid conversation ID is required'),
  param('participantId').isMongoId().withMessage('Valid participant ID is required'),
  body('role').isIn(['customer', 'vendor', 'admin', 'participant']).withMessage('Invalid role')
], chatController.updateParticipantRole);

// ================================
// CHAT PERFORMANCE
// ================================

// Get chat performance metrics (admin)
router.get('/admin/performance', authenticate, authorize(['admin']), chatController.getChatPerformance);

// ================================
// CHAT MAINTENANCE
// ================================

// Clean up old conversations (admin)
router.post('/admin/cleanup', authenticate, authorize(['admin']), [
  query('daysOld').optional().isInt({ min: 1, max: 3650 }).withMessage('Days old must be between 1 and 3650')
], chatController.cleanupOldConversations);

// Optimize chat performance (admin)
router.post('/admin/optimize', authenticate, authorize(['admin']), chatController.optimizeChatPerformance);

// ================================
// CHAT API ENDPOINTS
// ================================

// Get chat API data
router.get('/api', [
  query('format').optional().isIn(['json', 'xml']).withMessage('Format must be json or xml')
], chatController.getChatAPI);

module.exports = router;
