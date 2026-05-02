const Cheque = require('../models/Cheque');
const CreditCustomer = require('../models/CreditCustomer');
const apiResponse = require('../utils/apiResponse');
const mongoose = require('mongoose');

const ALLOWED_STATUS = ['PENDING', 'DEPOSITED', 'CLEARED', 'BOUNCED'];
const ALLOWED_TYPES = ['Incoming', 'Outgoing'];
const CHEQUE_TEXT_REGEX = /^[a-zA-Z\s]+$/;
const CHEQUE_NUMBER_REGEX = /^\d{6}$/;

const getFirstValidationMessage = (errors = {}, fallback = 'Validation failed') => {
    const firstError = Object.values(errors).find((value) => typeof value === 'string' && value.trim());
    return firstError || fallback;
};

const serializeCheque = (chequeDoc) => {
    if (!chequeDoc) return chequeDoc;
    const cheque = typeof chequeDoc.toObject === 'function' ? chequeDoc.toObject() : chequeDoc;
    return {
        ...cheque,
        id: String(cheque._id || cheque.id),
        customerId: cheque.customerId || (cheque.customer?._id ? String(cheque.customer._id) : cheque.customer ? String(cheque.customer) : '')
    };
};

const isValidChequeId = (id) => {
    if (!id || id === 'undefined' || id === 'null') return false;
    return mongoose.Types.ObjectId.isValid(id);
};

const normalizeChequePayload = (body = {}) => {
    const payload = { ...body };

    if (payload.chequeNumber !== undefined) payload.chequeNumber = String(payload.chequeNumber || '').trim();
    if (payload.bankName !== undefined) payload.bankName = String(payload.bankName || '').trim();
    if (payload.branch !== undefined) payload.branch = String(payload.branch || '').trim();
    if (payload.chequeType !== undefined) payload.chequeType = String(payload.chequeType || '').trim();
    if (payload.amount !== undefined) {
        payload.amount = String(payload.amount).trim() === '' ? Number.NaN : Number(payload.amount);
    }
    if (payload.issueDate !== undefined) payload.issueDate = payload.issueDate ? new Date(payload.issueDate) : null;
    if (payload.dueDate !== undefined) payload.dueDate = payload.dueDate ? new Date(payload.dueDate) : null;
    if (payload.note !== undefined) payload.note = String(payload.note || '').trim();
    if (payload.customerId !== undefined) payload.customerId = String(payload.customerId || '').trim();

    delete payload._id;
    delete payload.id;
    delete payload.createdAt;
    delete payload.updatedAt;

    return payload;
};

const isValidDate = (value) => value instanceof Date && !Number.isNaN(value.getTime());

const validateChequePayload = (payload = {}, { partial = false } = {}) => {
    const errors = {};

    const shouldValidateNumber = !partial || payload.chequeNumber !== undefined;
    if (shouldValidateNumber) {
        const chequeNumber = String(payload.chequeNumber || '').trim();
        if (!chequeNumber) errors.chequeNumber = 'Cheque number is required';
        else if (!CHEQUE_NUMBER_REGEX.test(chequeNumber)) errors.chequeNumber = 'Cheque number must be exactly 6 digits';
    }

    const shouldValidateBank = !partial || payload.bankName !== undefined;
    if (shouldValidateBank) {
        const bankName = String(payload.bankName || '').trim();
        if (!bankName) errors.bankName = 'Bank name is required';
        else if (bankName.length < 2 || bankName.length > 100) errors.bankName = 'Bank name must be between 2 and 100 characters';
        else if (!CHEQUE_TEXT_REGEX.test(bankName)) errors.bankName = 'Bank name must contain only letters';
    }

    const shouldValidateBranch = !partial || payload.branch !== undefined;
    if (shouldValidateBranch) {
        const branch = String(payload.branch || '').trim();
        if (!branch) errors.branch = 'Branch is required';
        else if (branch.length > 100) errors.branch = 'Branch cannot exceed 100 characters';
        else if (!CHEQUE_TEXT_REGEX.test(branch)) errors.branch = 'Branch must contain only letters';
    }

    const shouldValidateType = !partial || payload.chequeType !== undefined;
    if (shouldValidateType && !ALLOWED_TYPES.includes(payload.chequeType)) {
        errors.chequeType = 'Cheque type must be Incoming or Outgoing';
    }

    const shouldValidateAmount = !partial || payload.amount !== undefined;
    if (shouldValidateAmount) {
        if (!Number.isFinite(payload.amount)) errors.amount = 'Amount is required and must be a valid number';
        else if (payload.amount <= 0) errors.amount = 'Amount must be greater than zero';
    }

    const shouldValidateIssueDate = !partial || payload.issueDate !== undefined;
    if (shouldValidateIssueDate) {
        if (!isValidDate(payload.issueDate)) errors.issueDate = 'Issue date is required and must be valid';
    }

    const shouldValidateDueDate = !partial || payload.dueDate !== undefined;
    if (shouldValidateDueDate) {
        if (!isValidDate(payload.dueDate)) errors.dueDate = 'Due date is required and must be valid';
    }

    if (isValidDate(payload.issueDate) && isValidDate(payload.dueDate) && payload.dueDate < payload.issueDate) {
        errors.dueDate = 'Due date cannot be before issue date';
    }

    const shouldValidateIncomingCustomer = (!partial && (payload.chequeType || 'Incoming') === 'Incoming')
        || (partial && payload.chequeType === 'Incoming');
    if (shouldValidateIncomingCustomer && !payload.customerId) {
        errors.customerId = 'Customer is required for incoming cheques';
    }

    if (payload.customerId && !mongoose.Types.ObjectId.isValid(payload.customerId)) {
        errors.customerId = 'Invalid customer identifier';
    }

    return errors;
};

const validateStatusPayload = (payload = {}) => {
    const errors = {};
    const { status, depositDate, clearedDate, bouncedDate, bounceReason } = payload;

    if (!ALLOWED_STATUS.includes(status)) {
        errors.status = 'Invalid cheque status';
        return errors;
    }

    if (status === 'DEPOSITED') {
        if (!depositDate || !isValidDate(new Date(depositDate))) {
            errors.depositDate = 'Deposit date is required for DEPOSITED status';
        }
    }

    if (status === 'CLEARED') {
        if (!clearedDate || !isValidDate(new Date(clearedDate))) {
            errors.clearedDate = 'Cleared date is required for CLEARED status';
        }
    }

    if (status === 'BOUNCED') {
        if (!bouncedDate || !isValidDate(new Date(bouncedDate))) {
            errors.bouncedDate = 'Bounced date is required for BOUNCED status';
        }
        if (!String(bounceReason || '').trim()) {
            errors.bounceReason = 'Bounce reason is required for BOUNCED status';
        }
    }

    return errors;
};

exports.getAllCheques = async (req, res, next) => {
    try {
        const { page = 0, size = 10, search, status, sort } = req.query;
        const filter = { isDeleted: false };
        if (search) {
            filter.$or = [
                { chequeNumber: { $regex: search, $options: 'i' } },
                { bankName: { $regex: search, $options: 'i' } }
            ];
        }
        if (status) filter.status = status;

        const skip = page * size;
        const cheques = await Cheque.find(filter)
            .populate('customer', 'name phone publicId')
            .sort(sort ? sort.replace(',', ' ') : 'dueDate')
            .skip(skip)
            .limit(parseInt(size));

        const serializedCheques = cheques.map(serializeCheque);

        const totalElements = await Cheque.countDocuments(filter);

        res.status(200).json(apiResponse.success({
            content: serializedCheques,
            totalElements,
            totalPages: Math.ceil(totalElements / size),
            size: parseInt(size),
            number: parseInt(page)
        }));
    } catch (err) {
        next(err);
    }
};

exports.getCheque = async (req, res, next) => {
    try {
        if (!isValidChequeId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid cheque identifier'));
        }
        const cheque = await Cheque.findById(req.params.id).populate('customer', 'name phone publicId');
        if (!cheque) {
            return res.status(404).json(apiResponse.error('Cheque not found'));
        }
        res.status(200).json(apiResponse.success(serializeCheque(cheque)));
    } catch (err) {
        next(err);
    }
};

exports.createCheque = async (req, res, next) => {
    try {
        const body = normalizeChequePayload(req.body);
        const validationErrors = validateChequePayload(body, { partial: false });
        if (Object.keys(validationErrors).length > 0) {
            return res.status(400).json(apiResponse.error(getFirstValidationMessage(validationErrors), validationErrors));
        }

        // If customerId is provided as a string, resolve to ObjectId reference
        if (body.customerId) {
            const customer = await CreditCustomer.findById(body.customerId);
            if (!customer) {
                return res.status(404).json(apiResponse.error('Customer not found'));
            }
            body.customer = customer._id;
        }
        const cheque = await Cheque.create(body);
        res.status(201).json(apiResponse.success(serializeCheque(cheque), 'Cheque recorded successfully'));
    } catch (err) {
        next(err);
    }
};

exports.updateCheque = async (req, res, next) => {
    try {
        if (!isValidChequeId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid cheque identifier'));
        }
        const body = normalizeChequePayload(req.body);
        const validationErrors = validateChequePayload(body, { partial: true });
        if (Object.keys(validationErrors).length > 0) {
            return res.status(400).json(apiResponse.error(getFirstValidationMessage(validationErrors), validationErrors));
        }

        if (body.customerId) {
            const customer = await CreditCustomer.findById(body.customerId);
            if (!customer) {
                return res.status(404).json(apiResponse.error('Customer not found'));
            }
            body.customer = customer._id;
        }
        const cheque = await Cheque.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
        if (!cheque) {
            return res.status(404).json(apiResponse.error('Cheque not found'));
        }
        res.status(200).json(apiResponse.success(serializeCheque(cheque), 'Cheque updated successfully'));
    } catch (err) {
        next(err);
    }
};

exports.updateChequeStatus = async (req, res, next) => {
    try {
        if (!isValidChequeId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid cheque identifier'));
        }
        const { status, depositDate, clearedDate, bouncedDate, bounceReason } = req.body;
        const validationErrors = validateStatusPayload({ status, depositDate, clearedDate, bouncedDate, bounceReason });
        if (Object.keys(validationErrors).length > 0) {
            return res.status(400).json(apiResponse.error(getFirstValidationMessage(validationErrors), validationErrors));
        }

        const updateData = { status };
        if (depositDate) updateData.depositDate = depositDate;
        if (clearedDate) updateData.clearedDate = clearedDate;
        if (bouncedDate) updateData.bouncedDate = bouncedDate;
        if (bounceReason) updateData.bounceReason = bounceReason;

        const cheque = await Cheque.findByIdAndUpdate(req.params.id, updateData, { new: true });
        if (!cheque) {
            return res.status(404).json(apiResponse.error('Cheque not found'));
        }
        res.status(200).json(apiResponse.success(serializeCheque(cheque), `Cheque marked as ${status}`));
    } catch (err) {
        next(err);
    }
};

exports.deleteCheque = async (req, res, next) => {
    try {
        if (!isValidChequeId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid cheque identifier'));
        }
        const cheque = await Cheque.findByIdAndUpdate(req.params.id, {
            isDeleted: true,
            deletedAt: new Date()
        }, { new: true });
        if (!cheque) {
            return res.status(404).json(apiResponse.error('Cheque not found'));
        }
        res.status(200).json(apiResponse.success(null, 'Cheque record removed'));
    } catch (err) {
        next(err);
    }
};

exports.getChequesSummary = async (req, res, next) => {
    try {
        const filter = { isDeleted: false };
        const [pending, deposited, cleared, bounced] = await Promise.all([
            Cheque.countDocuments({ ...filter, status: 'PENDING' }),
            Cheque.countDocuments({ ...filter, status: 'DEPOSITED' }),
            Cheque.countDocuments({ ...filter, status: 'CLEARED' }),
            Cheque.countDocuments({ ...filter, status: 'BOUNCED' })
        ]);

        const totalAmountResult = await Cheque.aggregate([
            { $match: filter },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        res.status(200).json(apiResponse.success({
            pending,
            deposited,
            cleared,
            bounced,
            totalAmount: totalAmountResult[0]?.total || 0
        }));
    } catch (err) {
        next(err);
    }
};
