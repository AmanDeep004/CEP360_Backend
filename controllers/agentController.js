import AgentAssigned from "../models/agentAssigned.js";
import errorHandler from "../utils/index.js";
import User from "../models/userModel.js";

import { UserRoleEnum } from "../utils/enum.js";
import campaignModel from "../models/campaignModel.js";
import callingDataModal from "../models/callingDataModal.js";
import { maskEmail, maskPhone } from "../utils/mobileEmailMasking.js";
import EngagementHistory from "../models/MasterDBModel/enagagementHistoryModel.js";
import { sendEmail } from "../services/microsoftGraphMailer.js";
import { agentAssignedToCampaignTemplate } from "../services/notificationEmailTemplates.js";
import { EmailTrigger } from "../utils/enum.js";

const { asyncHandler, sendError, sendResponse } = errorHandler;

const assignAgentsToCampaign = asyncHandler(async (req, res, next) => {
  try {
    const { agentIds, campaignId } = req.body;

    if (!Array.isArray(agentIds) || agentIds.length === 0 || !campaignId) {
      return sendError(
        next,
        "agentIds (array) and campaignId are required",
        400
      );
    }

    const existingAssignments = await AgentAssigned.find({
      campaign_id: campaignId,
      agent_id: { $in: agentIds },
      //   isAssigned: true,
    }).select("agent_id");

    const alreadyAssignedIds = new Set(
      existingAssignments.map((doc) => doc.agent_id.toString())
    );

    if (alreadyAssignedIds.size > 0) {
      await AgentAssigned.updateMany(
        {
          campaign_id: campaignId,
          agent_id: { $in: Array.from(alreadyAssignedIds) },
        },
        {
          $set: {
            isAssigned: true,
            released_date: null,
            assigned_date: new Date(),
          },
        }
      );
    }

    // Prepare new assignments (skip duplicates)
    const newAssignments = agentIds
      .filter((id) => !alreadyAssignedIds.has(id))
      .map((id) => ({
        agent_id: id,
        campaign_id: campaignId,
        isAssigned: true,
        assigned_date: new Date(),
        released_date: null,
      }));

    if (newAssignments.length > 0) {
      await AgentAssigned.insertMany(newAssignments);
    }

    // Fire-and-forget: notify ALL agents being assigned (new + re-activated)
    if (agentIds.length > 0) {
      Promise.all([
        User.find({ _id: { $in: agentIds } })
          .select("employeeName email")
          .lean(),
        campaignModel
          .findById(campaignId)
          .select("name clientName brandName startDate endDate")
          .lean(),
      ])
        .then(([agents, campaign]) => {
          if (!campaign) return;
          agents.forEach((agent) => {
            if (!agent.email) return;
            sendEmail(
              agent.email,
              `You have been added to campaign: ${campaign.name}`,
              agentAssignedToCampaignTemplate({
                agentName: agent.employeeName,
                campaignName: campaign.name,
                clientName: campaign.clientName,
                brandName: campaign.brandName,
                startDate: campaign.startDate,
                endDate: campaign.endDate,
              }),
              {
                trigger: EmailTrigger.AGENT_ASSIGNED_TO_CAMPAIGN,
                campaignId: campaign._id,
                recipientUserId: agent._id,
              }
            );
          });
        })
        .catch((err) =>
          console.error(
            `[Email] Agent campaign assignment notification failed: ${err.message}`
          )
        );
    }

    return sendResponse(res, 200, "Agents assigned successfully", {
      assigned: newAssignments.length,
      updated: alreadyAssignedIds.size,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const getAllocAndUnalloclist = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    if (!campaignId) {
      return sendError(next, "campaignId is required", 400);
    }

    const agents = await AgentAssigned.find({
      campaign_id: campaignId,
    }).populate({
      path: "agent_id",
      select: "employeeName email",
    });
    return sendResponse(res, 200, "Agents retrieved successfully", agents);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const releaseAgents = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId, agentId } = req.body;

    if (!campaignId || !agentId) {
      return sendError(next, "campaignId and agentId are required", 400);
    }

    const result = await AgentAssigned.updateOne(
      {
        campaign_id: campaignId,
        agent_id: agentId,
        isAssigned: true,
      },
      {
        $set: {
          isAssigned: false,
          released_date: new Date(),
        },
      }
    );

    return sendResponse(res, 200, "Agents released successfully", {
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const getAllNonAssignedAgents = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    if (!campaignId) {
      return sendError(next, "campaignId is required", 400);
    }
    const assignedAgents = await AgentAssigned.find({
      campaign_id: campaignId,
      isAssigned: true,
    }).select("agent_id");
    const assignedAgentIds = assignedAgents.map((a) => a.agent_id.toString());

    const agents = await User.find({
      role: UserRoleEnum.AGENT,
      _id: { $nin: assignedAgentIds },
      status: "active",
    }).select("_id employeeName email employeeCode");

    return sendResponse(res, 200, "Agents fetched successfully", agents);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const getAllCampaignByAGentId = asyncHandler(async (req, res, next) => {
  try {
    let { agentId } = req.params;
    if (!agentId) {
      return sendError(next, "agentId is required", 400);
    }

    agentId = agentId.trim();
    console.log(agentId, "agentId");

    const assignments = await AgentAssigned.find({
      agent_id: agentId,
      isAssigned: true,
    }).select("campaign_id");

    console.log(assignments, "assignments");

    const campaignIds = assignments.map((a) => a.campaign_id);

    if (campaignIds.length === 0) {
      return sendResponse(res, 200, "No campaigns assigned to this agent", []);
    }

    const campaigns = await campaignModel
      .find({
        _id: { $in: campaignIds },
      })
      .select("_id name brandName clientName startDate endDate status");

    return sendResponse(
      res,
      200,
      "Campaigns retrieved successfully",
      campaigns
    );
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const getCallingDataByAgentAndCampaign = asyncHandler(
  async (req, res, next) => {
    try {
      const { agentId, campaignId } = req.params;

      if (!agentId || !campaignId) {
        return sendError(next, "Both agentId and campaignId are required", 400);
      }

      const callingData = await callingDataModal
        .find({
          agentId: agentId.trim(),
          CampaignId: campaignId.trim(),
        })
        .populate("CampaignId", "name")
        .populate("agentId", "employeeName email")
        .select("-__v");

      return sendResponse(
        res,
        200,
        "Calling data fetched successfully",
        callingData
      );
    } catch (error) {
      return sendError(next, error.message, 500);
    }
  }
);
const getAllAssignedAgents = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;

    if (!campaignId) {
      return sendError(next, "campaignId is required", 400);
    }

    const assignedAgents = await AgentAssigned.find({
      campaign_id: campaignId,
      isAssigned: true,
    }).populate("agent_id", "_id employeeName email employeeCode");

    return sendResponse(
      res,
      200,
      "Assigned agents fetched successfully",
      assignedAgents
    );
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const getCallingDataByAgentDataOld = asyncHandler(async (req, res, next) => {
  try {
    const { agentId } = req.params;
    const {
      source,
      registered,
      callRemarks,
      lastDateOfTelecalling,
      page = 1,
      limit = 20,
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limNum;

    const filter = { agentId };

    if (source) {
      filter.source = { $regex: new RegExp(source, "i") };
    }

    if (registered !== undefined) {
      filter.isRegistered = registered === "true";
    }

    let callingData = await callingDataModal
      .find(filter)
      .populate({
        path: "agentId",
        select: "employeeName email",
      })
      .populate({
        path: "callHistory",
        populate: {
          path: "chatHistory",
          model: "CallHistory",
        },
      })
      .lean();

    if (callRemarks) {
      callingData = callingData.filter((data) => {
        const chatHist = data.callHistory?.chatHistory;
        return (
          Array.isArray(chatHist) &&
          chatHist.some((entry) => entry.remarks === callRemarks)
        );
      });
    }

    if (lastDateOfTelecalling) {
      const targetDate = new Date(lastDateOfTelecalling);
      callingData = callingData.filter((data) => {
        const chatHist = data.callHistory?.chatHistory;
        if (Array.isArray(chatHist) && chatHist.length > 0) {
          const lastDate = chatHist.reduce(
            (latest, item) => {
              const callDate = new Date(item.callingDate || "1970-01-01");
              return callDate > latest.callingDate ? item : latest;
            },
            { callingDate: new Date("1970-01-01") }
          );
          return (
            lastDate.callingDate.toISOString().slice(0, 10) ===
            targetDate.toISOString().slice(0, 10)
          );
        }
        return false;
      });
    }

    callingData = callingData.map((data) => {
      const chatHist = data.callHistory?.chatHistory;

      if (Array.isArray(chatHist) && chatHist.length > 0) {
        const latestEntry = chatHist.reduce(
          (latest, curr) => {
            const latestDate = new Date(latest.callingDate || "1970-01-01");
            const currDate = new Date(curr.callingDate || "1970-01-01");
            return currDate > latestDate ? curr : latest;
          },
          { callingDate: new Date("1970-01-01"), remarks: "" }
        );

        return {
          ...data,
          lastRemarks: latestEntry.remarks || "",
          lastCallingDate: latestEntry.callingDate || null,
        };
      } else {
        return {
          ...data,
          lastRemarks: "",
          lastCallingDate: null,
        };
      }
    });

    const total = callingData.length;
    const paginatedData = callingData.slice(skip, skip + limNum);

    return sendResponse(res, 200, "Calling data fetched successfully", {
      total,
      page: pageNum,
      limit: limNum,
      totalPages: Math.ceil(total / limNum),
      data: paginatedData,
    });
  } catch (err) {
    console.error(err);
    return sendError(next, err.message, 500);
  }
});

// here
// const getCallingDataByAgentData = asyncHandler(async (req, res, next) => {
//   try {
//     const { agentId } = req.params;
//     const {
//       source,
//       registered,
//       callRemarks,
//       lastDateOfTelecalling,
//       page = 1,
//       limit = 20,
//     } = req.query;

//     const pageNum = parseInt(page, 10);
//     const limNum = parseInt(limit, 10);
//     const skip = (pageNum - 1) * limNum;

//     const filter = {
//       agentId: agentId,
//     };

//     if (source) {
//       filter.source = { $regex: new RegExp(source, "i") };
//     }

//     if (registered !== undefined) {
//       filter.isRegistered = registered === "true";
//     }

//     let callingData = await callingDataModal
//       .find(filter)
//       .populate({
//         path: "agentId",
//         select: "employeeName email",
//       })
//       .populate({
//         path: "callHistory",
//         populate: {
//           path: "chatHistory",
//           model: "CallHistory",
//         },
//       })
//       .lean();

//     if (callRemarks) {
//       callingData = callingData.filter((data) => {
//         const chatHist = data.callHistory?.chatHistory;
//         return (
//           Array.isArray(chatHist) &&
//           chatHist.some((entry) => entry.remarks === callRemarks)
//         );
//       });
//     }

//     if (lastDateOfTelecalling) {
//       const trimmedDate = lastDateOfTelecalling.trim();
//       const startOfDay = new Date(trimmedDate);
//       startOfDay.setUTCHours(0, 0, 0, 0);

//       const endOfDay = new Date(trimmedDate);
//       endOfDay.setUTCHours(23, 59, 59, 999);

//       callingData = callingData.filter((data) => {
//         const chatHist = data.callHistory?.chatHistory;
//         if (Array.isArray(chatHist) && chatHist.length > 0) {
//           const lastEntry = chatHist.reduce(
//             (latest, item) => {
//               const callDate = new Date(item.callingDate || "1970-01-01");
//               return callDate > latest.callingDate ? item : latest;
//             },
//             { callingDate: new Date("1970-01-01") }
//           );

//           if (!lastEntry.callingDate) return false;

//           const callDate = new Date(lastEntry.callingDate);
//           return callDate >= startOfDay && callDate <= endOfDay;
//         }
//         return false;
//       });
//     }

//     // Attach last remarks and last calling date for each record
//     callingData = callingData.map((item) => {
//       const chatHist = item.callHistory?.chatHistory;
//       if (Array.isArray(chatHist) && chatHist.length > 0) {
//         const lastEntry = chatHist.reduce(
//           (latest, entry) => {
//             const date = new Date(entry.callingDate || "1970-01-01");
//             return date > latest.callingDate ? entry : latest;
//           },
//           { callingDate: new Date("1970-01-01") }
//         );

//         item.lastCallingDate = lastEntry.callingDate || null;
//         item.lastRemarks = lastEntry.remarks || null;
//       } else {
//         item.lastCallingDate = null;
//         item.lastRemarks = null;
//       }
//       return item;
//     });

//     const total = callingData.length;
//     const paginatedData = callingData.slice(skip, skip + limNum);

//     return sendResponse(res, 200, "Calling data fetched successfully", {
//       total,
//       page: pageNum,
//       limit: limNum,
//       totalPages: Math.ceil(total / limNum),
//       data: paginatedData,
//     });
//   } catch (err) {
//     console.error(err);
//     return sendError(next, err.message, 500);
//   }
// });

const getCallingDataByAgentData = asyncHandler(async (req, res, next) => {
  try {
    const { agentId } = req.params;
    const {
      campaignId,
      dataSourceType,
      batch,
      registered,
      callRemarks,
      lastDateOfTelecalling,
      priorityGroup,
      search = "",
      page = 1,
      limit = 20,
    } = req.query;

    if (!campaignId) {
      return sendError(next, "campaignId is required", 400);
    }

    const pageNum = parseInt(page, 10);
    const limNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limNum;

    const filter = { agentId, CampaignId: campaignId };

    // Basic filters
    if (dataSourceType) {
      if (dataSourceType === "Kestone") {
        filter.dataSourceType = { $in: ["Kestone", "Both"] };
      } else if (dataSourceType === "Client") {
        filter.dataSourceType = { $in: ["Client", "Both"] };
      } else {
        filter.dataSourceType = dataSourceType;
      }
    }
    const esc = (s) => s.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (batch) filter.batch = { $regex: new RegExp(esc(batch), "i") };
    if (registered !== undefined && registered !== "")
      filter.isRegistered = registered === "true";
    if (priorityGroup === "unassigned") filter["priorityGroup.no"] = null;
    else if (priorityGroup) filter["priorityGroup.label"] = priorityGroup;

    if (search.trim()) {
      const regex = new RegExp(esc(search), "i");
      filter.$or = [
        { Full_Name: regex },
        { First_Name: regex },
        { Last_Name: regex },
        { Mobile_No: regex },
        { Office_Email_1: regex },
        { Office_Email_2: regex },
        { Personal_Email1: regex },
        { Personal_Email2: regex },
        { Contact_Direct_Phone1: regex },
        { Contact_Direct_Phone2: regex },
        { Company_Name: regex },
      ];
    }

    // Filter directly on indexed lastRemarks / lastCallingDate fields — no populate needed
    if (callRemarks) {
      if (callRemarks === "Yet to Call") {
        filter.lastRemarks = { $in: [null, "", "Yet to Call"] };
      } else {
        // Escape regex special chars so values like "No Number Found (WebSearch)" match literally
        const escapedRemark = callRemarks.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        filter.lastRemarks = { $regex: new RegExp(`^${escapedRemark}$`, "i") };
      }
    }

    if (lastDateOfTelecalling) {
      const trimmedDate = lastDateOfTelecalling.trim();
      filter.lastCallingDate = {
        $gte: new Date(trimmedDate + "T00:00:00+05:30"),
        $lte: new Date(trimmedDate + "T23:59:59.999+05:30"),
      };
    }

    let callingData;
    let total;

    [total, callingData] = await Promise.all([
      callingDataModal.countDocuments(filter),
      callingDataModal
        .find(filter)
        .populate({ path: "agentId", select: "employeeName email" })
        .sort({ "priorityGroup.no": 1 })
        .skip(skip)
        .limit(limNum)
        .lean(),
    ]);

    const maskedData = callingData.map((row) => ({
      ...row,
      priorityGroup: row.priorityGroup ?? { no: null, label: null },
      Contact_Direct_Phone1: maskPhone(row.Contact_Direct_Phone1),
      Contact_Direct_Phone2: maskPhone(row.Contact_Direct_Phone2),
      Mobile_No: maskPhone(row.Mobile_No),
      Office_Email_1: maskEmail(row.Office_Email_1),
      Office_Email_2: maskEmail(row.Office_Email_2),
      Personal_Email1: maskEmail(row.Personal_Email1),
      Personal_Email2: maskEmail(row.Personal_Email2),
    }));

    return sendResponse(res, 200, "Calling data fetched successfully", {
      total,
      page: pageNum,
      limit: limNum,
      totalPages: Math.ceil(total / limNum),
      data: maskedData,
    });
  } catch (err) {
    console.error(err);
    return sendError(next, err.message, 500);
  }
});

const getEngagementHistoryByContactId = asyncHandler(async (req, res, next) => {
  try {
    const { contactId } = req.params;
    if (!contactId) return sendError(next, "contactId is required", 400);

    const records = await EngagementHistory.find({ contact_id: contactId })
      .sort({ last_engagement_date: -1, createdAt: -1 })
      .lean();

    return sendResponse(res, 200, "Engagement history fetched", { records });
  } catch (err) {
    return sendError(
      next,
      err.message || "Failed to fetch engagement history",
      500
    );
  }
});

export {
  assignAgentsToCampaign,
  getAllocAndUnalloclist,
  releaseAgents,
  getAllNonAssignedAgents,
  getAllCampaignByAGentId,
  getCallingDataByAgentAndCampaign,
  getAllAssignedAgents,
  getCallingDataByAgentData,
  getEngagementHistoryByContactId,
};
