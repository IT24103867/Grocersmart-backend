const express = require('express');
const creditController = require('../controllers/creditController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

// Static routes must be before /:id
router.get('/summary', creditController.getCustomerSummary);

router.route('/')
    .get(creditController.getAllCustomers)
    .post(creditController.createCustomer);

router.route('/:id')
    .get(creditController.getCustomer)
    .put(creditController.updateCustomer)
    .delete(creditController.deleteCustomer);

router.post('/:id/payments', creditController.addPayment);
router.get('/:id/ledger', creditController.getCustomerLedger);
router.get('/:id/summary', creditController.getCustomerAccountSummary);
router.post('/:id/calculate-risk', creditController.calculateRiskScore);
router.get('/:id/transactions', creditController.getCustomerTransactions);

module.exports = router;
