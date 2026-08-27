const express = require('express');
const router = express.Router();
const qrController = require('../controllers/qrController');

router.get('/promptpay', qrController.generatePromptPayQR);

module.exports = router;
