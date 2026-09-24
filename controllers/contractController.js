import mongoose from "mongoose";
import User from "../models/userModel.js";
import ContractHistory from "../models/contractHistoryModel.js";
import { calcContractEndDate, CONTRACT_DURATION_MAP } from "../models/userModel.js";
import { UserRoleEnum } from "../utils/enum.js";
import { getPrimaryConnection } from "../config/db.js";

const { PROGRAM_MANAGER } = UserRoleEnum;

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Write a ContractHistory record inside an optional Mongoose session.
 */
const writeHistory = (agent, action, opts = {}, session = null) => {
  const doc = {
    agent:       agent._id,
    agentName:   agent.employeeName,
    agentCode:   agent.employeeCode,
    performedBy: opts.performedBy,
    action,
    duration:    opts.duration,
    startDate:   opts.startDate,
    endDate:     opts.endDate,
    note:        opts.note,
  };
  return session
    ? ContractHistory.create([doc], { session })
    : ContractHistory.create(doc);
};

/**
 * Run fn(session) inside a MongoDB transaction.
 * Falls back to running fn(null) if the replica-set feature is unavailable
 * (e.g., standalone dev MongoDB).
 */
const withTransaction = async (fn) => {
  const conn = getPrimaryConnection();
  let session;
  try {
    session = await conn.startSession();
    session.startTransaction();
    const result = await fn(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    if (session) await session.abortTransaction().catch(() => {});
    // If error is "Transaction numbers are only allowed on a replica set member…"
    // fall back to non-transactional execution
    if (err.codeName === "IllegalOperation" || err.code === 20) {
      return fn(null);
    }
    throw err;
  } finally {
    if (session) session.endSession();
  }
};

/**
 * Assert a PM owns the agent they're acting on.
 */
const assertPMOwnership = (req, agent) => {
  if (req.user.role !== PROGRAM_MANAGER) return; // RM / Admin / Superadmin: no restriction
  const pmId = agent.associatedProgramManager?.toString();
  if (pmId !== req.user._id.toString()) {
    const err = new Error("Forbidden: this agent is not under your management");
    err.status = 403;
    throw err;
  }
};

// ─── GET /api/contract/expiring ─────────────────────────────────────────────
// PM: agents expiring within 7 days under their management
export const getExpiringContracts = async (req, res) => {
  try {
    // Use start-of-today (midnight local) as lower bound so agents whose
    // contractEndDate is midnight today are not missed when current time > midnight.
    const now          = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekFromNow  = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);

    const agents = await User.find({
      associatedProgramManager: req.user._id,
      role:           UserRoleEnum.AGENT,
      contractStatus: "active",
      contractEndDate: { $gte: startOfToday, $lte: weekFromNow },
    }).select("employeeName employeeCode contractDuration contractStartDate contractEndDate contractStatus doj");

    res.json({ success: true, data: agents });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/contract ───────────────────────────────────────────────────────
// PM: their agents. RM/Admin: all agents. Filterable + paginated.
export const getAllContracts = async (req, res) => {
  try {
    const { status, search, page, limit: rawLimit = 100 } = req.query;
    const limit = Math.min(parseInt(rawLimit) || 100, 500);

    const query = { role: UserRoleEnum.AGENT };
    if (req.user.role === PROGRAM_MANAGER) {
      query.associatedProgramManager = req.user._id;
    }
    if (status && status !== "all") {
      if (status === "expiring") {
        const now          = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        query.contractStatus  = "active";
        query.contractEndDate = { $gte: startOfToday, $lte: new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000) };
      } else if (status === "expired") {
        query.$or = [
          { contractStatus: "expired" },
          { contractStatus: "active", contractEndDate: { $lt: new Date() } },
        ];
      } else {
        query.contractStatus = status; // "active" | "rejected"
      }
    }
    if (search?.trim()) {
      const regex = new RegExp(search.trim(), "i");
      const nameCodeFilter = [{ employeeName: regex }, { employeeCode: regex }];
      // Avoid overwriting $or already set by the "expired" status filter
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: nameCodeFilter }];
        delete query.$or;
      } else {
        query.$or = nameCodeFilter;
      }
    }

    if (page) {
      const skip = (parseInt(page) - 1) * limit;
      const [total, agents] = await Promise.all([
        User.countDocuments(query),
        User.find(query)
          .select("employeeName employeeCode contractDuration contractStartDate contractEndDate contractStatus doj associatedProgramManager")
          .populate("associatedProgramManager", "employeeName")
          .sort({ contractEndDate: 1 })
          .skip(skip)
          .limit(limit),
      ]);
      return res.json({ success: true, total, page: parseInt(page), data: agents });
    }

    // No page param — flat list (existing frontend compatibility)
    const agents = await User.find(query)
      .select("employeeName employeeCode contractDuration contractStartDate contractEndDate contractStatus doj associatedProgramManager")
      .populate("associatedProgramManager", "employeeName")
      .sort({ contractEndDate: 1 });

    res.json({ success: true, data: agents });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/contract/:agentId/history ─────────────────────────────────────
export const getAgentContractHistory = async (req, res) => {
  try {
    const history = await ContractHistory.find({ agent: req.params.agentId })
      .populate("performedBy", "employeeName employeeCode role")
      .sort({ createdAt: -1 });

    res.json({ success: true, data: history });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/contract/history ───────────────────────────────────────────────
// Global history — RM/Admin only. Filterable by action, agentId, date range.
export const getGlobalContractHistory = async (req, res) => {
  try {
    const { action, agent, from, to, page = 1, limit: rawLimit = 50 } = req.query;
    const limit = Math.min(parseInt(rawLimit) || 50, 200); // hard cap at 200

    const filter = {};
    if (action) filter.action = action;
    if (agent)  filter.agent  = agent;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to)   filter.createdAt.$lte = new Date(to);
    }

    const skip = (parseInt(page) - 1) * limit;
    const [total, records] = await Promise.all([
      ContractHistory.countDocuments(filter),
      ContractHistory.find(filter)
        .populate("agent",       "employeeName employeeCode")
        .populate("performedBy", "employeeName employeeCode role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
    ]);

    res.json({ success: true, total, page: parseInt(page), data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PUT /api/contract/:agentId/renew ───────────────────────────────────────
export const renewContract = async (req, res) => {
  try {
    const { duration, endDate } = req.body;

    if (!duration && !endDate) {
      return res.status(400).json({ success: false, message: "Provide either duration or endDate" });
    }
    if (duration && !CONTRACT_DURATION_MAP[duration]) {
      return res.status(400).json({ success: false, message: "Invalid duration" });
    }

    const agent = await User.findById(req.params.agentId);
    if (!agent) return res.status(404).json({ success: false, message: "Agent not found" });

    // PM can only renew their own agents
    assertPMOwnership(req, agent);

    // Start from existing expiry; fall back to today if already expired
    const now      = new Date();
    const newStart = agent.contractEndDate && agent.contractEndDate > now
      ? new Date(agent.contractEndDate)
      : now;

    let newEndDate;
    if (endDate) {
      newEndDate = new Date(endDate);
      if (isNaN(newEndDate.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid endDate" });
      }
    } else {
      newEndDate = calcContractEndDate(newStart, duration);
    }

    // Fix 3: Transaction — save agent + write history atomically
    await withTransaction(async (session) => {
      agent.contractDuration  = duration || "custom";
      agent.contractStartDate = newStart;
      agent.contractEndDate   = newEndDate;
      agent.contractStatus    = "active";
      agent.contractLastAction = {
        action:    "renewed",
        updatedAt: new Date(),
        updatedBy: req.user._id,
        tenure:    duration || "custom",
        startDate: newStart,
        endDate:   newEndDate,
      };
      await agent.save(session ? { session, validateModifiedOnly: true } : { validateModifiedOnly: true });

      await writeHistory(agent, "renewed", {
        duration:    duration || "custom",
        startDate:   newStart,
        endDate:     newEndDate,
        performedBy: req.user._id,
      }, session);
    });

    res.json({ success: true, message: "Contract renewed successfully", data: agent });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// ─── PUT /api/contract/:agentId/end ─────────────────────────────────────────
export const endContract = async (req, res) => {
  try {
    const agent = await User.findById(req.params.agentId);
    if (!agent) return res.status(404).json({ success: false, message: "Agent not found" });

    assertPMOwnership(req, agent);

    const endDate = req.body.endDate ? new Date(req.body.endDate) : new Date();
    if (isNaN(endDate.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid endDate" });
    }

    // Fix 8: use contractStartDate as the history startDate — not the old endDate
    const historyStart = agent.contractStartDate || agent.doj || agent.createdAt;
    const prevEndDate  = agent.contractEndDate;

    await withTransaction(async (session) => {
      agent.contractEndDate = endDate;
      agent.contractStatus  = "expired";
      agent.contractLastAction = {
        action:    "ended",
        updatedAt: new Date(),
        updatedBy: req.user._id,
        tenure:    agent.contractDuration,
        startDate: historyStart,
        endDate,
      };
      await agent.save(session ? { session, validateModifiedOnly: true } : { validateModifiedOnly: true });

      await writeHistory(agent, "ended", {
        duration:    agent.contractDuration,
        startDate:   historyStart,
        endDate,
        performedBy: req.user._id,
      }, session);
    });

    res.json({ success: true, message: "Contract ended", data: agent });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// ─── PUT /api/contract/:agentId/reject ──────────────────────────────────────
export const rejectContract = async (req, res) => {
  try {
    const agent = await User.findById(req.params.agentId);
    if (!agent) return res.status(404).json({ success: false, message: "Agent not found" });

    assertPMOwnership(req, agent);

    const historyStart = agent.contractStartDate || agent.doj || agent.createdAt;

    await withTransaction(async (session) => {
      agent.contractStatus = "rejected";
      agent.contractLastAction = {
        action:    "rejected",
        updatedAt: new Date(),
        updatedBy: req.user._id,
        tenure:    agent.contractDuration,
        startDate: historyStart,
        endDate:   agent.contractEndDate,
      };
      await agent.save(session ? { session, validateModifiedOnly: true } : { validateModifiedOnly: true });

      await writeHistory(agent, "rejected", {
        duration:    agent.contractDuration,
        startDate:   historyStart,
        endDate:     agent.contractEndDate,
        performedBy: req.user._id,
      }, session);
    });

    res.json({ success: true, message: "Contract rejected" });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// ─── Auto-expiry (called by daily cron) ─────────────────────────────────────
export const autoExpireContracts = async () => {
  const now = new Date();
  const agents = await User.find({
    role:           UserRoleEnum.AGENT,
    contractStatus: "active",
    contractEndDate: { $lt: now },
  }).select("_id employeeName employeeCode contractDuration contractStartDate contractEndDate doj createdAt");

  if (agents.length === 0) return { expired: 0 };

  const historyDocs = agents.map((a) => ({
    agent:     a._id,
    agentName: a.employeeName,
    agentCode: a.employeeCode,
    action:    "auto_expired",
    duration:  a.contractDuration,
    startDate: a.contractStartDate || a.doj || a.createdAt,
    endDate:   a.contractEndDate,
  }));

  const expireNow = new Date();
  const userBulk = agents.map((a) => ({
    updateOne: {
      filter: { _id: a._id },
      update: {
        $set: {
          contractStatus: "expired",
          contractLastAction: {
            action:    "auto_expired",
            updatedAt: expireNow,
            updatedBy: null,
            tenure:    a.contractDuration,
            startDate: a.contractStartDate || a.doj || a.createdAt,
            endDate:   a.contractEndDate,
          },
        },
      },
    },
  }));
  await Promise.all([
    User.bulkWrite(userBulk),
    ContractHistory.insertMany(historyDocs),
  ]);

  console.log(`[CONTRACT-CRON] Auto-expired ${agents.length} agent contract(s)`);
  return { expired: agents.length };
};
