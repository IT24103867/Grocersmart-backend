const Product = require('../models/Product');
const apiResponse = require('../utils/apiResponse');
const auditLogger = require('../utils/auditLogger');
const mongoose = require('mongoose');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const PRODUCT_TEXT_REGEX = /^[a-zA-Z0-9\s&()\-/.#,]+$/;

const isPastDateString = (value) => {
    if (!value) return false;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    return date < today;
};

const getFirstValidationMessage = (errors = {}, fallback = 'Validation failed') => {
    const firstError = Object.values(errors).find((value) => typeof value === 'string' && value.trim());
    return firstError || fallback;
};

const validateProductPayload = (payload = {}) => {
    const errors = {};

    if (!String(payload.name || '').trim()) errors.name = 'Product name is required';
    else if (!PRODUCT_TEXT_REGEX.test(String(payload.name || '').trim())) errors.name = 'Product name contains invalid characters';

    if (!String(payload.category || '').trim()) errors.category = 'Category is required';
    else if (!PRODUCT_TEXT_REGEX.test(String(payload.category || '').trim())) errors.category = 'Category contains invalid characters';

    const bulkUnit = String(payload?.unitConfig?.bulkUnit || '').trim();
    const retailUnit = String(payload?.unitConfig?.retailUnit || '').trim();
    if (!bulkUnit) errors.bulkUnit = 'Bulk unit is required';
    else if (!PRODUCT_TEXT_REGEX.test(bulkUnit)) errors.bulkUnit = 'Bulk unit contains invalid characters';
    if (!retailUnit) errors.retailUnit = 'Retail unit is required';
    else if (!PRODUCT_TEXT_REGEX.test(retailUnit)) errors.retailUnit = 'Retail unit contains invalid characters';

    const numericNonNegativeFields = ['unitPrice', 'bulkPrice', 'purchasePrice', 'reorderPoint'];
    for (const field of numericNonNegativeFields) {
        if (payload[field] !== undefined) {
            if (typeof payload[field] === 'string' && payload[field].trim() === '') {
                errors[field] = `${field} is required`;
                continue;
            }
            const value = Number(payload[field]);
            if (!Number.isFinite(value)) errors[field] = `${field} must be a valid number`;
            else if (value < 0) errors[field] = `${field} cannot be negative`;
        }
    }

    if (Number(payload.unitPrice) <= 0) errors.unitPrice = 'unitPrice must be greater than zero';
    if (Number(payload.bulkPrice) <= 0) errors.bulkPrice = 'bulkPrice must be greater than zero';
    if (Number(payload.reorderPoint) < 1) errors.reorderPoint = 'reorderPoint must be at least 1';

    // Price hierarchy validations
    if (!errors.unitPrice && !errors.purchasePrice) {
        const unitPrice = Number(payload.unitPrice);
        const purchasePrice = Number(payload.purchasePrice || 0);
        if (unitPrice <= purchasePrice) {
            errors.unitPrice = 'Unit price must be greater than purchase price';
        }
    }

    if (!errors.bulkPrice && !errors.purchasePrice) {
        const bulkPrice = Number(payload.bulkPrice);
        const purchasePrice = Number(payload.purchasePrice || 0);
        if (bulkPrice <= purchasePrice) {
            errors.bulkPrice = 'Bulk price must be greater than purchase price';
        }
    }

    if (!errors.unitPrice && !errors.bulkPrice) {
        const unitPrice = Number(payload.unitPrice);
        const bulkPrice = Number(payload.bulkPrice);
        if (unitPrice <= bulkPrice) {
            errors.unitPrice = 'Unit price must be greater than bulk price';
        }
    }

    if (payload.unitConfig?.conversionFactor !== undefined) {
        const factor = Number(payload.unitConfig.conversionFactor);
        if (!Number.isFinite(factor) || factor <= 0) {
            errors.conversionFactor = 'conversionFactor must be greater than zero';
        }
    }

    if (payload.stockLevels) {
        const bulkQty = Number(payload.stockLevels.bulkQty);
        const retailQty = Number(payload.stockLevels.retailQty);
        if (!Number.isFinite(bulkQty) || bulkQty < 0) errors.bulkQty = 'bulkQty cannot be negative';
        if (!Number.isFinite(retailQty) || retailQty < 0) errors.retailQty = 'retailQty cannot be negative';
    }

    if (Array.isArray(payload.batchDetails)) {
        payload.batchDetails.forEach((batch, index) => {
            const batchId = String(batch?.batchId || '').trim();
            if (batchId && !PRODUCT_TEXT_REGEX.test(batchId)) {
                errors[`batchDetails.${index}.batchId`] = 'Batch ID contains invalid characters';
            }
            if (batch?.expiryDate && isPastDateString(batch.expiryDate)) {
                errors[`batchDetails.${index}.expiryDate`] = 'Expiry date cannot be in the past';
            }
            if (batch?.costPrice === '') {
                errors[`batchDetails.${index}.costPrice`] = 'Batch costPrice is required';
                return;
            }
            const costPrice = Number(batch.costPrice);
            if (!Number.isFinite(costPrice) || costPrice < 0) {
                errors[`batchDetails.${index}.costPrice`] = 'Batch costPrice cannot be negative';
            }
        });
    }

    if (payload.family !== undefined) {
        const family = String(payload.family || '').trim();
        if (!family) errors.family = 'family is required';
    }

    if (payload.store_nbr !== undefined) {
        const storeNbr = Number(payload.store_nbr);
        if (!Number.isInteger(storeNbr) || storeNbr < 1) {
            errors.store_nbr = 'store_nbr must be an integer greater than or equal to 1';
        }
    }

    if (payload.onpromotion !== undefined) {
        const onpromotion = Number(payload.onpromotion);
        if (!Number.isFinite(onpromotion) || onpromotion < 0) {
            errors.onpromotion = 'onpromotion must be a non-negative number';
        }
    }

    return errors;
};

const normalizeProductPayload = (body = {}) => {
    const payload = { ...body };

    const conversionFactor = Number(
        payload?.unitConfig?.conversionFactor ?? payload.unitsPerBulk ?? 1
    ) || 1;

    payload.unitConfig = {
        bulkUnit: payload?.unitConfig?.bulkUnit || 'Case',
        retailUnit: payload?.unitConfig?.retailUnit || 'Piece',
        conversionFactor
    };

    payload.stockLevels = {
        bulkQty: Number(payload?.stockLevels?.bulkQty ?? payload.bulkQty ?? 0) || 0,
        retailQty: Number(payload?.stockLevels?.retailQty ?? payload.unitQty ?? 0) || 0
    };

    payload.reorderPoint = Number(payload.reorderPoint ?? payload.reorderLevel ?? 10) || 10;

    payload.family = String(payload.family || payload.category || 'GENERAL').trim() || 'GENERAL';
    payload.store_nbr = 1;
    payload.onpromotion = 0;

    if (Array.isArray(payload.batchDetails)) {
        payload.batchDetails = payload.batchDetails
            .filter((batch) => batch && (batch.batchId || batch.expiryDate || batch.costPrice !== undefined))
            .map((batch) => ({
                batchId: batch.batchId || '',
                expiryDate: batch.expiryDate || null,
                costPrice: Number(batch.costPrice || 0)
            }));
    } else if (payload.expiryDate) {
        payload.batchDetails = [{
            batchId: 'DEFAULT',
            expiryDate: payload.expiryDate,
            costPrice: Number(payload.purchasePrice || 0)
        }];
    }

    delete payload.bulkQty;
    delete payload.unitQty;
    delete payload.unitsPerBulk;
    delete payload.reorderLevel;
    delete payload.expiryDate;
    delete payload._id;
    delete payload.id;
    delete payload.publicId;
    delete payload.sku;
    delete payload.SKU;

    return payload;
};

exports.getAllProducts = async (req, res, next) => {
    try {
        const { page = 0, size = 10, search, category, status, sort } = req.query;

        const filter = { isDeleted: false };
        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: 'i' } },
                { publicId: { $regex: search, $options: 'i' } }
            ];
        }
        if (category) filter.category = category;
        if (status) filter.status = status;

        const skip = page * size;
        let sortBy = sort ? sort.replace(',', ' ') : '-createdAt';
        if (sortBy.includes('id')) sortBy = sortBy.replace('id', '_id');

        const products = await Product.find(filter)
            .sort(sortBy)
            .skip(skip)
            .limit(parseInt(size));

        const enrichedProducts = products.map((productDoc) => {
            const product = productDoc.toObject({ virtuals: true });
            const totalInRetailUnits = Number(product.totalInRetailUnits || product.stockLevels?.totalInRetailUnits || 0);
            return {
                ...product,
                totalInRetailUnits,
                lowStockAlert: totalInRetailUnits <= Number(product.reorderPoint || 0)
            };
        });


        const totalElements = await Product.countDocuments(filter);

        res.status(200).json(apiResponse.success({
            content: enrichedProducts,
            totalElements,
            totalPages: Math.ceil(totalElements / size),
            size: parseInt(size),
            number: parseInt(page)
        }));
    } catch (err) {
        next(err);
    }
};

exports.getProduct = async (req, res, next) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json(apiResponse.error('Product not found'));
        }
        res.status(200).json(apiResponse.success(product));
    } catch (err) {
        next(err);
    }
};

exports.createProduct = async (req, res, next) => {
    try {
        const payload = normalizeProductPayload(req.body);
        const validationErrors = validateProductPayload(payload);
        if (Object.keys(validationErrors).length > 0) {
            return res.status(400).json(apiResponse.error(getFirstValidationMessage(validationErrors), validationErrors));
        }
        const newProduct = await Product.create(payload);
        await auditLogger.logAction(req.user._id, 'CREATE', 'PRODUCTS', `Created product: ${newProduct.name}`);
        res.status(201).json(apiResponse.success(newProduct, 'Product created successfully'));
    } catch (err) {
        next(err);
    }
};

exports.updateProduct = async (req, res, next) => {
    try {
        const payload = normalizeProductPayload(req.body);
        const validationErrors = validateProductPayload(payload);
        if (Object.keys(validationErrors).length > 0) {
            return res.status(400).json(apiResponse.error(getFirstValidationMessage(validationErrors), validationErrors));
        }
        const product = await Product.findByIdAndUpdate(req.params.id, payload, {
            new: true,
            runValidators: true
        });

        if (!product) {
            return res.status(404).json(apiResponse.error('Product not found'));
        }
        await auditLogger.logAction(req.user._id, 'UPDATE', 'PRODUCTS', `Updated product: ${product.name}`);
        res.status(200).json(apiResponse.success(product, 'Product updated successfully'));
    } catch (err) {
        next(err);
    }
};

exports.deleteProduct = async (req, res, next) => {
    try {
        const product = await Product.findByIdAndUpdate(req.params.id, {
            isDeleted: true,
            deletedAt: new Date()
        }, { new: true });

        if (!product) {
            return res.status(404).json(apiResponse.error('Product not found'));
        }
        await auditLogger.logAction(req.user._id, 'DELETE', 'PRODUCTS', `Archived product: ${product.name}`);
        res.status(200).json(apiResponse.success(null, 'Product archived successfully'));
    } catch (err) {
        next(err);
    }
};

exports.searchProduct = async (req, res, next) => {
    try {
        const { id } = req.query;
        const product = await Product.findOne({ publicId: id });
        if (!product) {
            return res.status(404).json(apiResponse.error('Product not found'));
        }
        res.status(200).json(apiResponse.success(product));
    } catch (err) {
        next(err);
    }
};

exports.bulkImport = async (req, res, next) => {
    try {
        // Implementation for CSV parsing would go here. 
        // For now, returning a mock response to satisfy the frontend.
        res.status(200).json(apiResponse.success({
            imported: 0,
            totalRows: 0,
            skippedDuplicates: 0,
            failedRows: 0
        }, 'Bulk import processed (Mock)'));
    } catch (err) {
        next(err);
    }
};

exports.convertStock = async (req, res, next) => {
    try {
        const { productId, bulkQty } = req.body;
        if (!productId || !isValidObjectId(String(productId))) {
            return res.status(400).json(apiResponse.error('Valid productId is required'));
        }

        const normalizedBulkQty = Number(bulkQty);
        if (!Number.isFinite(normalizedBulkQty) || normalizedBulkQty <= 0) {
            return res.status(400).json(apiResponse.error('bulkQty must be greater than zero'));
        }

        const product = await Product.findById(productId);
        
        if (!product) {
            return res.status(404).json(apiResponse.error('Product not found'));
        }

        if ((product.stockLevels?.bulkQty || 0) < normalizedBulkQty) {
            return res.status(400).json(apiResponse.error('Insufficient bulk qty'));
        }

        const unitsToAdd = normalizedBulkQty * (product.unitConfig?.conversionFactor || 1);
        
        product.stockLevels.bulkQty -= normalizedBulkQty;
        product.stockLevels.retailQty += unitsToAdd;
        
        await product.save();

        res.status(200).json(apiResponse.success(product, `Converted ${normalizedBulkQty} bulk units to ${unitsToAdd} units`));
    } catch (err) {
        next(err);
    }
};
