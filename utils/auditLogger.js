const AuditLog = require('../models/AuditLog');

exports.logAction = async (userId, action, module, details = '', ipAddress = '') => {
    try {
        await AuditLog.create({
            user: userId,
            action,
            module,
            details,
            ipAddress
        });
    } catch (err) {
        console.error('Failed to create audit log:', err);
    }
};
