import axios from "axios";
import errorHandler from "../../utils/index.js";
import EmailStatus from "../../models/Email/EmailStatusModel.js";
import CallingData from "../../models/callingDataModal.js";
import { logger } from "../../logger/index.js";

const { asyncHandler, sendError, sendResponse } = errorHandler;

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

const sendTemplateEmailToCallingData = asyncHandler(async (req, res, next) => {
  try {
    const {
      callingDataIds,
      templateName,
      campaignId,
      fromEmail,
      campignType,
      campaignName,
    } = req.body;

    //console.log("Request Body:", req.body);

    if (!callingDataIds?.length || !templateName || !campaignId || !fromEmail) {
      return sendError(
        next,
        "callingDataIds, templateName, SenderEmail  and campaignId are required",
        400
      );
    }
    // console.log("Fetching MAILERtoken:", process.env.MAILERCLOUD_API_KEY);

    ///////// FETCH TEMPLATE
    const baseUrl = process.env.BASE_URL;
    console.log(baseUrl, "baseurl");

    const templateRes = await axios.get(
      `${baseUrl}api/mailercloud/template?name=${templateName}`,
      {
        headers: {
          Authorization: process.env.MAILERCLOUD_API_KEY,
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
    }).select(
      "Full_Name Office_Email_1 Office_Email_2 Personal_Email1 Personal_Email2  emailTemplates"
    );

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

    // console.log(`Total Batches: ${batches.length}`);

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

          console.log("Sending email to:", item);

          // 4. SEND EMAIL
          const recipientEmail =
            item.Office_Email_1 ||
            item.Office_Email_2 ||
            item.Personal_Email1 ||
            item.Personal_Email2;

          if (!recipientEmail) {
            console.error("No valid email found for:", item._id);

            results.push({
              callingDataId: item._id,
              email: null,
              status: "Failed",
              reason: "No email available",
            });

            continue; // skip this user
          }

          const sendRes = await axios.post(
            "https://email-api.mailercloud.com/email",
            {
              email: {
                // from: "miki@kestoneglobal.com",
                from: fromEmail,
                fromName: campaignName || "Campaign Team",
                subject: template.name,
                text: personalizedText,
                html: personalizedHTML,
                //   replyTo: ["miki@kestoneglobal.com"],
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
            },
            {
              headers: {
                Authorization: process.env.MAILERCLOUD_API_KEY,
                "Content-Type": "application/json",
              },
              timeout: 15000,
            }
          );
          console.log("Email sent :", sendRes);

          const messageId = sendRes.data?.messageId || "";

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
          await CallingData.findByIdAndUpdate(
            item._id,
            {
              $set: {
                "emailTemplates.templateName": templateName,
                "emailTemplates.status": "sent",
                "emailTemplates.messageId": "",
                "emailTemplates.timestamp": new Date(),
              },
              // $push: {
              //   "emailTemplates.history": {
              //     status: err.response?.data,

              //     timestamp: new Date(),
              //     messageId: "",
              //   },
              // },
              $push: {
                "emailTemplates.history": {
                  status: "sent", // keep status consistent
                  timestamp: new Date(),
                  messageId: "",
                  // error: err.response?.data, // always string
                  data: err.response?.data.message || err.message,
                },
              },
            },
            { new: true }
          );
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
            err.response?.data.message
            // err.response?.data || err.message
          );

          // -----------------------------------------
          // 6. UPDATE MongoDB on Failure
          // -----------------------------------------
          //         const errorDetails =
          // typeof err?.response?.data === "string"
          //   ? err.response.data
          //   : JSON.stringify(err?.response?.data || err.message);

          await CallingData.findByIdAndUpdate(
            item._id,
            {
              $set: {
                "emailTemplates.templateName": templateName,
                "emailTemplates.status": "failed",
                "emailTemplates.messageId": "",
                "emailTemplates.timestamp": new Date(),
              },
              // $push: {
              //   "emailTemplates.history": {
              //     status: err.response?.data,

              //     timestamp: new Date(),
              //     messageId: "",
              //   },
              // },
              $push: {
                "emailTemplates.history": {
                  status: "failed",
                  timestamp: new Date(),
                  messageId: "",
                  // error: err.response?.data, // always string
                  data: err.response?.data.message || err.message,
                },
              },
            },
            { new: true }
          );

          results.push({
            callingDataId: item._id,
            email: item.Office_Email_1,
            status: err.response?.data.message || "Failed",
          });
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    return sendResponse(res, 200, "Email process completed", results);
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
