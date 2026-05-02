const express = require('express');
const productController = require('../controllers/productController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.route('/')
    .get(productController.getAllProducts)
    .post(restrictTo('ADMIN', 'MANAGER'), productController.createProduct);

router.get('/search', productController.searchProduct);
router.post('/bulk-import', restrictTo('ADMIN', 'MANAGER'), productController.bulkImport);

router.route('/:id')
    .get(productController.getProduct)
    .put(restrictTo('ADMIN', 'MANAGER'), productController.updateProduct)
    .delete(restrictTo('ADMIN', 'MANAGER'), productController.deleteProduct);

// Reusing part of inventory logic here or could be separate router
router.post('/convert', restrictTo('ADMIN', 'MANAGER'), productController.convertStock);

module.exports = router;
