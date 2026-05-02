const express = require('express');
const supplierController = require('../controllers/supplierController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

// Summary must come before /:id to avoid route collision
router.get('/summary', supplierController.getSuppliersSummary);

router.route('/')
    .get(supplierController.getAllSuppliers)
    .post(restrictTo('ADMIN', 'MANAGER'), supplierController.createSupplier);

router.route('/:id')
    .get(supplierController.getSupplier)
    .put(restrictTo('ADMIN', 'MANAGER'), supplierController.updateSupplier)
    .delete(restrictTo('ADMIN', 'MANAGER'), supplierController.deleteSupplier);

module.exports = router;
