import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
// Resolve __filename and __dirname equivalents
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/**
 * Async function wrapper to avoid try-catch blocks in controllers
 * @param {Function} fn - Async function to wrap
 * @returns {Function} - Express middleware function
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
/**
 * Send response
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Response message
 * @param {Object} data - Response data
 */
const sendResponse = (res, statusCode, message, data, rest) => {
  res.status(statusCode).send({
    status: statusCode === 200 ? "success" : "error",
    message,
    data,
    ...rest,
  });
};
/**
 * Send error response
 * @param {Function} next - Express next function
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code
 * @returns {Function} - Next function with error
 */
const sendError = (next, message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return next(error);
};

/**
 * Logger utility to log messages to a daily file and delete files older than 15 days
 * @param {string} message - Message to log
 * @param {string} type - Type of log (e.g., 'error', 'info')
 */
const logger = (message, type = "info") => {
  const logDir = path.join(__dirname, "../logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
  }
  const date = new Date().toISOString().split("T")[0];
  const logFileName = `${type}-${date}.log`;
  const logFilePath = path.join(logDir, logFileName);
  const logMessage = `${new Date().toISOString()} - ${message}\n`;
  if (type === "error" && message instanceof Error) {
    const errorDetails = `Stack: ${message.stack}\n`;
    fs.appendFileSync(logFilePath, logMessage + errorDetails);
  } else {
    fs.appendFileSync(logFilePath, logMessage);
  }
  const files = fs.readdirSync(logDir);
  const now = Date.now();
  files.forEach((file) => {
    const filePath = path.join(logDir, file);
    const stats = fs.statSync(filePath);
    if (now - stats.mtimeMs > 15 * 24 * 60 * 60 * 1000) {
      fs.unlinkSync(filePath);
    }
  });
};

export default { asyncHandler, sendResponse, sendError, logger };
