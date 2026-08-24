import DoubleTickData from "../../models/Webhook/webHookModel.js";
import CallingData, { normalizePhoneDigits } from "../../models/callingDataModal.js";
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

  // normalizeNumber() here and normalizePhoneDigits() on the stored side both reduce
  // to the same digits-only, no-country/trunk-code form, so this is an exact match
  // against the indexed phoneLookup array — no more unscoped multi-field regex scan.
  const normalizedMobile = normalizePhoneDigits(normalizeNumber(mobile));
  if (!normalizedMobile) return null;

  return await CallingData.findOne({ phoneLookup: normalizedMobile }).lean();
};

// MESSAGE STATUS UPDATE WEBHOOK (legacy)
const messageStatusUpdateOld = asyncHandler(async (req, res, next) => {
  try {
    const payload = req.body;

    if (!payload) {
      return sendError(next, "Payload missing", 400);
    }

    const mobile = normalizeNumber(
      payload?.to || payload?.receiver || payload?.phone || payload?.recipient
    );

    if (!mobile) {
      return sendResponse(res, 200, "No mobile number in payload", {
        received: true,
        mobile: null,
      });
    }

    const callingDataContact = await findCallingDataForNumber(mobile);

    if (!callingDataContact) {

      const waMessageId = payload?.messageId || payload?.message_id || "";

      const saveObj = {
        webhookType: "MessageStatus",
        mobileNumber: mobile,
        contactId: null,
        payload,
        eventType: payload?.status || payload?.event_type || "unknown",
        waMessageId: waMessageId,
        status: payload?.status || payload?.delivery_status || "",
        timestamp: new Date(
          payload?.timestamp || payload?.statusTimestamp || Date.now()
        ),
        templateMessage: payload?.message || null,
        templateId: payload?.templateId || "",
        templateName: payload?.templateName || "",
      };

      // Try to create, if duplicate, update the existing one
      try {
        await DoubleTickData.create(saveObj);
      } catch (err) {
        if (err.code === 11000) {

          await DoubleTickData.findOneAndUpdate(
            { waMessageId: waMessageId },
            {
              $set: {
                ...saveObj,
                updatedAt: new Date(),
              },
              $push: {
                templateData: saveObj?.payload?.message,
                messageHistory: {
                  status: saveObj.status,
                  timestamp: saveObj.timestamp,
                  eventType: saveObj.eventType,
                },
              },
            }
          );
        } else {
          throw err;
        }
      }

      return sendResponse(res, 200, "Contact not found, webhook logged", {
        received: true,
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


    // First, try to update existing whatsappTemplate entry
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
          "whatsappTemplates.$.templateDetails": saveObj?.payload?.message,
          "whatsappTemplates.$.status": status,
          "whatsappTemplates.$.timestamp": new Date(timestamp),
          "whatsappTemplates.$.templateId": templateId,
          "whatsappTemplates.$.templateName": templateName,
        },
      },
      { new: true }
    );

    // If not found, check if it exists in the array (to prevent duplicates)
    if (!updated) {
      // Double-check: Does this waMessageId already exist?
      const existingContact = await CallingData.findOne({
        _id: callingDataContact._id,
        "whatsappTemplates.waMessageId": waMessageId,
      });

      if (existingContact) {
        updated = await CallingData.findOneAndUpdate(
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
      } else {

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

    // Try to create, if duplicate, update the existing one
    try {
      await DoubleTickData.create(saveObj);
    } catch (err) {
      if (err.code === 11000) {
        await DoubleTickData.findOneAndUpdate(
          { waMessageId: waMessageId },
          {
            $set: {
              ...saveObj,
              updatedAt: new Date(),
            },
            $push: {
              messageHistory: {
                status: status,
                timestamp: new Date(timestamp),
                eventType: status,
              },
            },
          }
        );
      } else {
        // Re-throw if it's a different error
        throw err;
      }
    }


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

const messageStatusUpdate = asyncHandler(async (req, res, next) => {
  try {
    const payload = req.body;

    if (!payload) {
      return sendError(next, "Payload missing", 400);
    }

    // DoubleTick webhook: primary field is "messageId" at root
    const waMessageId =
      payload?.messageId ||
      payload?.message_id ||
      payload?.message?.message_id ||
      payload?.referenceId ||
      "";

    // DoubleTick webhook: status values are "SENT", "DELIVERED", "READ", "FAILED"
    const status =
      payload?.status ||
      payload?.delivery_status ||
      payload?.message?.status ||
      payload?.event_type ||
      "";

    // DoubleTick webhook: primary timestamp field is "statusTimestamp"
    const timestamp =
      payload?.statusTimestamp ||
      payload?.timestamp ||
      payload?.message?.timestamp ||
      Date.now();

    const parsedTimestamp = new Date(timestamp);
    const templateId = payload?.templateId || "";

    // DoubleTick webhook: templateName lives inside payload.message object
    const templateName =
      payload?.message?.templateName ||
      payload?.templateName ||
      "";

    // DoubleTick webhook: failure reason field is "failMessage" (only present when FAILED)
    const failureReason =
      payload?.failMessage ||
      payload?.errorMessage ||
      payload?.failureReason ||
      payload?.error?.message ||
      payload?.error_message ||
      (typeof payload?.error === "string" ? payload.error : "") ||
      "";

    const mobile = normalizeNumber(
      payload?.to || payload?.receiver || payload?.phone || payload?.recipient
    );

    // ── Resolve CallingData contact ───────────────────────────────────────────
    // Priority 1: look up the DoubleTickData record by waMessageId — it already
    // carries the contactId that was stamped at send-time, which guarantees the
    // correct campaign record even when the same phone exists in many campaigns.
    // Priority 2: fall back to phone-number search (legacy / missing waMessageId).
    let callingDataContact = null;

    if (waMessageId) {
      const existingDoc = await DoubleTickData.findOne({ waMessageId })
        .select("contactId mobileNumber")
        .lean();

      if (existingDoc?.contactId) {
        callingDataContact = await CallingData.findById(
          existingDoc.contactId
        ).lean();
      }

      // If DoubleTickData had no contactId yet, fall back to phone-number lookup
      if (!callingDataContact && mobile) {
        callingDataContact = await findCallingDataForNumber(mobile);
      }
    } else if (mobile) {
      callingDataContact = await findCallingDataForNumber(mobile);
    }

    if (!mobile && !waMessageId) {
      await DoubleTickData.create({
        webhookType: "MessageStatus",
        mobileNumber: "",
        contactId: null,
        payload,
        eventType: status || "unknown",
        waMessageId: "",
        status,
        timestamp: parsedTimestamp,
        templateData: payload?.message || {},
        templateId,
        templateName,
        ...(failureReason && { failureReason }),
        messageHistory: [{ payload, status: status || "unknown", timestamp: parsedTimestamp, eventType: status || "unknown", ...(failureReason && { failureReason }) }],
      });
      return sendResponse(res, 200, "No mobile number in payload", { received: true, mobile: null });
    }

    const saveObj = {
      webhookType: "MessageStatus",
      mobileNumber: mobile || "",
      payload,
      eventType: status || "unknown",
      waMessageId,
      status,
      timestamp: parsedTimestamp,
      templateId,
      templateName,
      templateData: payload?.message || {},
      // Only include failureReason when it has a value
      ...(failureReason && { failureReason }),
    };

    // Always persist webhook in DoubleTickData.
    const persistDoubleTick = async (contactId) => {
      const historyRow = {
        payload,
        status: status || "unknown",
        timestamp: parsedTimestamp,
        eventType: status || "unknown",
        ...(failureReason && { failureReason }),
      };

      if (!waMessageId) {
        await DoubleTickData.create({
          ...saveObj,
          contactId: contactId || null,
          messageHistory: [historyRow],
        });
        return;
      }

      await DoubleTickData.findOneAndUpdate(
        { waMessageId },
        {
          $set: {
            ...saveObj,
            contactId: contactId || null,
            updatedAt: new Date(),
          },
          $push: {
            messageHistory: historyRow,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    };

    if (!callingDataContact) {
      await persistDoubleTick(null);

      return sendResponse(res, 200, "Contact not found, webhook logged", {
        received: true,
        mobile,
        matched: false,
      });
    }

    if (!waMessageId) {
      await persistDoubleTick(callingDataContact._id);
      return sendResponse(res, 200, "No message ID in payload", {
        received: true,
        contactId: callingDataContact._id,
        mobile,
      });
    }


    // Build the update fields — include failureReason only when present
    const whatsappTemplateSetFields = {
      "whatsappTemplates.$.templateDetails": payload?.message || {},
      "whatsappTemplates.$.status": status,
      "whatsappTemplates.$.timestamp": parsedTimestamp,
      "whatsappTemplates.$.templateId": templateId,
      "whatsappTemplates.$.templateName": templateName,
    };
    if (failureReason) {
      whatsappTemplateSetFields["whatsappTemplates.$.failureReason"] =
        failureReason;
    }

    const historyEntry = { status, timestamp: parsedTimestamp };
    if (failureReason) historyEntry.failureReason = failureReason;

    // First, try to update existing whatsappTemplate entry
    let updated = await CallingData.findOneAndUpdate(
      {
        _id: callingDataContact._id,
        "whatsappTemplates.waMessageId": waMessageId,
      },
      {
        $push: { "whatsappTemplates.$.history": historyEntry },
        $set: whatsappTemplateSetFields,
      },
      { new: true }
    );

    // If not found, check if it exists in the array (to prevent duplicates)
    if (!updated) {
      // Double-check: Does this waMessageId already exist?
      const existingContact = await CallingData.findOne({
        _id: callingDataContact._id,
        "whatsappTemplates.waMessageId": waMessageId,
      });

      if (existingContact) {
        updated = await CallingData.findOneAndUpdate(
          {
            _id: callingDataContact._id,
            "whatsappTemplates.waMessageId": waMessageId,
          },
          {
            $push: { "whatsappTemplates.$.history": historyEntry },
            $set: whatsappTemplateSetFields,
          },
          { new: true }
        );
      } else {

        const newEntry = {
          waMessageId,
          templateId,
          templateName,
          templateDetails: payload?.message || {},
          status,
          timestamp: parsedTimestamp,
          history: [historyEntry],
        };
        if (failureReason) newEntry.failureReason = failureReason;

        updated = await CallingData.findByIdAndUpdate(
          callingDataContact._id,
          { $push: { whatsappTemplates: newEntry } },
          { new: true }
        );
      }
    }

    await persistDoubleTick(callingDataContact._id);


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

    if (!payload) {
      return sendError(next, "Payload missing", 400);
    }

    const mobile = normalizeNumber(
      payload?.from || payload?.sender || payload?.phone || payload?.number
    );

    // DoubleTick webhook: "messageId" or "dtMessageId" for received messages
    const waMessageId =
      payload?.messageId ||
      payload?.dtMessageId ||
      payload?.message_id ||
      payload?.message?.message_id ||
      payload?.id ||
      "";

    const msgText =
      payload?.message?.text ||
      payload?.message?.textMessage ||
      payload?.text ||
      payload?.body ||
      "";

    // DoubleTick webhook: timestamp field for received messages is "receivedAt"
    const timestamp =
      payload?.receivedAt ||
      payload?.timestamp ||
      payload?.message?.timestamp ||
      Date.now();

    const messageType =
      payload?.message?.type ||
      payload?.message_type ||
      payload?.type ||
      "text";

    if (!mobile) {
      // Use upsert so DoubleTick retries don't create duplicate records.
      const noMobileDoc = {
        webhookType: "MessageReceived",
        mobileNumber: "",
        contactId: null,
        payload,
        waMessageId,
        messageType,
        textMessage: msgText,
        timestamp: new Date(timestamp),
        senderName: payload?.contact?.name || payload?.sender_name || payload?.name || "",
        eventType: "MessageReceived",
      };
      const noMobileHistory = {
        payload,
        status: "MessageReceived",
        timestamp: new Date(timestamp),
        eventType: "MessageReceived",
      };

      if (waMessageId) {
        await DoubleTickData.findOneAndUpdate(
          { waMessageId },
          {
            $set: { ...noMobileDoc, updatedAt: new Date() },
            $push: { messageHistory: noMobileHistory },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      } else {
        await DoubleTickData.create({
          ...noMobileDoc,
          messageHistory: [noMobileHistory],
        });
      }

      return sendResponse(res, 200, "No mobile number in payload", {
        received: true,
      });
    }

    const callingDataContact = await findCallingDataForNumber(mobile);

    const saveObj = {
      webhookType: "MessageReceived",
      mobileNumber: mobile,
      contactId: callingDataContact?._id || null,
      payload,
      waMessageId,
      messageType,
      textMessage: msgText,
      timestamp: new Date(timestamp),
      senderName: payload?.contact?.name || payload?.sender_name || payload?.name || "",
      eventType: "MessageReceived",
    };

    const historyRow = {
      payload,
      status: "MessageReceived",
      timestamp: new Date(timestamp),
      eventType: "MessageReceived",
    };

    let saved;
    if (!waMessageId) {
      saved = await DoubleTickData.create({
        ...saveObj,
        messageHistory: [historyRow],
      });
    } else {
      saved = await DoubleTickData.findOneAndUpdate(
        { waMessageId },
        {
          $set: {
            ...saveObj,
            updatedAt: new Date(),
          },
          $push: {
            messageHistory: historyRow,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }


    return sendResponse(
      res,
      200,
      "Message receive webhook saved successfully",
      {
        received: true,
        id: saved._id,
        mobile,
        matchedContact: callingDataContact?._id || null,
        hasContact: !!callingDataContact,
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
