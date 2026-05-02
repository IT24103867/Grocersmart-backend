const express = require('express');
const adminController = require('../controllers/adminController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);
router.use(restrictTo('ADMIN'));

router.get('/permissions/cashier', adminController.getCashierPermissions);
router.put('/permissions/cashier', adminController.bulkUpdateCashierPermissions);
router.put('/permissions/cashier/:moduleKey', adminController.updateCashierPermission);

module.exports = router;
