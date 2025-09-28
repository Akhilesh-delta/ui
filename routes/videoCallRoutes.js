const express = require('express');
const router = express.Router();
const videoCallController = require('../controllers/videoCallController');
const { authenticate, authorize } = require('../middleware/auth');
const { body, param, query } = require('express-validator');

// ================================
// VIDEO CALL MANAGEMENT
// ================================

// Create new video call
router.post('/calls', authenticate, [
  body('participants').isArray({ min: 1 }).withMessage('Participants must be an array with at least one participant'),
  body('participants.*').isMongoId().withMessage('Each participant must be a valid user ID'),
  body('type').optional().isIn(['audio', 'video', 'screen_share']).withMessage('Invalid call type'),
  body('context').optional().isObject().withMessage('Context must be an object'),
  body('settings').optional().isObject().withMessage('Settings must be an object')
], videoCallController.createVideoCall);

// Get video call details
router.get('/calls/:callId', authenticate, [
  param('callId').notEmpty().withMessage('Call ID is required')
], videoCallController.getVideoCall);

// Join video call
router.post('/calls/:callId/join', authenticate, [
  param('callId').notEmpty().withMessage('Call ID is required'),
  body('audioEnabled').optional().isBoolean().withMessage('audioEnabled must be a boolean'),
  body('videoEnabled').optional().isBoolean().withMessage('videoEnabled must be a boolean')
], videoCallController.joinVideoCall);

// Leave video call
router.post('/calls/:callId/leave', authenticate, [
  param('callId').notEmpty().withMessage('Call ID is required')
], videoCallController.leaveVideoCall);

// End video call
router.post('/calls/:callId/end', authenticate, [
  param('callId').notEmpty().withMessage('Call ID is required')
], videoCallController.endVideoCall);

// ================================
// CALL PARTICIPANT MANAGEMENT
// ================================

// Toggle mute for participant
router.put('/calls/:callId/mute', authenticate, [
  param('callId').notEmpty().withMessage('Call ID is required'),
  body('participantId').isMongoId().withMessage('Valid participant ID is required'),
  body('muted').isBoolean().withMessage('muted must be a boolean')
], videoCallController.toggleMute);

// Toggle video for participant
router.put('/calls/:callId/video', authenticate, [
  param('callId').notEmpty().withMessage('Call ID is required'),
  body('participantId').isMongoId().withMessage('Valid participant ID is required'),
  body('enabled').isBoolean().withMessage('enabled must be a boolean')
], videoCallController.toggleVideo);

// Start screen sharing
router.post('/calls/:callId/screen-share/start', authenticate, [
  param('callId').notEmpty().withMessage('Call ID is required')
], videoCallController.startScreenShare);

// Stop screen sharing
router.post('/calls/:callId/screen-share/stop', authenticate, [
  param('callId').notEmpty().withMessage('Call ID is required')
], videoCallController.stopScreenShare);

// ================================
// CALL RECORDING
// ================================

// Start call recording
router.post('/calls/:callId/recording/start', authenticate, [
  param('callId').notEmpty().withMessage('Call ID is required')
], videoCallController.startRecording);

// Stop call recording
router.post('/calls/:callId/recording/stop', authenticate, [
  param('callId').notEmpty().withMessage('Call ID is required')
], videoCallController.stopRecording);

// ================================
// CALL INTEGRATIONS
// ================================

// Create video call from chat
router.post('/conversations/:conversationId/call', authenticate, [
  param('conversationId').isMongoId().withMessage('Valid conversation ID is required'),
  body('type').optional().isIn(['audio', 'video', 'screen_share']).withMessage('Invalid call type')
], videoCallController.createCallFromChat);

// Get active calls for user
router.get('/calls/active', authenticate, videoCallController.getActiveCalls);

// ================================
// CALL HISTORY & ANALYTICS
// ================================

// Get call history
router.get('/calls/history', authenticate, [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
  query('type').optional().isIn(['audio', 'video', 'screen_share']).withMessage('Invalid call type'),
  query('status').optional().isIn(['pending', 'active', 'ended', 'cancelled', 'failed']).withMessage('Invalid status'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format')
], videoCallController.getCallHistory);

// Get call analytics (admin)
router.get('/admin/calls/analytics', authenticate, authorize(['admin']), [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], videoCallController.getCallAnalytics);

// ================================
// ADMIN CALL MANAGEMENT
// ================================

// Get all calls (admin)
router.get('/admin/calls', authenticate, authorize(['admin']), [
  query('status').optional().isIn(['pending', 'active', 'ended', 'cancelled', 'failed']).withMessage('Invalid status'),
  query('type').optional().isIn(['audio', 'video', 'screen_share']).withMessage('Invalid call type'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
], videoCallController.getAllCalls);

// Force end call (admin)
router.post('/admin/calls/:callId/end', authenticate, authorize(['admin']), [
  param('callId').notEmpty().withMessage('Call ID is required')
], videoCallController.forceEndCall);

// ================================
// CALL MAINTENANCE
// ================================

// Clean up old calls (admin)
router.post('/admin/calls/cleanup', authenticate, authorize(['admin']), [
  query('daysOld').optional().isInt({ min: 1, max: 3650 }).withMessage('Days old must be between 1 and 3650')
], videoCallController.cleanupOldCalls);

// Get call statistics (admin)
router.get('/admin/calls/statistics', authenticate, authorize(['admin']), [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], videoCallController.getCallStatistics);

module.exports = router;
