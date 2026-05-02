const express = require('express');
const analyticsController = require('../controllers/analyticsController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/targets', analyticsController.getTargets);
router.get('/summary', analyticsController.getFinancialSummary);
router.post('/targets', analyticsController.setTarget);

router.put('/targets/:id', analyticsController.updateTarget);
router.delete('/targets/:id', analyticsController.deleteTarget);

module.exports = router;
