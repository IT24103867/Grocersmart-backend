/**
 * Formats a successful API response
 * @param {Object} data - The data to include in the response
 * @param {String} message - An optional success message
 * @returns {Object} Standardized response object
 */
exports.success = (data, message = "Success") => {
  return {
    success: true,
    message,
    data,
  };
};

/**
 * Formats an error API response
 * @param {String} message - The error message
 * @param {Object} details - Optional error details (e.g., validation errors)
 * @returns {Object} Standardized error response object
 */
exports.error = (message = "Something went wrong", details = null) => {
  const response = {
    success: false,
    message,
  };

  if (details) {
    response.details = details;
  }

  return response;
};
