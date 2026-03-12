import AttendenceModel from "../models/attendenceModel.js";
import Campaign from "../models/campaignModel.js";
import AgentAssigned from "../models/agentAssigned.js";
import errorHandler from "../utils/index.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;

const getAllAttendenceDetailsOld = asyncHandler(async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return sendError(next, "startDate and endDate are required", 400);
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); // include entire end date

    const allAttendances = await AttendenceModel.find({
      createdAt: { $gte: start, $lte: end },
    })
      .sort({ createdAt: 1 })
      .populate("employeeId")
      .lean();

    const agentAttendances = allAttendances.filter(
      (att) => att.employeeId?.role === "agent"
    );

    const uniqueAttendanceMap = new Map();

    for (const attendance of agentAttendances) {
      const empId = attendance.employeeId?._id?.toString();
      const dateKey = new Date(attendance.createdAt)
        .toISOString()
        .split("T")[0];

      const mapKey = `${empId}-${dateKey}`;

      if (!uniqueAttendanceMap.has(mapKey)) {
        uniqueAttendanceMap.set(mapKey, attendance); // keep first (earliest) only
      }
    }

    const filteredAttendance = Array.from(uniqueAttendanceMap.values());

    // Combine by day
    const dayWiseAttendanceMap = {};

    filteredAttendance.forEach((att) => {
      const date = new Date(att.createdAt).toISOString().split("T")[0];
      if (!dayWiseAttendanceMap[date]) {
        dayWiseAttendanceMap[date] = [];
      }
      dayWiseAttendanceMap[date].push(att);
    });

    // Convert to array format
    const dayWiseAttendance = Object.entries(dayWiseAttendanceMap).map(
      ([date, entries]) => ({
        date,
        entries,
      })
    );

    return sendResponse(
      res,
      200,
      "Day-wise attendance fetched successfully",
      dayWiseAttendance
    );
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

const getAllAttendenceDetailsByPmandByMonthOld = asyncHandler(
  async (req, res, next) => {
    try {
      const { pmId, startDate, endDate } = req.query;

      if (!startDate || !endDate || !pmId) {
        return sendError(next, "startDate, endDate and pmId are required", 400);
      }

      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999); // include entire end date

      const campaigns = await Campaign.find({
        programManager: { $in: [pmId] },
      }).select("_id");

      const campaignIds = campaigns.map((c) => c._id);

      if (!campaignIds.length) {
        return sendResponse(res, 200, "No campaigns found for this PM", []);
      }

      const assignedAgents = await AgentAssigned.find({
        campaign_id: { $in: campaignIds },
        isAssigned: true,
      }).select("agent_id");

      const agentIds = assignedAgents.map((a) => a.agent_id.toString());

      if (!agentIds.length) {
        return sendResponse(res, 200, "No assigned agents found", []);
      }

      const allAttendances = await AttendenceModel.find({
        createdAt: { $gte: start, $lte: end },
      })
        .sort({ createdAt: 1 })
        .populate("employeeId")
        .lean();

      const filteredForAgents = allAttendances.filter(
        (att) =>
          att.employeeId?.role === "agent" &&
          agentIds.includes(att.employeeId?._id?.toString())
      );

      const uniqueAttendanceMap = new Map();
      for (const att of filteredForAgents) {
        const empId = att.employeeId?._id?.toString();
        const dateKey = new Date(att.createdAt).toISOString().split("T")[0];
        const mapKey = `${empId}-${dateKey}`;

        if (!uniqueAttendanceMap.has(mapKey)) {
          uniqueAttendanceMap.set(mapKey, att); // only earliest record for the day
        }
      }

      const filteredAttendance = Array.from(uniqueAttendanceMap.values());
      const dayWiseMap = {};

      filteredAttendance.forEach((att) => {
        const createdAt = new Date(att.createdAt);
        const date = createdAt.toISOString().split("T")[0];

        // Reference time: 9:31 AM on that same date
        const threshold = new Date(date);
        threshold.setHours(9, 31, 0, 0);

        att.status = createdAt < threshold ? "Ontime" : "Late";

        if (!dayWiseMap[date]) dayWiseMap[date] = [];
        dayWiseMap[date].push(att);
      });

      const dayWiseAttendance = Object.entries(dayWiseMap).map(
        ([date, entries]) => ({
          date,
          entries,
        })
      );

      return sendResponse(
        res,
        200,
        "Day-wise attendance for agents under PM fetched successfully",
        dayWiseAttendance
      );
    } catch (err) {
      return sendError(next, err.message, 500);
    }
  }
);
const getAllAttendenceDetailsByPmandByMonth = asyncHandler(
  async (req, res, next) => {
    try {
      const { pmId, startDate, endDate } = req.query;

      if (!startDate || !endDate || !pmId) {
        return sendError(next, "startDate, endDate and pmId are required", 400);
      }

      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      // Get campaigns under this PM
      const campaigns = await Campaign.find({
        programManager: { $in: [pmId] },
      }).select("_id programManager");

      const campaignIds = campaigns.map((c) => c._id);
      if (!campaignIds.length) {
        return sendResponse(res, 200, "No campaigns found for this PM", []);
      }

      // Get assigned agents for these campaigns and PMs
      const assignedAgents = await AgentAssigned.find({
        campaign_id: { $in: campaignIds },
        isAssigned: true,
      })
        .select("agent_id campaign_id")
        .populate({
          path: "campaign_id",
          select: "programManager",
          populate: {
            path: "programManager",
            select: "employeeName employeeCode email",
          },
        });

      const agentIds = assignedAgents.map((a) => a.agent_id.toString());
      if (!agentIds.length) {
        return sendResponse(res, 200, "No assigned agents found", []);
      }

      // Map: Agent -> PM info
      const agentToPMMap = {};
      assignedAgents.forEach((a) => {
        agentToPMMap[a.agent_id] =
          a.campaign_id?.programManager?.map((pm) => ({
            pmName: pm.employeeName,
            pmCode: pm.employeeCode,
            pmEmail: pm.email,
          })) || [];
      });

      // Fetch attendance
      const allAttendances = await AttendenceModel.find({
        createdAt: { $gte: start, $lte: end },
      })
        .sort({ createdAt: 1 })
        .populate("employeeId")
        .lean();

      // Filter only attendance of agents under this PM
      const filteredForAgents = allAttendances.filter(
        (att) =>
          att.employeeId?.role === "agent" &&
          agentIds.includes(att.employeeId?._id?.toString())
      );

      // Keep 1st attendance record per day (earliest punch)
      const uniqueAttendanceMap = new Map();
      for (const att of filteredForAgents) {
        const empId = att.employeeId?._id?.toString();
        const createdAt = new Date(att.createdAt);

        // Convert created timestamp to IST calendar date
        const istDate = new Intl.DateTimeFormat("en-IN", {
          timeZone: "Asia/Kolkata",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })
          .format(createdAt)
          .split("/")
          .reverse()
          .join("-");

        const mapKey = `${empId}-${istDate}`;

        if (!uniqueAttendanceMap.has(mapKey)) {
          att._istDate = istDate;
          att.programManagers = agentToPMMap[empId] || [];
          uniqueAttendanceMap.set(mapKey, att);
        }
      }

      const filteredAttendance = Array.from(uniqueAttendanceMap.values());

      // Calculate on-time / late based on IST 9:31 AM
      const dayWiseMap = {};
      filteredAttendance.forEach((att) => {
        const createdAt = new Date(att.createdAt);
        const istDate = att._istDate;

        // IST threshold at 09:31 AM
        const threshold = new Date(`${istDate}T09:31:00+05:30`);

        att.status = createdAt < threshold ? "Ontime" : "Late";

        if (!dayWiseMap[istDate]) dayWiseMap[istDate] = [];
        dayWiseMap[istDate].push(att);
      });

      const dayWiseAttendance = Object.entries(dayWiseMap).map(
        ([date, entries]) => ({
          date,
          entries,
        })
      );

      return sendResponse(
        res,
        200,
        "Day-wise attendance for agents under PM fetched successfully",
        dayWiseAttendance
      );
    } catch (err) {
      return sendError(next, err.message, 500);
    }
  }
);

const getAllAttendenceDetails = asyncHandler(async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return sendError(next, "startDate and endDate are required", 400);
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // Step 1: Get all agent attendance
    const allAttendances = await AttendenceModel.find({
      createdAt: { $gte: start, $lte: end },
    })
      .sort({ createdAt: 1 })
      .populate("employeeId")
      .lean();

    const agentAttendances = allAttendances.filter(
      (att) => att.employeeId?.role === "agent"
    );

    // Step 2: Find PMs for each agent using AgentAssigned
    const agentIds = [
      ...new Set(
        agentAttendances.map((att) => att.employeeId?._id?.toString())
      ),
    ];

    const assignedAgents = await AgentAssigned.find({
      agent_id: { $in: agentIds },
      isAssigned: true,
    })
      .populate({
        path: "campaign_id",
        select: "programManager",
        populate: {
          path: "programManager",
          select: "employeeName employeeCode email",
        },
      })
      .lean();

    // Create mapping agent -> PM array
    const agentToPMMap = {};
    assignedAgents.forEach((a) => {
      const agent = a.agent_id.toString();
      const pms =
        a.campaign_id?.programManager?.map((pm) => ({
          pmName: pm.employeeName,
          pmCode: pm.employeeCode,
          pmEmail: pm.email,
        })) || [];

      if (!agentToPMMap[agent]) agentToPMMap[agent] = [];
      agentToPMMap[agent].push(...pms);
    });

    // Deduplicate PMs per agent
    Object.keys(agentToPMMap).forEach((agent) => {
      const seen = new Set();
      agentToPMMap[agent] = agentToPMMap[agent].filter((pm) => {
        const key = pm.pmCode;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });

    // Step 3: Keep first punch per day
    const uniqueAttendanceMap = new Map();
    for (const attendance of agentAttendances) {
      const empId = attendance.employeeId?._id?.toString();
      const dateKey = new Date(attendance.createdAt)
        .toISOString()
        .split("T")[0];
      const mapKey = `${empId}-${dateKey}`;

      if (!uniqueAttendanceMap.has(mapKey)) {
        attendance.programManagers = agentToPMMap[empId] || [];
        uniqueAttendanceMap.set(mapKey, attendance);
      }
    }

    const filteredAttendance = Array.from(uniqueAttendanceMap.values());

    // Step 4: Mark On-time / Late based on 9:31 IST
    filteredAttendance.forEach((att) => {
      const createdAt = new Date(att.createdAt);

      const istDate = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .format(createdAt)
        .split("/")
        .reverse()
        .join("-");

      const threshold = new Date(`${istDate}T09:31:00+05:30`);
      att.status = createdAt < threshold ? "Ontime" : "Late";
      att._istDate = istDate;
    });

    // Step 5: Day-wise grouping
    const dayWiseAttendanceMap = {};
    filteredAttendance.forEach((att) => {
      const date = att._istDate;
      if (!dayWiseAttendanceMap[date]) dayWiseAttendanceMap[date] = [];
      dayWiseAttendanceMap[date].push(att);
    });

    const dayWiseAttendance = Object.entries(dayWiseAttendanceMap).map(
      ([date, entries]) => ({
        date,
        entries,
      })
    );

    return sendResponse(
      res,
      200,
      "Day-wise attendance fetched successfully",
      dayWiseAttendance
    );
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

export { getAllAttendenceDetails, getAllAttendenceDetailsByPmandByMonth };
