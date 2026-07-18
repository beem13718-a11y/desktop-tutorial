const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');
const { isAuthenticated, isOwner } = require('../middleware/authMiddleware');

router.use(isAuthenticated);
router.use(isOwner); // Settings are restricted to owner role

router.get('/', systemController.getSettings);
router.post('/change-password', systemController.updatePassword);
router.post('/line', systemController.updateLineSettings);
router.get('/backup', systemController.backupDatabase);
router.post('/restore', systemController.restoreDatabase);

module.exports = router;
