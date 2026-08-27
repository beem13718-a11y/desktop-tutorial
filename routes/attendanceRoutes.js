const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');
const { isAuthenticated, isOwner } = require('../middleware/authMiddleware');

// All attendance routes require login
router.use(isAuthenticated);

// View attendance dashboard & records
router.get('/', attendanceController.getAttendancePage);

// Staff Clock In / Clock Out
router.post('/clock-in', attendanceController.clockIn);
router.post('/clock-out', attendanceController.clockOut);

// Fast 1-click update from table
router.post('/quick-update', isOwner, attendanceController.quickUpdateStatus);

// Owner manual edit & leave recording
router.post('/manual', isOwner, attendanceController.manualAttendanceRecord);

// Verify Owner Password for unlocking past date edits
router.post('/verify-unlock', isOwner, attendanceController.verifyUnlock);

module.exports = router;
