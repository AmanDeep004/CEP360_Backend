import DoubleTickData from "../../models/Webhook/webHookModel.js";
import CallingData from "../../models/callingDataModal.js";
import Contact from "../../models/MasterDBModel/contactModel.js";
import Template from "../../models/Webhook/templateModel.js";
import errorHandler from "../../utils/index.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;

const normalizeNumber = (num) => {
  if (!num) return "";
  return String(num)
    .replace(/[^0-9]/g, "")
    .replace(/^91/, "")
    .replace(/^0/, "");
};

const findContactForNumber = async (mobile) => {
  if (!mobile) return null;

  return await Contact.findOne({
    $or: [
      { Mobile_No: mobile },
      { Contact_Direct_Phone1: mobile },
      { Contact_Direct_Phone2: mobile },
    ],
  }).lean();
};

const findCallingDataForNumber = async (mobile) => {
  if (!mobile) return null;

  const normalizedMobile = normalizeNumber(mobile);

  const orQuery = [
    { Contact_Direct_Phone1: new RegExp(`${normalizedMobile}$`) },
    { Contact_Direct_Phone2: new RegExp(`${normalizedMobile}$`) },
    { Mobile_No: new RegExp(`${normalizedMobile}$`) },
  ];

  return await CallingData.findOne({ $or: orQuery }).lean();
};

// MESSAGE STATUS UPDATE WEBHOOK
const messageStatusUpdateOld = asyncHandler(async (req, res, next) => {
  try {
    console.log("Received Message Status Webhook:", req.body);
    const payload = req.body;
    if (!payload) return sendError(next, "Payload missing", 400);

    const waMessageId =
      payload?.messageId ||
      payload?.message_id ||
      payload?.message?.message_id ||
      "";

    const status =
      payload?.status || payload?.event_type || payload?.message_status || "";

    const timestamp =
      payload?.statusTimestamp ||
      payload?.timestamp ||
      payload?.status_timestamp ||
      new Date();

    const mobile = normalizeNumber(payload?.to || payload?.phone);

    const contact = await findContactForNumber(mobile);

    const saveObj = {
      webhookType: "MessageStatus",
      mobileNumber: mobile,
      contactId: contact?._id || null,
      payload,
      eventType: status,
      waMessageId,
      status,
      timestamp: new Date(timestamp),
      templateMessage: payload?.message || null,
    };

    const saved = await DoubleTickData.create(saveObj);

    return sendResponse(res, 200, "Message status webhook saved", {
      received: true,
      id: saved._id,
      mobile,
      matchedContact: contact?._id || null,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// const messageStatusUpdate = asyncHandler(async (req, res, next) => {
//   try {
//     const payload = req.body;
//     const {
//       messageId,
//       to,
//       status,
//       statusTimestamp,
//       customerName,
//       templateId,
//       templateName,
//       sentBy,
//       assignedTo,
//       wabaNumber,
//     } = payload;
//     if (!payload) return sendError(next, "Payload missing", 400);

//     if (!messageId) {
//       return sendError(next, "waMessageId not found", 400);
//     }
//     const contact = await findContactForNumber(normalizeNumber(to));

//     const newHistory = { payload };

//     const updateData = {
//       webhookType: "MessageStatus",
//       mobileNumber: to,
//       contactId: contact?._id || null,
//       templateId,
//       templateName,
//       payload,
//       eventType: "MessageStatus",
//       status,
//       waMessageId: messageId,
//       timestamp: statusTimestamp,
//       templateMessage: payload?.message || null,
//       updatedAt: new Date(),
//     };

//     const updatedDoc = await DoubleTickData.findOneAndUpdate(
//       { waMessageId: messageId },
//       { $set: updateData, $push: { messageHistory: newHistory } },
//       { new: true, upsert: true }
//     );

//     return sendResponse(res, 200, "Status updated / created successfully");
//   } catch (err) {
//     return sendError(next, err.message, 500);
//   }
// });

const messageStatusUpdate = asyncHandler(async (req, res, next) => {
  try {
    const payload = req.body;
    console.log(
      "Received Message Status Webhook:",
      JSON.stringify(payload, null, 2)
    );

    if (!payload) {
      return sendError(next, "Payload missing", 400);
    }

    const mobile = normalizeNumber(
      payload?.to || payload?.receiver || payload?.phone || payload?.recipient
    );

    if (!mobile) {
      console.log("No mobile number found in payload");
      return sendResponse(res, 200, "No mobile number in payload", {
        received: true,
        mobile: null,
      });
    }

    const callingDataContact = await findCallingDataForNumber(mobile);

    if (!callingDataContact) {
      console.log(`CallingData contact not found for number: ${mobile}`);
      //check for the this part we mignt not require this
      const saveObj = {
        webhookType: "MessageStatus",
        mobileNumber: mobile,
        contactId: null,
        payload,
        eventType: payload?.status || payload?.event_type || "unknown",
        waMessageId: payload?.messageId || payload?.message_id || "",
        status: payload?.status || payload?.delivery_status || "",
        timestamp: new Date(
          payload?.timestamp || payload?.statusTimestamp || Date.now()
        ),
        templateMessage: payload?.message || null,
        templateId: payload?.templateId || "",
        templateName: payload?.templateName || "",
      };

      const saved = await DoubleTickData.create(saveObj);

      return sendResponse(res, 200, "Contact not found, webhook logged", {
        received: true,
        logId: saved._id,
        mobile,
        matched: false,
      });
    }

    const waMessageId =
      payload?.messageId ||
      payload?.message_id ||
      payload?.message?.message_id ||
      payload?.referenceId ||
      "";

    if (!waMessageId) {
      console.log("No message ID found in payload");
      return sendResponse(res, 200, "No message ID in payload", {
        received: true,
        contactId: callingDataContact._id,
        mobile,
      });
    }

    const status =
      payload?.status ||
      payload?.delivery_status ||
      payload?.message?.status ||
      payload?.event_type ||
      "";

    const timestamp =
      payload?.timestamp ||
      payload?.statusTimestamp ||
      payload?.message?.timestamp ||
      Date.now();

    const templateId = payload?.templateId || "";
    const templateName = payload?.templateName || "";

    console.log(
      `Found CallingData contact: ${callingDataContact._id}, updating status for message: ${waMessageId}`
    );

    let updated = await CallingData.findOneAndUpdate(
      {
        _id: callingDataContact._id,
        "whatsappTemplates.waMessageId": waMessageId,
      },
      {
        $push: {
          "whatsappTemplates.$.history": {
            status,
            timestamp: new Date(timestamp),
          },
        },
        $set: {
          "whatsappTemplates.$.status": status,
          "whatsappTemplates.$.timestamp": new Date(timestamp),
          "whatsappTemplates.$.templateId": templateId,
          "whatsappTemplates.$.templateName": templateName,
        },
      },
      { new: true }
    );

    if (!updated) {
      console.log(
        `Creating new WhatsApp template entry for message: ${waMessageId}`
      );

      updated = await CallingData.findByIdAndUpdate(
        callingDataContact._id,
        {
          $push: {
            whatsappTemplates: {
              waMessageId,
              templateId: templateId,
              templateName: templateName,
              status,
              timestamp: new Date(timestamp),
              history: [
                {
                  status,
                  timestamp: new Date(timestamp),
                },
              ],
            },
          },
        },
        { new: true }
      );
    }

    const saveObj = {
      webhookType: "MessageStatus",
      mobileNumber: mobile,
      contactId: callingDataContact._id,
      payload,
      eventType: status,
      waMessageId,
      status,
      timestamp: new Date(timestamp),
      templateMessage: payload?.message || null,
      templateName: templateName,
      templateId: templateId,
    };

    await DoubleTickData.create(saveObj);

    console.log(
      `Updated CallingData WhatsApp Template for contact: ${callingDataContact._id}`
    );

    return sendResponse(res, 200, "Message status updated successfully", {
      received: true,
      contactId: callingDataContact._id,
      mobile,
      waMessageId,
      status,
      templateId,
      templateName,
      updated: true,
    });
  } catch (err) {
    console.error("Error in messageStatusUpdate:", err);
    return sendError(next, err.message, 500);
  }
});

// MESSAGE RECEIVED WEBHOOK (when customer replies)
const messageReceiveUpdate = asyncHandler(async (req, res, next) => {
  try {
    const payload = req.body;
    console.log(
      "Received Message Receive Webhook:",
      JSON.stringify(payload, null, 2)
    );

    if (!payload) {
      return sendError(next, "Payload missing", 400);
    }

    const mobile = normalizeNumber(
      payload?.from || payload?.sender || payload?.phone || payload?.number
    );

    if (!mobile) {
      console.log("No mobile number found in payload");
      return sendResponse(res, 200, "No mobile number in payload", {
        received: true,
      });
    }

    const contact = await findContactForNumber(mobile);

    const waMessageId =
      payload?.messageId ||
      payload?.message_id ||
      payload?.message?.message_id ||
      payload?.id ||
      "";

    const msgText =
      payload?.text ||
      payload?.message?.text ||
      payload?.message?.textMessage ||
      payload?.body ||
      "";

    const timestamp =
      payload?.timestamp || payload?.message?.timestamp || Date.now();

    const messageType =
      payload?.message_type ||
      payload?.type ||
      payload?.message?.type ||
      "text";

    const saveObj = {
      webhookType: "MessageReceived",
      mobileNumber: mobile,
      contactId: contact?._id || null,
      payload,
      waMessageId,
      messageType,
      textMessage: msgText,
      timestamp: new Date(timestamp),
      senderName: payload?.sender_name || payload?.name || "",
      eventType: "MessageReceived",
    };

    const saved = await DoubleTickData.create(saveObj);

    console.log(`Message receive webhook saved: ${saved._id}`);

    return sendResponse(
      res,
      200,
      "Message receive webhook saved successfully",
      {
        received: true,
        id: saved._id,
        mobile,
        matchedContact: contact?._id || null,
        hasContact: !!contact,
      }
    );
  } catch (err) {
    console.error("Error in messageReceiveUpdate:", err);
    return sendError(next, err.message, 500);
  }
});

const getAllDoubleTickLogs = asyncHandler(async (req, res, next) => {
  try {
    const { page = 1, limit = 50, webhookType, status, mobile } = req.query;

    const filter = {};

    if (webhookType) {
      filter.webhookType = webhookType;
    }

    if (status) {
      filter.status = status;
    }

    if (mobile) {
      filter.mobileNumber = { $regex: normalizeNumber(mobile), $options: "i" };
    }

    const logs = await DoubleTickData.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate({
        path: "contactId",
      })
      .lean();

    const count = await DoubleTickData.countDocuments(filter);

    if (logs.length === 0) {
      return sendResponse(res, 200, "No DoubleTick data found", {
        logs: [],
        totalPages: 0,
        currentPage: parseInt(page),
        totalCount: 0,
      });
    }

    const templateNames = logs
      .map((l) => l.templateName)
      .filter((name) => name);

    let templateMap = {};
    if (templateNames.length > 0) {
      const templateDocs = await Template.find({
        templateName: { $in: templateNames },
      })
        .populate({
          path: "campaignId",
        })
        .lean();

      templateDocs.forEach((t) => {
        templateMap[t.templateName] = t;
      });
    }

    const enrichedData = logs.map((log) => {
      const temp = templateMap[log.templateName] || null;

      return {
        ...log,
        template: temp,
        campaign: temp?.campaignId || null,
      };
    });

    return sendResponse(res, 200, "DoubleTick data fetched successfully", {
      logs: enrichedData,
      totalPages: Math.ceil(count / limit),
      currentPage: parseInt(page),
      totalCount: count,
    });
  } catch (err) {
    console.error("Error in getAllDoubleTickLogs:", err);
    return sendError(next, err.message, 500);
  }
});

const getWebhookStats = asyncHandler(async (req, res, next) => {
  try {
    const stats = await DoubleTickData.aggregate([
      {
        $facet: {
          byType: [
            {
              $group: {
                _id: "$webhookType",
                count: { $sum: 1 },
              },
            },
          ],
          byStatus: [
            {
              $match: { webhookType: "MessageStatus" },
            },
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
              },
            },
          ],
          total: [
            {
              $count: "count",
            },
          ],
          matchedContacts: [
            {
              $match: { contactId: { $ne: null } },
            },
            {
              $count: "count",
            },
          ],
        },
      },
    ]);

    const result = {
      total: stats[0].total[0]?.count || 0,
      matchedContacts: stats[0].matchedContacts[0]?.count || 0,
      byType: {},
      byStatus: {},
    };

    stats[0].byType.forEach((item) => {
      result.byType[item._id] = item.count;
    });

    stats[0].byStatus.forEach((item) => {
      result.byStatus[item._id] = item.count;
    });

    return sendResponse(res, 200, "Statistics fetched successfully", result);
  } catch (err) {
    console.error("Error in getWebhookStats:", err);
    return sendError(next, err.message, 500);
  }
});

const getWebhookLogsByContact = asyncHandler(async (req, res, next) => {
  try {
    const { contactId } = req.params;

    const logs = await DoubleTickData.find({ contactId })
      .sort({ createdAt: -1 })
      .lean();

    return sendResponse(res, 200, "Contact webhook logs fetched successfully", {
      contactId,
      count: logs.length,
      logs,
    });
  } catch (err) {
    console.error("Error in getWebhookLogsByContact:", err);
    return sendError(next, err.message, 500);
  }
});

export {
  messageStatusUpdate,
  messageReceiveUpdate,
  getAllDoubleTickLogs,
  getWebhookStats,
  getWebhookLogsByContact,
  //getAllEmailWebhookStatus,
};
