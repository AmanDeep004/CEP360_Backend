import AgentAssigned from "../models/agentAssigned.js";
import errorHandler from "../utils/index.js";
import User from "../models/userModel.js";

import { UserRoleEnum } from "../utils/enum.js";

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

    // const campaignExists = await Campaign.exists({ _id: campaignId });
    // if (!campaignExists) {
    //   return sendError(next, "Campaign not found", 404);
    // }

    const existingAssignments = await AgentAssigned.find({
      campaign_id: campaignId,
      agent_id: { $in: agentIds },
      isAssigned: true,
    }).select("agent_id");

    const alreadyAssignedIds = new Set(
      existingAssignments.map((doc) => doc.agent_id.toString())
    );

    // Prepare new assignments (skip duplicates)
    const newAssignments = agentIds
      .filter((id) => !alreadyAssignedIds.has(id))
      .map((id) => ({
        agent_id: id,
        campaign_id: campaignId,
        isAssigned: true,
        assigned_date: new Date(),
      }));

    if (newAssignments.length > 0) {
      await AgentAssigned.insertMany(newAssignments);
    }

    return sendResponse(res, 200, "Agents assigned successfully", {
      assigned: newAssignments.length,
      skipped: alreadyAssignedIds.size,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const getAllAgentsByCampaignId = asyncHandler(async (req, res, next) => {
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

const releaseMultipleAgents = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId, agentIds } = req.body;

    if (!campaignId || !Array.isArray(agentIds) || agentIds.length === 0) {
      return sendError(
        next,
        "campaignId and agentIds (array) are required",
        400
      );
    }

    const result = await AgentAssigned.updateMany(
      {
        campaign_id: campaignId,
        agent_id: { $in: agentIds },
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

const getAllAgents = asyncHandler(async (req, res, next) => {
  try {
    const agents = await User.find({ role: UserRoleEnum.AGENT }).select(
      "_id employeeName email employeeCode"
    );

    return sendResponse(res, 200, "Agents fetched successfully", agents);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

export {
  assignAgentsToCampaign,
  getAllAgentsByCampaignId,
  releaseMultipleAgents,
  getAllAgents,
};
