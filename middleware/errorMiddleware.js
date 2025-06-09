const errorHandler = (err, req, res, next) => {
  if (err.name === "CastError" && err.kind === "ObjectId") {
    return res.status(404).json({
      success: false,
      message: "Resource not found",
    });
  }
  if (err.name === "ValidationError") {
    const message = Object.values(err.errors).map((val) => val.message);
    return res.status(400).json({
      success: false,
      message: message,
    });
  }
  if (err.code === 11000) {
    return res.status(400).json({
      success: false,
      message: "Duplicate field value entered",
    });
  }
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({
      success: false,
      message: "Invalid token",
    });
  }
  if (err.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      message: "Token expired",
    });
  }
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || "Server Error",
    data: err.data || null,
    stack: process.env.NODE_ENV === "production" ? "🥞" : err.stack,
  });
};
export { errorHandler };
