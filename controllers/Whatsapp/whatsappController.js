import errorHandler from "../../utils/index.js";
import WhatsAppService from "../../services/doubletick.js";
import pLimit from "p-limit";

const { asyncHandler, sendError, sendResponse } = errorHandler;

const CONCURRENCY_LIMIT = 5; // Number of concurrent requests
const BATCH_SIZE = 50; // Number of messages to send in each batch

// Initialize WhatsApp Service
const whatsappService = new WhatsAppService();

/**
 * Get all WhatsApp templates
 * @route GET /api/whatsapp/templates
 */
const getAllTemplates = asyncHandler(async (req, res, next) => {
  try {
    const result = await whatsappService.getAllTemplates();

    if (!result.success) {
      return sendError(next, result.error || "Failed to fetch templates", 500);
    }

    return sendResponse(
      res,
      200,
      "Templates fetched successfully",
      result.data
    );
  } catch (error) {
    console.error("Get Templates Error:", error);
    return sendError(next, error.message, 500);
  }
});
/**
 * Send WhatsApp template message
 * @route POST /api/whatsapp/send-template
 * @body {
 *   templateName: string,
 *   from: string,
 *   to: string,
 *   placeholders: string[],
 *   language?: string
 * }
 */

const sendTemplateMessageOld = asyncHandler(async (req, res, next) => {
  try {
    const {
      templateName,
      language = "en",
      wabaPhoneNumber,
      contacts,
    } = req.body;

    // ---------------- VALIDATION ----------------
    if (!templateName || !wabaPhoneNumber) {
      return sendError(
        next,
        "templateName and wabaPhoneNumber are required",
        400
      );
    }

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return sendError(next, "Contacts array is required", 400);
    }

    const phoneRegex = /^\+\d{10,15}$/;

    // ---------------- QUICK RESPONSE ----------------
    sendResponse(res, 200, "Message sending started", {
      totalContacts: contacts.length,
      templateName,
    });

    // ---------------- BACKGROUND PROCESS ----------------
    const limit = pLimit(CONCURRENCY_LIMIT);

    const batches = [];
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      batches.push(contacts.slice(i, i + BATCH_SIZE));
    }

    let successCount = 0;
    let failureCount = 0;

    (async () => {
      for (const batch of batches) {
        const tasks = batch.map((contact) =>
          limit(async () => {
            try {
              if (!phoneRegex.test(contact.contactNo)) {
                failureCount++;
                return;
              }

              const placeholders = [contact.fullName || ""];

              const result = await whatsappService.sendTemplateMessage({
                templateName,
                from: `+${wabaPhoneNumber}`,
                to: contact.contactNo,
                placeholders,
                language,
              });

              result.success ? successCount++ : failureCount++;
            } catch (err) {
              failureCount++;
              console.error("Send error:", err.message);
            }
          })
        );

        await Promise.all(tasks);
        await new Promise((r) => setTimeout(r, 500));
      }

      console.log("WhatsApp bulk sending completed", {
        successCount,
        failureCount,
      });
    })();
  } catch (error) {
    console.error("Send Template Message Error:", error);
    return sendError(next, error.message, 500);
  }
});

const sendTemplateMessage = asyncHandler(async (req, res, next) => {
  try {
    const {
      templateName,
      language = "en",
      wabaPhoneNumber,
      contacts,
    } = req.body;
    console.log("[WA_TEMPLATE] Stage 1: Request received", {
      templateName,
      language,
      wabaPhoneNumber,
      contactCount: Array.isArray(contacts) ? contacts.length : 0,
    });

    // ---------------- VALIDATION ----------------
    if (!templateName || !wabaPhoneNumber) {
      console.log("[WA_TEMPLATE] Stage 2: Validation failed - missing fields");
      return sendError(
        next,
        "templateName and wabaPhoneNumber are required",
        400
      );
    }

    if (!Array.isArray(contacts) || contacts.length === 0) {
      console.log(
        "[WA_TEMPLATE] Stage 2: Validation failed - contacts missing"
      );
      return sendError(next, "Contacts array is required", 400);
    }
    console.log("[WA_TEMPLATE] Stage 2: Validation passed");

    const phoneRegex = /^\+\d{10,15}$/;

    // ---------------- QUICK RESPONSE ----------------
    console.log("[WA_TEMPLATE] Stage 3: Sending immediate response to client");
    sendResponse(res, 200, "Message sending started", {
      totalContacts: contacts.length,
      templateName,
    });

    // ---------------- BACKGROUND PROCESS ----------------
    console.log("[WA_TEMPLATE] Stage 4: Preparing background processing");
    const limit = pLimit(CONCURRENCY_LIMIT);

    const batches = [];
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      batches.push(contacts.slice(i, i + BATCH_SIZE));
    }
    console.log("[WA_TEMPLATE] Stage 5: Batches prepared", {
      batchSize: BATCH_SIZE,
      totalBatches: batches.length,
      concurrencyLimit: CONCURRENCY_LIMIT,
    });

    let successCount = 0;
    let failureCount = 0;

    (async () => {
      console.log("[WA_TEMPLATE] Stage 6: Background send started");
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        console.log("[WA_TEMPLATE] Stage 7: Processing batch", {
          batchNumber: batchIndex + 1,
          totalBatches: batches.length,
          batchContacts: batch.length,
        });

        let batchSuccess = 0;
        let batchFailure = 0;
        const batchFailureReasons = [];
        const tasks = batch.map((contact) =>
          limit(async () => {
            const contactNo = contact?.contactNo || "";
            const fullName = contact?.fullName || "";
            try {
              if (!phoneRegex.test(contactNo)) {
                failureCount++;
                batchFailure++;
                batchFailureReasons.push("Invalid contact number format");
                return;
              }

              const placeholders = [fullName];

              const result = await whatsappService.sendTemplateMessage({
                templateName,
                from: `+${wabaPhoneNumber}`,
                to: contactNo,
                placeholders,
                language,
              });

              if (result?.success) {
                successCount++;
                batchSuccess++;
              } else {
                failureCount++;
                batchFailure++;
                batchFailureReasons.push(
                  result?.error ||
                    result?.message ||
                    "WhatsApp service returned unsuccessful response"
                );
              }
            } catch (err) {
              failureCount++;
              batchFailure++;
              batchFailureReasons.push(err?.message || "Unknown exception");
            }
          })
        );

        await Promise.all(tasks);
        const failureReasonSummary = batchFailureReasons.reduce(
          (acc, reason) => {
            acc[reason] = (acc[reason] || 0) + 1;
            return acc;
          },
          {}
        );
        console.log("[WA_TEMPLATE] Stage 8: Batch completed", {
          batchNumber: batchIndex + 1,
          batchSuccess,
          batchFailure,
          failureReasons: failureReasonSummary,
        });
        await new Promise((r) => setTimeout(r, 500));
      }

      console.log("[WA_TEMPLATE] Stage 9: Background send completed", {
        successCount,
        failureCount,
        total: contacts.length,
      });
    })().catch((err) => {
      console.error("[WA_TEMPLATE] Stage X: Background process failed", {
        reason: err?.message || "Unknown error",
      });
    });
  } catch (error) {
    console.error("[WA_TEMPLATE] Stage X: Handler failed", {
      reason: error?.message || "Unknown error",
    });
    return sendError(next, error.message, 500);
  }
});
/**
 * Send bulk WhatsApp messages
 * @route POST /api/whatsapp/send-bulk
 * @body {
 *   templateName: string,
 *   from: string,
 *   recipients: [{to: string, placeholders: string[]}],
 *   language?: string
 * }
 */
const sendBulkMessages = asyncHandler(async (req, res, next) => {
  try {
    const { templateName, from, recipients, language } = req.body;

    // Validation
    if (!templateName || !from || !recipients) {
      return sendError(
        next,
        "templateName, from, and recipients are required fields",
        400
      );
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return sendError(next, "recipients must be a non-empty array", 400);
    }

    // Validate phone number format for sender
    const phoneRegex = /^\+\d{10,15}$/;
    if (!phoneRegex.test(from)) {
      return sendError(
        next,
        "Invalid sender phone number format. Use format: +919876543210",
        400
      );
    }

    // Validate each recipient
    for (const recipient of recipients) {
      if (!recipient.to) {
        return sendError(next, "Each recipient must have a 'to' field", 400);
      }
      if (!phoneRegex.test(recipient.to)) {
        return sendError(
          next,
          `Invalid recipient phone number: ${recipient.to}`,
          400
        );
      }
    }

    const results = await whatsappService.sendBulkMessages({
      templateName,
      from,
      recipients,
      language: language || "en",
    });

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    return sendResponse(
      res,
      200,
      `Bulk messages sent. Success: ${successCount}, Failed: ${failureCount}`,
      {
        total: results.length,
        successful: successCount,
        failed: failureCount,
        details: results,
      }
    );
  } catch (error) {
    console.error("Send Bulk Messages Error:", error);
    return sendError(next, error.message, 500);
  }
});

export { getAllTemplates, sendTemplateMessage, sendBulkMessages };
