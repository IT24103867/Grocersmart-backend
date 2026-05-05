const Expense = require('../models/Expense');
const apiResponse = require('../utils/apiResponse');

exports.getExpenses = async (req, res, next) => {
    try {
        const expenses = await Expense.find({ isDeleted: false }).sort({ date: -1 });
        res.status(200).json(apiResponse.success(expenses));
    } catch (err) {
        next(err);
    }
};

exports.createExpense = async (req, res, next) => {
    try {
        const { title, amount, category, date, note } = req.body;

        // Validate required fields (note is optional)
        const missingFields = [];
        if (!title) missingFields.push('title');
        if (amount === undefined || amount === null) missingFields.push('amount');
        if (!category) missingFields.push('category');
        if (!date) missingFields.push('date');

        if (missingFields.length > 0) {
            return res.status(400).json(
                apiResponse.error(`Missing required fields: ${missingFields.join(', ')}`)
            );
        }

        // Validate amount is greater than 0
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json(
                apiResponse.error('Amount must be a valid number greater than 0')
            );
        }

        // Validate date is not in the future
        const expenseDate = new Date(date);
        const now = new Date();
        if (expenseDate > now) {
            return res.status(400).json(
                apiResponse.error('Date and time cannot be in the future')
            );
        }

        const expense = await Expense.create({
            title: title.trim(),
            amount: parsedAmount,
            category,
            date: expenseDate,
            note: note ? note.trim() : undefined
        });
        
        res.status(201).json(apiResponse.success(expense, 'Expense recorded successfully'));
    } catch (err) {
        next(err);
    }
};

exports.updateExpense = async (req, res, next) => {
    try {
        const expense = await Expense.findByIdAndUpdate(
            req.params.id,
            { ...req.body },
            { new: true, runValidators: true }
        );
        if (!expense) return res.status(404).json(apiResponse.error('Expense not found'));
        res.status(200).json(apiResponse.success(expense, 'Expense updated successfully'));
    } catch (err) {
        next(err);
    }
};

exports.deleteExpense = async (req, res, next) => {
    try {
        const expense = await Expense.findByIdAndUpdate(req.params.id, { isDeleted: true });
        if (!expense) return res.status(404).json(apiResponse.error('Expense not found'));
        res.status(200).json(apiResponse.success(null, 'Expense deleted successfully'));
    } catch (err) {
        next(err);
    }
};
