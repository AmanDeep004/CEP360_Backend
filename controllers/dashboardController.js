import Campaign from "../models/campaignModel.js";
import errorHandler from "../utils/index.js";
import User from "../models/userModel.js";
import CallingData from "../models/callingDataModal.js";
import CallHistory from "../models/callHistoryModel.js";
import { UserRoleEnum } from "../utils/enum.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;
const { ADMIN, PRESALES_MANAGER, PROGRAM_MANAGER, RESOURCE_MANAGER, AGENT } =
  UserRoleEnum;

const dashboardData1 = asyncHandler(async (req, res, next) => {
  try {
    const user = req?.user;
    const { startDate, endDate, campaignId } = req.query;
    let query = {};
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    if (campaignId) {
      if (user.role === PROGRAM_MANAGER) {
        query._id = campaignId;
      } else query.CampaignId = campaignId;
    }
    console.log(query, "queryData.");

    const parentData = {};
    if (user.role === AGENT) {
      parentData.Name = "Agent";
      query.agentId = user._id;
      console.log(query, "query");
      const myCallingData = await CallingData.find(query)
        .populate("callHistory")
        .lean();

      console.log(myCallingData, "myCallingData");

      //  parentData.myCallingData = myCallingData;
      // --------------------------------------------------
      // logic for all calling Data
      let totalCallsMade = 0;
      let totalRegistrations = 0;
      let remarkCount = {};
      const totalCallingDataAssignedToMe = myCallingData.length;
      console.log();
      myCallingData.forEach((entry) => {
        if (entry.callHistory && Array.isArray(entry.callHistory.chatHistory)) {
          totalCallsMade += entry.callHistory.chatHistory.length;
          entry.callHistory.chatHistory.forEach((chat) => {
            if (chat.remarks) {
              remarkCount[chat.remarks] = (remarkCount[chat.remarks] || 0) + 1;
            }
            if (chat.isRegistered) {
              totalRegistrations += 1;
            }
          });
        }
      });

      const myStats = {
        totalCallingDataAssignedToMe,
        totalCallsMade,
        totalRegistrations,
        remarkCount,
      };
      parentData.myStats = myStats;
    } else if (user.role === PROGRAM_MANAGER) {
      //logic for campaignDetailCount
      parentData.Name = "Program Manager";
      query.programManager = { $elemMatch: { $eq: user._id } };
      const campaigns = await Campaign.find(query).lean();
      const campaignDetailCount = {};
      campaigns.forEach((c) => {
        if (c.status) {
          campaignDetailCount[c.status] =
            (campaignDetailCount[c.status] || 0) + 1;
        }
      });
      campaignDetailCount.totalCount = campaigns.length;
      parentData.campaignDetailCount = campaignDetailCount;

      //logic for call history
      const campaignIds = campaigns.map((c) => c._id);
      const callingDataList = await CallingData.find({
        CampaignId: { $in: campaignIds },
      }).populate("callHistory");

      const agentAssignmentCount = callingDataList.filter(
        (cd) => cd.agentId
      ).length;

      const leadsDataInsight = {
        totalCallingData: callingDataList.length,
        dataForwhichAgentAssigned: agentAssignmentCount,
        // callingDataList,
      };
      parentData.leadsDataInsight = leadsDataInsight;
      // ----------------------------------------------
      //logic for sourceStats

      const sourceStats = {};
      callingDataList.forEach((cd) => {
        const source = cd.source || "unknown";
        if (!sourceStats[source]) {
          sourceStats[source] = { total: 0, registered: 0 };
        }
        sourceStats[source].total += 1;
        if (cd.isRegistered) {
          sourceStats[source].registered += 1;
        }
      });
      parentData.sourceStats = sourceStats;
      // ---------------------------------------------------
      //  logic for remarkCount

      const callingDataWithHistory = callingDataList.filter(
        (entry) =>
          entry.callHistory && Object.keys(entry.callHistory).length > 0
      );

      let totalCalls = 0;
      let totalRegisteredLeads = 0;
      const remarkCount = {};

      callingDataWithHistory.forEach((entry) => {
        if (entry.callHistory && Array.isArray(entry.callHistory.chatHistory)) {
          totalCalls += entry.callHistory.chatHistory.length;
          entry.callHistory.chatHistory.forEach((chat) => {
            if (chat.remarks) {
              remarkCount[chat.remarks] = (remarkCount[chat.remarks] || 0) + 1;
            }
            if (chat.isRegistered) {
              totalRegisteredLeads += 1;
            }
          });
        }
      });

      parentData.remarkCount = remarkCount;

      // ----------------------------------------------------------
      //logic for total calls vs total registrations
      const totalCallsVsTotalReg = {
        totalCalls: totalCalls,
        totalRegisteredLeads,
      };
      parentData.totalCallsVsTotalReg = totalCallsVsTotalReg;
    } else if (user.role === PRESALES_MANAGER) {
      parentData.Name === "PreSales Manager";
    } else if (user.role === RESOURCE_MANAGER) {
      parentData.Name = "Resource Manager";
    } else if (user.role === ADMIN) {
      parentData.Name = "Admin";
    }

    return sendResponse(res, 200, "All campaigns retrieved", parentData);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});
const dashboardData = asyncHandler(async (req, res, next) => {
  try {
    const user = req?.user;
    const { startDate, endDate, campaignId } = req.query;

    const query = {};
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const parentData = {};

    if (user.role === AGENT) {
      parentData.Name = "Agent";
      query.agentId = user._id;

      const myCallingData = await CallingData.find(query)
        .select("callHistory isRegistered")
        .lean();

      let totalCallsMade = 0;
      let totalRegistrations = 0;
      const remarkCount = {};

      for (const entry of myCallingData) {
        if (entry.callHistory?.chatHistory) {
          totalCallsMade += entry.callHistory.chatHistory.length;
          entry.callHistory.chatHistory.forEach((chat) => {
            if (chat.remarks) {
              remarkCount[chat.remarks] = (remarkCount[chat.remarks] || 0) + 1;
            }
            if (chat.isRegistered) totalRegistrations += 1;
          });
        }
      }

      parentData.myStats = {
        totalCallingDataAssignedToMe: myCallingData.length,
        totalCallsMade,
        totalRegistrations,
        remarkCount,
      };
    } else if (user.role === PROGRAM_MANAGER) {
      parentData.Name = "Program Manager";

      // Fetch campaigns by PM
      const campaigns = await Campaign.find({
        programManager: { $elemMatch: { $eq: user._id } },
      })
        .select("_id status")
        .lean();

      const campaignIds = campaigns.map((c) => c._id);

      // Summary of campaign status
      const campaignDetailCount = {};
      campaigns.forEach((c) => {
        campaignDetailCount[c.status] =
          (campaignDetailCount[c.status] || 0) + 1;
      });
      campaignDetailCount.totalCount = campaigns.length;
      parentData.campaignDetailCount = campaignDetailCount;

      // Fetch calling data and call history
      const callingDataList = await CallingData.find({
        CampaignId: { $in: campaignIds },
      })
        .select("CampaignId agentId source isRegistered callHistory")
        .lean();

      const callHistoryIds = callingDataList
        .map((cd) => cd.callHistory)
        .filter(Boolean);

      const callHistories = await CallHistory.find({
        _id: { $in: callHistoryIds },
      })
        .select("chatHistory")
        .lean();

      const callHistoryMap = new Map();
      callHistories.forEach((ch) => callHistoryMap.set(ch._id.toString(), ch));

      let totalCalls = 0;
      let totalRegisteredLeads = 0;
      const remarkCount = {};
      const sourceStats = {};
      let agentAssignmentCount = 0;

      callingDataList.forEach((cd) => {
        // Source Stats
        const source = cd.source || "unknown";
        if (!sourceStats[source]) {
          sourceStats[source] = { total: 0, registered: 0 };
        }
        sourceStats[source].total += 1;
        if (cd.isRegistered) sourceStats[source].registered += 1;

        // Agent Assigned Count
        if (cd.agentId) agentAssignmentCount++;

        // Call History Insights
        const callHistory = callHistoryMap.get(cd.callHistory?.toString());
        if (callHistory?.chatHistory?.length) {
          totalCalls += callHistory.chatHistory.length;
          callHistory.chatHistory.forEach((chat) => {
            if (chat.remarks) {
              remarkCount[chat.remarks] = (remarkCount[chat.remarks] || 0) + 1;
            }
            if (chat.isRegistered) totalRegisteredLeads += 1;
          });
        }
      });

      parentData.sourceStats = sourceStats;
      parentData.remarkCount = remarkCount;
      parentData.totalCallsVsTotalReg = {
        totalCalls,
        totalRegisteredLeads,
      };
      parentData.leadsDataInsight = {
        totalCallingData: callingDataList.length,
        dataForwhichAgentAssigned: agentAssignmentCount,
      };
    } else if (user.role === PRESALES_MANAGER) {
      parentData.Name = "PreSales Manager";
    } else if (user.role === RESOURCE_MANAGER) {
      parentData.Name = "Resource Manager";
    } else if (user.role === ADMIN) {
      parentData.Name = "Admin";
    }

    return sendResponse(res, 200, "All campaigns retrieved", parentData);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

export { dashboardData };
