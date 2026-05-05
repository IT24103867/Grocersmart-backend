const mongoose = require('mongoose');

const chequeSchema = new mongoose.Schema({
    chequeNumber: {
        type: String,
        required: [true, 'Cheque number is required'],
        unique: true,
        trim: true,
        match: [/^\d{6}$/, 'Cheque number must be exactly 6 digits']
    },
    bankName: {
        type: String,
        required: [true, 'Bank name is required'],
        trim: true,
        match: [/^[a-zA-Z\s]+$/, 'Bank name must contain only letters'],
        minlength: [2, 'Bank name must be at least 2 characters'],
        maxlength: [100, 'Bank name cannot exceed 100 characters']
    },
    branch: {
        type: String,
        trim: true,
        match: [/^[a-zA-Z\s]+$/, 'Branch must contain only letters'],
        maxlength: [100, 'Branch cannot exceed 100 characters']
    },
    // Incoming = from customer; Outgoing = to supplier
    chequeType: {
        type: String,
        enum: ['Incoming', 'Outgoing'],
        default: 'Incoming'
    },
    amount: {
        type: Number,
        required: [true, 'Amount is required'],
        min: [0.01, 'Amount must be greater than zero']
    },
    issueDate: {
        type: Date,
        required: [true, 'Issue date is required']
    },
    dueDate: {
        type: Date,
        required: [true, 'Due date is required']
    },
    status: {
        type: String,
        enum: ['PENDING', 'DEPOSITED', 'CLEARED', 'BOUNCED'],
        default: 'PENDING'
    },
    // Link to credit customer (for Incoming cheques)
    customer: {
        type: mongoose.Schema.ObjectId,
        ref: 'CreditCustomer'
    },
    customerId: {
        type: String
    },
    // Link to supplier (for Outgoing cheques)
    supplier: {
        type: mongoose.Schema.ObjectId,
        ref: 'Supplier'
    },
    supplierId: {
        type: String
    },
    note: {
        type: String,
        maxlength: [500, 'Note cannot exceed 500 characters']
    },
    depositDate: { type: Date },
    clearedDate: { type: Date },
    bouncedDate: { type: Date },
    bounceReason: { type: String },
    isDeleted: {
        type: Boolean,
        default: false
    },
    deletedAt: {
        type: Date
    }
}, { timestamps: true });

chequeSchema.pre('validate', function () {
    if (this.issueDate && this.dueDate && this.dueDate < this.issueDate) {
        this.invalidate('dueDate', 'Due date cannot be before issue date');
    }
});

const Cheque = mongoose.model('Cheque', chequeSchema);
module.exports = Cheque;
