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

const sendTemplateMessage = asyncHandler(async (req, res, next) => {
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
