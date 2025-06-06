const errorHandler = (err, req, res, next) => {
    console.error("Error:", err.stack);
    res.status(err.statusCode || 500).json({ message: err.message || "Internal Server Error" });
  };
  
export default errorHandler;
  