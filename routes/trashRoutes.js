const express = require('express');
const trashController = require('../controllers/trashController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);
router.use(restrictTo('ADMIN'));

router.get('/', trashController.getAllDeletedItems);
router.get('/:type', trashController.getDeletedItems);
router.post('/:type/:id/restore', trashController.restoreItem);
router.delete('/:type/:id/permanent', trashController.permanentDelete);

module.exports = router;
