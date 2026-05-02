const apiResponse = require('../utils/apiResponse');

// This would typically be stored in a collection, but for now we can mock it or use a simple JSON object
let cashierPermissions = {
    inventory: true,
    sales: true,
    customers: true,
    reports: false,
    settings: false
};

exports.getCashierPermissions = (req, res) => {
    res.status(200).json(apiResponse.success(cashierPermissions));
};

exports.updateCashierPermission = (req, res) => {
    const { moduleKey } = req.params;
    const { allowed } = req.body;

    if (!moduleKey || !(moduleKey in cashierPermissions)) {
        return res.status(400).json(apiResponse.error('Invalid module key'));
    }
    if (typeof allowed !== 'boolean') {
        return res.status(400).json(apiResponse.error('allowed must be a boolean'));
    }
    
    cashierPermissions[moduleKey] = allowed;
    
    res.status(200).json(apiResponse.success(cashierPermissions, 'Permission updated'));
};

exports.bulkUpdateCashierPermissions = (req, res) => {
    const { permissions } = req.body;

    if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
        return res.status(400).json(apiResponse.error('permissions must be an object'));
    }

    const nextPermissions = { ...cashierPermissions };
    for (const [key, value] of Object.entries(permissions)) {
        if (!(key in nextPermissions)) {
            return res.status(400).json(apiResponse.error(`Invalid permission key: ${key}`));
        }
        if (typeof value !== 'boolean') {
            return res.status(400).json(apiResponse.error(`Permission ${key} must be boolean`));
        }
        nextPermissions[key] = value;
    }

    cashierPermissions = nextPermissions;
    res.status(200).json(apiResponse.success(cashierPermissions, 'Permissions updated'));
};
