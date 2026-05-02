const jwt = require('jsonwebtoken');
const User = require('../models/User');
const apiResponse = require('../utils/apiResponse');
const auditLogger = require('../utils/auditLogger');
const userController = require('./userController');

const signToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN
    });
};

exports.register = async (req, res, next) => {
    try {
        const fullName = String(req.body.fullName || '').trim();
        const username = String(req.body.username || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');
        const role = String(req.body.role || 'CASHIER').toUpperCase();

        const allowedRoles = ['ADMIN', 'MANAGER', 'CASHIER'];
        if (!fullName || fullName.length < 2) {
            return res.status(400).json(apiResponse.error('Full name must be at least 2 characters'));
        }
        if (!username || username.length < 3) {
            return res.status(400).json(apiResponse.error('Username must be at least 3 characters'));
        }
        if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
            return res.status(400).json(apiResponse.error('Valid email is required'));
        }
        if (!password || password.length < 6) {
            return res.status(400).json(apiResponse.error('Password must be at least 6 characters'));
        }
        if (!allowedRoles.includes(role)) {
            return res.status(400).json(apiResponse.error('Invalid role'));
        }

        const newUser = await User.create({
            fullName,
            username,
            email,
            password,
            role
        });

        const token = signToken(newUser._id);

        res.status(201).json(apiResponse.success({
            token,
            user: newUser
        }, 'Registration successful'));
    } catch (err) {
        next(err);
    }
};

exports.login = async (req, res, next) => {
    try {
        const username = String(req.body?.username || '').trim();
        const password = String(req.body?.password || '');

        if (!username || !password) {
            return res.status(400).json(apiResponse.error('Please provide username and password'));
        }

        const user = await User.findOne({ username, isDeleted: false }).select('+password');

        if (!user) {
            return res.status(401).json(apiResponse.error('Incorrect username or password'));
        }

        let passwordMatches = await user.correctPassword(password, user.password);

        // Recover accounts affected by legacy plain-text password updates.
        if (!passwordMatches && typeof user.password === 'string' && user.password === password) {
            user.password = password;
            await user.save();
            passwordMatches = true;
        }

        if (!passwordMatches) {
            return res.status(401).json(apiResponse.error('Incorrect username or password'));
        }

        if (user.status === 'INACTIVE') {
            return res.status(403).json(apiResponse.error('Your account is inactive. Please contact admin.'));
        }

        const token = signToken(user._id);

        await userController.updateLastLogin(user._id);
        await userController.logActivity(
            user._id,
            'LOGIN',
            req.ip || req.connection?.remoteAddress || 'unknown'
        );

        const updatedUser = await User.findById(user._id);

        await auditLogger.logAction(user._id, 'LOGIN', 'AUTH', `User logged in: ${user.username}`);

        res.status(200).json(apiResponse.success({
            token,
            user: updatedUser
        }, 'Login successful'));
    } catch (err) {
        next(err);
    }
};

exports.getStatus = async (req, res, next) => {
    try {
        const userCount = await User.countDocuments();
        res.status(200).json(apiResponse.success({
            status: 'operational',
            initialized: userCount > 0,
            timestamp: new Date()
        }));
    } catch (err) {
        next(err);
    }
};


