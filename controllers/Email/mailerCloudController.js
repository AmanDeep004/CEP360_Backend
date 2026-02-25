import axios from "axios";
import errorHandler from "../../utils/index.js";
import EmailStatus from "../../models/Email/EmailStatusModel.js";
import CallingData from "../../models/callingDataModal.js";
import { logger } from "../../logger/index.js";

const { asyncHandler, sendError, sendResponse } = errorHandler;

const mailercloudWebhookOLD = asyncHandler(async (req, res, next) => {
  try {
    console.log("MailerCloud Webhook Data:", req.body);

    const { email, event, camp_id, timestamp } = req.body;

    if (!email || !event) {
      return sendError(next, "Missing required fields (email/event)", 400);
    }

    // Save webhook event in DB
    await EmailStatus.create({
      requestBody: req.body,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    });

    await CallingData.findByIdAndUpdate(
      req.body.campaignId || req.body.email,
      {
        $set: {
          //"emailTemplates.templateName": templateName,
          "emailTemplates.status": req.body.event,
          "emailTemplates.messageId": req.body.messageId || "",
          "emailTemplates.timestamp": new Date(),
        },

        $push: {
          "emailTemplates.history": {
            status: req.body.event, // keep status consistent
            timestamp: new Date(),
            messageId: req.body.messageId,
            data: req.body,
            templateDetails: req.body.templateDetails || {},
          },
        },
      },
      { new: true }
    );

    return sendResponse(res, 200, "Webhook received successfully", {
      email,
      event,
    });
  } catch (err) {
    console.error("Webhook Error:", err);
    return sendError(next, "Error processing webhook", 500);
  }
});
const mailercloudWebhook = asyncHandler(async (req, res, next) => {
  try {
    console.log("📩 MailerCloud Webhook Data:", req.body);

    const { email, event, campaignId, timestamp, messageId } = req.body;

    if (!email || !event) {
      return sendError(next, "Missing required fields (email/event)", 400);
    }

    // 1️⃣ Save webhook event to EmailStatus
    const resp = await EmailStatus.create({
      email,
      event,
      campaignId,
      timestamp: timestamp,
    });
    console.log("EmailStatus saved:", resp);
    // 2️⃣ Update CallingData emailTemplates history
    // await CallingData.findByIdAndUpdate(
    //   campaignId, // must be CallingData _id
    //   {
    //     $set: {
    //       "emailTemplates.status": event,
    //       "emailTemplates.messageId": messageId || "",
    //       "emailTemplates.timestamp": new Date(),
    //     },
    //     $push: {
    //       "emailTemplates.history": {
    //         status: event,
    //         timestamp: new Date(),
    //         messageId: messageId || "",
    //         data: req.body,
    //       },
    //     },
    //   },
    //   { new: true }
    // );

    return sendResponse(res, 200, "Webhook received successfully", {
      email,
      event,
    });
  } catch (err) {
    console.error("Webhook Error:", err);
    return sendError(next, "Error processing webhook", 500);
  }
});

const getMailercloudTemplateByName = asyncHandler(async (req, res, next) => {
  try {
    const API_KEY = process.env.MAILERCLOUD_API_KEY;

    if (!API_KEY) {
      return sendError(next, "MailerCloud API key missing", 500);
    }

    const { name } = req.query;

    if (!name) {
      return sendError(next, "Template name is required", 400);
    }

    const response = await axios.get(
      `https://cloudapi.mailercloud.com/v1/templates/details?name=${encodeURIComponent(
        name
      )}`,
      {
        headers: {
          Authorization: API_KEY,
          Accept: "application/json",
        },
      }
    );

    return sendResponse(
      res,
      200,
      "Template fetched successfully",
      response.data
    );
  } catch (error) {
    console.error(
      "MailerCloud Template Error:",
      error.response?.data || error.message
    );

    return sendError(
      next,
      error.response?.data?.message || error.message,
      error.response?.status || 500
    );
  }
});
//////////////////sending all data /////////////////////////

// here
const sendTemplateEmailToCallingData = asyncHandler(async (req, res, next) => {
  try {
    console.log("[MAILER_SEND] Stage 1: Request received");
    const {
      callingDataIds,
      templateName,
      campaignId,
      fromEmail,
      campignType,
      campaignName,
    } = req.body;

    if (!callingDataIds?.length || !templateName || !campaignId || !fromEmail) {
      console.log("[MAILER_SEND] Stage 2: Validation failed");
      return sendError(
        next,
        "callingDataIds, templateName, SenderEmail  and campaignId are required",
        400
      );
    }
    console.log("[MAILER_SEND] Stage 2: Validation passed", {
      totalContacts: callingDataIds.length,
      templateName,
      campaignId,
    });

    ///////// FETCH TEMPLATE
    const baseUrl = process.env.BASE_URL;
    console.log("[MAILER_SEND] Stage 3: Fetching template", { baseUrl });

    const templateRes = await axios.get(
      `${baseUrl}api/mailercloud/template?name=${templateName}`,
      {
        headers: {
          Authorization: process.env.MAILERCLOUD_API_KEY,
        },
      }
    );

    console.log("[MAILER_SEND] Stage 4: Template API response received");
    const template = templateRes.data?.data?.data;

    if (!template?.html || !template?.plainText) {
      console.log("[MAILER_SEND] Stage 4: Invalid template payload");
      return sendError(next, "Invalid template received", 400);
    }
    console.log("[MAILER_SEND] Stage 4: Template validated", {
      templateName: template.name || templateName,
    });

    // 2. FETCH CALLING DATA
    console.log("[MAILER_SEND] Stage 5: Fetching CallingData records");

    const callingDataList = await CallingData.find({
      _id: { $in: callingDataIds },
    }).select(
      "Full_Name Office_Email_1 Office_Email_2 Personal_Email1 Personal_Email2  emailTemplates"
    );

    console.log("[MAILER_SEND] Stage 5: CallingData fetched", {
      found: callingDataList.length,
    });

    const results = [];
    const BATCH_SIZE = 500;
    let successCount = 0;
    let failureCount = 0;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const normalizeEmail = (value) => {
      if (typeof value !== "string") return "";
      const trimmed = value.trim();
      if (!trimmed) return "";
      const lower = trimmed.toLowerCase();
      if (["na", "n/a", "null", "undefined", "-"].includes(lower)) return "";
      return trimmed;
    };

    const getRecipientEmail = (item) => {
      const candidates = [
        { key: "Office_Email_1", value: item.Office_Email_1 },
        { key: "Office_Email_2", value: item.Office_Email_2 },
        { key: "Personal_Email1", value: item.Personal_Email1 },
        { key: "Personal_Email2", value: item.Personal_Email2 },
      ];

      for (const candidate of candidates) {
        const normalized = normalizeEmail(candidate.value);
        if (normalized && emailRegex.test(normalized)) {
          return { email: normalized, source: candidate.key };
        }
      }

      return { email: "", source: "" };
    };

    // Helper: Split into batches of 500
    const chunkArray = (array, size) => {
      const chunks = [];
      for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
      }
      return chunks;
    };

    const batches = chunkArray(callingDataList, BATCH_SIZE);

    console.log("[MAILER_SEND] Stage 6: Batches prepared", {
      batchSize: BATCH_SIZE,
      totalBatches: batches.length,
    });
    // 3. PROCESS EACH BATCH

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      console.log("[MAILER_SEND] Stage 7: Processing batch", {
        batchNumber: b + 1,
        totalBatches: batches.length,
        batchSize: batch.length,
      });

      // Loop inside single batch

      for (const item of batch) {
        try {
          const personalizedHTML = template.html.replace(
            /{{name}}/g,
            item.Full_Name || "User"
          );

          const personalizedText = template.plainText.replace(
            /{{name}}/g,
            item.Full_Name || "User"
          );

          console.log("[MAILER_SEND] Stage 8: Preparing contact", {
            callingDataId: item._id,
            fullName: item.Full_Name || "",
          });

          // 4. SEND EMAIL
          const { email: recipientEmail, source: recipientSource } =
            getRecipientEmail(item);

          console.log("[MAILER_SEND] Stage 8: Recipient resolution", {
            callingDataId: item._id,
            recipientEmail,
            recipientSource,
            rawEmails: {
              Office_Email_1: item.Office_Email_1 || "",
              Office_Email_2: item.Office_Email_2 || "",
              Personal_Email1: item.Personal_Email1 || "",
              Personal_Email2: item.Personal_Email2 || "",
            },
          });

          if (!recipientEmail) {
            console.error("[MAILER_SEND] Stage 8: No recipient email", {
              callingDataId: item._id,
            });

            const noEmailTime = new Date();
            await CallingData.findByIdAndUpdate(
              item._id,
              {
                $set: {
                  "emailTemplates.templateName": templateName,
                  "emailTemplates.status": "failed",
                  "emailTemplates.messageId": "",
                  "emailTemplates.timestamp": noEmailTime,
                  "emailTemplates.templateId": String(campaignId),
                  "emailTemplates.templateDetails": template,
                },
                $push: {
                  "emailTemplates.history": {
                    status: "failed",
                    timestamp: noEmailTime,
                    messageId: "",
                    data: "No email available",
                    templateId: String(campaignId),
                    templateName,
                    templateDetails: template,
                  },
                },
              },
              { new: true }
            );

            await EmailStatus.create({
              email: "",
              event: "failed",
              campaignId: String(campaignId),
              callingDataId: String(item._id),
              templateName,
              messageId: "",
              provider: "MailerCloud",
              reason: "No email available",
              requestPayload: {
                templateName,
                fromEmail,
                campaignName: campaignName || "Campaign Team",
                campaignType: campignType,
                campaignId: String(campaignId),
              },
              responsePayload: {},
              meta: {
                recipientSource: "",
              },
              timestamp: noEmailTime,
            });

            results.push({
              callingDataId: item._id,
              email: null,
              status: "Failed",
              reason: "No email available",
            });
            failureCount++;

            continue; // skip this user
          }
          const providerPayload = {
            email: {
              from: fromEmail,
              fromName: campaignName || "Campaign Team",
              subject: template.name,
              text: personalizedText,
              html: personalizedHTML,
              replyTo: [fromEmail],
              recipients: {
                to: [
                  {
                    name: item.Full_Name,
                    email: recipientEmail,
                  },
                ],
              },
            },
            metadata: {
              campaignType: campignType,
              timestamp: new Date().toISOString(),
              custom: {
                inbox_tracking: "true",
                campaign_id: campaignId,
              },
            },
            version: "1.0",
          };

          console.log("[MAILER_SEND] Stage 8: Sending email", {
            callingDataId: item._id,
            recipientEmail,
            payload: providerPayload,
          });

          const sendTime = new Date();
          const sendRes = await axios.post(
            "https://email-api.mailercloud.com/email",
            providerPayload,
            {
              headers: {
                Authorization: process.env.MAILERCLOUD_API_KEY,
                "Content-Type": "application/json",
              },
              timeout: 15000,
            }
          );
          console.log("[MAILER_SEND] Stage 9: Provider response received", {
            callingDataId: item._id,
            recipientEmail,
            statusCode: sendRes.status,
            statusText: sendRes.statusText,
            responseData: sendRes.data || {},
          });

          const messageId = sendRes.data?.messageId || "";
          console.log("[MAILER_SEND] Stage 9: MessageId extracted", {
            callingDataId: item._id,
            recipientEmail,
            messageId,
          });

          console.log("[MAILER_SEND] Stage 10: Updating CallingData");
          await CallingData.findByIdAndUpdate(
            item._id,
            {
              $set: {
                "emailTemplates.templateName": templateName,
                "emailTemplates.status": "sent",
                "emailTemplates.messageId": messageId,
                "emailTemplates.timestamp": sendTime,
                "emailTemplates.templateId": String(campaignId),
                "emailTemplates.templateDetails": template,
              },
              $push: {
                "emailTemplates.history": {
                  status: "sent",
                  timestamp: sendTime,
                  messageId,
                  data: JSON.stringify(sendRes.data || {}),
                  templateId: String(campaignId),
                  templateName,
                  templateDetails: template,
                },
              },
            },
            { new: true }
          );

          console.log("[MAILER_SEND] Stage 11: Saving EmailStatus");
          await EmailStatus.create({
            email: recipientEmail,
            event: "sent",
            campaignId: String(campaignId),
            callingDataId: String(item._id),
            templateName,
            messageId,
            provider: "MailerCloud",
            statusCode: sendRes.status,
            statusText: sendRes.statusText,
            reason: "",
            requestPayload: providerPayload,
            responsePayload: sendRes.data || {},
            meta: {
              recipientSource,
              fullName: item.Full_Name || "",
            },
            timestamp: sendTime,
          });

          successCount++;
          results.push({
            callingDataId: item._id,
            email: recipientEmail,
            status: "Success",
            messageId,
          });
        } catch (err) {
          const failTime = new Date();
          const { email: recipientEmail } = getRecipientEmail(item);

          const failureReason =
            err?.response?.data?.message ||
            err?.response?.data?.error?.message ||
            err?.message ||
            "Failed";

          console.error("[MAILER_SEND] Stage 9: Provider call failed", {
            callingDataId: item._id,
            recipientEmail,
            reason: failureReason,
            providerResponse: err?.response?.data || null,
          });

          console.log("[MAILER_SEND] Stage 10: Updating CallingData as failed");
          await CallingData.findByIdAndUpdate(
            item._id,
            {
              $set: {
                "emailTemplates.templateName": templateName,
                "emailTemplates.status": "failed",
                "emailTemplates.messageId": "",
                "emailTemplates.timestamp": failTime,
                "emailTemplates.templateId": String(campaignId),
                "emailTemplates.templateDetails": template,
              },
              $push: {
                "emailTemplates.history": {
                  status: "failed",
                  timestamp: failTime,
                  messageId: "",
                  data: failureReason,
                  templateId: String(campaignId),
                  templateName,
                  templateDetails: template,
                },
              },
            },
            { new: true }
          );

          console.log("[MAILER_SEND] Stage 11: Saving EmailStatus as failed");
          await EmailStatus.create({
            email: recipientEmail,
            event: "failed",
            campaignId: String(campaignId),
            callingDataId: String(item._id),
            templateName,
            messageId: "",
            provider: "MailerCloud",
            statusCode: err?.response?.status || null,
            statusText: err?.response?.statusText || "",
            reason: failureReason,
            requestPayload: {
              templateName,
              fromEmail,
              campaignName: campaignName || "Campaign Team",
              campaignType: campignType,
              campaignId: String(campaignId),
              recipientEmail,
              fullName: item.Full_Name || "",
            },
            responsePayload: err?.response?.data || {},
            meta: {
              fullName: item.Full_Name || "",
            },
            timestamp: failTime,
          });

          failureCount++;
          results.push({
            callingDataId: item._id,
            email: recipientEmail,
            status: failureReason,
          });
        }
      }

      console.log("[MAILER_SEND] Stage 12: Batch completed", {
        batchNumber: b + 1,
        totalBatches: batches.length,
        successCount,
        failureCount,
      });
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    console.log("[MAILER_SEND] Stage 13: Process completed", {
      total: results.length,
      successCount,
      failureCount,
    });
    return sendResponse(res, 200, "Email process completed", {
      total: results.length,
      successCount,
      failureCount,
      results,
    });
  } catch (err) {
    console.error("Send Email Fatal Error:", err);

    const fatalErrorMessage =
      err?.response?.data?.message ||
      err?.response?.data?.error?.message ||
      err?.message ||
      "Email sending failed";
    console.log("fatalErrorMessage:", fatalErrorMessage);

    return sendError(next, fatalErrorMessage, 500);
  }
});

export {
  getMailercloudTemplateByName,
  mailercloudWebhook,
  sendTemplateEmailToCallingData,
};
