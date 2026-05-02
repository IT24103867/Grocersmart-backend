const Supplier = require('../models/Supplier');
const apiResponse = require('../utils/apiResponse');
const mongoose = require('mongoose');

const NAME_REGEX = /^[a-zA-Z\s]+$/;
const PHONE_REGEX = /^(?:0(?:70|71|72|74|75|76|77|78)\d{7}|\+94(?:70|71|72|74|75|76|77|78)\d{7})$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADDRESS_REGEX = /^[a-zA-Z0-9\s,./\-#]+$/;

const getFirstValidationMessage = (errors = {}, fallback = 'Validation failed') => {
    const firstError = Object.values(errors).find((value) => typeof value === 'string' && value.trim());
    return firstError || fallback;
};

const serializeSupplier = (supplierDoc) => {
    if (!supplierDoc) return supplierDoc;
    const supplier = typeof supplierDoc.toObject === 'function' ? supplierDoc.toObject() : supplierDoc;
    return {
        ...supplier,
        id: String(supplier._id || supplier.id)
    };
};

const isValidSupplierId = (id) => {
    if (!id || id === 'undefined' || id === 'null') return false;
    return mongoose.Types.ObjectId.isValid(id);
};

const getSupplierIdentifierFilter = (identifier) => {
    if (!identifier || identifier === 'undefined' || identifier === 'null') return null;
    if (mongoose.Types.ObjectId.isValid(identifier)) {
        return { _id: identifier };
    }
    return { publicId: String(identifier).trim() };
};

const normalizeSupplierPayload = (body = {}) => {
    const payload = { ...body };

    if (payload.name !== undefined) payload.name = String(payload.name || '').trim();
    if (payload.contactPerson !== undefined) payload.contactPerson = String(payload.contactPerson || '').trim();
    if (payload.phone !== undefined) payload.phone = String(payload.phone || '').trim();
    if (payload.email !== undefined) payload.email = String(payload.email || '').trim().toLowerCase();
    if (payload.address !== undefined) payload.address = String(payload.address || '').trim();

    if (typeof payload.supplyCategories === 'string') {
        payload.supplyCategories = payload.supplyCategories
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }
    if (Array.isArray(payload.supplyCategories)) {
        payload.supplyCategories = payload.supplyCategories
            .map((item) => String(item).trim())
            .filter(Boolean);
    }
    if (payload.outstandingPayable !== undefined) {
        if (String(payload.outstandingPayable).trim() === '') payload.outstandingPayable = Number.NaN;
        else payload.outstandingPayable = Number(payload.outstandingPayable);
    }

    delete payload._id;
    delete payload.id;
    delete payload.publicId;

    return payload;
};

const validateSupplierPayload = (payload = {}, { partial = false } = {}) => {
    const errors = {};

    const shouldValidateName = !partial || payload.name !== undefined;
    if (shouldValidateName) {
        const name = String(payload.name || '').trim();
        if (!name) errors.name = 'Supplier name is required';
        else if (!NAME_REGEX.test(name)) errors.name = 'Supplier name must contain only letters';
    }

    const shouldValidateContactPerson = !partial || payload.contactPerson !== undefined;
    if (shouldValidateContactPerson) {
        const contactPerson = String(payload.contactPerson || '').trim();
        if (!contactPerson) errors.contactPerson = 'Contact person is required';
        else if (!NAME_REGEX.test(contactPerson)) errors.contactPerson = 'Contact person must contain only letters';
    }

    const shouldValidatePhone = !partial || payload.phone !== undefined;
    if (shouldValidatePhone) {
        const phone = String(payload.phone || '').trim();
        if (!phone) errors.phone = 'Phone number is required';
        else if (!PHONE_REGEX.test(phone)) errors.phone = 'Phone number must be 07Xxxxxxxx or +947Xxxxxxxx (X: 0,1,2,4,5,6,7,8)';
    }

    const shouldValidateEmail = !partial || payload.email !== undefined;
    if (shouldValidateEmail) {
        const email = String(payload.email || '').trim();
        if (!email) errors.email = 'Email is required';
        else if (!EMAIL_REGEX.test(email)) errors.email = 'Please enter a valid email address';
    }

    const shouldValidateAddress = !partial || payload.address !== undefined;
    if (shouldValidateAddress) {
        const address = String(payload.address || '').trim();
        if (!address) errors.address = 'Address is required';
        else if (!ADDRESS_REGEX.test(address)) errors.address = 'Address must contain only letters, numbers, and common characters';
    }

    const shouldValidateCategories = !partial || payload.supplyCategories !== undefined;
    if (shouldValidateCategories) {
        if (!Array.isArray(payload.supplyCategories)) {
            errors.supplyCategories = 'Supply categories must be an array';
        } else if (payload.supplyCategories.length === 0) {
            errors.supplyCategories = 'Please add at least one supply category';
        }
    }

    if (payload.outstandingPayable !== undefined) {
        const outstandingPayable = Number(payload.outstandingPayable);
        if (!Number.isFinite(outstandingPayable) || outstandingPayable <= 0) {
            errors.outstandingPayable = 'Outstanding payable must be greater than 0';
        }
    }

    const allowedStatus = ['ACTIVE', 'INACTIVE'];
    if (payload.status !== undefined && !allowedStatus.includes(payload.status)) {
        errors.status = 'Status must be ACTIVE or INACTIVE';
    }

    return errors;
};

exports.getAllSuppliers = async (req, res, next) => {
    try {
        const { page = 0, size = 10, search, status, sort } = req.query;
        const filter = { isDeleted: false };
        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } },
                { contactPerson: { $regex: search, $options: 'i' } }
            ];
        }
        if (status) filter.status = status;

        const skip = page * size;
        let sortBy = sort ? sort.replace(',', ' ') : '-createdAt';
        if (sortBy.includes(' id')) sortBy = sortBy.replace(' id', ' _id');

        const suppliers = await Supplier.find(filter)
            .sort(sortBy)
            .skip(skip)
            .limit(parseInt(size));

        const serializedSuppliers = suppliers.map(serializeSupplier);

        const totalElements = await Supplier.countDocuments(filter);
        res.status(200).json(apiResponse.success({
            content: serializedSuppliers,
            totalElements,
            totalPages: Math.ceil(totalElements / size),
            size: parseInt(size),
            number: parseInt(page)
        }));
    } catch (err) { next(err); }
};

exports.getSupplier = async (req, res, next) => {
    try {
        const filter = getSupplierIdentifierFilter(req.params.id);
        if (!filter) {
            return res.status(400).json(apiResponse.error('Invalid supplier identifier'));
        }
        const supplier = await Supplier.findOne(filter);
        if (!supplier) return res.status(404).json(apiResponse.error('Supplier not found'));
        const supplierObj = serializeSupplier(supplier);
        supplierObj.purchaseOrdersSummary = {
            count: 0,
            totalValue: 0,
            pendingCount: 0
        };
        res.status(200).json(apiResponse.success(supplierObj));
    } catch (err) { next(err); }
};

exports.createSupplier = async (req, res, next) => {
    try {
        const payload = normalizeSupplierPayload(req.body);
        const validationErrors = validateSupplierPayload(payload, { partial: false });
        if (Object.keys(validationErrors).length > 0) {
            return res.status(400).json(apiResponse.error(getFirstValidationMessage(validationErrors), validationErrors));
        }

        const supplier = await Supplier.create(payload);
        res.status(201).json(apiResponse.success(serializeSupplier(supplier), 'Supplier created successfully'));
    } catch (err) { next(err); }
};

exports.updateSupplier = async (req, res, next) => {
    try {
        const filter = getSupplierIdentifierFilter(req.params.id);
        if (!filter) {
            return res.status(400).json(apiResponse.error('Invalid supplier identifier'));
        }
        const payload = normalizeSupplierPayload(req.body);
        const validationErrors = validateSupplierPayload(payload, { partial: true });
        if (Object.keys(validationErrors).length > 0) {
            return res.status(400).json(apiResponse.error(getFirstValidationMessage(validationErrors), validationErrors));
        }

        const supplier = await Supplier.findOneAndUpdate(filter, payload, {
            returnDocument: 'after', runValidators: true
        });
        if (!supplier) return res.status(404).json(apiResponse.error('Supplier not found'));
        res.status(200).json(apiResponse.success(serializeSupplier(supplier), 'Supplier updated'));
    } catch (err) { next(err); }
};

exports.deleteSupplier = async (req, res, next) => {
    try {
        const filter = getSupplierIdentifierFilter(req.params.id);
        if (!filter) {
            return res.status(400).json(apiResponse.error('Invalid supplier identifier'));
        }
        const supplier = await Supplier.findOneAndUpdate(filter, {
            isDeleted: true, deletedAt: new Date()
        }, { returnDocument: 'after' });
        if (!supplier) return res.status(404).json(apiResponse.error('Supplier not found'));
        res.status(200).json(apiResponse.success(null, 'Supplier archived'));
    } catch (err) { next(err); }
};

exports.getSuppliersSummary = async (req, res, next) => {
    try {
        const [total, active, inactive] = await Promise.all([
            Supplier.countDocuments({ isDeleted: false }),
            Supplier.countDocuments({ isDeleted: false, status: 'ACTIVE' }),
            Supplier.countDocuments({ isDeleted: false, status: 'INACTIVE' })
        ]);
        const payableResult = await Supplier.aggregate([
            { $match: { isDeleted: false } },
            { $group: { _id: null, totalPayable: { $sum: '$outstandingPayable' } } }
        ]);
        res.status(200).json(apiResponse.success({
            total, active, inactive,
            totalPayable: payableResult[0]?.totalPayable || 0
        }));
    } catch (err) { next(err); }
};
