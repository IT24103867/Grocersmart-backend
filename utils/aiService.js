const axios = require('axios');

const AI_SERVER_URL = process.env.AI_SERVER_URL || 'http://localhost:5000';
const CREDIT_RISK_ENDPOINT = process.env.AI_CREDIT_RISK_ENDPOINT || '/predict/credit';
const DEMAND_FORECAST_ENDPOINT = process.env.AI_DEMAND_FORECAST_ENDPOINT || '/predict/forecast/14days';

const getAiEndpointUrl = (endpointPath) => {
    const baseUrl = AI_SERVER_URL.replace(/\/$/, '');
    const endpoint = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
    return `${baseUrl}${endpoint}`;
};

exports.predictRisk = async (customerData) => {
    try {
        const response = await axios.post(getAiEndpointUrl(CREDIT_RISK_ENDPOINT), customerData, {
            timeout: 10000
        });
        return response.data;
    } catch (error) {
        console.error('AI Service Error:', error.response?.data || error.message);
        throw new Error('Could not connect to ai_features credit risk service');
    }
};

exports.predictDemand = async (forecastData) => {
    try {
        const response = await axios.post(getAiEndpointUrl(DEMAND_FORECAST_ENDPOINT), forecastData, {
            timeout: 10000
        });
        return response.data;
    } catch (error) {
        console.error('AI Demand Service Error:', error.response?.data || error.message);
        throw new Error('Could not connect to ai_features demand forecasting service');
    }
};
