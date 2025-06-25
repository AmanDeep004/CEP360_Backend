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
    }).select("_id employeeName email employeeCode");

    return sendResponse(res, 200, "Agents fetched successfully", agents);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});
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

export {
  assignAgentsToCampaign,
  getAllocAndUnalloclist,
  releaseAgents,
  getAllNonAssignedAgents,
  getAllAssignedAgents,
};
