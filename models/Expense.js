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
        min: [0.01, 'Amount must be greater than 0']
    },
    category: { 
        type: String, 
        enum: ['Rent', 'Salaries', 'Utilities', 'Inventory Loss', 'Marketing', 'Maintenance', 'Other'],
        required: [true, 'Category is required']
    },
    date: { 
        type: Date, 
        required: [true, 'Date is required'],
        validate: {
            validator: function(value) {
                return value <= new Date();
            },
            message: 'Date and time cannot be in the future'
        }
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
