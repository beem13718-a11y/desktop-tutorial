const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { isAuthenticated } = require('../middleware/authMiddleware');

router.use(isAuthenticated);

router.get('/', customerController.getAllCustomers);
router.post('/add', customerController.addCustomer);
router.post('/edit/:id', customerController.editCustomer);
router.post('/delete/:id', customerController.deleteCustomer);

module.exports = router;
