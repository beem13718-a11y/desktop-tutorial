const express = require('express');
const router = express.Router();
const financeController = require('../controllers/financeController');
const { isAuthenticated } = require('../middleware/authMiddleware');

router.use(isAuthenticated);

router.get('/', financeController.getAllFinances);
router.post('/record-income', financeController.recordIncome);
router.post('/record-expense', financeController.recordExpense);

module.exports = router;
