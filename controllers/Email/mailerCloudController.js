import axios from "axios";
import errorHandler from "../../utils/index.js";

const { asyncHandler, sendError, sendResponse } = errorHandler;

async function getToken() {
  const response = await axios.post(
    "https://api.mailercloud.com/v2/auth/token",
    {
      api_key: "YOUR_API_KEY",
    }
  );
  return response.data.token;
}

const getMailercloudTemplates = asyncHandler(async (req, res, next) => {
  try {
    const API_KEY = process.env.MAILERCLOUD_API_KEY;

    if (!API_KEY) {
      return sendError(next, "MailerCloud API key missing", 500);
    }

    const response = await axios.post(
      "https://api.mailercloud.com/v2/templates/lists",
      {}, // body must be {} (POST required)
      {
        headers: {
          Authorization: `${API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return sendResponse(
      res,
      200,
      "MailerCloud Templates Fetched Successfully",
      response.data
    );
  } catch (error) {
    console.error("MailerCloud Error:", error.response?.data || error.message);
    return sendError(
      next,
      error.response?.data?.message || error.message,
      error.response?.status || 500
    );
  }
});

const sendMailercloudEmailIndividual = asyncHandler(async (req, res, next) => {
  try {
    const API_KEY = process.env.MAILERCLOUD_API_KEY;

    if (!API_KEY) {
      return sendError(next, "MailerCloud API key missing", 500);
    }

    const {
      to,
      from,
      subject,
      templateId,
      htmlContent,
      textContent,
      replyTo,
      ccEmails,
      bccEmails,
      attachments,
      customData,
    } = req.body;

    // Validation
    if (!to || !from || !subject) {
      return sendError(next, "Missing required fields: to, from, subject", 400);
    }

    if (!templateId && !htmlContent && !textContent) {
      return sendError(
        next,
        "Either templateId or content (htmlContent/textContent) is required",
        400
      );
    }

    // Prepare email payload
    const emailPayload = {
      to: Array.isArray(to) ? to : [to],
      from: {
        email: from.email || from,
        name: from.name || "",
      },
      subject,
      reply_to: replyTo,
    };

    // Add template or content
    if (templateId) {
      emailPayload.template_id = templateId;
      if (customData) {
        emailPayload.merge_data = customData;
      }
    } else {
      if (htmlContent) emailPayload.html_content = htmlContent;
      if (textContent) emailPayload.text_content = textContent;
    }

    // Add optional fields
    if (ccEmails)
      emailPayload.cc = Array.isArray(ccEmails) ? ccEmails : [ccEmails];
    if (bccEmails)
      emailPayload.bcc = Array.isArray(bccEmails) ? bccEmails : [bccEmails];
    if (attachments) emailPayload.attachments = attachments;

    // Send email via MailerCloud API
    const response = await axios.post(
      "https://api.mailercloud.com/v2/emails/send",
      emailPayload,
      {
        headers: {
          Authorization: `${API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return sendResponse(res, 200, "Email sent successfully", response.data);
  } catch (error) {
    console.error(
      "MailerCloud Send Error:",
      error.response?.data || error.message
    );
    return sendError(
      next,
      error.response?.data?.message || error.message,
      error.response?.status || 500
    );
  }
});
// async function sendCampaign(campaignId) {
//   try {
//     const response = await axios.post(
//       `https://cloudapi.mailercloud.com/v1/campaigns/${campaignId}/send`,
//       {},
//       {
//         headers: {
//           Authorization: `Bearer ${MAILERCLOUD_API_KEY}`,
//           "Content-Type": "application/json",
//         },
//       }
//     );

//     console.log("Campaign Sent Successfully");
//   } catch (error) {
//     console.error("Error Sending Campaign:", error.response?.data || error);
//   }
// }

// // ------------------------------------------------------
// // 4️⃣ Webhook Endpoint to Receive Email Status (OPEN/READ)
// // ------------------------------------------------------
// app.post("/mailercloud/webhook", (req, res) => {
//   console.log("Webhook Received:", req.body);

//   if (req.body.event === "open") {
//     console.log("Email Opened by:", req.body.recipient_email);
//   }

//   if (req.body.event === "click") {
//     console.log("Email Link Clicked by:", req.body.recipient_email);
//   }

//   res.sendStatus(200);
// });

// // ------------------------------------------------------
// // 5️⃣ API Route to Trigger Everything
// // ------------------------------------------------------
// app.get("/send-email", async (req, res) => {
//   const campaignId = await createCampaign();
//   await addCampaignContent(campaignId);
//   await sendCampaign(campaignId);

//   res.send("Email triggered successfully!");
// });

// // ------------------------------------------------------
// app.listen(3000, () => {
//   console.log("Server running on port 3000");
// });
// 1️⃣ BATCH PROCESSING - Send multiple emails sequentially with rate limiting
const sendBatchEmails = asyncHandler(async (req, res, next) => {
  try {
    const API_KEY = process.env.MAILERCLOUD_API_KEY;

    if (!API_KEY) {
      return sendError(next, "MailerCloud API key missing", 500);
    }

    const { emails, delayMs = 100 } = req.body;

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return sendError(next, "emails array is required", 400);
    }

    const results = {
      successful: [],
      failed: [],
      total: emails.length,
    };

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    for (let i = 0; i < emails.length; i++) {
      const emailData = emails[i];

      try {
        if (!emailData.to || !emailData.from || !emailData.subject) {
          results.failed.push({
            index: i,
            email: emailData.to,
            error: "Missing required fields",
          });
          continue;
        }

        const emailPayload = {
          to: Array.isArray(emailData.to) ? emailData.to : [emailData.to],
          from: {
            email: emailData.from.email || emailData.from,
            name: emailData.from.name || "",
          },
          subject: emailData.subject,
          reply_to: emailData.replyTo,
        };

        if (emailData.templateId) {
          emailPayload.template_id = emailData.templateId;
          if (emailData.customData) {
            emailPayload.merge_data = emailData.customData;
          }
        } else {
          if (emailData.htmlContent)
            emailPayload.html_content = emailData.htmlContent;
          if (emailData.textContent)
            emailPayload.text_content = emailData.textContent;
        }

        if (emailData.ccEmails)
          emailPayload.cc = Array.isArray(emailData.ccEmails)
            ? emailData.ccEmails
            : [emailData.ccEmails];
        if (emailData.bccEmails)
          emailPayload.bcc = Array.isArray(emailData.bccEmails)
            ? emailData.bccEmails
            : [emailData.bccEmails];
        if (emailData.attachments)
          emailPayload.attachments = emailData.attachments;

        const response = await axios.post(
          "https://api.mailercloud.com/v2/emails/send",
          emailPayload,
          {
            headers: {
              Authorization: `${API_KEY}`,
              "Content-Type": "application/json",
            },
          }
        );

        results.successful.push({
          index: i,
          email: emailData.to,
          messageId: response.data.message_id || response.data.id,
        });

        if (i < emails.length - 1) {
          await delay(delayMs);
        }
      } catch (error) {
        results.failed.push({
          index: i,
          email: emailData.to,
          error: error.response?.data?.message || error.message,
        });
      }
    }

    return sendResponse(res, 200, "Batch email processing completed", results);
  } catch (error) {
    console.error("Batch Email Error:", error);
    return sendError(next, error.message, 500);
  }
});

// 2️⃣ QUEUE SYSTEM - Add emails to queue and process in background
let emailQueue = [];
let isProcessing = false;

const addEmailsToQueue = asyncHandler(async (req, res, next) => {
  try {
    const { emails } = req.body;

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return sendError(next, "emails array is required", 400);
    }

    const queueItems = emails.map((email, index) => ({
      id: Date.now() + index,
      email,
      status: "queued",
      addedAt: new Date(),
    }));

    emailQueue.push(...queueItems);

    if (!isProcessing) {
      processEmailQueue();
    }

    return sendResponse(res, 200, "Emails added to queue", {
      queued: queueItems.length,
      totalInQueue: emailQueue.length,
    });
  } catch (error) {
    console.error("Queue Add Error:", error);
    return sendError(next, error.message, 500);
  }
});

async function processEmailQueue() {
  if (isProcessing || emailQueue.length === 0) return;

  isProcessing = true;
  const API_KEY = process.env.MAILERCLOUD_API_KEY;

  while (emailQueue.length > 0) {
    const queueItem = emailQueue[0];
    const emailData = queueItem.email;

    try {
      queueItem.status = "processing";

      const emailPayload = {
        to: Array.isArray(emailData.to) ? emailData.to : [emailData.to],
        from: {
          email: emailData.from.email || emailData.from,
          name: emailData.from.name || "",
        },
        subject: emailData.subject,
        reply_to: emailData.replyTo,
      };

      if (emailData.templateId) {
        emailPayload.template_id = emailData.templateId;
        if (emailData.customData) {
          emailPayload.merge_data = emailData.customData;
        }
      } else {
        if (emailData.htmlContent)
          emailPayload.html_content = emailData.htmlContent;
        if (emailData.textContent)
          emailPayload.text_content = emailData.textContent;
      }

      if (emailData.ccEmails)
        emailPayload.cc = Array.isArray(emailData.ccEmails)
          ? emailData.ccEmails
          : [emailData.ccEmails];
      if (emailData.bccEmails)
        emailPayload.bcc = Array.isArray(emailData.bccEmails)
          ? emailData.bccEmails
          : [emailData.bccEmails];
      if (emailData.attachments)
        emailPayload.attachments = emailData.attachments;

      await axios.post(
        "https://api.mailercloud.com/v2/emails/send",
        emailPayload,
        {
          headers: {
            Authorization: `${API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      queueItem.status = "sent";
      queueItem.sentAt = new Date();
      console.log(`✓ Email sent to ${emailData.to}`);

      emailQueue.shift();
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (error) {
      console.error(
        `✗ Failed to send email to ${emailData.to}:`,
        error.message
      );
      queueItem.status = "failed";
      queueItem.error = error.response?.data?.message || error.message;
      queueItem.failedAt = new Date();
      emailQueue.shift();
    }
  }

  isProcessing = false;
}

const getQueueStatus = asyncHandler(async (_req, res) => {
  return sendResponse(res, 200, "Queue status", {
    queueLength: emailQueue.length,
    isProcessing,
    items: emailQueue.map((item) => ({
      id: item.id,
      to: item.email.to,
      status: item.status,
      addedAt: item.addedAt,
    })),
  });
});

export {
  getMailercloudTemplates,
  sendMailercloudEmail,
  sendBatchEmails,
  addEmailsToQueue,
  getQueueStatus,
};
