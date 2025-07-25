import AttendenceModel from "../models/attendenceModel.js";
import Campaign from "../models/campaignModel.js";
import AgentAssigned from "../models/agentAssigned.js";
import errorHandler from "../utils/index.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;

const getAllAttendenceDetails = asyncHandler(async (req, res, next) => {
  try {
    const { month } = req.query;

    if (!month) {
      return sendError(next, "Month is required", 400);
    }

    const [monthName, yearStr] = month.split(" ");
    const year = parseInt(yearStr, 10);
    const monthIndex = new Date(`${monthName} 1, ${year}`).getMonth();

    const startDate = new Date(year, monthIndex, 1);
    const endDate = new Date(year, monthIndex + 1, 1);

    const allAttendances = await AttendenceModel.find({
      createdAt: { $gte: startDate, $lt: endDate },
    })
      .sort({ createdAt: 1 })
      .populate("employeeId")
      .lean();

    const agentAttendances = allAttendances.filter(
      (att) => att.employeeId?.role === "agent"
    );

    console.log(allAttendances, "allAttendances");

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

// const getAllAttendenceDetailsByPmandByMonth = asyncHandler(
//   async (req, res, next) => {
//     try {
//       const { pmId, month } = req.query;
//       console.log(pmId, month, "pmId and month");
//       const attendenceDetails = await AttendenceModel.find().populate(
//         "employeeId"
//       );

//       return sendResponse(
//         res,
//         200,
//         "All call histories fetched successfully",
//         attendenceDetails
//       );
//     } catch (err) {
//       return sendError(next, err.message, 500);
//     }
//   }
// );

const getAllAttendenceDetailsByPmandByMonthold = asyncHandler(
  async (req, res, next) => {
    try {
      const { pmId } = req.query;
      const { month } = req.query;

      if (!month || !pmId) {
        return sendError(next, "Month and pmId are required", 400);
      }

      const campaigns = await Campaign.find({
        programManager: { $in: [pmId] },
      }).select("_id");

      console.log(campaigns, "campaigns under PM");
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

      const [monthName, yearStr] = month.split(" ");
      const year = parseInt(yearStr, 10);
      const monthIndex = new Date(`${monthName} 1, ${year}`).getMonth();
      const startDate = new Date(year, monthIndex, 1);
      const endDate = new Date(year, monthIndex + 1, 1);

      const allAttendances = await AttendenceModel.find({
        createdAt: { $gte: startDate, $lt: endDate },
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
          uniqueAttendanceMap.set(mapKey, att);
        }
      }

      const filteredAttendance = Array.from(uniqueAttendanceMap.values());
      const dayWiseMap = {};

      filteredAttendance.forEach((att) => {
        const date = new Date(att.createdAt).toISOString().split("T")[0];
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
        const date = new Date(att.createdAt).toISOString().split("T")[0];
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

export { getAllAttendenceDetails, getAllAttendenceDetailsByPmandByMonth };
