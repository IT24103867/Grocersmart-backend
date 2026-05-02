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
        const expense = await Expense.create(req.body);
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
