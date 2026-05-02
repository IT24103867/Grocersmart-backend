const apiResponse = require('../utils/apiResponse');
const Product = require('../models/Product');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Supplier = require('../models/Supplier');
const CreditCustomer = require('../models/CreditCustomer');
const Cheque = require('../models/Cheque');
const mongoose = require('mongoose');

const escapePdfText = (value = '') => String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');

const createSimplePdfBuffer = (title, lines = []) => {
    const safeTitle = escapePdfText(title || 'Report');
    const pageLineCapacity = 36;
    const rawLines = (lines || []).map((line) => escapePdfText(line));

    const pages = [];
    for (let index = 0; index < rawLines.length; index += pageLineCapacity) {
        pages.push(rawLines.slice(index, index + pageLineCapacity));
    }
    if (pages.length === 0) pages.push([]);

    const contentStreams = pages.map((pageLines, pageIndex) => {
        const headerDate = pageIndex === 0 ? `Generated: ${escapePdfText(new Date().toLocaleString())}` : `Page ${pageIndex + 1}`;
        return [
            'BT',
            '/F1 12 Tf',
            '72 800 Td',
            `(${safeTitle}) Tj`,
            '/F1 10 Tf',
            '0 -22 Td',
            `(${headerDate}) Tj`,
            ...pageLines.flatMap((line) => ['0 -16 Td', `(${line}) Tj`]),
            'ET'
        ].join('\n');
    });

    const objects = [];
    const pagesKids = [];

    // 1: Catalog, 2: Pages root
    objects.push('<< /Type /Catalog /Pages 2 0 R >>');
    objects.push(''); // placeholder for pages root

    // Font object number will be assigned at the end.
    const pageObjectsStart = 3;

    contentStreams.forEach((stream, pageIndex) => {
        const pageObjNumber = pageObjectsStart + (pageIndex * 2);
        const contentObjNumber = pageObjNumber + 1;
        pagesKids.push(`${pageObjNumber} 0 R`);

        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${pageObjectsStart + (contentStreams.length * 2)} 0 R >> >> /Contents ${contentObjNumber} 0 R >>`);
        objects.push(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);
    });

    // Font object
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

    // Fill pages root placeholder (object 2)
    objects[1] = `<< /Type /Pages /Kids [${pagesKids.join(' ')}] /Count ${pagesKids.length} >>`;

    let pdf = '%PDF-1.4\n';
    const offsets = [0];

    objects.forEach((objectContent, index) => {
        offsets.push(Buffer.byteLength(pdf, 'utf8'));
        pdf += `${index + 1} 0 obj\n${objectContent}\nendobj\n`;
    });

    const xrefPosition = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i <= objects.length; i += 1) {
        pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }

    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPosition}\n%%EOF`;
    return Buffer.from(pdf, 'utf8');
};

const sendPdf = (res, filename, title, lines = []) => {
    const buffer = createSimplePdfBuffer(title, lines);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
};

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));

const formatDate = (value) => {
    if (!value) return '-';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '-';
    return dt.toISOString().split('T')[0];
};

const formatMoney = (value) => `Rs.${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
})}`;

const getDateRange = (req) => {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : null;
    const toDate = to ? new Date(`${to}T23:59:59.999Z`) : null;

    return {
        from,
        to,
        fromDate: fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : null,
        toDate: toDate && !Number.isNaN(toDate.getTime()) ? toDate : null
    };
};

const attachDateRange = (filter, field, fromDate, toDate) => {
    if (!fromDate && !toDate) return;
    filter[field] = {};
    if (fromDate) filter[field].$gte = fromDate;
    if (toDate) filter[field].$lte = toDate;
};

exports.getInventoryReport = async (req, res, next) => {
    try {
        const status = String(req.query.status || '').trim();
        const filter = { isDeleted: false };
        if (status) filter.status = status;
        const products = await Product.find(filter)
            .sort({ name: 1 })
            .lean();

        const lines = [
            `Status Filter: ${status || 'ALL'}`,
            `Total Products: ${products.length}`,
            '----------------------------------------'
        ];

        products.forEach((product, index) => {
            const bulkQty = Number(product?.stockLevels?.bulkQty || 0);
            const retailQty = Number(product?.stockLevels?.retailQty || 0);
            lines.push(`${index + 1}. ${product.name || '-'} (${product.publicId || '-'})`);
            lines.push(`   Category: ${product.category || '-'}`);
            lines.push(`   Unit Price: ${formatMoney(product.unitPrice)}`);
            lines.push(`   Bulk Price: ${formatMoney(product.bulkPrice)}`);
            lines.push(`   Stock: Bulk ${bulkQty} | Retail ${retailQty}`);
            lines.push(`   Reorder Point: ${Number(product.reorderPoint || 0)}`);
            lines.push(`   Status: ${product.status || '-'}`);
            lines.push('----------------------------------------');
        });

        sendPdf(res, 'inventory_report.pdf', 'Inventory Report', lines);
    } catch (err) { next(err); }
};

exports.getProductDetailsPdf = async (req, res, next) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json(apiResponse.error('Invalid product identifier'));
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json(apiResponse.error('Product not found'));
        sendPdf(res, `product_${req.params.id}.pdf`, `Product: ${product.name}`, [
            `Public ID: ${product.publicId || '-'}`,
            `Category: ${product.category || '-'}`,
            `Unit Price: ${Number(product.unitPrice || 0).toFixed(2)}`,
            `Status: ${product.status || '-'}`
        ]);
    } catch (err) { next(err); }
};

exports.getUserReport = async (req, res, next) => {
    try {
        const users = await User.find({ isDeleted: false })
            .sort({ createdAt: -1 })
            .select('publicId fullName username email phone role status lastLogin createdAt')
            .lean();

        const lines = [
            `Total Users: ${users.length}`,
            '----------------------------------------'
        ];

        users.forEach((user, index) => {
            lines.push(`${index + 1}. ${user.fullName || '-'} (${user.publicId || '-'})`);
            lines.push(`   Username: ${user.username || '-'}`);
            lines.push(`   Email: ${user.email || '-'}`);
            lines.push(`   Phone: ${user.phone || '-'}`);
            lines.push(`   Role: ${user.role || '-'}`);
            lines.push(`   Status: ${user.status || '-'}`);
            lines.push(`   Last Login: ${formatDate(user.lastLogin)}`);
            lines.push(`   Joined: ${formatDate(user.createdAt)}`);
            lines.push('----------------------------------------');
        });

        sendPdf(res, 'users_report.pdf', 'User Report', lines);
    } catch (err) { next(err); }
};

exports.getUserDetailsPdf = async (req, res, next) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json(apiResponse.error('Invalid user identifier'));
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json(apiResponse.error('User not found'));
        sendPdf(res, `user_${req.params.id}.pdf`, `User: ${user.fullName || user.username}`, [
            `Username: ${user.username || '-'}`,
            `Role: ${user.role || '-'}`,
            `Status: ${user.status || '-'}`
        ]);
    } catch (err) { next(err); }
};

exports.getSalesReport = async (req, res, next) => {
    try {
        const { from, to, fromDate, toDate } = getDateRange(req);
        const filter = { isDeleted: false, type: 'SALE' };
        attachDateRange(filter, 'createdAt', fromDate, toDate);

        const sales = await Transaction.find(filter)
            .sort({ createdAt: -1 })
            .populate('customer', 'name publicId')
            .lean();

        const grandTotal = sales.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0);
        const lines = [
            `Date Range: ${from || '-'} to ${to || '-'}`,
            `Total Invoices: ${sales.length}`,
            `Grand Total: ${formatMoney(grandTotal)}`,
            '----------------------------------------'
        ];

        sales.forEach((sale, index) => {
            const customerName = sale?.customer?.name || '-';
            lines.push(`${index + 1}. ${sale.invoiceNo || sale.publicId || sale._id}`);
            lines.push(`   Date: ${formatDate(sale.createdAt)}`);
            lines.push(`   Customer: ${customerName}`);
            lines.push(`   Payment: ${sale.paymentType || '-'}`);
            lines.push(`   Status: ${sale.status || '-'}`);
            lines.push(`   Items: ${(sale.items || []).length}`);
            lines.push(`   Total: ${formatMoney(sale.totalAmount)}`);
            if (sale.note) lines.push(`   Note: ${sale.note}`);
            lines.push('----------------------------------------');
        });

        sendPdf(res, 'sales_report.pdf', 'POS Sales Report', lines);
    } catch (err) { next(err); }
};

exports.getSalesInvoicePdf = async (req, res, next) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json(apiResponse.error('Invalid sale identifier'));
        const sale = await Transaction.findOne({ _id: req.params.id, isDeleted: false, type: 'SALE' });
        if (!sale) return res.status(404).json(apiResponse.error('Sale not found'));
        sendPdf(res, `invoice_${sale.invoiceNo || req.params.id}.pdf`, `Invoice ${sale.invoiceNo || ''}`.trim(), [
            `Transaction ID: ${sale._id}`,
            `Payment Type: ${sale.paymentType || '-'}`,
            `Total Amount: ${Number(sale.totalAmount || 0).toFixed(2)}`,
            `Status: ${sale.status || '-'}`
        ]);
    } catch (err) { next(err); }
};

exports.getCreditCustomerLedgerPdf = async (req, res, next) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json(apiResponse.error('Invalid customer identifier'));
        const customer = await CreditCustomer.findById(req.params.id);
        if (!customer) return res.status(404).json(apiResponse.error('Customer not found'));

        const entries = Array.isArray(customer.ledger) ? [...customer.ledger] : [];
        entries.sort((a, b) => new Date(b.date) - new Date(a.date));

        const lines = [
            `Customer: ${customer.name || '-'}`,
            `Entries: ${entries.length}`,
            `Outstanding Balance: ${formatMoney(customer.currentBalance)}`,
            '----------------------------------------'
        ];

        entries.forEach((entry, index) => {
            lines.push(`${index + 1}. ${entry.type || '-'} | ${formatMoney(entry.amount)}`);
            lines.push(`   Date: ${formatDate(entry.date)}`);
            lines.push(`   Description: ${entry.description || '-'}`);
            lines.push(`   Order Ref: ${entry.orderId || '-'}`);
            lines.push('----------------------------------------');
        });

        sendPdf(res, `credit_customer_${req.params.id}_ledger.pdf`, `Customer Ledger: ${customer.name}`, lines);
    } catch (err) { next(err); }
};

exports.getCreditCustomerProfilePdf = async (req, res, next) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json(apiResponse.error('Invalid customer identifier'));
        const customer = await CreditCustomer.findById(req.params.id);
        if (!customer) return res.status(404).json(apiResponse.error('Customer not found'));
        sendPdf(res, `credit_customer_${req.params.id}.pdf`, `Customer Profile: ${customer.name}`, [
            `Public ID: ${customer.publicId || '-'}`,
            `Phone: ${customer.phone || '-'}`,
            `Credit Limit: ${Number(customer.creditLimit || 0).toFixed(2)}`
        ]);
    } catch (err) { next(err); }
};

exports.getChequesReportPdf = async (req, res, next) => {
    try {
        const status = String(req.query.status || '').trim();
        const filter = { isDeleted: false };
        if (status) filter.status = status;

        const cheques = await Cheque.find(filter)
            .sort({ dueDate: 1, createdAt: -1 })
            .populate('customer', 'name publicId')
            .lean();

        const totalAmount = cheques.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const lines = [
            `Status Filter: ${status || 'ALL'}`,
            `Total Cheques: ${cheques.length}`,
            `Total Amount: ${formatMoney(totalAmount)}`,
            '----------------------------------------'
        ];

        cheques.forEach((cheque, index) => {
            const customerName = cheque?.customer?.name || '-';
            lines.push(`${index + 1}. Cheque ${cheque.chequeNumber || '-'}`);
            lines.push(`   Type: ${cheque.chequeType || '-'}`);
            lines.push(`   Amount: ${formatMoney(cheque.amount)}`);
            lines.push(`   Bank: ${cheque.bankName || '-'} | Branch: ${cheque.branch || '-'}`);
            lines.push(`   Customer: ${customerName}`);
            lines.push(`   Issue Date: ${formatDate(cheque.issueDate)} | Due Date: ${formatDate(cheque.dueDate)}`);
            lines.push(`   Status: ${cheque.status || '-'}`);
            if (cheque.note) lines.push(`   Note: ${cheque.note}`);
            lines.push('----------------------------------------');
        });

        sendPdf(res, 'cheques_report.pdf', 'Cheque Report', lines);
    } catch (err) { next(err); }
};

exports.getProductsReportPdf = exports.getInventoryReport;

exports.getSuppliersPurchaseHistoryPdf = async (req, res, next) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json(apiResponse.error('Invalid supplier identifier'));
        const supplier = await Supplier.findById(req.params.id);
        if (!supplier) return res.status(404).json(apiResponse.error('Supplier not found'));

        const orders = await Transaction.find({ isDeleted: false, type: 'PURCHASE', supplier: supplier._id })
            .sort({ createdAt: -1 })
            .lean();

        const totalAmount = orders.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0);
        const lines = [
            `Supplier: ${supplier.name || '-'} (${supplier.publicId || '-'})`,
            `Total Purchase Orders: ${orders.length}`,
            `Total Procurement Amount: ${formatMoney(totalAmount)}`,
            '----------------------------------------'
        ];

        orders.forEach((order, index) => {
            lines.push(`${index + 1}. ${order.publicId || order.invoiceNo || order._id}`);
            lines.push(`   Date: ${formatDate(order.poDate || order.createdAt)}`);
            lines.push(`   Status: ${order.status || '-'}`);
            lines.push(`   Items: ${(order.items || []).length}`);
            lines.push(`   Amount: ${formatMoney(order.totalAmount)}`);
            lines.push('----------------------------------------');
        });

        sendPdf(res, `supplier_${req.params.id}_purchase_history.pdf`, `Supplier Purchase History: ${supplier.name}`, lines);
    } catch (err) { next(err); }
};

exports.getSupplierProfilePdf = async (req, res, next) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json(apiResponse.error('Invalid supplier identifier'));
        const supplier = await Supplier.findById(req.params.id);
        if (!supplier) return res.status(404).json(apiResponse.error('Supplier not found'));
        sendPdf(res, `supplier_${req.params.id}.pdf`, `Supplier Profile: ${supplier.name}`, [
            `Phone: ${supplier.phone || '-'}`,
            `Email: ${supplier.email || '-'}`,
            `Status: ${supplier.status || '-'}`
        ]);
    } catch (err) { next(err); }
};

exports.getCreditCustomersReportPdf = async (req, res, next) => {
    try {
        const customers = await CreditCustomer.find({ isDeleted: false })
            .sort({ name: 1 })
            .lean();

        const totalOutstanding = customers.reduce((sum, row) => sum + Number(row.currentBalance || 0), 0);
        const lines = [
            `Total Customers: ${customers.length}`,
            `Total Outstanding Balance: ${formatMoney(totalOutstanding)}`,
            '----------------------------------------'
        ];

        customers.forEach((customer, index) => {
            lines.push(`${index + 1}. ${customer.name || '-'} (${customer.publicId || '-'})`);
            lines.push(`   Phone: ${customer.phone || '-'}`);
            lines.push(`   Credit Limit: ${formatMoney(customer.creditLimit)}`);
            lines.push(`   Outstanding: ${formatMoney(customer.currentBalance)}`);
            lines.push(`   Risk: ${customer.riskStatus || '-'} (${Number(customer.aiRiskScore || 0)})`);
            lines.push(`   Terms: ${Number(customer.paymentTermsDays || 0)} days`);
            lines.push(`   Status: ${customer.status || '-'}`);
            lines.push('----------------------------------------');
        });

        sendPdf(res, 'credit_customers_report.pdf', 'Credit Customer Report', lines);
    } catch (err) { next(err); }
};

exports.getSuppliersReportPdf = async (req, res, next) => {
    try {
        const suppliers = await Supplier.find({ isDeleted: false }).sort({ name: 1 }).lean();

        const lines = [];
        lines.push(`Total Suppliers: ${suppliers.length}`);
        lines.push('----------------------------------------');

        suppliers.forEach((supplier, index) => {
            const categories = Array.isArray(supplier.supplyCategories) && supplier.supplyCategories.length > 0
                ? supplier.supplyCategories.join(', ')
                : '-';

            lines.push(`${index + 1}. ${supplier.name || '-'} (${supplier.publicId || '-'})`);
            lines.push(`   Contact Person: ${supplier.contactPerson || '-'}`);
            lines.push(`   Phone: ${supplier.phone || '-'}`);
            lines.push(`   Email: ${supplier.email || '-'}`);
            lines.push(`   Address: ${supplier.address || '-'}`);
            lines.push(`   Categories: ${categories}`);
            lines.push(`   Outstanding Payable: Rs.${Number(supplier.outstandingPayable || 0).toLocaleString()}`);
            lines.push(`   Status: ${supplier.status || '-'}`);
            lines.push('----------------------------------------');
        });

        sendPdf(res, 'suppliers_report.pdf', 'Supplier List Report', lines);
    } catch (err) { next(err); }
};

exports.getPurchaseOrdersReportPdf = async (req, res, next) => {
    try {
        const { from, to, fromDate, toDate } = getDateRange(req);
        const filter = { isDeleted: false, type: 'PURCHASE' };
        if (fromDate || toDate) {
            filter.$or = [
                { poDate: {} },
                { createdAt: {} }
            ];
            if (fromDate) {
                filter.$or[0].poDate.$gte = fromDate;
                filter.$or[1].createdAt.$gte = fromDate;
            }
            if (toDate) {
                filter.$or[0].poDate.$lte = toDate;
                filter.$or[1].createdAt.$lte = toDate;
            }
        }

        const purchaseOrders = await Transaction.find(filter)
            .sort({ createdAt: -1 })
            .populate('supplier', 'name publicId')
            .lean();

        const totalAmount = purchaseOrders.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0);
        const lines = [
            `Date Range: ${from || '-'} to ${to || '-'}`,
            `Total Purchase Orders: ${purchaseOrders.length}`,
            `Total Amount: ${formatMoney(totalAmount)}`,
            '----------------------------------------'
        ];

        purchaseOrders.forEach((order, index) => {
            const supplierName = order?.supplier?.name || order.supplierId || '-';
            lines.push(`${index + 1}. ${order.publicId || order.invoiceNo || order._id}`);
            lines.push(`   Date: ${formatDate(order.poDate || order.createdAt)}`);
            lines.push(`   Supplier: ${supplierName}`);
            lines.push(`   Status: ${order.status || '-'}`);
            lines.push(`   Items: ${(order.items || []).length}`);
            lines.push(`   Total: ${formatMoney(order.totalAmount)}`);
            if (order.note) lines.push(`   Note: ${order.note}`);
            lines.push('----------------------------------------');
        });

        sendPdf(res, 'purchase_orders_report.pdf', 'Purchase Order Report', lines);
    } catch (err) { next(err); }
};

exports.getPurchaseOrderPdf = async (req, res, next) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json(apiResponse.error('Invalid purchase order identifier'));
        const po = await Transaction.findOne({ _id: req.params.id, isDeleted: false, type: 'PURCHASE' });
        if (!po) return res.status(404).json(apiResponse.error('Purchase order not found'));
        sendPdf(res, `purchase_order_${req.params.id}.pdf`, `Purchase Order ${po.publicId || ''}`.trim(), [
            `Supplier ID: ${po.supplierId || '-'}`,
            `Status: ${po.status || '-'}`,
            `Total Amount: ${Number(po.totalAmount || 0).toFixed(2)}`
        ]);
    } catch (err) { next(err); }
};
