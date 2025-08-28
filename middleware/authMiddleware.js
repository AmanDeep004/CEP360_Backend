import pkg from "jsonwebtoken";
import errorHandler from "../utils/index.js";
import User from "../models/userModel.js";
const { asyncHandler, sendError } = errorHandler;
const { verify } = pkg;

/**
 * Protect routes - Authentication middleware
 */
export const protect = asyncHandler(async (req, res, next) => {
  // console.log(req.cookies.token, "cookies token");
  let token;
  if (req.cookies?.token) {
    token = req.cookies.token;
  }
  // Make sure token exists
  if (!token) {
    return sendError(next, "Not authorized to access this route", 400);
  }
  try {
    const decoded = verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select("-password");
    if (!req.user) {
      return sendError(next, "User not found", 400);
    }
    next();
  } catch (error) {
    return sendError(next, "Not authorized to access this route", 400);
  }
});

/**
 * Grant access to specific roles
 */
export const authorizeold = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(next, "User not authenticated", 400);
    }

    if (!roles.includes(req.user.roleId)) {
      return sendError(
        next,
        `User role ${req.user.roleId} is not authorized to access this route`,
        400
      );
    }
    next();
  };
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(next, "User not authenticated", 400);
    }

    if (!roles.includes(req.user.role)) {
      return sendError(
        next,
        `User role ${req.user.role} is not authorized to access this route`,
        400
      );
    }
    next();
  };
};

// export default { protect, authorize };
