const express = require('express');
const chequeController = require('../controllers/chequeController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

// Summary must be before /:id to avoid route collision
router.get('/summary', chequeController.getChequesSummary);

router.route('/')
    .get(chequeController.getAllCheques)
    .post(chequeController.createCheque);

router.route('/:id')
    .get(chequeController.getCheque)
    .put(chequeController.updateCheque)
    .delete(chequeController.deleteCheque);

router.put('/:id/status', chequeController.updateChequeStatus);

module.exports = router;
