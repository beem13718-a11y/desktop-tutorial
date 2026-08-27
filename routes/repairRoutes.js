const express = require('express');
const router = express.Router();
const repairController = require('../controllers/repairController');
const { isAuthenticated } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

router.use(isAuthenticated);

router.get('/', repairController.getAllRepairs);
router.get('/detail/:id', repairController.getRepairDetail);
router.post('/add', upload.single('car_photo_before'), repairController.addRepair);
router.post('/estimate/:id', repairController.updateEstimate);
router.post('/assign-parts/:id', repairController.assignMechanicAndParts);
router.post('/status/:id', repairController.updateStatus);
router.post('/close/:id', upload.single('car_photo_after'), repairController.closeRepair);
router.post('/send-line-invoice/:id', repairController.sendLineInvoice);

module.exports = router;
