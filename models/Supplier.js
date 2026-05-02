const mongoose = require('mongoose');

const PHONE_REGEX = /^(?:0(?:70|71|72|74|75|76|77|78)\d{7}|\+94(?:70|71|72|74|75|76|77|78)\d{7})$/;

const supplierSchema = new mongoose.Schema({
    publicId: {
        type: String,
        unique: true,
        sparse: true
    },
    // Company identity
    name: {
        type: String,
        required: [true, 'Supplier name is required'],
        trim: true,
        minlength: [2, 'Supplier name must be at least 2 characters'],
        maxlength: [120, 'Supplier name cannot exceed 120 characters']
    },
    contactPerson: {
        type: String
    },
    phone: {
        type: String,
        required: [true, 'Phone number is required'],
        trim: true,
        match: [PHONE_REGEX, 'Phone number must be 07Xxxxxxxx or +947Xxxxxxxx (X: 0,1,2,4,5,6,7,8)']
    },
    email: {
        type: String,
        lowercase: true,
        trim: true,
        match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address']
    },
    address: {
        type: String
    },
    // Categories this supplier covers
    supplyCategories: {
        type: [String],
        default: []
    },
    // Financials
    outstandingPayable: {
        type: Number,
        default: 0,
        min: [0, 'Outstanding payable cannot be negative']
    },
    category: {
        type: String
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
}, { timestamps: true });

supplierSchema.pre('save', async function () {
    if (!this.publicId) {
        this.publicId = 'SUP-' + Math.random().toString(36).substr(2, 8).toUpperCase();
    }
});

// Virtual: companyName alias
supplierSchema.virtual('companyName').get(function () {
    return this.name;
});

const Supplier = mongoose.model('Supplier', supplierSchema);
module.exports = Supplier;
