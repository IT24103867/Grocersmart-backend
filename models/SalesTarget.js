const mongoose = require('mongoose');

const salesTargetSchema = new mongoose.Schema({
    month: {
        type: String, // format: YYYY-MM
        required: [true, 'Month is required'],
        unique: true
    },
    targetAmount: {
        type: Number,
        required: [true, 'Target amount is required'],
        min: [0, 'Target amount cannot be negative']
    },
    category: {
        type: String,
        enum: ['REVENUE', 'ORDERS'],
        default: 'REVENUE'
    },
    isDeleted: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

const SalesTarget = mongoose.model('SalesTarget', salesTargetSchema);
module.exports = SalesTarget;
