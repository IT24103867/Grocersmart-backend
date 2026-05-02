const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    invoiceNo: {
        type: String
    },
    publicId: {
        type: String,
        unique: true,
        sparse: true
    },
    poDate: {
        type: Date
    },
    supplier: {
        type: mongoose.Schema.ObjectId,
        ref: 'Supplier'
    },
    supplierId: { type: String },
    items: [{
        product: {
            type: mongoose.Schema.ObjectId,
            ref: 'Product'
        },
        productId: { type: String },
        qty: { type: Number, default: 1 },
        quantity: { type: Number, default: 1 },     // alias
        unitPrice: { type: Number, default: 0 },
        unitCost: { type: Number, default: 0 },
        price: { type: Number, default: 0 },         // alias
        discount: { type: Number, default: 0 },      // item-level discount (amount)
        subtotal: { type: Number, default: 0 },      // (unitPrice - discount) * qty
        lineTotal: { type: Number, default: 0 }      // alias for subtotal
    }],
    totalAmount: {
        type: Number,
        default: 0
    },
    paymentType: {
        type: String,
        enum: ['CASH', 'CARD', 'CREDIT', 'Cash', 'Credit', 'Cheque'],
        default: 'CASH'
    },
    // POS cashier reference
    cashierId: {
        type: mongoose.Schema.ObjectId,
        ref: 'User'
    },
    staff: {
        type: mongoose.Schema.ObjectId,
        ref: 'User'
    },
    // Credit customer reference
    customer: {
        type: mongoose.Schema.ObjectId,
        ref: 'CreditCustomer'
    },
    creditCustomerId: { type: String },
    // Audit flag for financial reconciliation
    isAudited: {
        type: Boolean,
        default: false
    },
    // Payment-type record from credit controller
    type: {
        type: String,
        enum: ['SALE', 'PAYMENT', 'PURCHASE'],
        default: 'SALE'
    },
    note: { type: String },
    amount: { type: Number },   // for PAYMENT records
    recordedBy: {
        type: mongoose.Schema.ObjectId,
        ref: 'User'
    },
    status: {
        type: String,
        enum: ['DRAFT', 'PENDING', 'CONFIRMED', 'CANCELLED', 'CREATED', 'RECEIVED'],
        default: 'DRAFT'
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

transactionSchema.virtual('orderDate').get(function () {
    return this.createdAt;
});

transactionSchema.pre('save', async function () {
    if (!this.publicId) {
        const prefix = this.type === 'PURCHASE' ? 'PO' : this.type === 'PAYMENT' ? 'PAY' : 'ORD';
        this.publicId = `${prefix}-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
    }
    if (this.type === 'PURCHASE' && !this.poDate) {
        this.poDate = this.createdAt || new Date();
    }
});

const Transaction = mongoose.model('Transaction', transactionSchema);
module.exports = Transaction;
