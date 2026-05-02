const Transaction = require('../models/Transaction');
const Product = require('../models/Product');
const CreditCustomer = require('../models/CreditCustomer');
const Supplier = require('../models/Supplier');
const apiResponse = require('../utils/apiResponse');
const mongoose = require('mongoose');
const { predictDemand } = require('../utils/aiService');

const isPurchaseOrdersRequest = (req) => req.baseUrl.includes('/purchase-orders');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const ALLOWED_PAYMENT_TYPES = ['CASH', 'CARD', 'CREDIT'];

const generateInvoiceSeed = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const suffix = Math.floor(1000 + Math.random() * 9000);
    return `INV-${y}${m}${d}-${suffix}`;
};

const generateUniqueInvoiceNo = async () => {
    let attempts = 0;
    while (attempts < 30) {
        const candidate = generateInvoiceSeed();
        const exists = await Transaction.exists({
            isDeleted: false,
            type: 'SALE',
            invoiceNo: candidate
        });
        if (!exists) return candidate;
        attempts += 1;
    }
    return `INV-${Date.now()}`;
};

const validateCreditLimitForAmount = async ({ customerId, amount, excludeOrderId }) => {
    const customer = await CreditCustomer.findById(customerId);
    if (!customer) {
        return { error: 'Credit customer not found' };
    }

    const outstanding = Number(customer.currentBalance || 0);
    const limit = Number(customer.creditLimit || 0);

    let existingOrderAmount = 0;
    if (excludeOrderId) {
        const existingOrder = await Transaction.findById(excludeOrderId);
        if (existingOrder && existingOrder.paymentType === 'CREDIT' && existingOrder.status !== 'CONFIRMED') {
            existingOrderAmount = Number(existingOrder.totalAmount || 0);
        }
    }

    const projectedOutstanding = outstanding - existingOrderAmount + Number(amount || 0);
    if (projectedOutstanding > limit) {
        return { error: 'Credit limit exceeded for selected customer' };
    }

    return { ok: true };
};

const normalizeSaleItems = (items = []) => {
    const normalized = [];

    for (let index = 0; index < items.length; index += 1) {
        const item = items[index] || {};
        const productId = String(item.productId || item.product || '').trim();

        if (!productId) {
            return { error: `Item ${index + 1}: product is required` };
        }
        if (!isValidObjectId(productId)) {
            return { error: `Item ${index + 1}: invalid product identifier` };
        }

        const qty = Number(item.qty || item.quantity || 0);
        if (!Number.isFinite(qty) || qty <= 0) {
            return { error: `Item ${index + 1}: quantity must be greater than zero` };
        }

        const unitPrice = Number(item.unitPrice || item.price || 0);
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
            return { error: `Item ${index + 1}: unit price must be greater than zero` };
        }

        const discount = Number(item.discount || 0);
        if (!Number.isFinite(discount) || discount < 0) {
            return { error: `Item ${index + 1}: discount cannot be negative` };
        }

        const lineTotal = Number(item.lineTotal);

        const computedLineTotal = Number.isFinite(lineTotal)
            ? lineTotal
            : ((qty * unitPrice) - discount);

        if (!Number.isFinite(computedLineTotal) || computedLineTotal < 0) {
            return { error: `Item ${index + 1}: line total cannot be negative` };
        }

        normalized.push({
            productId,
            product: productId,
            qty,
            quantity: qty,
            unitPrice,
            price: unitPrice,
            discount,
            subtotal: computedLineTotal,
            lineTotal: computedLineTotal
        });
    }

    return { items: normalized };
};

const serializeTransaction = (transactionDoc) => {
    if (!transactionDoc) return transactionDoc;
    const transaction = typeof transactionDoc.toObject === 'function' ? transactionDoc.toObject() : transactionDoc;
    return {
        ...transaction,
        id: String(transaction._id || transaction.id),
        supplierId: transaction.supplierId || (transaction.supplier?._id ? String(transaction.supplier._id) : transaction.supplier ? String(transaction.supplier) : undefined),
        poDate: transaction.poDate || transaction.createdAt
    };
};

exports.getAllOrders = async (req, res, next) => {
    try {
        const { page = 0, size = 10, sort, search, status, paymentType, publicId, id } = req.query;
        const isPurchase = isPurchaseOrdersRequest(req);
        const filter = { isDeleted: false, type: isPurchase ? 'PURCHASE' : 'SALE' };

        if (search) {
            filter.$or = isPurchase
                ? [{ publicId: { $regex: search, $options: 'i' } }, { supplierId: { $regex: search, $options: 'i' } }]
                : [{ invoiceNo: { $regex: search, $options: 'i' } }, { publicId: { $regex: search, $options: 'i' } }];
        }
        if (publicId) filter.publicId = { $regex: String(publicId), $options: 'i' };
        if (id && isValidObjectId(id)) filter._id = id;
        if (status) filter.status = status;
        if (!isPurchase && paymentType) filter.paymentType = paymentType;

        const skip = page * size;
        
        let sortBy = sort ? sort.replace(',', ' ') : '-createdAt';
        if (sortBy.includes('id')) sortBy = sortBy.replace('id', '_id');

        const query = Transaction.find(filter)
            .sort(sortBy)
            .skip(skip)
            .limit(parseInt(size));

        if (isPurchase) {
            query.populate('supplier', 'name publicId');
        } else {
            query.populate('customer', 'name phone').populate('staff', 'fullName').populate('items.product', 'name unitPrice');
        }

        const orders = await query;
        const serializedOrders = orders.map(serializeTransaction);

        const totalElements = await Transaction.countDocuments(filter);

        res.status(200).json(apiResponse.success({
            content: serializedOrders,
            totalElements,
            totalPages: Math.ceil(totalElements / size),
            size: parseInt(size),
            number: parseInt(page)
        }));
    } catch (err) {
        next(err);
    }
};

exports.getOrder = async (req, res, next) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid order identifier'));
        }

        const isPurchase = isPurchaseOrdersRequest(req);
        const query = Transaction.findById(req.params.id).populate('items.product');
        if (isPurchase) query.populate('supplier', 'name publicId');
        else query.populate('customer').populate('staff', 'fullName');

        const order = await query;
        
        if (!order) {
            return res.status(404).json(apiResponse.error('Order not found'));
        }
        if (isPurchase && order.type !== 'PURCHASE') {
            return res.status(404).json(apiResponse.error('Purchase order not found'));
        }

        res.status(200).json(apiResponse.success(serializeTransaction(order)));
    } catch (err) {
        next(err);
    }
};

exports.createOrder = async (req, res, next) => {
    try {
        const isPurchase = isPurchaseOrdersRequest(req);

        if (isPurchase) {
            const { supplierId } = req.body;
            if (!supplierId || !isValidObjectId(supplierId)) {
                return res.status(400).json(apiResponse.error('Valid supplierId is required'));
            }

            const supplier = await Supplier.findOne({ _id: supplierId, isDeleted: false });
            if (!supplier) {
                return res.status(404).json(apiResponse.error('Supplier not found'));
            }

            const transaction = await Transaction.create({
                supplier: supplier._id,
                supplierId: String(supplier._id),
                poDate: new Date(),
                items: [],
                totalAmount: 0,
                paymentType: 'CASH',
                cashierId: req.user._id,
                staff: req.user._id,
                type: 'PURCHASE',
                status: 'CREATED',
                isAudited: false
            });

            return res.status(201).json(apiResponse.success(serializeTransaction(transaction), 'Purchase order created successfully'));
        }

        const { invoiceNo, items, paymentType, creditCustomerId, customerId, note } = req.body;


        const normalizedPaymentType = String(paymentType || '').toUpperCase();
        if (!ALLOWED_PAYMENT_TYPES.includes(normalizedPaymentType)) {
            return res.status(400).json(apiResponse.error('paymentType must be CASH, CARD or CREDIT'));
        }

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json(apiResponse.error('At least one item is required'));
        }

        const mapped = normalizeSaleItems(items);
        if (mapped.error) {
            return res.status(400).json(apiResponse.error(mapped.error));
        }
        const mappedItems = mapped.items;

        let normalizedInvoiceNo = String(invoiceNo || '').trim();
        if (!normalizedInvoiceNo) {
            normalizedInvoiceNo = await generateUniqueInvoiceNo();
        } else {
            const duplicateInvoice = await Transaction.exists({
                isDeleted: false,
                type: 'SALE',
                invoiceNo: normalizedInvoiceNo
            });
            if (duplicateInvoice) {
                return res.status(409).json(apiResponse.error('Invoice number already exists'));
            }
        }

        const totalAmount = mappedItems.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
        if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
            return res.status(400).json(apiResponse.error('Sale total must be greater than zero'));
        }
        const creditRef = String(creditCustomerId || customerId || '').trim();
        const normalizedNote = String(note || '').trim();
        if (normalizedNote.length > 500) {
            return res.status(400).json(apiResponse.error('Note cannot exceed 500 characters'));
        }

        if (normalizedPaymentType === 'CREDIT') {
            if (!creditRef || !isValidObjectId(creditRef)) {
                return res.status(400).json(apiResponse.error('Valid credit customer is required for CREDIT payments'));
            }

            const creditLimitValidation = await validateCreditLimitForAmount({
                customerId: creditRef,
                amount: totalAmount
            });
            if (creditLimitValidation.error) {
                return res.status(400).json(apiResponse.error(creditLimitValidation.error));
            }
        }

        const transaction = await Transaction.create({
            invoiceNo: normalizedInvoiceNo,
            items: mappedItems,
            totalAmount,
            paymentType: normalizedPaymentType,
            customer: creditRef || undefined,
            creditCustomerId: creditRef || undefined,
            note: normalizedNote || undefined,
            cashierId: req.user._id,
            staff: req.user._id,
            type: 'SALE',
            isAudited: false,
            status: 'DRAFT'
        });

        res.status(201).json(apiResponse.success(serializeTransaction(transaction), 'Order created successfully'));
    } catch (err) {
        next(err);
    }
};

exports.updateOrder = async (req, res, next) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid order identifier'));
        }

        const order = await Transaction.findById(req.params.id);
        if (!order) {
            return res.status(404).json(apiResponse.error('Order not found'));
        }

        if (order.type !== 'SALE') {
            return res.status(400).json(apiResponse.error('Only sales orders can be updated from this endpoint'));
        }

        // Allow updates to orders regardless of current status
        const originalItems = Array.isArray(order.items) ? order.items.map(i => ({
            productId: String(i.product?._id || i.product || i.productId || ''),
            qty: Number(i.qty || i.quantity || 0),
            lineTotal: Number(i.lineTotal || i.subtotal || (i.qty || 0) * (i.unitPrice || i.price || 0))
        })) : [];
        const originalTotalAmount = Number(order.totalAmount || 0);
        const originalPaymentType = String(order.paymentType || '').toUpperCase();
        const originalCustomerRef = order.customer || order.creditCustomerId;

        const { invoiceNo, items, paymentType, creditCustomerId, customerId, note } = req.body;

        if (invoiceNo !== undefined) {
            const normalizedInvoiceNo = String(invoiceNo || '').trim();
            if (!normalizedInvoiceNo) {
                order.invoiceNo = await generateUniqueInvoiceNo();
            } else {
                const duplicateInvoice = await Transaction.exists({
                    isDeleted: false,
                    type: 'SALE',
                    invoiceNo: normalizedInvoiceNo,
                    _id: { $ne: order._id }
                });
                if (duplicateInvoice) {
                    return res.status(409).json(apiResponse.error('Invoice number already exists'));
                }
                order.invoiceNo = normalizedInvoiceNo;
            }
        }

        if (paymentType !== undefined) {
            const normalizedPaymentType = String(paymentType || '').toUpperCase();
            if (!ALLOWED_PAYMENT_TYPES.includes(normalizedPaymentType)) {
                return res.status(400).json(apiResponse.error('paymentType must be CASH, CARD or CREDIT'));
            }
            order.paymentType = normalizedPaymentType;
        }

        const creditRef = String(creditCustomerId || customerId || '').trim();
        if (order.paymentType === 'CREDIT') {
            if (!creditRef || !isValidObjectId(creditRef)) {
                return res.status(400).json(apiResponse.error('Valid credit customer is required for CREDIT payments'));
            }

            const amountToValidate = Array.isArray(items)
                ? order.items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0)
                : Number(order.totalAmount || 0);

            const creditLimitValidation = await validateCreditLimitForAmount({
                customerId: creditRef,
                amount: amountToValidate,
                excludeOrderId: order._id
            });
            if (creditLimitValidation.error) {
                return res.status(400).json(apiResponse.error(creditLimitValidation.error));
            }

            order.customer = creditRef || undefined;
            order.creditCustomerId = creditRef || undefined;
        } else {
            order.customer = undefined;
            order.creditCustomerId = undefined;
        }

        if (Array.isArray(items)) {
            const mapped = normalizeSaleItems(items);
            if (mapped.error) {
                return res.status(400).json(apiResponse.error(mapped.error));
            }

            order.items = mapped.items;

            order.totalAmount = order.items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
            if (!Number.isFinite(order.totalAmount) || order.totalAmount <= 0) {
                return res.status(400).json(apiResponse.error('Sale total must be greater than zero'));
            }
        }

        if (note !== undefined) {
            const normalizedNote = String(note || '').trim();
            if (normalizedNote.length > 500) {
                return res.status(400).json(apiResponse.error('Note cannot exceed 500 characters'));
            }
            order.note = normalizedNote || undefined;
        }

        // If order was already confirmed (sales) or received (purchase), apply adjustments
        if (order.status === 'CONFIRMED' || (order.type === 'PURCHASE' && order.status === 'RECEIVED')) {
            // Build maps of productId -> qty for original and updated items
            const mapItems = (arr) => {
                const m = new Map();
                for (const it of arr || []) {
                    const pid = String(it.productId || it.product || it.product?._id || it.productId || '');
                    const q = Number(it.qty || it.quantity || 0);
                    if (!pid) continue;
                    m.set(pid, (m.get(pid) || 0) + q);
                }
                return m;
            };

            const updatedItemsMap = mapItems(order.items);
            const originalItemsMap = mapItems(originalItems);

            // For each product in either map, compute delta and adjust stock accordingly
            const allProductIds = new Set([...updatedItemsMap.keys(), ...originalItemsMap.keys()]);

            for (const pid of allProductIds) {
                if (!isValidObjectId(pid)) continue;
                const origQty = Number(originalItemsMap.get(pid) || 0);
                const newQty = Number(updatedItemsMap.get(pid) || 0);
                const delta = newQty - origQty; // positive => more was sold/received, negative => returned

                const product = await Product.findById(pid);
                if (!product) continue;

                if (order.type === 'SALE') {
                    // Confirmed sales reduce stock
                    if (delta > 0) {
                        const available = Number(product.unitQty || 0);
                        if (available < delta) {
                            return res.status(400).json(apiResponse.error(`Insufficient stock for product ${product.name} to increase order quantity`));
                        }
                        product.unitQty = available - delta;
                    } else if (delta < 0) {
                        product.unitQty = Number(product.unitQty || 0) + Math.abs(delta);
                    }
                } else if (order.type === 'PURCHASE') {
                    // Received purchase orders increased stock when received
                    if (delta > 0) {
                        product.unitQty = Number(product.unitQty || 0) + delta;
                    } else if (delta < 0) {
                        const available = Number(product.unitQty || 0);
                        if (available < Math.abs(delta)) {
                            return res.status(400).json(apiResponse.error(`Insufficient stock for product ${product.name} to reduce received quantity`));
                        }
                        product.unitQty = available - Math.abs(delta);
                    }
                }

                await product.save();
            }

            // If a confirmed sale had credit payment, adjust customer's balance by the total delta
            if (order.type === 'SALE') {
                const newTotal = Number(order.totalAmount || 0);
                const amountDelta = newTotal - originalTotalAmount;
                const newPaymentType = String(order.paymentType || '').toUpperCase();
                const customerRef = order.customer || order.creditCustomerId || originalCustomerRef;

                if (newPaymentType === 'CREDIT' || originalPaymentType === 'CREDIT') {
                    // If customer ref changed, use the new one
                    if (customerRef && isValidObjectId(customerRef)) {
                        const customer = await CreditCustomer.findById(customerRef);
                        if (customer) {
                            const projected = Number(customer.currentBalance || 0) + amountDelta;
                            if (projected > Number(customer.creditLimit || 0)) {
                                return res.status(400).json(apiResponse.error('Credit limit exceeded for selected customer due to order update'));
                            }

                            customer.currentBalance = projected;
                            if (amountDelta !== 0) {
                                customer.ledger.push({
                                    date: new Date(),
                                    type: amountDelta > 0 ? 'Debit' : 'Credit',
                                    amount: Math.abs(amountDelta),
                                    orderId: String(order._id),
                                    note: 'Adjustment from order update'
                                });
                            }
                            await customer.save();
                        }
                    }
                }
            }
        }

        await order.save();

        res.status(200).json(apiResponse.success(serializeTransaction(order), 'Order updated successfully'));
    } catch (err) {
        next(err);
    }
};

exports.deleteOrder = async (req, res, next) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid order identifier'));
        }
        const order = await Transaction.findByIdAndUpdate(req.params.id, {
            isDeleted: true,
            deletedAt: new Date()
        }, { new: true });

        if (!order) {
            return res.status(404).json(apiResponse.error('Order not found'));
        }
        res.status(200).json(apiResponse.success(null, 'Order cancelled/archived successfully'));
    } catch (err) {
        next(err);
    }
};

exports.addOrderItem = async (req, res, next) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid order identifier'));
        }

        const order = await Transaction.findById(req.params.id);
        
        if (!order) {
            return res.status(404).json(apiResponse.error('Order not found'));
        }

        const isPurchase = isPurchaseOrdersRequest(req) || order.type === 'PURCHASE';

        if (isPurchase) {
            const { productId, qty, unitCost } = req.body;
            if (!productId || !isValidObjectId(productId)) {
                return res.status(400).json(apiResponse.error('Valid productId is required'));
            }

            const product = await Product.findById(productId);
            if (!product) {
                return res.status(404).json(apiResponse.error('Product not found'));
            }

            const normalizedQty = Math.max(1, Number(qty) || 1);
            const normalizedUnitCost = Math.max(0, Number(unitCost) || 0);
            const lineTotal = normalizedQty * normalizedUnitCost;

            order.items.push({
                product: product._id,
                productId: String(product._id),
                qty: normalizedQty,
                quantity: normalizedQty,
                unitCost: normalizedUnitCost,
                unitPrice: normalizedUnitCost,
                price: normalizedUnitCost,
                subtotal: lineTotal,
                lineTotal
            });

            order.totalAmount = (Number(order.totalAmount) || 0) + lineTotal;
            await order.save();

            return res.status(200).json(apiResponse.success(serializeTransaction(order), 'Item added to purchase order'));
        }

        const { product, quantity, price } = req.body;
        if (!product || !isValidObjectId(String(product))) {
            return res.status(400).json(apiResponse.error('Valid product identifier is required'));
        }

        const normalizedQty = Number(quantity);
        const normalizedPrice = Number(price);
        if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) {
            return res.status(400).json(apiResponse.error('quantity must be greater than zero'));
        }
        if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
            return res.status(400).json(apiResponse.error('price must be greater than zero'));
        }

        order.items.push({ product, quantity: normalizedQty, price: normalizedPrice });
        order.totalAmount += (normalizedPrice * normalizedQty);
        await order.save();

        res.status(200).json(apiResponse.success(serializeTransaction(order), 'Item added to order'));
    } catch (err) {
        next(err);
    }
};

exports.getOrderItems = async (req, res, next) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid order identifier'));
        }
        const order = await Transaction.findById(req.params.id).populate('items.product');
        if (!order) {
            return res.status(404).json(apiResponse.error('Order not found'));
        }
        res.status(200).json(apiResponse.success(order.items));
    } catch (err) {
        next(err);
    }
};

exports.confirmOrder = async (req, res, next) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid order identifier'));
        }
        const order = await Transaction.findById(req.params.id).populate('items.product');
        if (!order) {
            return res.status(404).json(apiResponse.error('Order not found'));
        }

        if (order.type === 'PURCHASE') {
            return res.status(400).json(apiResponse.error('Use receive endpoint for purchase orders'));
        }

        if (order.status === 'CONFIRMED') {
            return res.status(400).json(apiResponse.error('Order already confirmed'));
        }

        if (!Array.isArray(order.items) || order.items.length === 0) {
            return res.status(400).json(apiResponse.error('Cannot confirm an order without items'));
        }

        // Deduct stock
        for (const item of order.items) {
            if (item.product && item.product._id) {
                const product = await Product.findById(item.product._id);
                if (product) {
                    const qtyToDeduct = Number(item.qty || item.quantity || 0);
                    if (qtyToDeduct <= 0) {
                        return res.status(400).json(apiResponse.error('Order contains invalid item quantity'));
                    }
                    if (Number(product.unitQty || 0) < qtyToDeduct) {
                        return res.status(400).json(apiResponse.error(`Insufficient stock for product ${product.name}`));
                    }
                    product.unitQty -= qtyToDeduct;
                    await product.save();
                }
            }
        }

        // Handle Credit payment logic — update customer debt
        if ((order.paymentType === 'CREDIT' || order.paymentType === 'Credit') && (order.customer || order.creditCustomerId)) {
            const custId = order.customer || order.creditCustomerId;
            const customer = await CreditCustomer.findById(custId);
            if (customer) {
                const projectedOutstanding = Number(customer.currentBalance || 0) + Number(order.totalAmount || 0);
                if (projectedOutstanding > Number(customer.creditLimit || 0)) {
                    return res.status(400).json(apiResponse.error('Credit limit exceeded for selected customer'));
                }

                customer.currentBalance += order.totalAmount;
                customer.ledger.push({
                    date: new Date(),
                    type: 'Debit',
                    amount: order.totalAmount,
                    orderId: String(order._id)
                });
                await customer.save();
            }
        }

        order.status = 'CONFIRMED';
        await order.save();

        res.status(200).json(apiResponse.success(serializeTransaction(order), 'Order confirmed and stock updated'));
    } catch (err) {
        next(err);
    }
};

exports.receivePurchaseOrder = async (req, res, next) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json(apiResponse.error('Invalid purchase order identifier'));
        }

        const order = await Transaction.findById(req.params.id).populate('items.product');
        if (!order || order.type !== 'PURCHASE') {
            return res.status(404).json(apiResponse.error('Purchase order not found'));
        }

        if (order.status === 'RECEIVED') {
            return res.status(400).json(apiResponse.error('Purchase order already received'));
        }

        for (const item of order.items) {
            const productId = item.product?._id || item.productId;
            if (!productId || !isValidObjectId(String(productId))) continue;

            const product = await Product.findById(productId);
            if (!product) continue;

            const qty = Number(item.qty || item.quantity || 0);
            product.unitQty = Number(product.unitQty || 0) + qty;

            const latestCost = Number(item.unitCost || item.unitPrice || item.price || 0);
            if (latestCost > 0) product.purchasePrice = latestCost;

            await product.save();
        }

        order.status = 'RECEIVED';
        await order.save();

        res.status(200).json(apiResponse.success(serializeTransaction(order), 'Purchase order received and stock updated'));
    } catch (err) {
        next(err);
    }
};

exports.markOrderAudited = async (req, res, next) => {
    try {
        const order = await Transaction.findByIdAndUpdate(
            req.params.id,
            { isAudited: true },
            { new: true }
        );

        if (!order) {
            return res.status(404).json(apiResponse.error('Order not found'));
        }

        res.status(200).json(apiResponse.success(order, 'Order marked as audited'));
    } catch (err) {
        next(err);
    }
};

exports.getDailySalesStats = async (req, res, next) => {
    try {
        const { from, to } = req.query;
        // Mock data for now to satisfy the frontend charts
        const stats = [
            { date: new Date().toISOString().split('T')[0], total: 5000, count: 10 }
        ];
        res.status(200).json(apiResponse.success(stats));
    } catch (err) {
        next(err);
    }
};

exports.getTopProductsStats = async (req, res, next) => {
    try {
        const { limit = 5 } = req.query;
        
        const stats = await Transaction.aggregate([
            { $match: { status: 'CONFIRMED', isDeleted: false } },
            { $unwind: "$items" },
            { $group: { 
                _id: "$items.product", 
                totalQtySold: { $sum: "$items.quantity" },
                totalRevenue: { $sum: { $multiply: ["$items.quantity", "$items.price"] } }
            }},
            { $sort: { totalQtySold: -1 } },
            { $limit: parseInt(limit) },
            { $lookup: {
                from: "products",
                localField: "_id",
                foreignField: "_id",
                as: "productInfo"
            }},
            { $unwind: "$productInfo" },
            { $project: {
                productId: "$_id",
                productName: "$productInfo.name",
                totalQtySold: 1,
                totalRevenue: 1
            }}
        ]);

        res.status(200).json(apiResponse.success(stats));
    } catch (err) {
        next(err);
    }
};

// Simulated AI Demand Forecaster
exports.getDemandForecast = async (req, res, next) => {
    try {
        const { productId } = req.params;
        if (!isValidObjectId(productId)) {
            return res.status(400).json(apiResponse.error('Invalid product identifier'));
        }

        const product = await Product.findById(productId);
        if (!product) return res.status(404).json(apiResponse.error('Product not found'));

        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - 30);

        const sales = await Transaction.find({
            type: 'SALE',
            status: 'CONFIRMED',
            isDeleted: false,
            createdAt: { $gte: startDate },
            items: { $elemMatch: { product: product._id } }
        }).select('items createdAt');

        const dailyQty = new Map();
        const toDateKey = (date) => {
            const d = new Date(date);
            return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        };

        for (const sale of sales) {
            const key = toDateKey(sale.createdAt);
            const qtyForProduct = (sale.items || []).reduce((sum, item) => {
                const itemProductId = String(item.product?._id || item.product || item.productId || '');
                if (itemProductId !== String(product._id)) return sum;
                return sum + Number(item.qty || item.quantity || 0);
            }, 0);

            dailyQty.set(key, (dailyQty.get(key) || 0) + qtyForProduct);
        }

        const getLagQty = (daysAgo) => {
            const d = new Date(today);
            d.setDate(today.getDate() - daysAgo);
            return Number(dailyQty.get(toDateKey(d)) || 0);
        };

        const lag_1 = getLagQty(1);
        const lag_7 = getLagQty(7);
        const lag_14 = getLagQty(14);

        let rollingSum = 0;
        for (let i = 1; i <= 7; i += 1) {
            rollingSum += getLagQty(i);
        }
        const rolling_mean_7 = rollingSum / 7;

        const demandPayload = {
            family: String(product.family || product.category || 'GENERAL'),
            store_nbr: 1,
            onpromotion: 0,
            day_of_week: today.getDay(),
            month: today.getMonth() + 1,
            day_of_month: today.getDate(),
            is_weekend: today.getDay() === 0 || today.getDay() === 6 ? 1 : 0,
            lag_1,
            lag_7,
            lag_14,
            rolling_mean_7: Number(rolling_mean_7.toFixed(2))
        };

        const aiForecast = await predictDemand(demandPayload);
        const forecast14Days = Array.isArray(aiForecast?.forecast_14_days) ? aiForecast.forecast_14_days : [];
        const totalForecast = forecast14Days.reduce((sum, val) => sum + Number(val || 0), 0);

        const currentStock = Number(product.totalInRetailUnits || product.stockLevels?.totalInRetailUnits || product.unitQty || 0);
        const recommendedReorderQty = Math.max(0, Math.ceil(totalForecast - currentStock));

        res.status(200).json(apiResponse.success({
            productId: String(product._id),
            productName: product.name,
            currentStock,
            forecast14Days,
            totalForecast14Days: Number(totalForecast.toFixed(2)),
            recommendedReorderQty,
            featureSnapshot: demandPayload
        }, 'AI demand forecast generated'));
    } catch (err) {
        next(err);
    }
};

