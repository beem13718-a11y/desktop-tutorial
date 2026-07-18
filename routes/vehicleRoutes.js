const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicleController');
const { isAuthenticated } = require('../middleware/authMiddleware');

router.use(isAuthenticated);

router.get('/', vehicleController.getAllVehicles);
router.post('/add', vehicleController.addVehicle);
router.post('/edit/:id', vehicleController.editVehicle);
router.post('/delete/:id', vehicleController.deleteVehicle);
router.get('/history/:id', vehicleController.getRepairHistory);

module.exports = router;
