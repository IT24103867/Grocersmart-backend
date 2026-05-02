const mongoose = require('mongoose');

const creditCustomerSchema = new mongoose.Schema({
    publicId: {
        type: String,
        unique: true,
        sparse: true
    },
    // Core identity
    name: {
        type: String,
        required: [true, 'Customer name is required'],
        trim: true,
        minlength: [2, 'Customer name must be at least 2 characters'],
        maxlength: [100, 'Customer name cannot exceed 100 characters']
    },
    phone: {
        type: String,
        required: [true, 'Phone number is required'],
        trim: true,
        match: [/^\+?[0-9\s()-]{7,20}$/, 'Please provide a valid phone number']
    },
    address: {
        type: String
    },
    // Credit configuration
    creditLimit: {
        type: Number,
        required: [true, 'Credit limit is required'],
        min: [0, 'Credit limit cannot be negative']
    },
    // Current outstanding balance (replaces totalDebt)
    currentBalance: {
        type: Number,
        default: 0,
        min: [0, 'Current balance cannot be negative']
    },
    // Ledger — append-only transaction log
    ledger: [
        {
            date: { type: Date, default: Date.now },
            type: { type: String, enum: ['Debit', 'Credit'], required: true },
            amount: { type: Number, required: true, min: [0.01, 'Ledger amount must be greater than zero'] },
            description: { type: String },
            orderId: { type: String }    // optional link to an order
        }
    ],
    // AI / Risk
    aiRiskScore: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    riskStatus: {
        type: String,
        enum: ['Safe', 'Warning', 'Defaulter'],
        default: 'Safe'
    },
    // Additional metadata
    paymentTermsDays: {
        type: Number,
        default: 30,
        min: [1, 'Payment terms must be at least 1 day'],
        max: [365, 'Payment terms cannot exceed 365 days']
    },
    customerType: {
        type: String,
        enum: ['CREDIT', 'CASH'],
        default: 'CREDIT'
    },
    status: {
        type: String,
        enum: ['ACTIVE', 'INACTIVE'],
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

// Virtual aliases for backward compat with frontend
creditCustomerSchema.virtual('outstandingBalance').get(function () {
    return this.currentBalance;
});
creditCustomerSchema.virtual('totalDebt').get(function () {
    return this.currentBalance;
});
creditCustomerSchema.virtual('riskScore').get(function () {
    return this.aiRiskScore;
});

// Auto publicId
creditCustomerSchema.pre('save', async function () {
    if (!this.publicId) {
        this.publicId = 'CRD-' + Math.random().toString(36).substr(2, 8).toUpperCase();
    }
});

const CreditCustomer = mongoose.model('CreditCustomer', creditCustomerSchema);
module.exports = CreditCustomer;
