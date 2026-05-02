const express = require('express');
const reportController = require('../controllers/reportController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

// Sales
router.get('/sales', reportController.getSalesReport);
router.get('/sales/pdf', reportController.getSalesReport);
router.get('/sales/:id/invoice.pdf', reportController.getSalesInvoicePdf);

// Products / Inventory
router.get('/inventory', reportController.getInventoryReport);
router.get('/products/pdf', reportController.getProductsReportPdf);
router.get('/products/:id', reportController.getProductDetailsPdf);
router.get('/products/:id/pdf', reportController.getProductDetailsPdf);

// Users
router.get('/users', reportController.getUserReport);
router.get('/users/pdf', reportController.getUserReport);
router.get('/users/:id', reportController.getUserDetailsPdf);
router.get('/users/:id/pdf', reportController.getUserDetailsPdf);

// Credit customers
router.get('/credit-customers/pdf', reportController.getCreditCustomersReportPdf);
router.get('/credit-customers/:id/ledger.pdf', reportController.getCreditCustomerLedgerPdf);
router.get('/credit-customers/:id/pdf', reportController.getCreditCustomerProfilePdf);

// Suppliers
router.get('/suppliers/pdf', reportController.getSuppliersReportPdf);
router.get('/suppliers/:id/purchase-history.pdf', reportController.getSuppliersPurchaseHistoryPdf);
router.get('/suppliers/:id/pdf', reportController.getSupplierProfilePdf);

// Cheques
router.get('/cheques/pdf', reportController.getChequesReportPdf);

// Purchase orders
router.get('/purchase-orders/pdf', reportController.getPurchaseOrdersReportPdf);
router.get('/purchase-orders/:id/pdf', reportController.getPurchaseOrderPdf);

module.exports = router;
