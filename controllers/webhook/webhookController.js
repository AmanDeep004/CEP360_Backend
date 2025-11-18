import DoubleTickData from "../../models/Webhook/webHookModel.js";
import Contact from "../../models/MasterDBModel/contactModel.js";
import errorHandler from "../../utils/index.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;

const normalizeNumber = (num) => {
  if (!num) return "";
  return String(num)
    .replace(/[^0-9]/g, "")
    .replace(/^91/, "") // remove +91 if exists
    .replace(/^0/, ""); // remove leading zero
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

// MESSAGE STATUS UPDATE WEBHOOK
// ==================================================================
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

    // find contact
    const contact = await findContactForNumber(mobile);

    // save object
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

const messageStatusUpdate = asyncHandler(async (req, res, next) => {
  try {
    const payload = req.body;
    const {
      messageId,
      to,
      status,
      statusTimestamp,
      customerName,
      templateId,
      templateName,
      sentBy,
      assignedTo,
      wabaNumber,
    } = payload;
    if (!payload) return sendError(next, "Payload missing", 400);

    if (!messageId) {
      return sendError(next, "waMessageId not found", 400);
    }
    const contact = await findContactForNumber(normalizeNumber(to));

    const updateData = {
      webhookType: "MessageStatus",
      mobileNumber: to,
      contactId: contact?._id || null,
      templateId,
      templateName,
      payload,
      eventType: "MessageStatus",
      status,
      waMessageId: messageId,
      timestamp: statusTimestamp,
      templateMessage: payload?.message || null,
      updatedAt: new Date(),
    };

    const updatedDoc = await DoubleTickData.findOneAndUpdate(
      { waMessageId: messageId }, // match condition
      { $set: updateData }, // update fields
      { new: true, upsert: true } // create if not exists
    );

    return sendResponse(res, 200, "Status updated / created successfully");
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// ==================================================================
// MESSAGE RECEIVED WEBHOOK (when customer replies)
// ==================================================================
const messageReceiveUpdate = asyncHandler(async (req, res, next) => {
  try {
    const payload = req.body;
    console.log("Received Message Receive Webhook:", payload);
    if (!payload) return sendError(next, "Payload missing", 400);

    const mobile = normalizeNumber(payload?.from || payload?.sender);

    // find contact
    const contact = await findContactForNumber(mobile);

    const waMessageId =
      payload?.messageId ||
      payload?.message_id ||
      payload?.message?.message_id ||
      "";

    const msgText =
      payload?.text ||
      payload?.message?.text ||
      payload?.message?.textMessage ||
      "";

    const timestamp =
      payload?.timestamp || payload?.message?.timestamp || new Date();

    const messageType = payload?.message_type || payload?.message?.type || "";

    const saveObj = {
      webhookType: "MessageReceived",
      mobileNumber: mobile,
      contactId: contact?._id || null,

      payload,

      waMessageId,
      messageType,
      textMessage: msgText,
      timestamp: new Date(timestamp),
      senderName: payload?.sender_name || "",
    };

    const saved = await DoubleTickData.create(saveObj);

    return sendResponse(res, 200, "Message receive webhook saved", {
      received: true,
      id: saved._id,
      mobile,
      matchedContact: contact?._id || null,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

export { messageStatusUpdate, messageReceiveUpdate };
