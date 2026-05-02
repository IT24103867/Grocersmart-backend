const SalesTarget = require('../models/SalesTarget');
const Expense = require('../models/Expense');
const Transaction = require('../models/Transaction');
const Product = require('../models/Product');
const apiResponse = require('../utils/apiResponse');


exports.getTargets = async (req, res, next) => {
    try {
        const targets = await SalesTarget.find({ isDeleted: false }).sort({ month: -1 });
        res.status(200).json(apiResponse.success(targets));
    } catch (err) {
        next(err);
    }
};

exports.setTarget = async (req, res, next) => {
    try {
        const { month, targetAmount, category } = req.body;
        
        // Check if target for this month already exists
        const existing = await SalesTarget.findOne({ month, isDeleted: false });
        if (existing) {
            return res.status(400).json(apiResponse.error(`Target for ${month} already exists. Update it instead.`));
        }

        const target = await SalesTarget.create({ month, targetAmount, category });
        res.status(201).json(apiResponse.success(target, 'Sales target set successfully'));
    } catch (err) {
        next(err);
    }
};

exports.updateTarget = async (req, res, next) => {
    try {
        const target = await SalesTarget.findByIdAndUpdate(
            req.params.id,
            { ...req.body },
            { new: true, runValidators: true }
        );
        if (!target) {
            return res.status(404).json(apiResponse.error('Target not found'));
        }
        res.status(200).json(apiResponse.success(target, 'Sales target updated successfully'));
    } catch (err) {
        next(err);
    }
};

exports.deleteTarget = async (req, res, next) => {
    try {
        const target = await SalesTarget.findByIdAndUpdate(req.params.id, { isDeleted: true });
        if (!target) {
            return res.status(404).json(apiResponse.error('Target not found'));
        }
        res.status(200).json(apiResponse.success(null, 'Sales target deleted successfully'));
    } catch (err) {
        next(err);
    }
};

exports.getFinancialSummary = async (req, res, next) => {
    try {
        const [sales, expenses, products] = await Promise.all([
            Transaction.find({ isDeleted: false, type: 'SALE' }),
            Expense.find({ isDeleted: false }),
            Product.find({ isDeleted: false })
        ]);

        let totalRevenue = 0;
        let totalCOGS = 0; // Cost of Goods Sold
        
        sales.forEach(sale => {
            totalRevenue += (sale.totalAmount || 0);
            (sale.items || []).forEach(item => {
                const prodId = item.productId || item.product;
                const prod = products.find(p => p._id.toString() === prodId?.toString());
                const cost = prod ? (prod.purchasePrice || 0) : 0;
                totalCOGS += (cost * (item.quantity || item.qtySold || 0));
            });
        });

        const totalExpenses = expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
        const grossProfit = totalRevenue - totalCOGS;
        const netProfit = grossProfit - totalExpenses;

        res.status(200).json(apiResponse.success({
            totalRevenue,
            totalCOGS,
            totalExpenses,
            grossProfit,
            netProfit,
            expenseCount: expenses.length,
            margin: totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0
        }));
    } catch (err) {
        next(err);
    }
};

