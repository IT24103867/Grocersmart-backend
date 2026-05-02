const express = require('express');
const orderController = require('../controllers/orderController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.route('/')
    .get(orderController.getAllOrders)
    .post(orderController.createOrder);

router.get('/analytics/daily', orderController.getDailySalesStats);
router.get('/analytics/top-products', orderController.getTopProductsStats);

router.route('/:id')

    .get(orderController.getOrder)
    .put(orderController.updateOrder)
    .delete(orderController.deleteOrder);

router.route('/:id/items')
    .get(orderController.getOrderItems)
    .post(orderController.addOrderItem);

router.put('/:id/confirm', orderController.confirmOrder);
router.put('/:id/receive', orderController.receivePurchaseOrder);
router.patch('/:id/audit', orderController.markOrderAudited);

router.get('/products/:productId/forecast', orderController.getDemandForecast);

module.exports = router;
