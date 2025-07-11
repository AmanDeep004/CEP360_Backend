import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import expressWinston from "express-winston";
import cookieParser from "cookie-parser";
import connectDB from "./config/db.js";
import { errorHandler } from "./middleware/errorMiddleware.js";
import userRoutes from "./routes/userRoutes.js";
import campaignRoutes from "./routes/campaignRoutes.js";
import callingDataRoutes from "./routes/callingDataRoutes.js";
import callingHistoryRoutes from "./routes/callHistoryRoutes.js";
import agentRoutes from "./routes/agentRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";

import dashboardRoutes from "./routes/dashboardRoutes.js";
import { expressWinstonErrorLogger, logger } from "./logger/index.js";
dotenv.config({ path: `.env.local` });
// Connect to database
connectDB();
const app = express();
// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
const corsOptions = {
  origin: "http://localhost:4021",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  credentials: true,
};
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(expressWinston.logger(logger));
// Define routes
app.get("/", (req, res) => {
  res.json({ message: "Welcome to MERN API" });
});
app.use("/api/auth", userRoutes);
app.use("/api/campaign", campaignRoutes);
app.use("/api/callingData", callingDataRoutes);
app.use("/api/callHistory", callingHistoryRoutes);
app.use("/api/agent", agentRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/dashboard", dashboardRoutes);

// Handle 404 - Route not found
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Endpoint not found",
  });
});
// Error middleware
app.use(expressWinston.errorLogger(expressWinstonErrorLogger));
app.use(errorHandler);
// Start server
const PORT = process.env.PORT || 6000;
const server = app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (err, promise) => {
  console.log(`Error: ${err.message}`);
  // Close server & exit process
  server.close(() => process.exit(1));
});
