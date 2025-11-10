import Campaign from "../models/campaignModel.js";
import errorHandler from "../utils/index.js";
import User from "../models/userModel.js";
import CallingData from "../models/callingDataModal.js";
import CallHistory from "../models/callHistoryModel.js";
import AgentAssigned from "../models/agentAssigned.js";
import { UserRoleEnum } from "../utils/enum.js";
import mongoose from "mongoose";
import XLSX from "xlsx";
import path from "path";
import os from "os";
import fs from "fs";
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
      if (campaignId)
        query.CampaignId = new mongoose.Types.ObjectId(campaignId);

      const myCallingData = await CallingData.find(query)
        .select("callHistory isRegistered")
        .populate({
          path: "callHistory",
          select: "chatHistory", // only chatHistory needed
        })
        .lean();

      console.log(myCallingData, "myCallingData");

      let totalCallsMade = 0;
      let totalRegistrations = 0;
      const remarkCount = {};

      for (const entry of myCallingData) {
        if (entry.callHistory && entry.callHistory.chatHistory) {
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
      }

      parentData.myStats = {
        totalCallingDataAssignedToMe: myCallingData.length,
        totalCallsMade,
        totalRegistrations,
        remarkCount,
      };
    } else if (user.role === PROGRAM_MANAGER) {
      parentData.Name = "Program Manager";

      const campaignFilter = {
        programManager: { $elemMatch: { $eq: user._id } },
      };

      if (campaignId) {
        campaignFilter._id = campaignId;
      }

      const campaigns = await Campaign.find(campaignFilter)
        .select("_id status")
        .lean();

      const campaignIds = campaigns.map((c) => c._id);

      const campaignDetailCount = {};
      campaigns.forEach((c) => {
        campaignDetailCount[c.status] =
          (campaignDetailCount[c.status] || 0) + 1;
      });
      campaignDetailCount.totalCount = campaigns.length;
      parentData.campaignDetailCount = campaignDetailCount;

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
        const source = cd.source || "unknown";
        if (!sourceStats[source]) {
          sourceStats[source] = { total: 0, registered: 0 };
        }
        sourceStats[source].total += 1;
        if (cd.isRegistered) sourceStats[source].registered += 1;

        if (cd.agentId) agentAssignmentCount++;

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

const getAllAgentsDashboardData1 = asyncHandler(async (req, res, next) => {
  try {
    const { startDate, endDate, campaignId } = req.query;

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    // Get all agents
    const agents = await User.find({ role: AGENT })
      .select("_id name email")
      .lean();

    const responseData = [];

    for (const agent of agents) {
      const query = { agentId: agent._id };
      if (campaignId)
        query.CampaignId = new mongoose.Types.ObjectId(campaignId);
      if (startDate || endDate) query.createdAt = dateFilter;

      const callingData = await CallingData.find(query)
        .select("callHistory isRegistered")
        .populate({
          path: "callHistory",
          select: "chatHistory",
        })
        .lean();

      let totalCallsMade = 0;
      let totalRegistrations = 0;
      const remarkCount = {};

      for (const entry of callingData) {
        if (entry.callHistory?.chatHistory) {
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
      }

      responseData.push({
        agentId: agent._id,
        name: agent.name,
        email: agent.email,
        totalCallingDataAssigned: callingData.length,
        totalCallsMade,
        totalRegistrations,
        remarkCount,
      });
    }

    return sendResponse(
      res,
      200,
      "All agents dashboard data retrieved",
      responseData
    );
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const getAllAgentsDashboardData = asyncHandler(async (req, res, next) => {
  try {
    const { startDate, endDate, campaignId } = req.query;

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    let agents;

    if (campaignId) {
      // Get agents assigned to the campaign
      const assignedAgents = await AgentAssigned.find({
        campaign_id: campaignId,
        isAssigned: true,
      })
        .select("agent_id")
        .lean();

      const assignedAgentIds = assignedAgents.map((a) => a.agent_id);

      agents = await User.find({
        _id: { $in: assignedAgentIds },
        role: AGENT,
      })
        .select("_id employeeName email")
        .lean();
    } else {
      // Get all agents
      agents = await User.find({ role: AGENT })
        .select("_id employeeName email")
        .lean();
    }

    const responseData = [];

    for (const agent of agents) {
      const query = { agentId: agent._id };
      if (campaignId)
        query.CampaignId = new mongoose.Types.ObjectId(campaignId);
      if (startDate || endDate) query.createdAt = dateFilter;

      const callingData = await CallingData.find(query)
        .select("callHistory isRegistered")
        .populate({
          path: "callHistory",
          select: "chatHistory",
        })
        .lean();

      let totalCallsMade = 0;
      let totalRegistrations = 0;
      const remarkCount = {};

      for (const entry of callingData) {
        if (entry.callHistory?.chatHistory) {
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
      }

      responseData.push({
        agentId: agent._id,
        name: agent.employeeName,
        email: agent.email,
        totalCallingDataAssigned: callingData.length,
        totalCallsMade,
        totalRegistrations,
        remarkCount,
      });
    }

    return sendResponse(
      res,
      200,
      "All agents dashboard data retrieved",
      responseData
    );
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const getAllAgentsStatsReport = asyncHandler(async (req, res, next) => {
  try {
    const { startDate, endDate, campaignId, download } = req.query;

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    let campaign = null;
    if (campaignId) {
      campaign = await Campaign.findById(campaignId).select("name").lean();
    }

    let agents;

    if (campaignId) {
      // ✅ Agents of specific campaign
      const assignedAgents = await AgentAssigned.find({
        campaign_id: campaignId,
        isAssigned: true,
      })
        .select("agent_id")
        .lean();

      const assignedAgentIds = assignedAgents.map((a) => a.agent_id);

      agents = await User.find({
        _id: { $in: assignedAgentIds },
        role: AGENT,
      })
        .select("_id employeeName email")
        .lean();
    } else {
      // ✅ All Agents for All Campaigns
      agents = await User.find({ role: AGENT })
        .select("_id employeeName email")
        .lean();
    }

    const responseData = [];

    for (const agent of agents) {
      let campaignName = "All Campaigns";

      // ✅ Case 1: All Campaigns → find agent's assigned campaign name
      if (!campaignId) {
        const agentCampaign = await AgentAssigned.findOne({
          agent_id: agent._id,
          isAssigned: true,
        })
          .populate("campaign_id", "name")
          .lean();

        if (agentCampaign?.campaign_id?.name) {
          campaignName = agentCampaign.campaign_id.name;
        }
      }

      const query = { agentId: agent._id };

      // ✅ Case 2: Specific Campaign
      if (campaignId) {
        query.CampaignId = campaignId;
        campaignName = campaign?.name || "N/A";
      }

      if (startDate || endDate) query.createdAt = dateFilter;

      const callingData = await CallingData.find(query)
        .select("callHistory isRegistered")
        .populate({
          path: "callHistory",
          select: "chatHistory",
        })
        .lean();

      let totalCallsMade = 0;
      let totalRegistrations = 0;
      const remarkCount = {};

      for (const entry of callingData) {
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

      responseData.push({
        campaignName,
        agentName: agent.employeeName,
        email: agent.email,
        totalCallingDataAssigned: callingData.length,
        totalCallsMade,
        totalRegistrations,
        remarkCount: JSON.stringify(remarkCount),
      });
    }

    // ✅ Download as Excel
    if (download === "true") {
      const worksheet = XLSX.utils.json_to_sheet(responseData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Agent Stats");

      const fileName = `Agent_Report_${Date.now()}.xlsx`;

      // ✅ Use system temp directory (works on Windows/Linux/Mac)
      const tempDir = os.tmpdir();
      const filePath = path.join(tempDir, fileName);

      XLSX.writeFile(workbook, filePath);

      return res.download(filePath, fileName, (err) => {
        if (err) console.log("Download error:", err);
        // Optional: delete after download
        // fs.unlinkSync(filePath);
      });
    }

    return sendResponse(
      res,
      200,
      "All agents dashboard data retrieved",
      responseData
    );
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});
const getRegisteredUsersWithCampaign = asyncHandler(async (req, res, next) => {
  try {
    const { startDate, endDate, campaignId, download } = req.query;

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    const matchQuery = { isRegistered: true };
    if (campaignId) matchQuery.CampaignId = campaignId;
    if (startDate || endDate) matchQuery.createdAt = dateFilter;

    // ✅ Fetch Registered Users
    const registeredUsers = await CallingData.find(matchQuery)
      .populate("agentId", "employeeName email")
      .populate("CampaignId", "name")
      .populate({
        path: "callHistory",
        select: "chatHistory",
      })
      .lean();

    const responseData = registeredUsers.map((item) => ({
      campaignName: item?.CampaignId?.name || "N/A",
      agentName: item?.agentId?.employeeName || "N/A",
      agentEmail: item?.agentId?.email || "N/A",

      // ✅ Details from CallingData Model
      userName:
        item?.Full_Name ||
        `${item?.First_Name || ""} ${item?.Last_Name || ""}`.trim() ||
        "N/A",
      phone: item?.Mobile_No || item?.Contact_Direct_Phone1 || "N/A",
      email: item?.Office_Email_1 || item?.Personal_Email1 || "N/A",

      registeredDate: item?.createdAt
        ? new Date(item.createdAt).toLocaleString("en-IN")
        : "N/A",

      remarks:
        item?.callHistory?.chatHistory?.length > 0
          ? item.callHistory.chatHistory.slice(-1)[0]?.remarks || "N/A"
          : "N/A",
    }));

    // ✅ Excel Download Option
    if (download === "true") {
      const worksheet = XLSX.utils.json_to_sheet(responseData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Registered Users");

      const fileName = `Registered_Users_Report_${Date.now()}.xlsx`;
      const filePath = path.join(os.tmpdir(), fileName);

      XLSX.writeFile(workbook, filePath);

      return res.download(filePath, fileName, (err) => {
        if (err) console.log("Download Error:", err);
      });
    }

    return sendResponse(
      res,
      200,
      "Registered users data fetched successfully",
      responseData
    );
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});
const getCombinedReportOld = asyncHandler(async (req, res, next) => {
  try {
    const { startDate, endDate, campaignId, download } = req.query;

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    // ===================== AGENT STATS REPORT ===================== //
    let campaign = null;
    if (campaignId) {
      campaign = await Campaign.findById(campaignId).select("name").lean();
    }

    let agents;

    if (campaignId) {
      const assignedAgents = await AgentAssigned.find({
        campaign_id: campaignId,
        isAssigned: true,
      })
        .select("agent_id")
        .lean();

      const assignedAgentIds = assignedAgents.map((a) => a.agent_id);

      agents = await User.find({
        _id: { $in: assignedAgentIds },
        role: "AGENT",
      })
        .select("_id employeeName email")
        .lean();
    } else {
      agents = await User.find({ role: "AGENT" })
        .select("_id employeeName email")
        .lean();
    }

    const agentStats = [];

    for (const agent of agents) {
      let campaignName = "All Campaigns";

      if (!campaignId) {
        const agentCampaign = await AgentAssigned.findOne({
          agent_id: agent._id,
          isAssigned: true,
        })
          .populate("campaign_id", "name")
          .lean();

        if (agentCampaign?.campaign_id?.name) {
          campaignName = agentCampaign.campaign_id.name;
        }
      }

      const query = { agentId: agent._id };
      if (campaignId) query.CampaignId = campaignId;
      if (startDate || endDate) query.createdAt = dateFilter;

      const callingData = await CallingData.find(query)
        .select("callHistory isRegistered")
        .populate({ path: "callHistory", select: "chatHistory" })
        .lean();

      let totalCallsMade = 0;
      let totalRegistrations = 0;
      const remarkCount = {};

      for (const entry of callingData) {
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

      agentStats.push({
        campaignName,
        agentName: agent.employeeName,
        agentEmail: agent.email,
        totalCallingDataAssigned: callingData.length,
        totalCallsMade,
        totalRegistrations,
        remarkBreakDown: JSON.stringify(remarkCount),
      });
    }

    // ===================== REGISTERED USERS REPORT ===================== //
    const matchQuery = { isRegistered: true };
    if (campaignId) matchQuery.CampaignId = campaignId;
    if (startDate || endDate) matchQuery.createdAt = dateFilter;

    const registeredUsersRaw = await CallingData.find(matchQuery)
      .populate("agentId", "employeeName email")
      .populate("CampaignId", "name")
      .populate({ path: "callHistory", select: "chatHistory" })
      .lean();

    const registeredUsers = registeredUsersRaw.map((item) => ({
      campaignName: item?.CampaignId?.name || "N/A",
      agentName: item?.agentId?.employeeName || "N/A",
      agentEmail: item?.agentId?.email || "N/A",
      userName:
        item?.Full_Name ||
        `${item?.First_Name || ""} ${item?.Last_Name || ""}`.trim(),
      phone: item?.Mobile_No || item?.Contact_Direct_Phone1 || "N/A",
      email: item?.Office_Email_1 || item?.Personal_Email1 || "N/A",
      registeredDate: item?.createdAt
        ? new Date(item.createdAt).toLocaleString("en-IN")
        : "N/A",
      remarks:
        item?.callHistory?.chatHistory?.length > 0
          ? item.callHistory.chatHistory.slice(-1)[0]?.remarks || "N/A"
          : "N/A",
    }));

    // ===================== EXCEL DOWNLOAD (BOTH SHEETS) ===================== //
    if (download === "true") {
      const workbook = XLSX.utils.book_new();

      const sheet1 = XLSX.utils.json_to_sheet(agentStats);
      XLSX.utils.book_append_sheet(workbook, sheet1, "Agent Stats");

      const sheet2 = XLSX.utils.json_to_sheet(registeredUsers);
      XLSX.utils.book_append_sheet(workbook, sheet2, "Registered Users");

      const fileName = `Combined_Report_${Date.now()}.xlsx`;
      const filePath = path.join(os.tmpdir(), fileName);

      XLSX.writeFile(workbook, filePath);

      return res.download(filePath, fileName);
    }

    return sendResponse(res, 200, "Combined report fetched", {
      agentStats,
      registeredUsers,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const getCombinedReportOld2 = asyncHandler(async (req, res, next) => {
  try {
    const { startDate, endDate, campaignId, download } = req.query;

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    //---------------------- 1) AGENT STATS REPORT ----------------------//

    const agentQuery = {};
    if (campaignId)
      agentQuery.CampaignId = new mongoose.Types.ObjectId(campaignId);
    if (startDate || endDate) agentQuery.createdAt = dateFilter;

    const agentData = await CallingData.find(agentQuery)
      .populate("agentId", "employeeName email")
      .populate("CampaignId", "name")
      .populate({
        path: "callHistory",
        select: "chatHistory",
      })
      .lean();

    const agentStatsMap = {};

    agentData.forEach((record) => {
      const agentKey = record.agentId?._id?.toString();
      if (!agentKey) return;

      if (!agentStatsMap[agentKey]) {
        agentStatsMap[agentKey] = {
          campaignName: record?.CampaignId?.name || "N/A",
          agentName: record?.agentId?.employeeName || "N/A",
          email: record?.agentId?.email || "N/A",
          totalCallingDataAssigned: 0,
          totalCallsMade: 0,
          totalRegistrations: 0,
          remarkCount: {},
        };
      }

      agentStatsMap[agentKey].totalCallingDataAssigned++;

      if (record.callHistory?.chatHistory) {
        record.callHistory.chatHistory.forEach((chat) => {
          agentStatsMap[agentKey].totalCallsMade++;
          if (chat.isRegistered) agentStatsMap[agentKey].totalRegistrations++;
          if (chat.remarks) {
            agentStatsMap[agentKey].remarkCount[chat.remarks] =
              (agentStatsMap[agentKey].remarkCount[chat.remarks] || 0) + 1;
          }
        });
      }
    });

    const agentStats = Object.values(agentStatsMap).map((item) => ({
      ...item,
      remarkCount: JSON.stringify(item.remarkCount),
    }));

    //---------------------- 2) REGISTERED USERS REPORT ----------------------//

    const regQuery = { isRegistered: true };
    if (campaignId)
      regQuery.CampaignId = new mongoose.Types.ObjectId(campaignId);
    if (startDate || endDate) regQuery.createdAt = dateFilter;

    const registeredUsersData = await CallingData.find(regQuery)
      .populate("agentId", "employeeName email")
      .populate("CampaignId", "name")
      .populate({
        path: "callHistory",
        select: "chatHistory",
      })
      .lean();

    const registeredUsers = registeredUsersData.map((item) => ({
      campaignName: item?.CampaignId?.name || "N/A",
      agentName: item?.agentId?.employeeName || "N/A",
      agentEmail: item?.agentId?.email || "N/A",
      userName: item?.userName || "N/A",
      phone: item?.phone || "N/A",
      email: item?.email || "N/A",
      registeredDate: item?.createdAt
        ? new Date(item.createdAt).toLocaleString()
        : "N/A",
      remarks:
        item?.callHistory?.chatHistory?.length > 0
          ? item.callHistory.chatHistory.slice(-1)[0].remarks || "N/A"
          : "N/A",
    }));

    //---------------------- 3) EXCEL DOWNLOAD ----------------------//

    if (download === "true") {
      const workbook = XLSX.utils.book_new();

      const agentSheet = XLSX.utils.json_to_sheet(agentStats);
      const regUsersSheet = XLSX.utils.json_to_sheet(registeredUsers);

      XLSX.utils.book_append_sheet(workbook, agentSheet, "Agent Stats");
      XLSX.utils.book_append_sheet(workbook, regUsersSheet, "Registered Users");

      const fileName = `Combined_Report_${Date.now()}.xlsx`;
      const tempDir = os.tmpdir();
      const filePath = path.join(tempDir, fileName);

      XLSX.writeFile(workbook, filePath);
      return res.download(filePath, fileName);
    }

    return sendResponse(res, 200, "Combined report fetched", {
      agentStats,
      registeredUsers,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const getCombinedReport = asyncHandler(async (req, res, next) => {
  try {
    const { startDate, endDate, campaignId, download } = req.query;

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    let campaign = null;
    if (campaignId) {
      campaign = await Campaign.findById(campaignId).select("name").lean();
    }

    // ✅ Get Agents
    let agents;
    if (campaignId) {
      const assignedAgents = await AgentAssigned.find({
        campaign_id: campaignId,
        isAssigned: true,
      })
        .select("agent_id")
        .lean();

      const assignedAgentIds = assignedAgents.map((a) => a.agent_id);

      agents = await User.find({
        _id: { $in: assignedAgentIds },
        role: AGENT,
      }).select("_id employeeName email");
    } else {
      agents = await User.find({ role: AGENT }).select(
        "_id employeeName email"
      );
    }

    // ✅ Agent Stats
    const agentStats = [];
    for (const agent of agents) {
      let campaignName = "All Campaigns";

      if (!campaignId) {
        const agentCampaign = await AgentAssigned.findOne({
          agent_id: agent._id,
          isAssigned: true,
        })
          .populate("campaign_id", "name")
          .lean();

        if (agentCampaign?.campaign_id?.name) {
          campaignName = agentCampaign.campaign_id.name;
        }
      }

      const query = { agentId: agent._id };
      if (campaignId) {
        query.CampaignId = campaignId;
        campaignName = campaign?.name || "N/A";
      }
      if (startDate || endDate) query.createdAt = dateFilter;

      const callingData = await CallingData.find(query)
        .select("callHistory isRegistered")
        .populate({
          path: "callHistory",
          select: "chatHistory",
        })
        .lean();

      let totalCallsMade = 0;
      let totalRegistrations = 0;
      const remarkCount = {};

      for (const entry of callingData) {
        if (entry.callHistory?.chatHistory) {
          totalCallsMade += entry.callHistory.chatHistory.length;

          entry.callHistory.chatHistory.forEach((chat) => {
            if (chat.remarks) {
              remarkCount[chat.remarks] = (remarkCount[chat.remarks] || 0) + 1;
            }
            if (chat.isRegistered) totalRegistrations++;
          });
        }
      }

      agentStats.push({
        campaignName,
        agentName: agent.employeeName,
        email: agent.email,
        totalCallingDataAssigned: callingData.length,
        totalCallsMade,
        totalRegistrations,
        remarkCount: JSON.stringify(remarkCount),
      });
    }

    // ✅ Registered Users
    const matchQuery = { isRegistered: true };
    if (campaignId) matchQuery.CampaignId = campaignId;
    if (startDate || endDate) matchQuery.createdAt = dateFilter;

    const registeredData = await CallingData.find(matchQuery)
      .populate("agentId", "employeeName email")
      .populate("CampaignId", "name")
      .populate({
        path: "callHistory",
        select: "chatHistory",
      })
      .lean();

    const registeredUsers = registeredData.map((item) => ({
      campaignName: item?.CampaignId?.name || "N/A",
      agentName: item?.agentId?.employeeName || "N/A",
      agentEmail: item?.agentId?.email || "N/A",
      userName:
        item?.Full_Name ||
        `${item?.First_Name || ""} ${item?.Last_Name || ""}`.trim() ||
        "N/A",
      phone: item?.Mobile_No || item?.Contact_Direct_Phone1 || "N/A",
      email: item?.Office_Email_1 || item?.Personal_Email1 || "N/A",
      registeredDate: item?.createdAt
        ? new Date(item.createdAt).toLocaleString("en-IN")
        : "N/A",
      remarks:
        item?.callHistory?.chatHistory?.length > 0
          ? item.callHistory.chatHistory.slice(-1)[0]?.remarks || "N/A"
          : "N/A",
    }));

    // ✅ Download as Excel
    if (download === "true") {
      const workbook = XLSX.utils.book_new();

      // Sheet 1 - Agent Stats
      const agentStatsSheet = XLSX.utils.json_to_sheet(agentStats);
      XLSX.utils.book_append_sheet(workbook, agentStatsSheet, "Agent Stats");

      // Sheet 2 - Registered Users
      const registeredSheet = XLSX.utils.json_to_sheet(registeredUsers);
      XLSX.utils.book_append_sheet(
        workbook,
        registeredSheet,
        "Registered Users"
      );

      const fileName = `Combined_Report_${Date.now()}.xlsx`;
      const filePath = path.join(os.tmpdir(), fileName);

      XLSX.writeFile(workbook, filePath);

      return res.download(filePath, fileName, (err) => {
        if (err) console.log("Download Error:", err);
        fs.unlinkSync(filePath);
      });
    }

    // ✅ Normal JSON Response
    return sendResponse(res, 200, "Combined report fetched", {
      agentStats,
      registeredUsers,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});
export {
  dashboardData,
  getAllAgentsDashboardData,
  getAllAgentsStatsReport,
  getRegisteredUsersWithCampaign,
  getCombinedReport,
};
