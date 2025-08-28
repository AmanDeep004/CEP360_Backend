import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import expressWinston from "express-winston";
import cookieParser from "cookie-parser";
import { connectDB } from "./config/db.js";
import { errorHandler } from "./middleware/errorMiddleware.js";
import { expressWinstonErrorLogger, logger } from "./logger/index.js";
dotenv.config({ path: `.env.local` });

const startServer = async () => {
  try {
    console.log("Starting server initialization...");
    await connectDB();
    console.log("Loading routes...");
    const userRoutes = (await import("./routes/userRoutes.js")).default;
    const campaignRoutes = (await import("./routes/campaignRoutes.js")).default;
    const callingDataRoutes = (await import("./routes/callingDataRoutes.js"))
      .default;
    const callingHistoryRoutes = (await import("./routes/callHistoryRoutes.js"))
      .default;
    const agentRoutes = (await import("./routes/agentRoutes.js")).default;
    const uploadRoutes = (await import("./routes/uploadRoutes.js")).default;
    const invoiceRoutes = (await import("./routes/invoiceRoute.js")).default;
    const attendenceRoutes = (await import("./routes/attendenceRoute.js"))
      .default;
    const dashboardRoutes = (await import("./routes/dashboardRoutes.js"))
      .default;
    const masterDBRoutes = (await import("./routes/masterRoute/masterRoute.js"))
      .default;

    console.log("Routes loaded successfully");

    const app = express();

    app.use(express.json({ limit: "10mb" }));
    app.use(express.urlencoded({ extended: false, limit: "10mb" }));

    const corsOptions = {
      origin: process.env.CLIENT_URL || "http://localhost:4021",
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
      credentials: true,
    };
    app.use(cors(corsOptions));
    app.use(cookieParser());
    app.use(expressWinston.logger(logger));

    app.get("/", (req, res) => {
      res.json({
        message: "Welcome to MERN API",
        status: "healthy",
        timestamp: new Date().toISOString(),
      });
    });

    app.use("/api/auth", userRoutes);
    app.use("/api/campaign", campaignRoutes);
    app.use("/api/callingData", callingDataRoutes);
    app.use("/api/callHistory", callingHistoryRoutes);
    app.use("/api/agent", agentRoutes);
    app.use("/api/upload", uploadRoutes);
    app.use("/api/dashboard", dashboardRoutes);
    app.use("/api/invoice", invoiceRoutes);
    app.use("/api/attendence", attendenceRoutes);
    app.use("/api/masterdb", masterDBRoutes);

    app.use("*", (req, res) => {
      res.status(404).json({
        success: false,
        message: "Endpoint not found",
        path: req.originalUrl,
        method: req.method,
      });
    });

    app.use(expressWinston.errorLogger(expressWinstonErrorLogger));
    app.use(errorHandler);

    const PORT = process.env.PORT || 6000;
    const server = app.listen(PORT, () => {
      console.log(
        ` Server running in ${
          process.env.NODE_ENV || "development"
        } mode on port ${PORT}`
      );
    });

    const gracefulShutdown = async (signal) => {
      console.log(`\n${signal} received. Shutting down gracefully...`);

      server.close(async () => {
        console.log("HTTP server closed");

        try {
          const { primaryConnection, secondaryConnection } = await import(
            "./config/db.js"
          );
          if (primaryConnection) {
            await primaryConnection.close();
            console.log("Primary database connection closed");
          }
          if (secondaryConnection) {
            await secondaryConnection.close();
            console.log("Secondary database connection closed");
          }
        } catch (error) {
          console.error("Error closing database connections:", error);
        }

        process.exit(0);
      });
    };

    // Handle process termination
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    // Handle unhandled promise rejections
    process.on("unhandledRejection", (err, promise) => {
      console.error(`Unhandled Promise Rejection: ${err.message}`);
      server.close(() => process.exit(1));
    });

    // Handle uncaught exceptions
    process.on("uncaughtException", (err) => {
      console.error(`Uncaught Exception: ${err.message}`);
      process.exit(1);
    });

    return server;
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();
