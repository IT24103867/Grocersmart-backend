const User = require('../models/User');
const apiResponse = require('../utils/apiResponse');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const NAME_REGEX = /^[a-zA-Z\s]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,30}$/;
const PHONE_REGEX = /^(?:0(?:70|71|72|74|75|76|77|78)\d{7}|\+94(?:70|71|72|74|75|76|77|78)\d{7})$/;

const sanitizePermissions = (permissions) => {
    if (!Array.isArray(permissions)) return undefined;
    return permissions.filter((permission) => typeof permission === 'string' && permission.trim());
};

const getFirstValidationMessage = (errors = {}, fallback = 'Validation failed') => {
    const firstError = Object.values(errors).find((value) => typeof value === 'string' && value.trim());
    return firstError || fallback;
};

const validateUserPayload = (body = {}, { isCreate = false } = {}) => {
    const errors = {};

    if (isCreate || body.fullName !== undefined) {
        const fullName = String(body.fullName || '').trim();
        if (!fullName) errors.fullName = 'Full name is required';
        else if (!NAME_REGEX.test(fullName)) errors.fullName = 'Full name must contain only letters';
    }

    if (isCreate || body.username !== undefined) {
        const username = String(body.username || '').trim();
        if (!username) errors.username = 'Username is required';
        else if (!USERNAME_REGEX.test(username)) errors.username = 'Username must be 3-30 characters (letters, numbers, _, -, . only)';
    }

    if (isCreate) {
        const password = String(body.password || '');
        if (!password) errors.password = 'Password is required';
        else if (password.length < 8) errors.password = 'Password must be at least 8 characters';
    } else if (body.password !== undefined && body.password !== '') {
        const password = String(body.password);
        if (password.length < 8) errors.password = 'Password must be at least 8 characters';
    }

    if (isCreate || body.email !== undefined) {
        const email = String(body.email || '').trim();
        if (!email) errors.email = 'Email is required';
        else if (!EMAIL_REGEX.test(email)) errors.email = 'Please enter a valid email address';
    }

    if (isCreate || body.phone !== undefined) {
        const phone = String(body.phone || '').trim();
        if (!phone) errors.phone = 'Phone number is required';
        else if (!PHONE_REGEX.test(phone)) errors.phone = 'Phone number must be 070-078 format with 0 or +94';
    }

    const allowedRoles = ['ADMIN', 'MANAGER', 'CASHIER'];
    if (body.role !== undefined && !allowedRoles.includes(body.role)) {
        errors.role = 'Invalid role';
    }

    return errors;
};

const serializeUser = (userDoc) => {
    if (!userDoc) return userDoc;
    const user = typeof userDoc.toObject === 'function' ? userDoc.toObject() : userDoc;
    return {
        ...user,
        id: String(user._id || user.id)
    };
};

const isValidUserId = (id) => {
    if (!id || id === 'undefined' || id === 'null') return false;
    return mongoose.Types.ObjectId.isValid(id);
};

exports.logActivity = async (userId, action, ipAddress = 'unknown') => {
    if (!userId || !action) return;
    const user = await User.findById(userId);
    if (!user) return;
    user.activityLogs.push({
        action,
        timestamp: new Date(),
        ipAddress
    });
    if (user.activityLogs.length > 50) {
        user.activityLogs = user.activityLogs.slice(-50);
    }
    await user.save({ validateBeforeSave: false });
};

exports.updateLastLogin = async (userId) => {
    if (!userId) return;
    await User.findByIdAndUpdate(userId, { lastLogin: new Date() }, { new: true });
};

exports.getAllUsers = async (req, res, next) => {
    try {
        const { page = 0, size = 10, search, role, status, sort } = req.query;

        const filter = { isDeleted: false };
        if (search) {
            filter.$or = [
                { fullName: { $regex: search, $options: 'i' } },
                { username: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }
        if (role) filter.role = role;
        if (status) filter.status = status;

        const skip = page * size;
        let sortBy = sort ? sort.replace(',', ' ') : '-createdAt';
        if (sortBy.includes(' id')) sortBy = sortBy.replace(' id', ' _id');

        const users = await User.find(filter)
            .sort(sortBy)
            .skip(skip)
            .limit(parseInt(size));

        const serializedUsers = users.map(serializeUser);

        const totalElements = await User.countDocuments(filter);

        res.status(200).json(apiResponse.success({
            content: serializedUsers,
            totalElements,
            totalPages: Math.ceil(totalElements / size),
            size: parseInt(size),
            number: parseInt(page)
        }));
    } catch (err) {
        next(err);
    }
};

exports.getUser = async (req, res, next) => {
    try {
        if (!isValidUserId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid user identifier'));
        }
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json(apiResponse.error('User not found'));
        res.status(200).json(apiResponse.success(serializeUser(user)));
    } catch (err) {
        next(err);
    }
};

exports.createUser = async (req, res, next) => {
    try {
        const body = { ...req.body };
        const errors = validateUserPayload(body, { isCreate: true });
        if (Object.keys(errors).length > 0) {
            return res.status(400).json(apiResponse.error(getFirstValidationMessage(errors), errors));
        }
        const { fullName, username, email, password, phone, role, permissions } = body;
        const existing = await User.findOne({ username: username.trim(), isDeleted: false });
        if (existing) {
            return res.status(409).json(apiResponse.error('Username already exists'));
        }
        const newUser = await User.create({
            fullName: fullName.trim(),
            username: username.trim(),
            email: email ? email.trim() : undefined,
            password,
            phone: phone ? String(phone).trim() : undefined,
            role,
            permissions: sanitizePermissions(permissions)
        });
        res.status(201).json(apiResponse.success(serializeUser(newUser), 'User created successfully'));
    } catch (err) {
        next(err);
    }
};

exports.updateUser = async (req, res, next) => {
    try {
        if (!isValidUserId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid user identifier'));
        }
        const body = { ...req.body };

        const errors = validateUserPayload(body, { isCreate: false });
        if (Object.keys(errors).length > 0) {
            return res.status(400).json(apiResponse.error(getFirstValidationMessage(errors), errors));
        }

        if (body.permissions !== undefined) {
            body.permissions = sanitizePermissions(body.permissions) || [];
        }
        // Never update password via this route if blank
        if (!body.password) delete body.password;
        else body.password = await bcrypt.hash(String(body.password), 12);

        if (body.username) {
            const conflict = await User.findOne({ username: body.username.trim(), isDeleted: false, _id: { $ne: req.params.id } });
            if (conflict) return res.status(409).json(apiResponse.error('Username already taken'));
        }

        const user = await User.findByIdAndUpdate(req.params.id, body, {
            new: true,
            runValidators: true
        });
        if (!user) return res.status(404).json(apiResponse.error('User not found'));
        res.status(200).json(apiResponse.success(serializeUser(user), 'User updated successfully'));
    } catch (err) {
        next(err);
    }
};

exports.deleteUser = async (req, res, next) => {
    try {
        if (!isValidUserId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid user identifier'));
        }
        const user = await User.findByIdAndUpdate(req.params.id, {
            isDeleted: true,
            deletedAt: new Date()
        }, { new: true });
        if (!user) return res.status(404).json(apiResponse.error('User not found'));
        res.status(200).json(apiResponse.success(null, 'User deactivated successfully'));
    } catch (err) {
        next(err);
    }
};

exports.activateUser = async (req, res, next) => {
    try {
        if (!isValidUserId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid user identifier'));
        }
        const user = await User.findByIdAndUpdate(req.params.id, { status: 'ACTIVE' }, { new: true });
        if (!user) return res.status(404).json(apiResponse.error('User not found'));
        res.status(200).json(apiResponse.success(serializeUser(user), 'User activated'));
    } catch (err) {
        next(err);
    }
};

exports.deactivateUser = async (req, res, next) => {
    try {
        if (!isValidUserId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid user identifier'));
        }
        const user = await User.findByIdAndUpdate(req.params.id, { status: 'INACTIVE' }, { new: true });
        if (!user) return res.status(404).json(apiResponse.error('User not found'));
        res.status(200).json(apiResponse.success(serializeUser(user), 'User deactivated'));
    } catch (err) {
        next(err);
    }
};

exports.updatePermissions = async (req, res, next) => {
    try {
        if (!isValidUserId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid user identifier'));
        }
        const { permissions } = req.body;
        if (!Array.isArray(permissions)) {
            return res.status(400).json(apiResponse.error('permissions must be an array'));
        }

        const allowedPermissions = [
            'POS_ACCESS',
            'VOID_SALE',
            'VIEW_REPORTS',
            'MANAGE_INVENTORY',
            'MANAGE_USERS',
            'MANAGE_CREDIT'
        ];

        const invalidPermissions = permissions.filter((item) => !allowedPermissions.includes(String(item)));
        if (invalidPermissions.length > 0) {
            return res.status(400).json(apiResponse.error(`Invalid permissions: ${invalidPermissions.join(', ')}`));
        }

        const user = await User.findByIdAndUpdate(req.params.id, { permissions: sanitizePermissions(permissions) || [] }, { new: true });
        if (!user) return res.status(404).json(apiResponse.error('User not found'));
        res.status(200).json(apiResponse.success(serializeUser(user), 'Permissions updated'));
    } catch (err) {
        next(err);
    }
};

exports.getActivityLogs = async (req, res, next) => {
    try {
        if (!isValidUserId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid user identifier'));
        }
        const user = await User.findById(req.params.id).select('activityLogs fullName username');
        if (!user) return res.status(404).json(apiResponse.error('User not found'));
        res.status(200).json(apiResponse.success(user.activityLogs));
    } catch (err) {
        next(err);
    }
};
