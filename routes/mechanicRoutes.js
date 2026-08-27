const express = require('express');
const router = express.Router();
const mechanicController = require('../controllers/mechanicController');
const { isAuthenticated, isOwner } = require('../middleware/authMiddleware');

// Mechanics require authentication and only Owner role can perform CRUD
router.use(isAuthenticated);
router.use(isOwner);

router.get('/', mechanicController.getAllMechanics);
router.post('/add', mechanicController.addMechanic);
router.post('/edit/:id', mechanicController.editMechanic);
router.post('/delete/:id', mechanicController.deleteMechanic);
router.post('/pay-salary', mechanicController.paySalary);

module.exports = router;
