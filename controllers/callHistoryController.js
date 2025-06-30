import CallHistory from "../models/callHistoryModel.js";
import errorHandler from "../utils/index.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;

const createCallHistory = asyncHandler(async (req, res, next) => {
  try {
    const newEntry = await CallHistory.create(req.body);
    return sendResponse(
      res,
      200,
      "Call history created successfully",
      newEntry
    );
  } catch (err) {
    return sendError(next, err.message, 500);
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

const getCallHistoryByCampaignId = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = { campaign_id: campaignId };

    const [total, data] = await Promise.all([
      CallHistory.countDocuments(filter),
      CallHistory.find(filter).skip(skip).limit(limit).lean(),
    ]);

    return sendResponse(res, 200, "Call history fetched successfully", {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});
const getCallHistoryByCallingDataId = asyncHandler(async (req, res, next) => {
  try {
    const { callingDataId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = { calling_data_id: callingDataId };

    const [total, data] = await Promise.all([
      CallHistory.countDocuments(filter),
      CallHistory.find(filter)
        .skip(skip)
        .limit(limit)
        .populate("calling_data_id")
        .lean(),
    ]);

    return sendResponse(res, 200, "Call history fetched successfully", {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// const getAllCallHistoryByCallingDataId = asyncHandler(
//   async (req, res, next) => {
//     try {
//       const { callingDataId } = req.params;

//       const histories = await CallHistory.find({
//         calling_data_id: callingDataId,
//       })
//         .populate("calling_data_id")
//         .lean();

//       return sendResponse(
//         res,
//         200,
//         "All call histories fetched successfully",
//         histories
//       );
//     } catch (err) {
//       return sendError(next, err.message, 500);
//     }
//   }
// );

export {
  createCallHistory,
  updateCallHistory,
  getCallHistoryByCampaignId,
  getCallHistoryByCallingDataId,
  //getAllCallHistoryByCallingDataId,
};
