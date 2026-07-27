import axios from "axios";
import errorHandler from "../../utils/index.js";
import EmailStatus from "../../models/Email/EmailStatusModel.js";
import CallingData from "../../models/callingDataModal.js";
import Campaign from "../../models/campaignModel.js";
import { logger } from "../../logger/index.js";
import {
  createJob,
  updateJob,
  completeJob,
  failJob,
} from "../../utils/jobTracker.js";

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
// Normalise MailerCloud's verbose event names → short lowercase tokens
const MAILERCLOUD_EVENT_MAP = {
  "Campaign Sent": "sent",
  Opened: "opened",
  Clicked: "clicked",
  "Campaign Failed": "failed",
  Spam: "spam",
  Unsubscribed: "unsubscribed",
  Bounced: "bounced",
};

const mailercloudWebhook = asyncHandler(async (req, res, next) => {
  try {
    console.log(
      "==========================================================================================================================================================================================================================WEBHOOK Raw Body:====================================================================================================================================================================================================================================",
      req.body
    );

    // ── Parse MailerCloud payload fields ────────────────────────────────────
    // Docs: https://help.mailercloud.com/en/articles/132-getting-started-with-webhooks
    // Payload fields: event, email, campaign_name, tag_name, campaign_id,
    //                 date_event (datetime str), ts / ts_event (Unix secs),
    //                 URL (click only), reason (bounce/fail/spam only),
    //                 list_id (unsubscribe only), emails[] (sent batch only)
    const {
      event: rawEvent,
      email: recipientEmail,
      emails: recipientEmails, // batch sent event
      campaign_name: campaignName, // MailerCloud campaign name (= templateName for transactional)
      campaign_id: mailerCampaignId, // MailerCloud campaign id (may equal our campaignId from metadata)
      ts_event: tsEvent, // Unix seconds – most reliable timestamp
      date_event: dateEvent, // datetime string fallback
      URL: clickedUrl, // present for "Clicked" events
      reason, // present for Bounced / Campaign Failed / Spam
      list_id: listId, // present for Unsubscribed
    } = req.body;

    if (!rawEvent) {
      console.log("[WEBHOOK] Missing event field in payload");
      return sendError(next, "Missing event field", 400);
    }

    // Normalise event name
    const event =
      MAILERCLOUD_EVENT_MAP[rawEvent] ||
      rawEvent.toLowerCase().replace(/\s+/g, "_");

    // Resolve timestamp: prefer ts_event (Unix secs) → date_event string → now
    const eventTime = tsEvent
      ? new Date(tsEvent * 1000)
      : dateEvent
      ? new Date(dateEvent)
      : new Date();

    console.log("WEBHOOK Parsed Fields:", {
      rawEvent,
      event,
      recipientEmail,
      recipientEmails,
      campaignName,
      mailerCampaignId,
      clickedUrl,
      reason,
      listId,
      eventTime,
    });

    // For batch "Campaign Sent" events, MailerCloud sends an `emails` array
    // instead of a single `email`. Expand each into its own processing.
    const addressList = recipientEmails?.length
      ? recipientEmails
      : recipientEmail
      ? [recipientEmail]
      : [];

    console.log("[WEBHOOK] Address list:", addressList);

    if (!addressList.length) {
      console.log(
        "[WEBHOOK] ⚠️ No email target found — saving campaign-level event only"
      );
      await EmailStatus.create({
        event,
        mailerCampaignId,
        templateName: campaignName,
        reason: reason || "",
        webhookPayload: req.body,
        timestamp: eventTime,
      });
      return sendResponse(res, 200, "Webhook received (no email target)", {
        event,
      });
    }

    // ── Process each recipient ───────────────────────────────────────────────
    await Promise.all(
      addressList.map(async (email) => {
        console.log(`[WEBHOOK] ── Processing email: ${email} ──`);

        // ── 1. Resolve callingDataId ─────────────────────────────────────────
        // Strategy A: look up the "sent" EmailStatus record for this email +
        //             our MongoDB campaignId (which we embed in metadata.custom.campaign_id)
        let callingDataId = null;
        let sentRecord = await EmailStatus.findOne({
          email,
          campaignId: mailerCampaignId,
          event: "sent",
        })
          .select("callingDataId templateName")
          .sort({ createdAt: -1 })
          .lean();

        console.log(
          `[WEBHOOK] Strategy A (email+campaignId):`,
          sentRecord
            ? `Found → callingDataId=${sentRecord.callingDataId}`
            : "Not found"
        );

        // Strategy B: try email + templateName (campaign_name from webhook ≈ template name)
        if (!sentRecord) {
          sentRecord = await EmailStatus.findOne({
            email,
            templateName: campaignName,
            event: "sent",
          })
            .select("callingDataId templateName")
            .sort({ createdAt: -1 })
            .lean();
          console.log(
            `[WEBHOOK] Strategy B (email+templateName):`,
            sentRecord
              ? `Found → callingDataId=${sentRecord.callingDataId}`
              : "Not found"
          );
        }

        callingDataId = sentRecord?.callingDataId || null;
        console.log(
          `[WEBHOOK] Final callingDataId: ${callingDataId || "❌ UNRESOLVED"}`
        );

        // ── 2. Save to EmailStatus ───────────────────────────────────────────
        const statusDoc = {
          email,
          event,
          campaignId: mailerCampaignId,
          callingDataId: callingDataId || "",
          templateName: campaignName || sentRecord?.templateName || "",
          mailerCampaignId: mailerCampaignId || "",
          reason: reason || "",
          url: clickedUrl || "",
          provider: "MailerCloud",
          webhookPayload: req.body,
          meta: { listId: listId || "" },
          timestamp: eventTime,
        };
        await EmailStatus.create(statusDoc);
        console.log(
          `[WEBHOOK] ✅ EmailStatus saved for email=${email} event=${event}`
        );

        // ── 3. Update CallingData.emailTemplates ─────────────────────────────
        if (!callingDataId) {
          console.log(
            `[WEBHOOK] ⚠️ Skipping CallingData update — callingDataId not resolved for email=${email} event=${event}`
          );
          return;
        }

        const historyEntry = {
          event,
          timestamp: eventTime,
          ...(reason && { reason }),
          ...(clickedUrl && { url: clickedUrl }),
        };

        // Find the most recent emailTemplates entry whose recipientEmail matches
        const cdDoc = await CallingData.findOne(
          { _id: callingDataId, "emailTemplates.recipientEmail": email },
          { "emailTemplates.$": 1 }
        ).lean();

        console.log(
          `[WEBHOOK] CallingData emailTemplates match found: ${
            cdDoc?.emailTemplates?.length ? "Yes" : "No (will create stub)"
          }`
        );

        if (cdDoc?.emailTemplates?.length) {
          // Get the subdocument _id of the latest matching entry
          const latestEntry =
            cdDoc.emailTemplates[cdDoc.emailTemplates.length - 1];
          await CallingData.findOneAndUpdate(
            { _id: callingDataId, "emailTemplates._id": latestEntry._id },
            {
              $set: { "emailTemplates.$.status": event },
              $push: { "emailTemplates.$.history": historyEntry },
            }
          );
          console.log(
            `[WEBHOOK] ✅ CallingData emailTemplates updated → status=${event}`
          );
        } else {
          // No entry found — create a stub so the event is not lost
          await CallingData.findByIdAndUpdate(callingDataId, {
            $push: {
              emailTemplates: {
                recipientEmail: email,
                templateName: campaignName || "",
                status: event,
                timestamp: eventTime,
                history: [historyEntry],
              },
            },
          });
          console.log(
            `[WEBHOOK] ✅ CallingData stub entry created for email=${email} event=${event}`
          );
        }

        console.log(
          `[WEBHOOK] ✔ Done → email=${email} event=${event} callingDataId=${callingDataId}`
        );
      })
    );

    console.log(
      `[WEBHOOK] ━━ All recipients processed. event=${event} count=${addressList.length} ━━`
    );
    return sendResponse(res, 200, "Webhook processed", {
      event,
      count: addressList.length,
    });
  } catch (err) {
    console.error("[WEBHOOK] ❌ Fatal Error:", err.message);
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
const MAX_RANGE = 100000;

const sendTemplateEmailToCallingData = asyncHandler(async (req, res, next) => {
  try {
    const {
      callingDataIds,
      filterParams,   // range-based mode: { range, batch, remark, isRegistered, priorityGroup }
      templateName,
      campaignId,
      campignType,
      fromName: senderName,
    } = req.body;

    const fromEmail =
      req.body.fromEmail ||
      process.env.DEFAULT_SENDER_EMAIL ||
      process.env.MS_GRAPH_SENDER_EMAIL;

    const hasIds    = callingDataIds?.length > 0;
    const hasFilter = filterParams?.range && campaignId;

    if (!templateName || !campaignId || !fromEmail || (!hasIds && !hasFilter)) {
      return sendError(next, "templateName, campaignId, fromEmail and either callingDataIds or filterParams.range are required", 400);
    }

    // ── Resolve IDs from filterParams (range mode) ────────────────────────────
    let resolvedIds = hasIds ? callingDataIds : [];

    if (hasFilter) {
      const { range, batch, remark, isRegistered, priorityGroup } = filterParams;
      const parts = String(range).split("-").map((v) => parseInt(v.trim(), 10));
      if (parts.length !== 2 || parts.some((n) => isNaN(n))) {
        return sendError(next, "Invalid range format. Use 1-1000", 400);
      }
      const [rangeMin, rangeMax] = parts;
      const rangeSize = Math.min(rangeMax - rangeMin + 1, MAX_RANGE);
      const rangeSkip = rangeMin - 1;

      const dbFilter = { CampaignId: campaignId, "discrepencyInData.status": { $ne: true } };
      if (batch)        dbFilter.batch = { $regex: new RegExp(batch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") };
      if (isRegistered !== undefined && isRegistered !== "") dbFilter.isRegistered = isRegistered === "true" || isRegistered === true;
      if (priorityGroup === "unassigned") dbFilter["priorityGroup.no"] = null;
      else if (priorityGroup)             dbFilter["priorityGroup.label"] = priorityGroup;
      if (remark) {
        dbFilter.lastRemarks = remark === "Yet to Call" ? { $in: [null, "", "Yet to Call"] } : remark;
      }

      const DISPLAY_SORT = { "priorityGroup.no": 1, _id: 1 };
      const docs = await CallingData.find(dbFilter)
        .sort(DISPLAY_SORT)
        .hint({ CampaignId: 1, "priorityGroup.no": 1, _id: 1 })
        .skip(rangeSkip)
        .limit(rangeSize)
        .select("_id")
        .lean();

      resolvedIds = docs.map((d) => d._id);
      console.log(`[EMAIL_SEND] Range mode: ${range} → resolved ${resolvedIds.length} IDs`);
    }

    if (!resolvedIds.length) {
      return sendError(next, "No records found for the given filter/range", 400);
    }

    // Create Redis job and respond immediately
    const jobId = await createJob("email", resolvedIds.length);
    sendResponse(res, 200, "Email sending started", {
      jobId,
      totalContacts: resolvedIds.length,
      templateName,
    });

    // Increment campaign email sent counter (fire-and-forget)
    Campaign.findByIdAndUpdate(campaignId, {
      $inc: { totalEmailSent: resolvedIds.length },
    }).catch(() => {});

    // ---- BACKGROUND PROCESSING ----
    (async () => {
      try {
        const templateRes = await axios.get(
          `https://cloudapi.mailercloud.com/v1/templates/details?name=${encodeURIComponent(
            templateName
          )}`,
          {
            headers: {
              Authorization: process.env.MAILERCLOUD_API_KEY,
              Accept: "application/json",
            },
          }
        );

        const template = templateRes.data?.data;

        if (!template?.html || !template?.plainText) {
          console.error(
            "[MAILER_SEND] Invalid template payload:",
            JSON.stringify(templateRes.data)
          );
          await failJob(jobId, "Invalid template received");
          return;
        }

        const callingDataList = await CallingData.find({
          _id: { $in: resolvedIds },
        }).select(
          "Full_Name Office_Email_1 Office_Email_2 Personal_Email1 Personal_Email2  emailTemplates"
        );

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
          if (["na", "n/a", "null", "undefined", "-"].includes(lower))
            return "";
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

        for (let b = 0; b < batches.length; b++) {
          const batch = batches[b];

          // Loop inside single batch

          for (const item of batch) {
            try {
              // Migrate emailTemplates from old object format to array if needed
              await CallingData.updateOne(
                {
                  _id: item._id,
                  $expr: { $not: { $isArray: "$emailTemplates" } },
                },
                { $set: { emailTemplates: [] } }
              );

              const personalizedHTML = template.html.replace(
                /{{name}}/g,
                item.Full_Name || "User"
              );

              const personalizedText = template.plainText.replace(
                /{{name}}/g,
                item.Full_Name || "User"
              );

              const { email: recipientEmail, source: recipientSource } =
                getRecipientEmail(item);

              if (!recipientEmail) {
                console.error("[MAILER_SEND] Stage 8: No recipient email", {
                  callingDataId: item._id,
                });

                const noEmailTime = new Date();
                await CallingData.findByIdAndUpdate(
                  item._id,
                  {
                    $push: {
                      emailTemplates: {
                        messageId: "",
                        templateId: String(campaignId),
                        templateName,
                        campaignId: String(campaignId),
                        recipientEmail: "",
                        recipientSource: "",
                        status: "failed",
                        timestamp: noEmailTime,
                        history: [
                          {
                            event: "failed",
                            timestamp: noEmailTime,
                            reason: "No email available",
                          },
                        ],
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
                    fromName: senderName || fromEmail,
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
                  fromName: senderName || fromEmail,
                  subject: template.name,
                  text: personalizedText,
                  html: personalizedHTML,
                  replyTo: [fromEmail],
                  trackOpens: true,
                  trackClicks: true,
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
                    campaign_id: String(campaignId),
                    calling_data_id: String(item._id),
                    template_name: templateName,
                  },
                },
                version: "1.0",
              };

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
              const messageId = sendRes.data?.messageId || "";
              await CallingData.findByIdAndUpdate(
                item._id,
                {
                  $push: {
                    emailTemplates: {
                      messageId,
                      templateId: String(campaignId),
                      templateName,
                      campaignId: String(campaignId),
                      recipientEmail,
                      recipientSource,
                      status: "sent",
                      timestamp: sendTime,
                      history: [{ event: "sent", timestamp: sendTime }],
                    },
                  },
                },
                { new: true }
              );

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
              const { email: recipientEmail, source: recipientSource } =
                getRecipientEmail(item);

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

              await CallingData.findByIdAndUpdate(
                item._id,
                {
                  $push: {
                    emailTemplates: {
                      messageId: "",
                      templateId: String(campaignId),
                      templateName,
                      campaignId: String(campaignId),
                      recipientEmail,
                      recipientSource,
                      status: "failed",
                      timestamp: failTime,
                      history: [
                        {
                          event: "failed",
                          timestamp: failTime,
                          reason: failureReason,
                        },
                      ],
                    },
                  },
                },
                { new: true }
              );

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
                  fromName: senderName || fromEmail,
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

          await updateJob(jobId, successCount, failureCount);
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }

        await completeJob(jobId);
      } catch (err) {
        const fatalErrorMessage =
          err?.response?.data?.message ||
          err?.response?.data?.error?.message ||
          err?.message ||
          "Email sending failed";
        console.error(
          "[MAILER_SEND] Background process failed:",
          fatalErrorMessage
        );
        await failJob(jobId, fatalErrorMessage);
      }
    })();
  } catch (err) {
    console.error("Send Email Fatal Error:", err);
    const fatalErrorMessage =
      err?.response?.data?.message ||
      err?.response?.data?.error?.message ||
      err?.message ||
      "Email sending failed";
    return sendError(next, fatalErrorMessage, 500);
  }
});

const getAllMailerCloudTemplates = asyncHandler(async (req, res, next) => {
  try {
    const API_KEY = process.env.MAILERCLOUD_API_KEY;
    if (!API_KEY) return sendError(next, "MailerCloud API key missing", 500);

    // Try different MailerCloud template list endpoints
    const endpoints = [
      {
        method: "get",
        url: "https://cloudapi.mailercloud.com/v1/templates",
        params: {},
      },
      {
        method: "get",
        url: "https://cloudapi.mailercloud.com/v1/templates/list",
        params: {},
      },
      {
        method: "post",
        url: "https://cloudapi.mailercloud.com/v1/templates/list",
        data: {},
      },
    ];

    let lastError = null;
    for (const ep of endpoints) {
      try {
        const config = {
          headers: {
            Authorization: API_KEY,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        };
        const response =
          ep.method === "get"
            ? await axios.get(ep.url, { ...config, params: ep.params })
            : await axios.post(ep.url, ep.data || {}, config);

        const templates = response.data?.data || response.data || [];
        return sendResponse(
          res,
          200,
          "Templates fetched successfully",
          Array.isArray(templates) ? templates : []
        );
      } catch (err) {
        console.warn(
          `[MailerCloud] Failed ${ep.method.toUpperCase()} ${ep.url}:`,
          err.response?.data || err.message
        );
        lastError = err;
      }
    }

    return sendError(
      next,
      lastError?.response?.data?.errors?.[0]?.message ||
        lastError?.message ||
        "Failed to fetch templates",
      500
    );
  } catch (error) {
    console.error(
      "MailerCloud Get All Templates Error:",
      error.response?.data || error.message
    );
    return sendError(
      next,
      error.response?.data?.message || error.message,
      error.response?.status || 500
    );
  }
});

const getMailerCloudSenders = asyncHandler(async (req, res, next) => {
  try {
    const API_KEY = process.env.MAILERCLOUD_API_KEY;
    if (!API_KEY) return sendError(next, "MailerCloud API key missing", 500);

    const response = await axios.post(
      "https://cloudapi.mailercloud.com/v1/senders/search",
      {
        limit: 100,
        page: 1,
        search: "",
        sort_field: "sender_email",
        sort_order: "asc",
      },
      {
        headers: {
          Authorization: API_KEY,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    const list = response.data?.data || response.data || [];
    const senders = (Array.isArray(list) ? list : [])
      .map((s) => ({
        email: s.sender_email || s.email || "",
        name: s.sender_name || s.name || "",
      }))
      .filter((s) => s.email);

    return sendResponse(res, 200, "Senders fetched", senders);
  } catch (error) {
    console.error(
      "[MailerCloud] senders/search error:",
      error.response?.data || error.message
    );
    return sendError(
      next,
      error.response?.data?.message || error.message,
      error.response?.status || 500
    );
  }
});

export {
  getMailercloudTemplateByName,
  getAllMailerCloudTemplates,
  mailercloudWebhook,
  sendTemplateEmailToCallingData,
  getMailerCloudSenders,
};
