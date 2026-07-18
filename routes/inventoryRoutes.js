const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const { isAuthenticated } = require('../middleware/authMiddleware');

router.use(isAuthenticated);

router.get('/', inventoryController.getAllInventory);
router.post('/add', inventoryController.addInventoryPart);
router.post('/edit/:id', inventoryController.editInventoryPart);
router.post('/delete/:id', inventoryController.deleteInventoryPart);
router.post('/restock/:id', inventoryController.restockPart);

module.exports = router;
