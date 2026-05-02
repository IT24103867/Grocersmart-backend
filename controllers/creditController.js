const CreditCustomer = require('../models/CreditCustomer');
const Transaction = require('../models/Transaction');
const apiResponse = require('../utils/apiResponse');
const { predictRisk } = require('../utils/aiService');
const mongoose = require('mongoose');

const NAME_REGEX = /^[a-zA-Z\s]+$/;
const PHONE_REGEX = /^[+]?[\d\s-]{9,15}$/;
const ADDRESS_REGEX = /^[a-zA-Z0-9\s,./\-#]+$/;

const getFirstValidationMessage = (errors = {}, fallback = 'Validation failed') => {
    const firstError = Object.values(errors).find((value) => typeof value === 'string' && value.trim());
    return firstError || fallback;
};

const serializeCustomer = (customerDoc) => {
    if (!customerDoc) return customerDoc;
    const customer = typeof customerDoc.toObject === 'function' ? customerDoc.toObject() : customerDoc;
    return {
        ...customer,
        id: String(customer._id || customer.id)
    };
};

const isValidCustomerId = (id) => {
    if (!id || id === 'undefined' || id === 'null') return false;
    return mongoose.Types.ObjectId.isValid(id);
};

const validateCreditPayload = (payload = {}, { partial = false } = {}) => {
    const errors = {};

    const shouldValidateName = !partial || payload.name !== undefined;
    if (shouldValidateName) {
        const name = String(payload.name || '').trim();
        if (!name) errors.name = 'Customer name is required';
        else if (!NAME_REGEX.test(name)) errors.name = 'Customer name must contain only letters';
    }

    const shouldValidatePhone = !partial || payload.phone !== undefined;
    if (shouldValidatePhone) {
        const phone = String(payload.phone || '').trim();
        if (!phone) errors.phone = 'Phone number is required';
        else if (!PHONE_REGEX.test(phone)) errors.phone = 'Please enter a valid phone number';
    }

    const shouldValidateAddress = !partial || payload.address !== undefined;
    if (shouldValidateAddress) {
        const address = String(payload.address || '').trim();
        if (!address) errors.address = 'Address is required';
        else if (!ADDRESS_REGEX.test(address)) errors.address = 'Address must contain only letters, numbers, and common characters';
    }

    const shouldValidateLimit = !partial || payload.creditLimit !== undefined;
    if (shouldValidateLimit) {
        const creditLimit = Number(payload.creditLimit);
        if (!Number.isFinite(creditLimit)) errors.creditLimit = 'Credit limit must be a valid number';
        else if (creditLimit <= 0) errors.creditLimit = 'Credit limit must be greater than 0';
    }

    const shouldValidateTerms = !partial || payload.paymentTermsDays !== undefined;
    if (shouldValidateTerms) {
        const paymentTermsDays = Number(payload.paymentTermsDays);
        if (!Number.isInteger(paymentTermsDays)) errors.paymentTermsDays = 'Payment terms must be a whole number';
        else if (paymentTermsDays < 1 || paymentTermsDays > 365) errors.paymentTermsDays = 'Payment terms must be between 1 and 365 days';
    }

    const allowedStatus = ['ACTIVE', 'INACTIVE'];
    if (payload.status !== undefined && !allowedStatus.includes(payload.status)) {
        errors.status = 'Status must be ACTIVE or INACTIVE';
    }

    const allowedTypes = ['CREDIT', 'CASH'];
    if (payload.customerType !== undefined && !allowedTypes.includes(payload.customerType)) {
        errors.customerType = 'Customer type must be CREDIT or CASH';
    }

    return errors;
};

const normalizeCreditPayload = (body = {}) => {
    const payload = { ...body };
    if (payload.riskScore !== undefined && payload.aiRiskScore === undefined) {
        payload.aiRiskScore = payload.riskScore;
    }
    delete payload.riskScore;

    if (payload.name !== undefined) payload.name = String(payload.name).trim();
    if (payload.phone !== undefined) payload.phone = String(payload.phone).trim();
    if (payload.address !== undefined) payload.address = String(payload.address || '').trim();
    if (payload.creditLimit !== undefined) {
        const rawCreditLimit = String(payload.creditLimit).trim();
        payload.creditLimit = rawCreditLimit === '' ? Number.NaN : Number(rawCreditLimit);
    }
    if (payload.paymentTermsDays !== undefined) {
        const rawPaymentTermsDays = String(payload.paymentTermsDays).trim();
        payload.paymentTermsDays = rawPaymentTermsDays === '' ? Number.NaN : Number(rawPaymentTermsDays);
    }

    // Prevent direct ledger/balance mutation from generic create/update payloads.
    delete payload.ledger;
    delete payload.currentBalance;
    delete payload.totalDebt;
    delete payload.outstandingBalance;

    return payload;
};

const toFiniteNumber = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
};

const mapCustomerToAiPayload = (customer) => {
    const ledger = Array.isArray(customer.ledger) ? customer.ledger : [];
    const debitEntries = ledger.filter((entry) => entry.type === 'Debit');
    const creditEntries = ledger.filter((entry) => entry.type === 'Credit');

    const creditLimit = Math.max(0, toFiniteNumber(customer.creditLimit));
    const currentOutstandingBalance = Math.max(0, toFiniteNumber(customer.currentBalance));

    const avgBillAmount = debitEntries.length
        ? debitEntries.reduce((sum, entry) => sum + Math.max(0, toFiniteNumber(entry.amount)), 0) / debitEntries.length
        : 0;

    const totalPaid = creditEntries.reduce((sum, entry) => sum + Math.max(0, toFiniteNumber(entry.amount)), 0);
    const totalBilled = debitEntries.reduce((sum, entry) => sum + Math.max(0, toFiniteNumber(entry.amount)), 0);

    const paymentRatio = totalBilled > 0 ? Math.min(1, totalPaid / totalBilled) : 0;

    // Use payment terms as a consistent project-native proxy for delays.
    const expectedDays = Math.max(1, toFiniteNumber(customer.paymentTermsDays, 30));
    const today = Date.now();
    const delayDays = creditEntries
        .map((entry) => {
            const ts = new Date(entry.date).getTime();
            if (!Number.isFinite(ts)) return 0;
            const elapsed = Math.floor((today - ts) / (1000 * 60 * 60 * 24));
            return Math.max(0, elapsed - expectedDays);
        });

    const numLatePayments = delayDays.filter((days) => days > 0).length;
    const avgDelay = delayDays.length
        ? delayDays.reduce((sum, days) => sum + days, 0) / delayDays.length
        : 0;
    const maxDelay = delayDays.length ? Math.max(...delayDays) : 0;
    const recentDelay = delayDays.length ? delayDays[delayDays.length - 1] : 0;

    const creditUtilization = creditLimit > 0
        ? Math.min(1, currentOutstandingBalance / creditLimit)
        : 0;

    return {
        credit_limit: Number(creditLimit.toFixed(2)),
        current_outstanding_balance: Number(currentOutstandingBalance.toFixed(2)),
        avg_bill_amount: Number(avgBillAmount.toFixed(2)),
        total_paid: Number(totalPaid.toFixed(2)),
        payment_ratio: Number(paymentRatio.toFixed(4)),
        num_late_payments: numLatePayments,
        avg_delay: Number(avgDelay.toFixed(2)),
        max_delay: Number(maxDelay.toFixed(2)),
        recent_delay: Number(recentDelay.toFixed(2)),
        credit_utilization: Number(creditUtilization.toFixed(4))
    };
};

exports.getAllCustomers = async (req, res, next) => {
    try {
        const { page = 0, size = 10, search, sort, status } = req.query;
        const filter = { isDeleted: false };
        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }
        if (status) filter.status = status;

        const skip = page * size;
        let sortBy = sort ? sort.replace(',', ' ') : '-createdAt';
        if (sortBy.includes('id')) sortBy = sortBy.replace('id', '_id');

        const customers = await CreditCustomer.find(filter)
            .sort(sortBy).skip(skip).limit(parseInt(size));

        const serializedCustomers = customers.map(serializeCustomer);

        const totalElements = await CreditCustomer.countDocuments(filter);
        res.status(200).json(apiResponse.success({
            content: serializedCustomers,
            totalElements,
            totalPages: Math.ceil(totalElements / size),
            size: parseInt(size),
            number: parseInt(page)
        }));
    } catch (err) { next(err); }
};

exports.getCustomer = async (req, res, next) => {
    try {
        if (!isValidCustomerId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid customer identifier'));
        }
        const customer = await CreditCustomer.findById(req.params.id);
        if (!customer) return res.status(404).json(apiResponse.error('Customer not found'));
        res.status(200).json(apiResponse.success(serializeCustomer(customer)));
    } catch (err) { next(err); }
};

exports.createCustomer = async (req, res, next) => {
    try {
        const normalizedBody = normalizeCreditPayload(req.body);
        const errors = validateCreditPayload(normalizedBody, { partial: false });
        if (Object.keys(errors).length > 0) {
            return res.status(400).json(apiResponse.error(getFirstValidationMessage(errors), errors));
        }

        const customer = await CreditCustomer.create(normalizedBody);
        res.status(201).json(apiResponse.success(serializeCustomer(customer), 'Customer created successfully'));
    } catch (err) { next(err); }
};

exports.updateCustomer = async (req, res, next) => {
    try {
        if (!isValidCustomerId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid customer identifier'));
        }

        const normalizedBody = normalizeCreditPayload(req.body);
        const errors = validateCreditPayload(normalizedBody, { partial: true });
        if (Object.keys(errors).length > 0) {
            return res.status(400).json(apiResponse.error(getFirstValidationMessage(errors), errors));
        }

        const customer = await CreditCustomer.findByIdAndUpdate(req.params.id, normalizedBody, {
            new: true, runValidators: true
        });
        if (!customer) return res.status(404).json(apiResponse.error('Customer not found'));
        res.status(200).json(apiResponse.success(serializeCustomer(customer), 'Customer updated successfully'));
    } catch (err) { next(err); }
};

exports.deleteCustomer = async (req, res, next) => {
    try {
        if (!isValidCustomerId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid customer identifier'));
        }
        const customer = await CreditCustomer.findByIdAndUpdate(req.params.id, {
            isDeleted: true, deletedAt: new Date()
        }, { new: true });
        if (!customer) return res.status(404).json(apiResponse.error('Customer not found'));
        res.status(200).json(apiResponse.success(null, 'Customer archived'));
    } catch (err) { next(err); }
};

// Record a payment — credits the customer's balance, appends to ledger
exports.addPayment = async (req, res, next) => {
    try {
        if (!isValidCustomerId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid customer identifier'));
        }

        const amount = Number(req.body.amount);
        const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json(apiResponse.error('Payment amount must be positive'));
        }
        const customer = await CreditCustomer.findById(req.params.id);
        if (!customer) return res.status(404).json(apiResponse.error('Customer not found'));
        if (amount > customer.currentBalance) {
            return res.status(400).json(apiResponse.error('Payment exceeds outstanding balance'));
        }

        customer.currentBalance = Math.max(0, customer.currentBalance - amount);
        customer.ledger.push({
            date: new Date(),
            type: 'Credit',
            amount,
            description: note || 'Payment received'
        });
        await customer.save();

        res.status(200).json(apiResponse.success(customer, 'Payment recorded'));
    } catch (err) { next(err); }
};

// Get full ledger for a customer
exports.getCustomerLedger = async (req, res, next) => {
    try {
        if (!isValidCustomerId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid customer identifier'));
        }
        const customer = await CreditCustomer.findById(req.params.id)
            .select('name phone currentBalance ledger publicId');
        if (!customer) return res.status(404).json(apiResponse.error('Customer not found'));
        res.status(200).json(apiResponse.success(serializeCustomer(customer)));
    } catch (err) { next(err); }
};

exports.getCustomerTransactions = async (req, res, next) => {
    try {
        if (!isValidCustomerId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid customer identifier'));
        }
        const transactions = await Transaction.find({ customer: req.params.id }).sort('-createdAt');
        res.status(200).json(apiResponse.success(transactions));
    } catch (err) { next(err); }
};

exports.getCustomerSummary = async (req, res, next) => {
    try {
        const result = await CreditCustomer.aggregate([
            { $match: { isDeleted: false } },
            {
                $group: {
                    _id: null,
                    totalOutstanding: { $sum: '$currentBalance' },
                    totalLimit: { $sum: '$creditLimit' }
                }
            }
        ]);
        const totalOutstanding = result[0]?.totalOutstanding || 0;
        const totalLimit = result[0]?.totalLimit || 0;
        res.status(200).json(apiResponse.success({
            totalOutstanding,
            totalLimit,
            totalAvailable: Math.max(0, totalLimit - totalOutstanding),
            activeCustomers: await CreditCustomer.countDocuments({ isDeleted: false, status: 'ACTIVE' }),
            defaulters: await CreditCustomer.countDocuments({ isDeleted: false, riskStatus: 'Defaulter' }),
            warnings: await CreditCustomer.countDocuments({ isDeleted: false, riskStatus: 'Warning' })
        }));
    } catch (err) { next(err); }
};

exports.getCustomerAccountSummary = async (req, res, next) => {
    try {
        if (!isValidCustomerId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid customer identifier'));
        }

        const customer = await CreditCustomer.findById(req.params.id).select(
            'name phone publicId address creditLimit currentBalance paymentTermsDays ledger status riskStatus aiRiskScore customerType'
        );

        if (!customer) {
            return res.status(404).json(apiResponse.error('Customer not found'));
        }

        const ledger = Array.isArray(customer.ledger) ? customer.ledger : [];
        const totalPaid = ledger
            .filter((entry) => entry.type === 'Credit')
            .reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
        const totalPurchases = ledger
            .filter((entry) => entry.type === 'Debit')
            .reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
        const latestPayment = ledger
            .filter((entry) => entry.type === 'Credit')
            .sort((a, b) => new Date(b.date) - new Date(a.date))[0];

        const customerData = serializeCustomer(customer);
        const outstandingBalance = Number(customerData.outstandingBalance || customerData.currentBalance || 0);
        const creditLimit = Number(customerData.creditLimit || 0);

        res.status(200).json(apiResponse.success({
            ...customerData,
            outstandingBalance,
            availableCredit: Math.max(0, creditLimit - outstandingBalance),
            totalPaid,
            totalPurchases,
            lastPaymentDate: latestPayment?.date || null
        }));
    } catch (err) {
        next(err);
    }
};

// AI Credit Risk Score Calculator
exports.calculateRiskScore = async (req, res, next) => {
    try {
        if (!isValidCustomerId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid customer identifier'));
        }
        const customer = await CreditCustomer.findById(req.params.id);
        if (!customer) return res.status(404).json(apiResponse.error('Customer not found'));

        const aiPayload = mapCustomerToAiPayload(customer);
        const aiResult = await predictRisk(aiPayload);

        const probability = toFiniteNumber(aiResult?.probability, 0);
        const score = Math.max(0, Math.min(100, Math.round(probability * 100)));

        const aiRisk = String(aiResult?.risk || '').toUpperCase();
        const riskStatus = aiRisk === 'HIGH' ? 'Defaulter' : 'Safe';

        customer.aiRiskScore = score;
        customer.riskStatus = riskStatus;
        await customer.save();

        res.status(200).json(apiResponse.success({
            aiRiskScore: score,
            riskStatus,
            probability,
            aiModelRisk: aiResult?.risk || null,
            confidence: toFiniteNumber(aiResult?.confidence, 0),
            thresholdUsed: aiResult?.threshold_used ?? null,
            inputFeatures: aiPayload
        }, 'AI Credit Risk Score updated'));
    } catch (err) { next(err); }
};
