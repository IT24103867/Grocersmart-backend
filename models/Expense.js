const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
    title: { 
        type: String, 
        required: [true, 'Expense title is required'],
        trim: true
    },
    amount: { 
        type: Number, 
        required: [true, 'Amount is required'],
        min: [0, 'Amount cannot be negative']
    },
    category: { 
        type: String, 
        enum: ['Rent', 'Salaries', 'Utilities', 'Inventory Loss', 'Marketing', 'Maintenance', 'Other'],
        default: 'Other'
    },
    date: { 
        type: Date, 
        default: Date.now 
    },
    note: {
        type: String,
        trim: true
    },
    isDeleted: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

const Expense = mongoose.model('Expense', expenseSchema);
module.exports = Expense;
