const mongoose = require('mongoose');
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const creditRoutes = require('./routes/creditRoutes');
const chequeRoutes = require('./routes/chequeRoutes');
const supplierRoutes = require('./routes/supplierRoutes');
const adminRoutes = require('./routes/adminRoutes');
const reportRoutes = require('./routes/reportRoutes');
const trashRoutes = require('./routes/trashRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const expenseRoutes = require('./routes/expenseRoutes');


const globalErrorHandler = require('./middleware/errorMiddleware');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/inventory', productRoutes); 
app.use('/api/orders', orderRoutes);
app.use('/api/purchase-orders', orderRoutes); // Reusing order logic as placeholder
app.use('/api/suppliers', supplierRoutes);
app.use('/api/credit-customers', creditRoutes);
app.use('/api/sales', orderRoutes);
app.use('/api/cheques', chequeRoutes);

app.use('/api/admin', adminRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/trash', trashRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/expenses', expenseRoutes);


app.get('/', (req, res) => {
    res.status(200).json({
        status: 'success',
        message: 'Welcome to GrocerSmart API! The backend server is running.'
    });
});

app.get('/api', (req, res) => {
    res.status(200).json({
        status: 'success',
        message: 'GrocerSmart API endpoint is active. Please use specific routes.'
    });
});

// Handling undefined routes
app.use((req, res, next) => {
    res.status(404).json({
        status: 'fail',
        message: `Can't find ${req.originalUrl} on this server!`
    });
});

// Global Error Handler
app.use(globalErrorHandler);

// Connect to Database
const DB = process.env.DATABASE;

if (!DB) {
    console.error('DATABASE environment variable is not defined in .env file!');
} else {
    mongoose.connect(DB)
        .then(() => console.log('DB connection successful!'))
        .catch(err => console.error('DB connection error:', err));
}

const port = process.env.PORT || 8000;
app.listen(port, () => {
    console.log(`Server running on port ${port}...`);
});
