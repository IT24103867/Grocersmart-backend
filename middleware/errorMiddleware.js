const apiResponse = require('../utils/apiResponse');

module.exports = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;

    let message = err.message || 'Something went wrong';
    let details = null;

    // Handle Mongoose Validation Errors
    if (err.name === 'ValidationError') {
        message = 'Validation Error';
        details = {};
        Object.values(err.errors).forEach((error) => {
            details[error.path] = error.message;
        });
        err.statusCode = 400;
    }

    // Handle Duplicate Key Errors
    if (err.code === 11000) {
        const duplicateFields = err.keyValue ? Object.keys(err.keyValue) : [];
        const duplicateField = duplicateFields.length > 0 ? duplicateFields[0] : null;
        message = duplicateField
            ? `Duplicate value for ${duplicateField}`
            : 'Duplicate field value entered';
        err.statusCode = 400;
    }

    // Handle invalid ObjectId cast errors
    if (err.name === 'CastError') {
        message = `Invalid ${err.path} value`;
        err.statusCode = 400;
    }

    res.status(err.statusCode).json(
        apiResponse.error(message, details)
    );
};

