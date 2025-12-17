import axios from "axios";
import errorHandler from "../../utils/index.js";
import EmailStatus from "../../models/Email/EmailStatusModel.js";
import CallingData from "../../models/callingDataModal.js";

const { asyncHandler, sendError, sendResponse } = errorHandler;

// const getMailercloudTemplates = asyncHandler(async (req, res, next) => {
//   try {
//     const API_KEY = process.env.MAILERCLOUD_API_KEY;

//     if (!API_KEY) {
//       return sendError(next, "MailerCloud API key missing", 500);
//     }

//     const response = await axios.post(
//       "https://api.mailercloud.com/v2/templates/lists",
//       {}, // body must be {} (POST required)
//       {
//         headers: {
//           Authorization: `${API_KEY}`,
//           "Content-Type": "application/json",
//         },
//       }
//     );

//     return sendResponse(
//       res,
//       200,
//       "MailerCloud Templates Fetched Successfully",
//       response.data
//     );
//   } catch (error) {
//     console.error("MailerCloud Error:", error.response?.data || error.message);
//     return sendError(
//       next,
//       error.response?.data?.message || error.message,
//       error.response?.status || 500
//     );
//   }
// });

// const sendMailercloudEmailIndividual = asyncHandler(async (req, res, next) => {
//   try {
//     const API_KEY = process.env.MAILERCLOUD_API_KEY;

//     if (!API_KEY) {
//       return sendError(next, "MailerCloud API key missing", 500);
//     }

//     const {
//       to,
//       from,
//       subject,
//       templateId,
//       htmlContent,
//       textContent,
//       replyTo,
//       ccEmails,
//       bccEmails,
//       attachments,
//       customData,
//     } = req.body;

//     // Validation
//     if (!to || !from || !subject) {
//       return sendError(next, "Missing required fields: to, from, subject", 400);
//     }

//     if (!templateId && !htmlContent && !textContent) {
//       return sendError(
//         next,
//         "Either templateId or content (htmlContent/textContent) is required",
//         400
//       );
//     }

//     // Prepare email payload
//     const emailPayload = {
//       to: Array.isArray(to) ? to : [to],
//       from: {
//         email: from.email || from,
//         name: from.name || "",
//       },
//       subject,
//       reply_to: replyTo,
//     };

//     // Add template or content
//     if (templateId) {
//       emailPayload.template_id = templateId;
//       if (customData) {
//         emailPayload.merge_data = customData;
//       }
//     } else {
//       if (htmlContent) emailPayload.html_content = htmlContent;
//       if (textContent) emailPayload.text_content = textContent;
//     }

//     // Add optional fields
//     if (ccEmails)
//       emailPayload.cc = Array.isArray(ccEmails) ? ccEmails : [ccEmails];
//     if (bccEmails)
//       emailPayload.bcc = Array.isArray(bccEmails) ? bccEmails : [bccEmails];
//     if (attachments) emailPayload.attachments = attachments;

//     // Send email via MailerCloud API
//     const response = await axios.post(
//       "https://api.mailercloud.com/v2/emails/send",
//       emailPayload,
//       {
//         headers: {
//           Authorization: `${API_KEY}`,
//           "Content-Type": "application/json",
//         },
//       }
//     );

//     return sendResponse(res, 200, "Email sent successfully", response.data);
//   } catch (error) {
//     console.error(
//       "MailerCloud Send Error:",
//       error.response?.data || error.message
//     );
//     return sendError(
//       next,
//       error.response?.data?.message || error.message,
//       error.response?.status || 500
//     );
//   }
// });
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
// const sendBatchEmails = asyncHandler(async (req, res, next) => {
//   console.log("=== BATCH EMAIL REQUEST RECEIVED ===");
//   console.log("Request Body:", JSON.stringify(req.body, null, 2));

//   try {
//     const API_KEY = process.env.MAILERCLOUD_API_KEY;

//     if (!API_KEY) {
//       console.error("ERROR: MAILERCLOUD_API_KEY is missing from environment");
//       return sendError(next, "MailerCloud API key missing", 500);
//     }

//     console.log("API_KEY found:", API_KEY.substring(0, 10) + "...");

//     const { emails, delayMs = 100 } = req.body;

//     if (!emails || !Array.isArray(emails) || emails.length === 0) {
//       console.error("ERROR: emails array is missing or empty");
//       return sendError(next, "emails array is required", 400);
//     }

//     console.log(
//       `Processing ${emails.length} emails with ${delayMs}ms delay...`
//     );

//     const results = {
//       successful: [],
//       failed: [],
//       total: emails.length,
//     };

//     const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

//     for (let i = 0; i < emails.length; i++) {
//       const emailData = emails[i];
//       console.log(`\n--- Processing email ${i + 1}/${emails.length} ---`);

//       try {
//         if (!emailData.to || !emailData.from || !emailData.subject) {
//           console.log(`✗ Email ${i + 1} failed: Missing required fields`);
//           results.failed.push({
//             index: i,
//             email: emailData.to,
//             error: "Missing required fields",
//           });
//           continue;
//         }

//         // Convert 'to' to MailerCloud format
//         const toArray = Array.isArray(emailData.to)
//           ? emailData.to
//           : [emailData.to];
//         const toRecipients = toArray.map((email) => {
//           if (typeof email === "string") {
//             return { email, name: "" };
//           }
//           return { email: email.email, name: email.name || "" };
//         });

//         // Build the MailerCloud API payload
//         const emailPayload = {
//           email: {
//             from: emailData.from.email || emailData.from,
//             fromName: emailData.from.name || "",
//             subject: emailData.subject,
//             recipients: {
//               to: toRecipients,
//             },
//           },
//           version: "1.0",
//         };

//         // Add reply-to if present
//         if (emailData.replyTo) {
//           emailPayload.email.replyTo = Array.isArray(emailData.replyTo)
//             ? emailData.replyTo
//             : [emailData.replyTo];
//         }

//         // Add content (HTML/Text or Template)
//         if (emailData.templateId) {
//           // For template-based emails, use the template_id
//           emailPayload.email.template_id = emailData.templateId;
//           if (emailData.customData) {
//             emailPayload.email.merge_data = emailData.customData;
//           }
//         } else {
//           // For custom HTML/Text content
//           if (emailData.htmlContent) {
//             emailPayload.email.html = emailData.htmlContent;
//           }
//           if (emailData.textContent) {
//             emailPayload.email.text = emailData.textContent;
//           }
//         }

//         // Add CC emails
//         if (emailData.ccEmails && emailData.ccEmails.length > 0) {
//           emailPayload.email.recipients.cc = Array.isArray(emailData.ccEmails)
//             ? emailData.ccEmails
//             : [emailData.ccEmails];
//         }

//         // Add BCC emails
//         if (emailData.bccEmails && emailData.bccEmails.length > 0) {
//           emailPayload.email.recipients.bcc = Array.isArray(emailData.bccEmails)
//             ? emailData.bccEmails
//             : [emailData.bccEmails];
//         }

//         // Add attachments
//         if (emailData.attachments && emailData.attachments.length > 0) {
//           emailPayload.email.attachments = emailData.attachments.map((att) => ({
//             name: att.filename || att.name,
//             url: att.url || att.content, // Use URL or base64 content
//           }));
//         }

//         // Add metadata
//         emailPayload.metadata = {
//           campaignType: "transactional",
//           timestamp: new Date().toISOString(),
//           custom: {
//             inbox_tracking: true,
//           },
//         };

//         console.log(`Sending email to: ${emailData.to}`);
//         console.log("Payload:", JSON.stringify(emailPayload, null, 2));

//         const response = await axios.post(
//           "https://email-api.mailercloud.com/email",
//           emailPayload,
//           {
//             headers: {
//               Authorization: API_KEY,
//               "Content-Type": "application/json",
//               Accept: "application/json",
//             },
//             timeout: 30000, // 30 second timeout
//           }
//         );

//         console.log(`✓ Email ${i + 1} sent successfully to ${emailData.to}`);
//         console.log("Response:", JSON.stringify(response.data, null, 2));

//         results.successful.push({
//           index: i,
//           email: emailData.to,
//           messageId: response.data.message_id || response.data.id || "sent",
//         });

//         if (i < emails.length - 1) {
//           console.log(`Waiting ${delayMs}ms before next email...`);
//           await delay(delayMs);
//         }
//       } catch (error) {
//         console.error(
//           `✗ Email ${i + 1} failed:`,
//           error.response?.data || error.message
//         );
//         results.failed.push({
//           index: i,
//           email: emailData.to,
//           error: error.response?.data?.message || error.message,
//         });
//       }
//     }

//     console.log("\n=== BATCH PROCESSING COMPLETE ===");
//     console.log(`Successful: ${results.successful.length}`);
//     console.log(`Failed: ${results.failed.length}`);

//     return sendResponse(res, 200, "Batch email processing completed", results);
//   } catch (error) {
//     console.error("Batch Email Error:", error);
//     return sendError(next, error.message, 500);
//   }
// });

// // 2️⃣ QUEUE SYSTEM - Add emails to queue and process in background
// let emailQueue = [];
// let isProcessing = false;

// const addEmailsToQueue = asyncHandler(async (req, res, next) => {
//   try {
//     const { emails } = req.body;

//     if (!emails || !Array.isArray(emails) || emails.length === 0) {
//       return sendError(next, "emails array is required", 400);
//     }

//     const queueItems = emails.map((email, index) => ({
//       id: Date.now() + index,
//       email,
//       status: "queued",
//       addedAt: new Date(),
//     }));

//     emailQueue.push(...queueItems);

//     if (!isProcessing) {
//       processEmailQueue();
//     }

//     return sendResponse(res, 200, "Emails added to queue", {
//       queued: queueItems.length,
//       totalInQueue: emailQueue.length,
//     });
//   } catch (error) {
//     console.error("Queue Add Error:", error);
//     return sendError(next, error.message, 500);
//   }
// });

// async function processEmailQueue() {
//   if (isProcessing || emailQueue.length === 0) return;

//   isProcessing = true;
//   const API_KEY = process.env.MAILERCLOUD_API_KEY;

//   while (emailQueue.length > 0) {
//     const queueItem = emailQueue[0];
//     const emailData = queueItem.email;

//     try {
//       queueItem.status = "processing";

//       const emailPayload = {
//         to: Array.isArray(emailData.to) ? emailData.to : [emailData.to],
//         from: {
//           email: emailData.from.email || emailData.from,
//           name: emailData.from.name || "",
//         },
//         subject: emailData.subject,
//         reply_to: emailData.replyTo,
//       };

//       if (emailData.templateId) {
//         emailPayload.template_id = emailData.templateId;
//         if (emailData.customData) {
//           emailPayload.merge_data = emailData.customData;
//         }
//       } else {
//         if (emailData.htmlContent)
//           emailPayload.html_content = emailData.htmlContent;
//         if (emailData.textContent)
//           emailPayload.text_content = emailData.textContent;
//       }

//       if (emailData.ccEmails)
//         emailPayload.cc = Array.isArray(emailData.ccEmails)
//           ? emailData.ccEmails
//           : [emailData.ccEmails];
//       if (emailData.bccEmails)
//         emailPayload.bcc = Array.isArray(emailData.bccEmails)
//           ? emailData.bccEmails
//           : [emailData.bccEmails];
//       if (emailData.attachments)
//         emailPayload.attachments = emailData.attachments;

//       await axios.post(
//         "https://api.mailercloud.com/v2/emails/send",
//         emailPayload,
//         {
//           headers: {
//             Authorization: `${API_KEY}`,
//             "Content-Type": "application/json",
//           },
//         }
//       );

//       queueItem.status = "sent";
//       queueItem.sentAt = new Date();
//       console.log(`✓ Email sent to ${emailData.to}`);

//       emailQueue.shift();
//       await new Promise((resolve) => setTimeout(resolve, 200));
//     } catch (error) {
//       console.error(
//         `✗ Failed to send email to ${emailData.to}:`,
//         error.message
//       );
//       queueItem.status = "failed";
//       queueItem.error = error.response?.data?.message || error.message;
//       queueItem.failedAt = new Date();
//       emailQueue.shift();
//     }
//   }

//   isProcessing = false;
// }

// const getQueueStatus = asyncHandler(async (_req, res) => {
//   return sendResponse(res, 200, "Queue status", {
//     queueLength: emailQueue.length,
//     isProcessing,
//     items: emailQueue.map((item) => ({
//       id: item.id,
//       to: item.email.to,
//       status: item.status,
//       addedAt: item.addedAt,
//     })),
//   });
// });
const sendEmailUsingTemplate = asyncHandler(async (req, res, next) => {
  try {
    const API_KEY = process.env.MAILERCLOUD_API_KEY;

    if (!API_KEY) {
      return sendError(next, "MailerCloud API key missing", 500);
    }

    const { to, from, subject, templateId, customData } = req.body;

    if (!to || !from || !subject || !templateId) {
      return sendError(
        next,
        "Fields required: to, from, subject, templateId",
        400
      );
    }

    const payload = {
      email: {
        from: from.email,
        fromName: from.name || "",
        subject,
        template_id: templateId,
        recipients: {
          to: [
            {
              email: to,
              name: "",
            },
          ],
        },
        merge_data: customData || {}, // dynamic variables for template
      },
      version: "1.0",
    };

    const response = await axios.post(
      "https://email-api.mailercloud.com/email",
      payload,
      {
        headers: {
          Authorization: API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    return sendResponse(res, 200, "Email sent successfully", response.data);
  } catch (error) {
    console.error("MailerCloud Email Error:", error.response?.data || error);
    return sendError(
      next,
      error.response?.data?.message || error.message,
      error.response?.status || 500
    );
  }
});
const mailercloudWebhook = asyncHandler(async (req, res, next) => {
  try {
    console.log("📩 MailerCloud Webhook Data:", req.body);

    const { email, event, camp_id, timestamp } = req.body;

    if (!email || !event) {
      return sendError(next, "Missing required fields (email/event)", 400);
    }

    // Save webhook event in DB
    await EmailStatus.create({
      requestBody: req.body,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    });

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
// const sendTemplateEmailToCallingDataOld1 = asyncHandler(
//   async (req, res, next) => {
//     try {
//       const { callingDataIds, templateName, campaignId } = req.body;

//       if (!callingDataIds?.length || !templateName || !campaignId) {
//         return sendError(
//           next,
//           "callingDataIds, templateName and campaignId are required",
//           400
//         );
//       }

//       // ✅ 1. Fetch Template from MailerCloud
//       const templateRes = await axios.get(
//         `http://localhost:4020/api/mailercloud/template?name=${templateName}`,
//         {
//           headers: {
//             Authorization: process.env.MAILERCLOUD_TOKEN,
//           },
//         }
//       );

//       const template = templateRes.data?.data?.data;

//       if (!template?.html || !template?.plainText) {
//         return sendError(next, "Invalid template received", 400);
//       }

//       // ✅ 2. Fetch Calling Data
//       const callingDataList = await CallingData.find({
//         _id: { $in: callingDataIds },
//       }).select("Full_Name Office_Email_1 emailTemplates");

//       const results = [];

//       // ✅ 3. Loop & Send Email
//       for (const item of callingDataList) {
//         const personalizedHTML = template.html.replace(
//           /{{name}}/g,
//           item.Full_Name || "User"
//         );

//         const personalizedText = template.plainText.replace(
//           /{{name}}/g,
//           item.Full_Name || "User"
//         );
//         console.log("Personalized HTML:", personalizedHTML);
//         console.log("Personalized Text:", personalizedText);
//         console.log("Sending email to:", item);

//         // ✅ 4. Send Email via MailerCloud
//         const sendRes = await axios.post(
//           "https://email-api.mailercloud.com/email",
//           {
//             email: {
//               from: "miki@kestoneglobal.com",
//               fromName: "Campaign Team",
//               subject: template.name,
//               text: personalizedText,
//               html: personalizedHTML,
//               recipients: {
//                 to: [
//                   {
//                     name: item.Full_Name,
//                     email: item.Office_Email_1,
//                   },
//                 ],
//               },
//             },
//             // metadata: {
//             //   campaignType: "transactional",
//             //   timestamp: new Date().toISOString(),
//             //   custom: {
//             //     campaign_id: campaignId,
//             //     callingDataId: item._id,
//             //   },
//             // },
//             version: "1.0",
//           },
//           {
//             headers: {
//               Authorization: process.env.MAILERCLOUD_API_KEY,
//               "Content-Type": "application/json",
//             },
//           }
//         );

//         const messageId = sendRes.data?.messageId || "";

//         // ✅ 5. Update Calling Data (emailTemplates array)
//         await CallingData.findByIdAndUpdate(item._id, {
//           $push: {
//             emailTemplates: {
//               templateName,
//               status: "sent",
//               messageId,
//               timestamp: new Date(),
//               history: [
//                 {
//                   status: "sent",
//                   timestamp: new Date(),
//                 },
//               ],
//             },
//           },
//         });

//         results.push({
//           callingDataId: item._id,
//           email: item.Office_Email_1,
//           status: "sent",
//           messageId,
//         });
//       }

//       return sendResponse(res, 200, "Emails sent successfully", results);
//     } catch (err) {
//       console.error("Send Email Error:", err.response?.data || err.message);
//       return sendError(next, "Email sending failed", 500);
//     }
//   }
// );
const sendTemplateEmailToCallingData = asyncHandler(async (req, res, next) => {
  try {
    const { callingDataIds, templateName, campaignId, fromEmail } = req.body;

    if (!callingDataIds?.length || !templateName || !campaignId) {
      return sendError(
        next,
        "callingDataIds, templateName and campaignId are required",
        400
      );
    }

    ///////// FETCH TEMPLATE

    const templateRes = await axios.get(
      `http://localhost:4020/api/mailercloud/template?name=${templateName}`,
      {
        headers: {
          Authorization: process.env.MAILERCLOUD_TOKEN,
        },
      }
    );

    const template = templateRes.data?.data?.data;

    if (!template?.html || !template?.plainText) {
      return sendError(next, "Invalid template received", 400);
    }

    // 2. FETCH CALLING DATA

    const callingDataList = await CallingData.find({
      _id: { $in: callingDataIds },
    }).select("Full_Name Office_Email_1 emailTemplates");

    const results = [];
    const BATCH_SIZE = 500;

    // Helper: Split into batches of 500
    const chunkArray = (array, size) => {
      const chunks = [];
      for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
      }
      return chunks;
    };

    const batches = chunkArray(callingDataList, BATCH_SIZE);

    console.log(`Total Batches: ${batches.length}`);

    // 3. PROCESS EACH BATCH

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      console.log(`📦 Processing Batch ${b + 1}/${batches.length}`);

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

          console.log("Sending email to:", item.Office_Email_1);

          // 4. SEND EMAIL

          const sendRes = await axios.post(
            "https://email-api.mailercloud.com/v1/email",
            {
              email: {
                // from: "miki@kestoneglobal.com",
                from: fromEmail,
                fromName: "Campaign Team",
                subject: template.name,
                text: personalizedText,
                html: personalizedHTML,
                //   replyTo: ["miki@kestoneglobal.com"],
                replyTo: [fromEmail],
                recipients: {
                  to: [
                    {
                      name: item.Full_Name,
                      email: item.Office_Email_1,
                    },
                  ],
                },
              },
              version: "1.0",
            },
            {
              headers: {
                Authorization: process.env.MAILERCLOUD_API_KEY,
                "Content-Type": "application/json",
              },
              timeout: 15000,
            }
          );

          const messageId = sendRes.data?.messageId || "";

          // 5. UPDATE MongoDB on Success

          // await CallingData.findOneAndUpdate(
          //   { _id: item._id },
          //   {
          //     $setOnInsert: {
          //       emailTemplates: [],
          //     },
          //     $push: {
          //       emailTemplates: {
          //         templateName,
          //         status: "sent",
          //         messageId,
          //         timestamp: new Date(),
          //         history: [
          //           {
          //             status: "sent",
          //             timestamp: new Date(),
          //             messageId,
          //           },
          //         ],
          //       },
          //     },
          //   },
          //   { upsert: true }
          // );

          results.push({
            callingDataId: item._id,
            email: item.Office_Email_1,
            status: "Success",
            messageId,
          });
        } catch (err) {
          console.error(
            "Email failed for:",
            item.Office_Email_1,
            err.response?.data || err.message
          );

          // -----------------------------------------
          // 6. UPDATE MongoDB on Failure
          // -----------------------------------------
          // await CallingData.findByIdAndUpdate(
          //   item._id,
          //   {
          //     $set: {
          //       "emailTemplates.templateName": templateName,
          //       "emailTemplates.status": "failed",
          //       "emailTemplates.messageId": "",
          //       "emailTemplates.timestamp": new Date(),
          //     },
          //     $push: {
          //       "emailTemplates.history": {
          //         status: "failed",
          //         timestamp: new Date(),
          //         messageId: "",
          //       },
          //     },
          //   },
          //   { new: true }
          // );

          results.push({
            callingDataId: item._id,
            email: item.Office_Email_1,
            status: "Failed",
          });
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    return sendResponse(res, 200, "Email process completed", results);
  } catch (err) {
    console.error("Send Email Fatal Error:", err.response?.data || err.message);
    return sendError(next, "Email sending failed", 500);
  }
});
// const sendTemplateEmailToCallingDataold = asyncHandler(async (req, res, next) => {
//   try {
//     const { callingDataIds, templateName, campaignId } = req.body;

//     if (!callingDataIds?.length || !templateName || !campaignId) {
//       return sendError(
//         next,
//         "callingDataIds, templateName and campaignId are required",
//         400
//       );
//     }

//     // ✅ 1. FETCH TEMPLATE FROM MAILERCLOUD
//     const templateRes = await axios.get(
//       `http://localhost:4020/api/mailercloud/template?name=${templateName}`,
//       {
//         headers: {
//           Authorization: process.env.MAILERCLOUD_TOKEN,
//         },
//       }
//     );

//     const template = templateRes.data?.data?.data;

//     if (!template?.html || !template?.plainText) {
//       return sendError(next, "Invalid template received", 400);
//     }

//     // ✅ 2. FETCH CALLING DATA
//     const callingDataList = await CallingData.find({
//       _id: { $in: callingDataIds },
//     }).select("Full_Name Office_Email_1 emailTemplates");

//     const results = [];

//     // ✅ 3. LOOP + SEND EMAIL (FAILURE SAFE)
//     for (const item of callingDataList) {
//       try {
//         const personalizedHTML = template.html.replace(
//           /{{name}}/g,
//           item.Full_Name || "User"
//         );

//         const personalizedText = template.plainText.replace(
//           /{{name}}/g,
//           item.Full_Name || "User"
//         );

//         console.log("Sending email to:", item.Office_Email_1);

//         // ✅ 4. SEND EMAIL TO MAILERCLOUD
//         const sendRes = await axios.post(
//           "https://email-api.mailercloud.com/email",
//           {
//             email: {
//               from: "miki@kestoneglobal.com",
//               fromName: "Campaign Team",
//               subject: template.name,
//               text: personalizedText,
//               html: personalizedHTML,
//               replyTo: ["miki@kestoneglobal.com"],
//               recipients: {
//                 to: [
//                   // {
//                   //   name: item.Full_Name,
//                   //   email: item.Office_Email_1,
//                   // },
//                   {
//                     name: "miki Pradhan",
//                     email: "impradhan711@gmail.com",
//                   },
//                 ],
//               },
//             },
//             version: "1.0",
//           },
//           {
//             headers: {
//               Authorization: process.env.MAILERCLOUD_API_KEY,
//               "Content-Type": "application/json",
//             },
//             timeout: 15000, // ✅ prevents ECONNRESET hang
//           }
//         );

//         const messageId = sendRes.data?.messageId || "";

//         // ✅ 5. UPDATE CALLING DATA (SUCCESS)
//         // await CallingData.findByIdAndUpdate(item._id, {
//         //   $push: {
//         //     emailTemplates: {
//         //       templateName,
//         //       status: "sent",
//         //       messageId,
//         //       timestamp: new Date(),
//         //       history: [
//         //         {
//         //           status: "sent",
//         //           timestamp: new Date(),
//         //         },
//         //       ],
//         //     },
//         //   },
//         // });
//         ///working
//         // await CallingData.findOneAndUpdate(
//         //   { _id: item._id },
//         //   {
//         //     $setOnInsert: {
//         //       emailTemplates: [],
//         //     },
//         //     $push: {
//         //       emailTemplates: {
//         //         templateName,
//         //         status: "sent",
//         //         messageId,
//         //         timestamp: new Date(),
//         //         history: [
//         //           {
//         //             status: "sent",
//         //             timestamp: new Date(),
//         //             messageId,
//         //           },
//         //         ],
//         //       },
//         //     },
//         //   },
//         //   { upsert: true }
//         // );

//         // await CallingData.findOneAndUpdate(
//         //   { _id: item._id },
//         //   {
//         //     $setOnInsert: {
//         //       emailTemplates: [],
//         //     },
//         //     $push: {
//         //       emailTemplates: {
//         //         templateName,
//         //         status: "sent",
//         //         messageId,
//         //         timestamp: new Date(),
//         //         history: [
//         //           {
//         //             status: "sent",
//         //             timestamp: new Date(),
//         //             messageId,
//         //           },
//         //         ],
//         //       },
//         //     },
//         //   },
//         //   { upsert: true }
//         // );
//         results.push({
//           callingDataId: item._id,
//           email: item.Office_Email_1,
//           status: "Success",
//           messageId,
//         });
//       } catch (err) {
//         console.error(
//           "Email failed for:",
//           item.Office_Email_1,
//           err.response?.data || err.message
//         );

//         // ✅ 6. UPDATE CALLING DATA (FAILED)
//         // await CallingData.findByIdAndUpdate(
//         //   item._id,
//         //   {
//         //     $set: {
//         //       "emailTemplates.templateName": templateName,
//         //       "emailTemplates.status": "failed",
//         //       "emailTemplates.messageId": "",
//         //       "emailTemplates.timestamp": new Date(),
//         //     },
//         //     $push: {
//         //       "emailTemplates.history": {
//         //         status: "failed",
//         //         timestamp: new Date(),
//         //         messageId: "",
//         //       },
//         //     },
//         //   },
//         //   { new: true }
//         // );

//         results.push({
//           callingDataId: item._id,
//           email: item.Office_Email_1,
//           status: "Failed",
//         });
//       }
//     }

//     return sendResponse(res, 200, "Email process completed", results);
//   } catch (err) {
//     console.error("Send Email Fatal Error:", err.response?.data || err.message);
//     return sendError(next, "Email sending failed", 500);
//   }
// });

export {
  getMailercloudTemplateByName,
  mailercloudWebhook,
  sendTemplateEmailToCallingData,
};
