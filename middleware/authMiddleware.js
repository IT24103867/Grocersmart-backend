const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const User = require('../models/User');
const mongoose = require('mongoose');

exports.protect = async (req, res, next) => {
    try {
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({ status: 'fail', message: 'You are not logged in!' });
        }

        const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

        if (!decoded?.id || !mongoose.Types.ObjectId.isValid(decoded.id)) {
            return res.status(401).json({ status: 'fail', message: 'Invalid token payload' });
        }

        const currentUser = await User.findById(decoded.id);
        if (!currentUser) {
            return res.status(401).json({ status: 'fail', message: 'The user belonging to this token no longer exists.' });
        }

        req.user = currentUser;
        next();
    } catch (err) {
        res.status(401).json({ status: 'fail', message: 'Invalid token' });
    }
};

exports.restrictTo = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ status: 'fail', message: 'You do not have permission to perform this action' });
        }
        next();
    };
};
