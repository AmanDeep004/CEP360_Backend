import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import expressWinston from "express-winston";
import cookieParser from "cookie-parser";
import { connectDB } from "./config/db.js";
import cron from "node-cron";
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
    const callingDataFiltrationRoutes = (
      await import("./routes/callingDataFiltrationRoute.js")
    ).default;
    const masterDBRoutes = (await import("./routes/masterRoute/masterRoute.js"))
      .default;
    const callingDataEditApprovalRoutes = (
      await import("./routes/callingDataEditApprovalRoute.js")
    ).default;

    const webHookRoutes = (await import("./routes/webhookRoutes.js")).default;
    const templateRoutes = (await import("./routes/templateRoute.js")).default;
    const linkedinDataScrapingRoute = (
      await import("./routes/Linkedin/linkedinDataScrapingRoute.js")
    ).default;
    const mailerCloudRoute = (
      await import("./routes/Email/mailerCloudRoute.js")
    ).default;

    const whatsappRoute = (
      await import("./routes/whatsapp/doubleTickRoutes.js")
    ).default;
    const checkEndedCampaigns = await import("./utils/endedCampaign.js");

    const app = express();

    app.use(helmet());
    app.use(express.json({ limit: "1500mb" }));
    app.use(express.urlencoded({ extended: false, limit: "1500mb" }));

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
    app.use("/api/filtration", callingDataFiltrationRoutes);
    app.use("/api/callingDataEditApproval", callingDataEditApprovalRoutes);
    app.use("/api/webhook", webHookRoutes);
    app.use("/api/template", templateRoutes);
    app.use("/api/linkedin", linkedinDataScrapingRoute);
    app.use("/api/mailercloud", mailerCloudRoute);
    app.use("/api/whatsapp", whatsappRoute);

    // Schedule: At 23:00 on day-of-month 25 for expected salary generation
    cron.schedule(
      "30 23 25 * *", // 11:00 PM on 25th of every month
      // "56 11 6 * *", // 11:30 AM on 6th of every month
      async () => {
        const now = new Date().toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
        });
        console.log(`[CRON] Triggered at ${now} (IST)`);

        try {
          // Dynamically import to avoid circular dependencies
          const { runInvoiceGeneration } = await import(
            "./controllers/invoiceController.js"
          );

          console.log("[CRON] Invoice generation started...");
          await runInvoiceGeneration(); // Should be a pure function (not req/res)
          console.log("[CRON] Invoice generation completed successfully.");
        } catch (err) {
          console.error(
            "[CRON] Invoice generation failed:",
            err?.message || err
          );
        }
      },
      {
        timezone: "Asia/Kolkata", // run on Indian time
      }
    );
    //Schedule at 11:50 pm everyday
    cron.schedule(
      "30 23 * * *", //trigress on 11:30 pM
      async () => {
        const now = new Date().toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
        });
        console.log("cron trigrred at:", now);

        try {
          const { retryEnrichmentForPending } = await import(
            "./controllers/Linkedin/linkedinDataScrapingController.js"
          );
          console.log("[CRON] Invoice generation started...");
          await retryEnrichmentForPending();
          console.log("[CRON] Invoice generation completed successfully.");
        } catch (err) {
          console.error(
            "[CRON] Invoice generation failed:",
            err?.message || err
          );
        }
      },
      {
        timezone: "Asia/Kolkata", // run on Indian time
      }
    );

    // cron to check if campaign is completed or not everyday at 1:00 am
    cron.schedule(
      "00 01 * * *",
      async () => {
        const now = new Date().toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
        });

        console.log("\n" + "=".repeat(70));
        console.log(
          `[CRON] CAMPAIGN DISCREPANCY CHECK - Triggered at ${now} (IST)`
        );
        console.log("=".repeat(70));

        try {
          // console.log("\nSTEP 1: Checking for ended campaigns...");
          const endedCampaigns =
            await checkEndedCampaigns.checkEndedCampaigns();

          if (endedCampaigns.length === 0) {
            console.log("No ended campaigns found. Nothing to process.");
            return;
          }

          // Step 2: Get call histories with redundant data
          // console.log(
          // "\nSTEP 2: Fetching call histories with redundant remarks..."
          // );
          const redundantData =
            await checkEndedCampaigns.getAllCallHistoriesForCampaign(
              endedCampaigns
            );

          if (redundantData.length === 0) {
            console.log("No redundant data found in ended campaigns.");
            return;
          }

          // console.log("\nSTEP 2.1: Discrepancy data...", redundantData);
          // Step 3: Update MasterDB
          // console.log("\nSTEP 3: Updating MasterDB with discrepancy data...");
          const updateResult =
            await checkEndedCampaigns.updatingIncorrectDataInMasterDB(
              redundantData
            );
          // console.log("\nSTEP 3.1: Update result...", updateResult);

          // Final Summary
        } catch (err) {
          console.error(
            "[CRON] Campaign discrepancy check failed:",
            err?.message || err
          );
        }
      },
      {
        timezone: "Asia/Kolkata",
      }
    );
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

    // Ensure uploads directory exists for multer disk storage
    const { mkdirSync } = await import("fs");
    mkdirSync("uploads", { recursive: true });

    const PORT = process.env.PORT || 4020;
    const server = app.listen(PORT, () => {
      console.log(
        ` Server running in ${
          process.env.NODE_ENV || "development"
        } mode on port ${PORT}`
      );
    });

    // 10-minute socket timeout — prevents gateway timeout on large Excel uploads.
    // The upload route also sets res.setTimeout(600000) individually.
    // NOTE: if nginx sits in front, also set:
    //   proxy_read_timeout 600;
    //   proxy_send_timeout 600;
    //   client_max_body_size 500m;
    server.timeout = 600000;          // 10 min — max time for any single request
    server.keepAliveTimeout = 605000; // slightly above timeout
    server.headersTimeout = 610000;   // slightly above keepAliveTimeout

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
