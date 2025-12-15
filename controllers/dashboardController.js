import Campaign from "../models/campaignModel.js";
import errorHandler from "../utils/index.js";
import User from "../models/userModel.js";
import CallingData from "../models/callingDataModal.js";
import CallHistory from "../models/callHistoryModel.js";
import CallRecording from "../models/callRecordingModel.js";
import AgentAssigned from "../models/agentAssigned.js";
import { UserRoleEnum } from "../utils/enum.js";
import mongoose from "mongoose";
import XLSX from "xlsx";
import path from "path";
import os from "os";
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
const getRegisteredUsersWithCampaignOld = asyncHandler(
  async (req, res, next) => {
    try {
      const { startDate, endDate, campaignId, download } = req.query;

      const dateFilter = {};
      if (startDate) dateFilter.$gte = new Date(startDate);
      if (endDate) dateFilter.$lte = new Date(endDate);

      const matchQuery = { isRegistered: true };
      if (campaignId) matchQuery.CampaignId = campaignId;
      if (startDate || endDate) matchQuery.createdAt = dateFilter;
      console.log(matchQuery, "matchQuery");

      // ✅ Fetch Registered Users
      const registeredUsers = await CallingData.find(matchQuery)
        .populate("agentId", "employeeName email _id")
        // .populate("CampaignId", "name")
        .populate({
          path: "CampaignId",
          model: "Campaign", // 👈 explicitly specify model name
          select: "name _id",
        })
        .populate({
          path: "callHistory",
          select: "chatHistory",
        })
        .lean();
      console.log(registeredUsers, "registeredUsers");

      const responseData = registeredUsers.map(
        (item) => (
          console.log("Campaign Data:", item.CampaignId),
          {
            campaignName: item?.CampaignId?.name || "N/A",
            agentName: item?.agentId?.employeeName || "N/A",
            agentId: item?.agentId?._id || "N/A",
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
          }
        )
      );

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
  }
);
const getRegisteredUsersWithCampaignold3 = asyncHandler(
  async (req, res, next) => {
    try {
      const { startDate, endDate, campaignId, download } = req.query;

      // ✅ Setup date filter if provided
      const dateFilter = {};
      if (startDate) dateFilter.$gte = new Date(startDate);
      if (endDate) dateFilter.$lte = new Date(endDate);

      // ✅ Base query for registered users
      const matchQuery = { isRegistered: true };

      // ✅ If specific campaignId provided, filter data
      if (campaignId && campaignId !== "all") {
        matchQuery.CampaignId = campaignId;
      }

      // ✅ If date range provided
      if (startDate || endDate) {
        matchQuery.createdAt = dateFilter;
      }

      console.log("Match Query:", matchQuery);

      // ✅ Fetch registered users + populate Campaign & Agent info
      const registeredUsers = await CallingData.find(matchQuery)
        .populate({
          path: "CampaignId",
          model: "Campaign",
          select: "name _id",
        })
        .populate({
          path: "agentId",
          model: "User",
          select: "employeeName email _id",
        })
        .populate({
          path: "callHistory",
          select: "chatHistory",
        })
        .lean();

      console.log("Registered Users Found:", registeredUsers.length);

      // ✅ Transform data to the desired output format
      const responseData = registeredUsers.map((item) => ({
        campaignId: item?.CampaignId?._id || "N/A",
        campaignName: item?.CampaignId?.name || "N/A",
        agentId: item?.agentId?._id || "N/A",
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
        // remarks:
        //   item?.callHistory?.chatHistory?.length > 0
        //     ? item.callHistory.chatHistory.slice(-1)[0]?.remarks || "N/A"
        //     : "N/A",
      }));

      // ✅ Excel download option
      if (download === "false") {
        const worksheet = XLSX.utils.json_to_sheet(responseData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Registered Users");

        const fileName = `Registered_Users_Report_${Date.now()}.xlsx`;
        const filePath = path.join(os.tmpdir(), fileName);

        XLSX.writeFile(workbook, filePath);

        return res.download(filePath, fileName, (err) => {
          if (err) console.error("Download Error:", err);
        });
      }

      // ✅ Normal API response
      return sendResponse(
        res,
        200,
        "Registered users fetched successfully",
        responseData
      );
    } catch (error) {
      return sendError(next, error.message || "Internal Server Error", 500);
    }
  }
);

const getRegisteredUsersWithCampaignOld2 = asyncHandler(
  async (req, res, next) => {
    try {
      const { startDate, endDate, campaignId, download } = req.query;

      // ✅ Date filter setup
      const dateFilter = {};
      if (startDate) dateFilter.$gte = new Date(startDate);
      if (endDate) dateFilter.$lte = new Date(endDate);

      // ✅ Base filter — only registered users
      const matchQuery = { isRegistered: true };

      // ✅ If campaignId is provided, filter by it — else get all campaigns
      if (campaignId && campaignId !== "all") {
        matchQuery.CampaignId = campaignId;
      }

      // ✅ Apply date filter if present
      if (startDate || endDate) {
        matchQuery.createdAt = dateFilter;
      }

      console.log("Match Query =>", matchQuery);

      // ✅ Fetch all registered users (filtered or all)
      const registeredUsers = await CallingData.find(matchQuery)
        .populate({
          path: "CampaignId",
          model: "Campaign", // 👈 ensure matches Campaign model name
          select: "name _id",
        })
        .populate("agentId", "employeeName email _id")
        .populate({
          path: "callHistory",
          select: "chatHistory",
        })
        .lean();

      console.log("Fetched Users =>", registeredUsers.length);

      // ✅ Transform response
      const responseData = registeredUsers.map((item) => ({
        campaignId: item?.CampaignId?._id || "N/A",
        campaignName: item?.CampaignId?.name || "N/A",
        agentId: item?.agentId?._id || "N/A",
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

      // ✅ Excel download support
      if (download === "true") {
        const worksheet = XLSX.utils.json_to_sheet(responseData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Registered Users");

        const fileName = `Registered_Users_Report_${Date.now()}.xlsx`;
        const filePath = path.join(os.tmpdir(), fileName);

        XLSX.writeFile(workbook, filePath);
        return res.download(filePath, fileName, (err) => {
          if (err) console.error("Download Error:", err);
        });
      }

      // ✅ Normal API JSON response
      return sendResponse(
        res,
        200,
        "Registered users data fetched successfully",
        responseData
      );
    } catch (error) {
      return sendError(next, error.message, 500);
    }
  }
);
const getRegisteredUsersWithCampaign = asyncHandler(async (req, res, next) => {
  try {
    const { startDate, endDate, campaignId, download } = req.query;

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    const matchQuery = { isRegistered: true };
    if (campaignId && campaignId !== "all") matchQuery.CampaignId = campaignId;
    if (startDate || endDate) matchQuery.createdAt = dateFilter;

    console.log("Match Query:", matchQuery);

    const registeredUsers = await CallingData.find(matchQuery)
      .populate({
        path: "CampaignId",
        model: "Campaign",
        select: "name _id",
      })
      .populate({
        path: "agentId",
        model: "User",
        select: "employeeName email _id",
      })
      .populate({
        path: "callHistory",
        select: "chatHistory",
      })
      .lean();

    console.log("Registered Users Found:", registeredUsers.length);

    const responseData = registeredUsers.map((item) => ({
      campaignId: item?.CampaignId?._id || "N/A",
      campaignName: item?.CampaignId?.name || "N/A",
      agentId: item?.agentId?._id || "N/A",
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
    }));

    if (download === "false") {
      const worksheet = XLSX.utils.json_to_sheet(responseData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Registered Users");

      const fileName = `Registered_Users_Report_${Date.now()}.xlsx`;
      const filePath = path.join(os.tmpdir(), fileName);
      XLSX.writeFile(workbook, filePath);

      return res.download(filePath, fileName, (err) => {
        if (err) console.error("Download Error:", err);
      });
    }

    return sendResponse(
      res,
      200,
      "Registered users fetched successfully",
      responseData
    );
  } catch (error) {
    return sendError(next, error.message || "Internal Server Error", 500);
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

// const getCombinedReportOld3 = asyncHandler(async (req, res, next) => {
//   try {
//     const { startDate, endDate, campaignId, download } = req.query;

//     const dateFilter = {};
//     if (startDate) dateFilter.$gte = new Date(startDate);
//     if (endDate) dateFilter.$lte = new Date(endDate);

//     let campaign = null;
//     if (campaignId) {
//       campaign = await Campaign.findById(campaignId).select("name").lean();
//     }

//     // ✅ Get Agents
//     let agents;
//     if (campaignId) {
//       const assignedAgents = await AgentAssigned.find({
//         campaign_id: campaignId,
//         isAssigned: true,
//       })
//         .select("agent_id")
//         .lean();

//       const assignedAgentIds = assignedAgents.map((a) => a.agent_id);

//       agents = await User.find({
//         _id: { $in: assignedAgentIds },
//         role: AGENT,
//       }).select("_id employeeName email");
//     } else {
//       agents = await User.find({ role: AGENT }).select(
//         "_id employeeName email"
//       );
//     }

//     // ✅ Agent Stats
//     const agentStats = [];
//     for (const agent of agents) {
//       let campaignName = "All Campaigns";

//       if (!campaignId) {
//         const agentCampaign = await AgentAssigned.findOne({
//           agent_id: agent._id,
//           isAssigned: true,
//         })
//           .populate("campaign_id", "name")
//           .lean();

//         if (agentCampaign?.campaign_id?.name) {
//           campaignName = agentCampaign.campaign_id.name;
//         }
//       }

//       const query = { agentId: agent._id };
//       if (campaignId) {
//         query.CampaignId = campaignId;
//         campaignName = campaign?.name || "N/A";
//       }
//       if (startDate || endDate) query.createdAt = dateFilter;

//       const callingData = await CallingData.find(query)
//         .select("callHistory isRegistered")
//         .populate({
//           path: "callHistory",
//           select: "chatHistory",
//         })
//         .lean();

//       let totalCallsMade = 0;
//       let totalRegistrations = 0;
//       const remarkCount = {};

//       for (const entry of callingData) {
//         if (entry.callHistory?.chatHistory) {
//           totalCallsMade += entry.callHistory.chatHistory.length;

//           entry.callHistory.chatHistory.forEach((chat) => {
//             if (chat.remarks) {
//               remarkCount[chat.remarks] = (remarkCount[chat.remarks] || 0) + 1;
//             }
//             if (chat.isRegistered) totalRegistrations++;
//           });
//         }
//       }

//       agentStats.push({
//         campaignName,
//         agentName: agent.employeeName,
//         email: agent.email,
//         totalCallingDataAssigned: callingData.length,
//         totalCallsMade,
//         totalRegistrations,
//         remarkCount: JSON.stringify(remarkCount),
//       });
//     }

//     // ✅ Registered Users
//     const matchQuery = { isRegistered: true };
//     if (campaignId) matchQuery.CampaignId = campaignId;
//     if (startDate || endDate) matchQuery.createdAt = dateFilter;

//     const registeredData = await CallingData.find(matchQuery)
//       .populate("agentId", "employeeName email")
//       .populate("CampaignId", "name")
//       .populate({
//         path: "callHistory",
//         select: "chatHistory",
//       })
//       .lean();

//     const registeredUsers = registeredData.map((item) => ({
//       campaignName: item?.CampaignId?.name || "N/A",
//       agentName: item?.agentId?.employeeName || "N/A",
//       agentEmail: item?.agentId?.email || "N/A",
//       userName:
//         item?.Full_Name ||
//         `${item?.First_Name || ""} ${item?.Last_Name || ""}`.trim() ||
//         "N/A",
//       phone: item?.Mobile_No || item?.Contact_Direct_Phone1 || "N/A",
//       email: item?.Office_Email_1 || item?.Personal_Email1 || "N/A",
//       registeredDate: item?.createdAt
//         ? new Date(item.createdAt).toLocaleString("en-IN")
//         : "N/A",
//       remarks:
//         item?.callHistory?.chatHistory?.length > 0
//           ? item.callHistory.chatHistory.slice(-1)[0]?.remarks || "N/A"
//           : "N/A",
//     }));

//     // ✅ Download as Excel
//     if (download === "true") {
//       const workbook = XLSX.utils.book_new();

//       // Sheet 1 - Agent Stats
//       const agentStatsSheet = XLSX.utils.json_to_sheet(agentStats);
//       XLSX.utils.book_append_sheet(workbook, agentStatsSheet, "Agent Stats");

//       // Sheet 2 - Registered Users
//       const registeredSheet = XLSX.utils.json_to_sheet(registeredUsers);
//       XLSX.utils.book_append_sheet(
//         workbook,
//         registeredSheet,
//         "Registered Users"
//       );

//       const fileName = `Combined_Report_${Date.now()}.xlsx`;
//       const filePath = path.join(os.tmpdir(), fileName);

//       XLSX.writeFile(workbook, filePath);

//       return res.download(filePath, fileName, (err) => {
//         if (err) console.log("Download Error:", err);
//         fs.unlinkSync(filePath);
//       });
//     }

//     // ✅ Normal JSON Response
//     return sendResponse(res, 200, "Combined report fetched", {
//       agentStats,
//       registeredUsers,
//     });
//   } catch (error) {
//     return sendError(next, error.message, 500);
//   }
// });
const getCombinedReport = asyncHandler(async (req, res, next) => {
  try {
    const { download } = req.query; // ✅ Only "download" query param now

    // ✅ Fetch all active campaigns
    const campaigns = await Campaign.find()
      .select("name type category startDate endDate")
      .lean();

    if (!campaigns.length)
      return sendError(next, "No active campaigns found", 404);

    const reportData = [];

    for (const campaign of campaigns) {
      // ✅ Total calling data count
      const totalCallingData = await CallingData.countDocuments({
        CampaignId: campaign._id,
      });

      // ✅ Total called data count
      const totalCalledData = await CallingData.countDocuments({
        CampaignId: campaign._id,
        callHistory: { $exists: true, $ne: null },
      });

      // ✅ Total registered users
      const totalRegisteredUsers = await CallingData.countDocuments({
        CampaignId: campaign._id,
        isRegistered: true,
      });

      // ✅ Total not registered users
      const totalNotRegisteredUsers = totalCallingData - totalRegisteredUsers;

      // ✅ Total agents assigned
      const totalAgents = await AgentAssigned.countDocuments({
        campaign_id: campaign._id,
        isAssigned: true,
      });

      reportData.push({
        Campaign_Name: campaign.name,
        Category: campaign.category || "N/A",
        Type: campaign.type || "N/A",
        Start_Date: campaign.startDate
          ? new Date(campaign.startDate).toLocaleDateString("en-GB")
          : "N/A",
        End_Date: campaign.endDate
          ? new Date(campaign.endDate).toLocaleDateString("en-GB")
          : "N/A",
        Total_Agents: totalAgents,
        Total_Calling_Data: totalCallingData,
        Total_Called_Data: totalCalledData,
        Total_Registered_Users: totalRegisteredUsers,
        Total_Not_Registered_Users: totalNotRegisteredUsers,
      });
    }

    // ✅ Excel Download Feature
    if (download === "true") {
      const worksheet = XLSX.utils.json_to_sheet(reportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Combined Report");

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=Combined_Report_${
          new Date().toISOString().split("T")[0]
        }.xlsx`
      );

      return res.send(buffer);
    }

    // ✅ Normal JSON Response
    return sendResponse(res, 200, "Combined report fetched successfully", {
      totalCampaigns: reportData.length,
      campaigns: reportData,
    });
  } catch (error) {
    return sendError(next, error.message || "Internal Server Error", 500);
  }
});

const getCallHistoryReportOld = asyncHandler(async (req, res, next) => {
  try {
    const { pmId } = req.params;

    if (!pmId) {
      return sendError(next, "PM ID is required", 400);
    }
    // Step 1: Find all campaigns where this PM is a program manager
    const campaigns = await Campaign.find({
      programManager: { $in: [pmId] },
    }).select("_id name type startDate endDate status");

    console.log(campaigns, "campaigns..");
    if (!campaigns || campaigns.length === 0) {
      return sendResponse(
        res,
        200,
        "No campaigns found for this Program Manager",
        {
          pmId,
          totalCampaigns: 0,
          campaigns: [],
          callHistories: [],
        }
      );
    }

    // Extract campaign IDs
    const campaignIds = campaigns.map((campaign) => campaign._id);
    console.log("campaignIds", campaignIds);
    // Step 2: Find all call histories for these campaigns
    const callHistories = await CallHistory.find({
      campaign_id: { $in: campaignIds },
    })
      .populate("callingData_id", "name email phone company designation")
      .populate("campaign_id", "name type startDate endDate")
      .populate("chatHistory.agent_id", "name email")
      .sort({ updatedAt: -1 }); // Latest first

    console.log("callHistories", callHistories);

    if (!callHistories || callHistories.length === 0) {
      return sendResponse(
        res,
        200,
        "No call histories found for these campaigns",
        {
          pmId,
          totalCampaigns: campaigns.length,
          campaigns,
          totalCallHistories: 0,
          callHistories: [],
        }
      );
    }

    // Step 3: Get all callingData_ids from call histories
    const callingDataIds = callHistories.map((ch) => ch.callingData_id._id);

    console.log("callingDataIds56", callingDataIds);

    // Step 4: Find all call recordings for these callingData_ids
    const callRecordings = await CallRecording.find({
      callingData_id: { $in: callingDataIds },
    })
      .populate("callingData_id", "name email phone company")
      .populate("campaign_id", "name type")
      .populate("agent_id", "name email")
      .sort({ callingDate: -1 }); // Latest first

    // Step 5: Map recordings to their respective call histories
    const callHistoriesWithRecordings = callHistories.map((history) => {
      const recordings = callRecordings.filter(
        (rec) =>
          rec.callingData_id._id.toString() ===
          history.callingData_id._id.toString()
      );

      return {
        ...history.toObject(),
        recordings: recordings.map((rec) => ({
          _id: rec._id,
          callId: rec.callId,
          recording: rec.recording,
          contactNo: rec.contactNo,
          callingDate: rec.callingDate,
          agentName: rec.agentName,
          sessionId: rec.sessionId,
          misc: rec.misc,
          webHookResponse: rec.webHookResponse,
          createdAt: rec.createdAt,
        })),
      };
    });

    // Step 6: Prepare summary statistics
    const summary = {
      totalCampaigns: campaigns.length,
      totalCallHistories: callHistories.length,
      totalRecordings: callRecordings.length,
      registeredCount: callHistories.filter((ch) => ch.isRegistered).length,
      notRegisteredCount: callHistories.filter((ch) => !ch.isRegistered).length,
      recordingsWithFiles: callRecordings.filter((rec) => rec.recording).length,
    };

    return sendResponse(res, 200, "Call histories fetched successfully", {
      pmId,
      summary,
      campaigns,
      callHistories: callHistoriesWithRecordings,
    });
  } catch (error) {
    console.error("Error fetching PM call histories:", error);
    return sendError(
      next,
      error.message || "Failed to fetch call histories",
      500
    );
  }
});

const getCallHistoryReport = asyncHandler(async (req, res, next) => {
  try {
    const { pmId } = req.params;

    if (!pmId) {
      return sendError(next, "PM ID is required", 400);
    }

    // Step 1: Find all campaigns managed by this PM
    const campaigns = await Campaign.find({
      programManager: { $in: [pmId] },
    }).select("_id name type startDate endDate status");

    if (!campaigns || campaigns.length === 0) {
      return sendResponse(res, 200, "No campaigns found", {
        pmId,
        totalCampaigns: 0,
        data: [],
      });
    }

    const campaignIds = campaigns.map((c) => c._id);

    // Step 2: Fetch all call histories for these campaigns
    const callHistories = await CallHistory.find({
      campaign_id: { $in: campaignIds },
    })
      .populate("callingData_id")
      .populate("campaign_id", "name type startDate endDate")
      .populate("chatHistory.agent_id", "name email")
      .sort({ updatedAt: -1 });

    if (!callHistories || callHistories.length === 0) {
      return sendResponse(res, 200, "No call histories found", {
        pmId,
        totalCampaigns: campaigns.length,
        data: [],
      });
    }

    // Step 3: Get all callingData IDs for recordings mapping
    const callingDataIds = callHistories.map((ch) => ch.callingData_id?._id);

    // Step 4: Find corresponding call recordings
    const callRecordings = await CallRecording.find({
      callingData_id: { $in: callingDataIds },
    })
      .populate("callingData_id")
      .populate("campaign_id", "name type")
      .populate("agent_id", "name email")
      .sort({ callingDate: -1 });

    // Step 5: Merge recordings into call histories
    const historiesWithRecordings = callHistories.map((history) => {
      const recordings = callRecordings.filter(
        (rec) =>
          rec.callingData_id?._id?.toString() ===
          history.callingData_id?._id?.toString()
      );

      return {
        ...history.toObject(),
        recordings: recordings.map((rec) => ({
          _id: rec._id,
          callId: rec.callId,
          recording: rec.recording,
          contactNo: rec.contactNo,
          callingDate: rec.callingDate,
          agentName: rec.agentName,
          sessionId: rec.sessionId,
          misc: rec.misc,
          webHookResponse: rec.webHookResponse,
          createdAt: rec.createdAt,
        })),
      };
    });

    // Step 6: Format final output grouped by campaign
    const finalOutput = campaigns.map((campaign) => {
      // Filter only histories belonging to this campaign
      const campaignHistories = historiesWithRecordings.filter(
        (h) => h.campaign_id._id.toString() === campaign._id.toString()
      );

      const formattedHistories = campaignHistories.map((history) => {
        // Collect previous remarks with timestamps + agent info
        const previousRemarks = (history.chatHistory || []).map((entry) => ({
          remark: entry.remarks || "",
          reason: entry.reason || "",
          agentName: entry.agentName || "",
          contactNo: entry.contactNo || "",
          timestamp: entry.callingDate,
        }));

        return {
          callingData: history.callingData_id, // full data
          recordings: history.recordings,
          previousRemarks,
          agentDetails:
            history.chatHistory?.length > 0
              ? history.chatHistory[0].agent_id
              : null,
          timestamps: {
            createdAt: history.createdAt,
            updatedAt: history.updatedAt,
          },
        };
      });

      return {
        campaignId: campaign._id,
        campaignName: campaign.name,
        campaignType: campaign.type,
        campaignStartDate: campaign.startDate,
        campaignEndDate: campaign.endDate,
        status: campaign.status,
        callHistory: formattedHistories,
      };
    });

    // Step 7: Summary (Optional)
    const summary = {
      totalCampaigns: campaigns.length,
      totalCallHistories: callHistories.length,
      totalRecordings: callRecordings.length,
      registeredCount: callHistories.filter((ch) => ch.isRegistered).length,
      notRegisteredCount: callHistories.filter((ch) => !ch.isRegistered).length,
      recordingsWithFiles: callRecordings.filter((rec) => rec.recording).length,
    };

    return sendResponse(res, 200, "Call histories fetched successfully", {
      pmId,
      summary,
      data: finalOutput,
    });
  } catch (error) {
    console.error("Error fetching PM call histories:", error);
    return sendError(
      next,
      error.message || "Failed to fetch call histories",
      500
    );
  }
});

export {
  dashboardData,
  getAllAgentsDashboardData,
  getAllAgentsStatsReport,
  getRegisteredUsersWithCampaign,
  getCombinedReport,
  getCallHistoryReport,
};
