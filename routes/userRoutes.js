const express = require('express');
const userController = require('../controllers/userController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

// Allow anyone to get their own user info or update themselves
// But restrict everything else to ADMIN
router.route('/:id')
    .get((req, res, next) => {
        if (req.user.role === 'ADMIN' || req.user._id.toString() === req.params.id) return next();
        res.status(403).json({ status: 'fail', message: 'Unauthorized' });
    }, userController.getUser)
    .put((req, res, next) => {
        if (req.user.role === 'ADMIN' || req.user._id.toString() === req.params.id) return next();
        res.status(403).json({ status: 'fail', message: 'Unauthorized' });
    }, userController.updateUser);

router.use(restrictTo('ADMIN'));

router.route('/')
    .get(userController.getAllUsers)
    .post(userController.createUser);

router.route('/:id')
    .delete(userController.deleteUser);

router.patch('/:id/activate', userController.activateUser);
router.patch('/:id/deactivate', userController.deactivateUser);
router.patch('/:id/permissions', userController.updatePermissions);
router.get('/:id/activity-logs', userController.getActivityLogs);

module.exports = router;
