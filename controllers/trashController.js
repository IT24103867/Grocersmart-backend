const User = require('../models/User');
const Product = require('../models/Product');
const Supplier = require('../models/Supplier');
const CreditCustomer = require('../models/CreditCustomer');
const Transaction = require('../models/Transaction');
const Cheque = require('../models/Cheque');
const mongoose = require('mongoose');
const apiResponse = require('../utils/apiResponse');

const getModel = (type) => {
    const t = String(type || '').toLowerCase();
    switch (t) {
        case 'user':
        case 'users': return User;
        case 'product':
        case 'products': return Product;
        case 'supplier':
        case 'suppliers': return Supplier;
        case 'credit-customer':
        case 'credit-customers': return CreditCustomer;
        case 'order':
        case 'orders':
        case 'sale':
        case 'sales': return Transaction;
        case 'cheque':
        case 'cheques': return Cheque;
        default: return null;
    }
};

const serializeTrashItem = (doc) => {
    if (!doc) return doc;
    const item = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    return {
        ...item,
        id: String(item._id || item.id)
    };
};

const isValidObjectId = (id) => {
    if (!id || id === 'undefined' || id === 'null') return false;
    return mongoose.Types.ObjectId.isValid(id);
};

exports.getDeletedItems = async (req, res, next) => {
    try {
        const { type } = req.params;
        const Model = getModel(type);
        if (!Model) return res.status(400).json(apiResponse.error('Invalid entity type'));

        const items = await Model.find({ isDeleted: true }).sort('-deletedAt');
        const serializedItems = items.map(item => ({ ...serializeTrashItem(item), entityType: type }));
        res.status(200).json(apiResponse.success(serializedItems));
    } catch (err) {
        next(err);
    }
};

exports.getAllDeletedItems = async (req, res, next) => {
    try {
        const types = ['products', 'suppliers', 'credit-customers', 'cheques', 'orders'];
        const results = await Promise.all(types.map(async (type) => {
            const Model = getModel(type);
            const items = await Model.find({ isDeleted: true });
            return items.map(item => ({ ...serializeTrashItem(item), entityType: type }));
        }));

        const flattened = results.flat().sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
        res.status(200).json(apiResponse.success(flattened));
    } catch (err) {
        next(err);
    }
};

exports.restoreItem = async (req, res, next) => {
    try {
        const { type, id } = req.params;
        const Model = getModel(type);
        if (!Model) return res.status(400).json(apiResponse.error('Invalid entity type'));
        if (!isValidObjectId(id)) return res.status(400).json(apiResponse.error('Invalid item identifier'));

        const item = await Model.findByIdAndUpdate(id, { 
            isDeleted: false,
            deletedAt: null
        }, { new: true });

        if (!item) return res.status(404).json(apiResponse.error('Item not found'));
        res.status(200).json(apiResponse.success(item, 'Item restored successfully'));
    } catch (err) {
        next(err);
    }
};

exports.permanentDelete = async (req, res, next) => {
    try {
        const { type, id } = req.params;
        const Model = getModel(type);
        if (!Model) return res.status(400).json(apiResponse.error('Invalid entity type'));
        if (!isValidObjectId(id)) return res.status(400).json(apiResponse.error('Invalid item identifier'));

        const item = await Model.findByIdAndDelete(id);
        if (!item) return res.status(404).json(apiResponse.error('Item not found'));

        res.status(200).json(apiResponse.success(null, 'Item deleted permanently'));
    } catch (err) {
        next(err);
    }
};
