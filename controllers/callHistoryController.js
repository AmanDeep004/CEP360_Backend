import CallHistory from "../models/callHistoryModel.js";
import CallingData from "../models/callingDataModal.js";
import errorHandler from "../utils/index.js";
import { DND_REMARK_TO_SCOPE, DND_SCOPE, DND_CHANNEL, REMARK_STATUS } from "../utils/enum.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;

/**
 * Applies DND suppression after a call remark is saved.
 * This runs fire-and-forget — failures are logged but do NOT reject the
 * call history save so the agent is never blocked by a MasterDB error.
 *
 * @param {Object} opts
 * @param {string} opts.scope      - DND_SCOPE value
 * @param {string} opts.callingDataId
 * @param {string} opts.campaignId
 * @param {string} opts.agentId
 * @param {string} opts.agentName
 */
async function applyDND({ scope, callingDataId, campaignId, agentId, agentName }) {
  try {
    const now = new Date();

    // 1. Mark suppression on CallingData (primary DB — always done for all scopes)
    await CallingData.findByIdAndUpdate(callingDataId, {
      "suppressions.calling.isDND":     true,
      "suppressions.calling.scope":     scope,
      "suppressions.calling.setAt":     now,
      "suppressions.calling.setBy":     agentId,
      "suppressions.calling.setByName": agentName,
    });

    // 2. Brand / Global — also update MasterDB Contact
    if (scope === DND_SCOPE.BRAND || scope === DND_SCOPE.GLOBAL) {
      // Lazy-import to avoid circular dependency with secondary connection init
      const [{ default: Contact }, { default: Campaign }, callingDoc] = await Promise.all([
        import("../models/MasterDBModel/contactModel.js"),
        import("../models/campaignModel.js"),
        CallingData.findById(callingDataId).select("Contact_ID").lean(),
      ]);

      if (!callingDoc?.Contact_ID) return;

      if (scope === DND_SCOPE.BRAND) {
        // Fetch brand info from Campaign + BrandsWorkedWith
        const [{ default: Brand }, campaign] = await Promise.all([
          import("../models/MasterDBModel/brandsWorkedWithModel.js"),
          Campaign.findById(campaignId).select("brandId brandName").lean(),
        ]);

        // brandId must be present — skip entirely if missing
        if (!campaign?.brandId) {
          console.warn(`[applyDND] Campaign ${campaignId} has no brandId — brand DND skipped for MasterDB`);
          return;
        }

        // Look up the brand in BrandsWorkedWith for authoritative id & name
        let brandId   = "";
        let brandName = campaign?.brandName || "";

        try {
          const brandDoc = await Brand.findById(campaign.brandId).select("name").lean();
          if (brandDoc) {
            brandId   = String(brandDoc._id);
            brandName = brandDoc.name;
          }
          // brand not found → brandId stays blank, brandName stays from campaign
        } catch {
          // not a valid ObjectId — brandId stays blank, brandName stays from campaign
        }

        await Contact.findOneAndUpdate(
          {
            Contact_ID: callingDoc.Contact_ID,
            "DND_Calling_Companies.brandId": { $ne: String(campaign.brandId) },
          },
          {
            $push: {
              DND_Calling_Companies: {
                brandId,
                brandName,
                setAt:     now,
                setBy:     String(agentId),
                setByName: agentName,
              },
            },
          }
        );
      } else {
        // Global — set the boolean flag
        await Contact.findOneAndUpdate(
          { Contact_ID: callingDoc.Contact_ID },
          { $set: { DND_Calling: true } }
        );
      }
    }
  } catch (err) {
    console.error("[applyDND] Failed:", err.message);
  }
}

const createCallHistory = asyncHandler(async (req, res, next) => {
  try {
    const {
      callingData_id,
      campaign_id,
      contactNo,
      remarks,
      reason,
      isRegistered,
      agent_id,
      agentName,
      callRecordingId,
      overallTime,
    } = req.body;

    if (
      !callingData_id ||
      !campaign_id ||
      !contactNo ||
      !remarks ||
      !agent_id ||
      !agentName
    ) {
      return sendError(next, "Missing required fields", 400);
    }

    // Construct chat entry
    const chatEntry = {
      contactNo,
      remarks,
      reason,
      callingDate: new Date(),
      isRegistered: isRegistered || false,
      agent_id,
      agentName,
      ...(callRecordingId ? { callRecordingId } : {}),
      ...(overallTime != null ? { overallTime: Number(overallTime) } : {}),
    };

    // Registration remarks from agent only go into chat history — they must NOT
    // update CallingData registration fields (isRegistered / registeredOn).
    // Registration in CallingData is only set via the external registration upload.
    const isRegistrationRemark =
      remarks === REMARK_STATUS.REGISTERED ||
      remarks === REMARK_STATUS.ALREADY_REGISTERED;

    // Atomic upsert — $push to existing doc or create new one in a single round-trip.
    // Uses compound index { callingData_id, campaign_id } for the lookup.
    const savedHistory = await CallHistory.findOneAndUpdate(
      { callingData_id, campaign_id },
      {
        $push: { chatHistory: chatEntry },
        ...(isRegistered && !isRegistrationRemark
          ? { $set: { isRegistered: true, registrationDate: new Date() } }
          : {}),
      },
      { upsert: true, new: true }
    );

    // chatHistory.length === 1 means this was a fresh upsert (just created)
    const isNew = savedHistory.chatHistory.length === 1;

    // Single consolidated update to CallingData — always runs
    const callingDataUpdate = {
      lastRemarks: chatEntry.remarks,
      lastCallingDate: chatEntry.callingDate,
    };
    if (isRegistered && !isRegistrationRemark) {
      callingDataUpdate.isRegistered = true;
      callingDataUpdate.registeredOn = new Date();
    }
    if (isNew) {
      callingDataUpdate.callHistory = savedHistory._id;
    }
    await CallingData.findByIdAndUpdate(callingData_id, callingDataUpdate);

    // DND processing — fire-and-forget (non-blocking)
    let dndResult = null;
    const dndScope = DND_REMARK_TO_SCOPE[remarks];
    if (dndScope) {
      dndResult = { applied: true, scope: dndScope, channel: DND_CHANNEL.CALLING };
      applyDND({
        scope:         dndScope,
        callingDataId: callingData_id,
        campaignId:    campaign_id,
        agentId:       agent_id,
        agentName,
      });
    }

    return sendResponse(
      res,
      200,
      isNew ? "Call history created successfully" : "Call history updated successfully",
      { ...savedHistory.toObject(), dndResult }
    );
  } catch (err) {
    return sendError(next, err.message || "Server error", 500);
  }
});

const updateCallHistoryold = asyncHandler(async (req, res, next) => {
  try {
    const history = await CallHistory.findById(req.params.id);
    if (!history) return sendError(next, "Call history not found", 404);

    if (req.body.newChatEntry) {
      history.chatHistory.push({
        remarks: req.body.newChatEntry.remarks,
        status: req.body.newChatEntry.status,
        updateDate: new Date(),
      });
    }

    Object.assign(history, req.body);
    const updated = await history.save();

    return sendResponse(res, 200, "Call history updated successfully", updated);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});
const updateCallHistory = asyncHandler(async (req, res, next) => {
  try {
    const history = await CallHistory.findById(req.params.id);
    if (!history) return sendError(next, "Call history not found", 404);

    if (
      Array.isArray(req.body.chatHistory) &&
      req.body.chatHistory.length > 0
    ) {
      history.chatHistory = [...history.chatHistory, ...req.body.chatHistory];
      delete req.body.chatHistory;
    }

    Object.assign(history, req.body);

    const updated = await history.save();

    return sendResponse(res, 200, "Call history updated successfully", updated);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// const getCallHistoryByCampaignId = asyncHandler(async (req, res, next) => {
//   try {
//     const { campaignId } = req.params;
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 20;
//     const skip = (page - 1) * limit;

//     const filter = { campaign_id: campaignId };

//     const [total, data] = await Promise.all([
//       CallHistory.countDocuments(filter),
//       CallHistory.find(filter).skip(skip).limit(limit).lean(),
//     ]);

//     return sendResponse(res, 200, "Call history fetched successfully", {
//       total,
//       page,
//       limit,
//       totalPages: Math.ceil(total / limit),
//       data,
//     });
//   } catch (err) {
//     return sendError(next, err.message, 500);
//   }
// });
// const getCallHistoryByCallingDataId = asyncHandler(async (req, res, next) => {
//   try {
//     const { callingDataId } = req.params;
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 20;
//     const skip = (page - 1) * limit;

//     const filter = { calling_data_id: callingDataId };

//     const [total, data] = await Promise.all([
//       CallHistory.countDocuments(filter),
//       CallHistory.find(filter)
//         .skip(skip)
//         .limit(limit)
//         .populate("calling_data_id")
//         .lean(),
//     ]);

//     return sendResponse(res, 200, "Call history fetched successfully", {
//       total,
//       page,
//       limit,
//       totalPages: Math.ceil(total / limit),
//       data,
//     });
//   } catch (err) {
//     return sendError(next, err.message, 500);
//   }
// });

const getAllCallHistoryByCallingDataId = asyncHandler(
  async (req, res, next) => {
    try {
      const { callingDataId } = req.params;
      const histories = await CallHistory.find({
        calling_data_id: callingDataId,
      });

      return sendResponse(
        res,
        200,
        "All call histories fetched successfully",
        histories
      );
    } catch (err) {
      return sendError(next, err.message, 500);
    }
  }
);

const proxyCallRecording = asyncHandler(async (req, res, next) => {
  const { appid, file } = req.query;
  if (!appid || !file) {
    return sendError(next, "Missing appid or file parameter", 400);
  }
  const secret = process.env.TELECMI_SECRET;
  if (!secret) {
    return sendError(next, "TeleCMI secret not configured", 500);
  }
  const telecmiUrl = `https://rest.telecmi.com/v2/play?appid=${appid}&secret=${secret}&file=${file}`;
  const response = await fetch(telecmiUrl);
  if (!response.ok) {
    return sendError(next, "Failed to fetch recording from TeleCMI", 502);
  }
  res.setHeader("Content-Type", response.headers.get("content-type") || "audio/mpeg");
  const { Readable } = await import("stream");
  Readable.fromWeb(response.body).pipe(res);
});

export {
  createCallHistory,
  updateCallHistory,
  getAllCallHistoryByCallingDataId,
  proxyCallRecording,
};
