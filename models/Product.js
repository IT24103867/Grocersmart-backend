const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    publicId: {
        type: String,
        unique: true,
        sparse: true
    },
    SKU: {
        type: String,
        unique: true,
        sparse: true,
        trim: true,
        uppercase: true
    },
    name: {
        type: String,
        required: [true, 'Product name is required'],
        trim: true
    },
    category: {
        type: String,
        required: [true, 'Category is required']
    },
    // Pricing
    unitPrice: {
        type: Number,
        required: [true, 'Unit price is required']
    },
    bulkPrice: {
        type: Number,
        required: [true, 'Bulk price is required']
    },
    purchasePrice: {
        type: Number,
        default: 0
    },
    // Unit configuration: how bulk maps to retail
    unitConfig: {
        bulkUnit: { type: String, default: 'Case' },
        retailUnit: { type: String, default: 'Piece' },
        conversionFactor: { type: Number, default: 1 }
    },
    // Stock levels
    stockLevels: {
        bulkQty: { type: Number, default: 0 },
        retailQty: { type: Number, default: 0 }
    },
    // Reorder alert threshold
    reorderPoint: {
        type: Number,
        default: 10
    },
    // Demand forecast feature fields for ai_features service.
    family: {
        type: String,
        default: 'GENERAL',
        trim: true
    },
    store_nbr: {
        type: Number,
        default: 1,
        min: [1, 'store_nbr must be at least 1']
    },
    onpromotion: {
        type: Number,
        default: 0,
        min: [0, 'onpromotion cannot be negative']
    },
    // Batch details — supports multiple batches per product
    batchDetails: [
        {
            batchId: { type: String },
            expiryDate: {
                type: Date,
                validate: {
                    validator: function (value) {
                        if (!value) return true;
                        const expiry = new Date(value);
                        if (Number.isNaN(expiry.getTime())) return false;
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        expiry.setHours(0, 0, 0, 0);
                        return expiry >= today;
                    },
                    message: 'Expiry date cannot be in the past'
                }
            },
            costPrice: { type: Number, default: 0 }
        }
    ],
    status: {
        type: String,
        enum: ['ACTIVE', 'DISCONTINUED'],
        default: 'ACTIVE'
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    deletedAt: {
        type: Date
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual: total retail units = retailQty + (bulkQty * conversionFactor)
productSchema.virtual('stockLevels.totalInRetailUnits').get(function () {
    const bulk = this.stockLevels?.bulkQty ?? 0;
    const retail = this.stockLevels?.retailQty ?? 0;
    const factor = this.unitConfig?.conversionFactor ?? 1;
    return retail + (bulk * factor);
});

productSchema.virtual('totalInRetailUnits').get(function () {
    const bulk = this.stockLevels?.bulkQty ?? 0;
    const retail = this.stockLevels?.retailQty ?? 0;
    const factor = this.unitConfig?.conversionFactor ?? 1;
    return retail + (bulk * factor);
});

// Virtual: is below reorder point
productSchema.virtual('isLowStock').get(function () {
    const total = this.totalInRetailUnits ?? 0;
    const threshold = this.reorderPoint ?? 10;
    return total <= threshold;
});

// Legacy aliases for existing UI compatibility
productSchema.virtual('bulkQty').get(function () {
    return this.stockLevels?.bulkQty ?? 0;
});
productSchema.virtual('bulkQty').set(function (value) {
    this.stockLevels = this.stockLevels || {};
    this.stockLevels.bulkQty = Number(value) || 0;
});

productSchema.virtual('unitQty').get(function () {
    return this.stockLevels?.retailQty ?? 0;
});
productSchema.virtual('unitQty').set(function (value) {
    this.stockLevels = this.stockLevels || {};
    this.stockLevels.retailQty = Number(value) || 0;
});

productSchema.virtual('unitsPerBulk').get(function () {
    return this.unitConfig?.conversionFactor ?? 1;
});
productSchema.virtual('unitsPerBulk').set(function (value) {
    this.unitConfig = this.unitConfig || {};
    this.unitConfig.conversionFactor = Number(value) || 1;
});

productSchema.virtual('reorderLevel').get(function () {
    return this.reorderPoint ?? 10;
});
productSchema.virtual('reorderLevel').set(function (value) {
    this.reorderPoint = Number(value) || 10;
});

productSchema.virtual('expiryDate').get(function () {
    return this.batchDetails?.[0]?.expiryDate || null;
});

// Pre-save: generate publicId
productSchema.pre('save', async function () {
    if (!this.SKU) {
        let generatedSku;
        let skuExists = true;

        // Ensure SKU is always unique to satisfy collection-level unique constraints.
        while (skuExists) {
            generatedSku = 'SKU-' + Math.random().toString(36).substr(2, 8).toUpperCase();
            skuExists = await this.constructor.exists({ SKU: generatedSku });
        }

        this.SKU = generatedSku;
    }

    if (!this.publicId) {
        let generatedId;
        let exists = true;

        // Keep generating until we find an unused publicId to avoid duplicate key errors.
        while (exists) {
            generatedId = 'PRD-' + Math.random().toString(36).substr(2, 9).toUpperCase();
            exists = await this.constructor.exists({ publicId: generatedId });
        }

        this.publicId = generatedId;
    }
});

const Product = mongoose.model('Product', productSchema);
module.exports = Product;
