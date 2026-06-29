import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import expressWinston from "express-winston";
import cookieParser from "cookie-parser";
import { connectDB } from "./config/db.js";
import { connectRedis, getRedis, isRedisAvailable } from "./config/redis.js";
import { getJob } from "./utils/jobTracker.js";
import cron from "node-cron";
import { errorHandler } from "./middleware/errorMiddleware.js";
import { expressWinstonErrorLogger, logger } from "./logger/index.js";
dotenv.config({ path: `.env.local` });

const startServer = async () => {
  try {
    console.log("Starting server initialization...");
    await connectDB();
    await connectRedis();
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
    const tataCallingRoutes = (await import("./routes/tataCallingRoutes.js"))
      .default;
    const campaignReportRoutes = (await import("./routes/campaignReportRoutes.js"))
      .default;
    const checkEndedCampaigns = await import("./utils/endedCampaign.js");

    const app = express();

    // Trust the first proxy (Nginx) so express-rate-limit can read X-Forwarded-For correctly
    app.set("trust proxy", 1);

    const frontendOrigin = process.env.CLIENT_URL || "http://localhost:4021";

    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: [
              "'self'",
              frontendOrigin,
              "https://cep360.kestoneapps.in",
            ],
            fontSrc: ["'self'", "https:", "data:"],
            objectSrc: ["'none'"],
            frameSrc: ["'none'"],
            upgradeInsecureRequests: [],
          },
        },
      })
    );

    const loginLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 30, // maximum 30 login attempts per 15 minutes per IP
      message: {
        success: false,
        message: "Too many login attempts. Please try again after 15 minutes.",
      },
      standardHeaders: true,
      legacyHeaders: false,
    });

    const generalLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 200,
      message: {
        success: false,
        message: "Too many requests. Please slow down.",
      },
      standardHeaders: true,
      legacyHeaders: false,
    });

    app.use("/api/auth/login", loginLimiter);
    app.use(generalLimiter);

    app.use(express.json({ limit: "50mb" }));
    app.use(express.urlencoded({ extended: false, limit: "50mb" }));
    app.use("/reports", express.static("public/reports"));

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

    app.get("/api/health", async (req, res) => {
      // MongoDB check
      let mongoStatus = "connected";
      try {
        const { primaryConnection, secondaryConnection } = await import("./config/db.js");
        if (!primaryConnection || primaryConnection.readyState !== 1) mongoStatus = "disconnected";
        if (!secondaryConnection || secondaryConnection.readyState !== 1) mongoStatus = "secondary-disconnected";
      } catch {
        mongoStatus = "error";
      }

      // Redis check
      let redisStatus = "unavailable";
      let redisPing = null;
      if (isRedisAvailable()) {
        try {
          redisPing = await getRedis().ping();
          redisStatus = redisPing === "PONG" ? "connected" : "error";
        } catch {
          redisStatus = "error";
        }
      }

      res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        services: {
          mongodb: mongoStatus,
          redis: redisStatus,
        },
      });
    });

    // Redis inspect — Resource Manager only
    const { protect, authorize } = await import("./middleware/authMiddleware.js");
    const { UserRoleEnum: RoleEnum } = await import("./utils/enum.js");

    app.get("/api/redis/inspect", protect, authorize(RoleEnum.RESOURCE_MANAGER, RoleEnum.ADMIN), async (req, res) => {
      if (!isRedisAvailable()) {
        return res.status(503).json({ success: false, message: "Redis unavailable" });
      }
      try {
        const redis = getRedis();
        const keys = await redis.keys("*");

        if (keys.length === 0) {
          return res.json({ success: true, totalKeys: 0, cache: {} });
        }

        const pipeline = redis.pipeline();
        keys.forEach((key) => { pipeline.get(key); pipeline.ttl(key); });
        const results = await pipeline.exec();

        const cache = {};
        keys.forEach((key, i) => {
          const value = results[i * 2][1];
          const ttl = results[i * 2 + 1][1];
          let parsed;
          try { parsed = JSON.parse(value); } catch { parsed = value; }
          cache[key] = {
            ttl_seconds: ttl,
            expires_in: ttl > 0 ? `${Math.floor(ttl / 60)}m ${ttl % 60}s` : "no expiry",
            value: parsed,
          };
        });

        res.json({ success: true, totalKeys: keys.length, cache });
      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    app.delete("/api/redis/inspect/:key", protect, authorize(RoleEnum.RESOURCE_MANAGER, RoleEnum.ADMIN), async (req, res) => {
      if (!isRedisAvailable()) {
        return res.status(503).json({ success: false, message: "Redis unavailable" });
      }
      try {
        const deleted = await getRedis().del(req.params.key);
        res.json({ success: true, deleted: deleted === 1 });
      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    app.delete("/api/redis/flush", protect, authorize(RoleEnum.RESOURCE_MANAGER, RoleEnum.ADMIN), async (req, res) => {
      if (!isRedisAvailable()) {
        return res.status(503).json({ success: false, message: "Redis unavailable" });
      }
      try {
        await getRedis().flushdb();
        res.json({ success: true, message: "All cache cleared" });
      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
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
    app.use("/api/tataCalling", tataCallingRoutes);
    app.use("/api/campaignReport", campaignReportRoutes);

    // Job status endpoint — poll progress of bulk email/whatsapp sends
    app.get("/api/jobs/:jobId", async (req, res) => {
      const job = await getJob(req.params.jobId);
      if (!job)
        return res
          .status(404)
          .json({ success: false, message: "Job not found" });
      return res
        .status(200)
        .json({ success: true, message: "Job found", data: job });
    });

    // Schedule: At 23:00 on day-of-month 25 for expected salary generation
    cron.schedule(
      "0 07 26 * *", // 7:00 AM on 26th of every month (IST) — runs after 6 PM salary generation
      // "30 23 25 * *", // 11:00 PM on 25th of every month
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
    server.timeout = 600000; // 10 min — max time for any single request
    server.keepAliveTimeout = 605000; // slightly above timeout
    server.headersTimeout = 610000; // slightly above keepAliveTimeout

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
          console.error("Error closing connections:", error);
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
