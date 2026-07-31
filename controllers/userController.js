import User from "../models/userModel.js";
import Campaign from "../models/campaignModel.js";
import Attendence from "../models/attendenceModel.js";
import errorHandler from "../utils/index.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;
import { UserRoleEnum, ProgramType } from "../utils/enum.js";
import XLSX from "xlsx";

const { SUPERADMIN, ADMIN, PROGRAM_MANAGER, RESOURCE_MANAGER, AGENT, DATABASE_MANAGER } =
  UserRoleEnum;

/**
 * @desc    Register a new user
 * @route   POST /api/users/register
 * @access  Public
 */
const registerUser = asyncHandler(async (req, res, next) => {
  try {
    const {
      employeeName,
      type,
      employeeCode,
      email,
      password,
      mobile,
      role,
      code,
      employeeBase,
      programName,
      programType,
      signature,
      programManager,
      associatedProgramManager,
      location,
      status,
      doj,
      pan,
      ctc,
      telecmiId,
      tataSmartFlowId,
      tataSmartFlowPassword,
      tataDIDNo,
      tataTeleLoginId,
    } = req.body;

    // Role assignment restrictions
    const requestingRole = req.user?.role;
    const privilegedRoles = [SUPERADMIN, ADMIN];
    if (role && privilegedRoles.includes(role) && requestingRole !== SUPERADMIN) {
      return sendError(next, `You are not authorized to create a user with role '${role}'`, 403);
    }

    // Check if user exists
    const userExists = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { employeeCode }],
    });

    if (userExists) {
      return sendError(
        next,
        "User already exists with this email or employee code",
        400
      );
    }

    // Create user
    const user = await User.create({
      employeeName,
      type,
      employeeCode,
      email: email.toLowerCase(),
      password,
      role: role || "agent",
      code,
      mobile,
      employeeBase,
      programName,
      programType,
      signature,
      programManager,
      associatedProgramManager: associatedProgramManager || undefined,
      location,
      status: status || "active",
      doj,
      pan,
      ctc,
      telecmiId,
      tataSmartFlowId,
      tataSmartFlowPassword,
      tataDIDNo,
      tataTeleLoginId,
    });

    return sendResponse(res, 200, "User Created Successfully", {
      _id: user._id,
      employeeName: user.employeeName,
      email: user.email,
      employeeCode: user.employeeCode,
      role: user.role,
      status: user.status,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const resetUserPassword = asyncHandler(async (req, res, next) => {
  try {
    const { userId, newPassword } = req.body;

    if (!userId || !newPassword) {
      return sendError(next, "User ID and new password are required", 400);
    }

    const user = await User.findById(userId);
    if (!user) {
      return sendError(next, "User not found", 404);
    }

    // const salt = await bcrypt.genSalt(10);
    // const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = newPassword;
    await user.save();

    return sendResponse(res, 200, "Password reset successfully", {
      userId: user._id,
      employeeName: user.employeeName,
      email: user.email,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});
/**
 * @desc    Authenticate a user
 * @route   POST /api/users/login
 * @access  Public
 */
const loginUser = asyncHandler(async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return sendError(next, "Please provide email and password", 400);
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+password"
    );

    if (!user) {
      return sendError(next, "Invalid credentials", 401);
    }

    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return sendError(next, "Invalid credentials", 401);
    }
    await Attendence.create({ employeeId: user._id });
    // Update last login
    // await user.updateLastLogin();

    const token = user.getSignedJwtToken();

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      path: "/",
    });

    return sendResponse(res, 200, "Login successful", {
      _id: user._id,
      employeeName: user.employeeName,
      employeeCode: user.employeeCode,
      email: user.email,
      role: user.role,
      status: user.status,
      // token,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Get user profile
 * @route   GET /api/users/profile
 * @access  Private
 */
const getUserProfile = asyncHandler(async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return sendError(next, "User not found", 404);
    }

    return sendResponse(res, 200, "User profile retrieved successfully", user);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Update user profile
 * @route   PUT /api/users/profile
 * @access  Private
 */
const updateUserProfile = asyncHandler(async (req, res, next) => {
  try {
    const user = await User.findById(req.body._id);

    if (!user) {
      return sendError(next, "User not found", 404);
    }

    const updateFields = [
      "employeeName",
      "email",
      "type",
      "code",
      "role",
      "employeeBase",
      "programName",
      "programType",
      "signature",
      "programManager",
      "associatedProgramManager",
      "location",
      "status",
      "pan",
      "telecmiId",
      "mobile",
      "tataSmartFlowId",
      "tataSmartFlowPassword",
      "tataDIDNo",
      "tataTeleLoginId",
    ];

    if (req.user.role === SUPERADMIN || req.user.role === ADMIN || req.user.role === RESOURCE_MANAGER) {
      updateFields.push("ctc");
    }

    updateFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        user[field] = req.body[field];
      }
    });

    if (req.body.password) {
      user.password = req.body.password;
    }

    const updatedUser = await user.save();

    const { password, tokenVersion, __v, ...safeUser } = updatedUser.toObject();
    return sendResponse(res, 200, "Profile updated successfully", safeUser);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Get all users
 * @route   GET /api/users
 * @access  Private/Admin
 */
const getAllUsers = asyncHandler(async (req, res, next) => {
  try {
    const page = parseInt(req.query.page);
    const limit = Math.min(parseInt(req.query.limit) || 20, 200);
    const search = req.query.search?.trim();

    const filter = { role: { $nin: ["admin", "superadmin"] } };
    if (search) {
      const regex = new RegExp(search, "i");
      filter.$or = [
        { employeeName: regex },
        { email: regex },
        { employeeCode: regex },
      ];
    }

    // No page param → flat array (backward compat)
    if (!page) {
      const users = await User.find(filter)
        .select("-password")
        .populate("associatedProgramManager", "employeeName email employeeCode _id")
        .sort({ createdAt: -1 });
      return sendResponse(res, 200, "Users retrieved successfully", users);
    }

    const skip = (page - 1) * limit;
    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select("-password")
        .populate("associatedProgramManager", "employeeName email employeeCode _id")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
    ]);

    return sendResponse(res, 200, "Users retrieved successfully", {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: users,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Get user by roles specially program manager & agent
 */

// here
const getUsersByRole = asyncHandler(async (req, res, next) => {
  try {
    const roles = req.query.roles?.split(",") || [];

    if (roles.length === 0) {
      return sendError(next, "Please specify roles to filter", 400);
    }

    const validRoles = roles.every(
      (role) => UserRoleEnum.ALL.includes(role) && role !== ADMIN
    );
    if (!validRoles) {
      return sendError(next, "Invalid role specified", 400);
    }

    if (roles.length == 1 && roles[0] === AGENT) {
      const campaigns = await Campaign.find({
        programManager: { $ne: req.user._id },
      }).select("resourcesAssigned");

      const assignedAgentIds = campaigns
        .map((c) => c.resourcesAssigned)
        .flat()
        .map((id) => id.toString());

      const agents = await User.find({
        role: AGENT,
        _id: { $nin: assignedAgentIds },
      }).select(
        "employeeName email role employeeCode programName location status _id"
      );

      return sendResponse(
        res,
        200,
        "Agents not assigned to any campaign (except your own) retrieved successfully",
        agents
      );
    }

    // Default: get users by roles (excluding admin)
    const filter = { role: { $in: roles } };
    if (req.query.status) filter.status = req.query.status;

    const users = await User.find(filter)
      .select(
        "employeeName email role employeeCode programName location status _id"
      )
      .lean();

    return sendResponse(res, 200, "Users retrieved successfully", users);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Delete user
 * @route   DELETE /api/users/:id
 * @access  Private/Admin
 */
const deleteUser = asyncHandler(async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return sendError(next, "User not found", 404);
    }

    // Prevent admin from deleting themselves
    if (user._id.toString() === req.user._id.toString()) {
      return sendError(next, "Cannot delete your own account", 400);
    }

    await user.deleteOne();

    return sendResponse(res, 200, "User deleted successfully", null);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Logout user
 * @route   POST /api/users/logout
 * @access  Private
 */
const logout = asyncHandler(async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { $inc: { tokenVersion: 1 } });

    res.cookie("token", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      expires: new Date(0),
      path: "/",
    });

    return sendResponse(res, 200, "Logout Successfully", { logOut: true });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const VALID_TYPES = ["KSTN", "KI", "TEMP", "CEP"];
const VALID_STATUSES = ["active", "inactive", "pending"];

const COLUMN_MAP = {
  "employee name": "employeeName",
  "employee code": "employeeCode",
  "email": "email",
  "password": "password",
  "type": "type",
  "employee base": "employeeBase",
  "location": "location",
  "date of joining": "doj",
  "mobile": "mobile",
  "pan": "pan",
  "ctc": "ctc",
  "telecmi id": "telecmiId",
  "program name": "programName",
  "program type": "programType",
  "program manager": "programManager",
  "status": "status",
};

const normalizeHeader = (h) =>
  String(h || "").replace(/\*/g, "").trim().toLowerCase();

const bulkCreateAgents = asyncHandler(async (req, res, next) => {
  try {
    if (!req.file) return sendError(next, "No file uploaded", 400);

    const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    if (rows.length < 2) return sendError(next, "File is empty or has no data rows", 400);

    // Build header map from row 0
    const headers = rows[0].map(normalizeHeader);
    const dataRows = rows.slice(1).filter((r) => r.some((c) => String(c).trim() !== ""));

    if (dataRows.length === 0) return sendError(next, "No data rows found in file", 400);

    const created = [];
    const failed = [];

    for (let i = 0; i < dataRows.length; i++) {
      const raw = {};
      headers.forEach((h, idx) => {
        const key = COLUMN_MAP[h];
        if (key) raw[key] = String(dataRows[i][idx] ?? "").trim();
      });

      const rowNum = i + 2; // Excel row number (1-indexed + header)

      // Validate mandatory fields
      const missing = [];
      if (!raw.employeeName) missing.push("Employee Name");
      if (!raw.employeeCode) missing.push("Employee Code");
      if (!raw.email) missing.push("Email");
      if (!raw.password || raw.password.length < 6) missing.push("Password (min 6 chars)");
      if (!raw.type || !VALID_TYPES.includes(raw.type.toUpperCase()))
        missing.push(`Type (must be one of: ${VALID_TYPES.join(", ")})`);
      if (!raw.employeeBase) missing.push("Employee Base");
      if (!raw.location) missing.push("Location");
      if (!raw.doj) missing.push("Date of Joining");

      if (missing.length > 0) {
        failed.push({ row: rowNum, employeeCode: raw.employeeCode || "-", email: raw.email || "-", reason: `Missing/invalid: ${missing.join(", ")}` });
        continue;
      }

      // Check duplicate email/code
      const exists = await User.findOne({
        $or: [{ email: raw.email.toLowerCase() }, { employeeCode: raw.employeeCode }],
      });
      if (exists) {
        failed.push({ row: rowNum, employeeCode: raw.employeeCode, email: raw.email, reason: "Email or Employee Code already exists" });
        continue;
      }

      try {
        const user = await User.create({
          employeeName: raw.employeeName,
          employeeCode: raw.employeeCode,
          email: raw.email.toLowerCase(),
          password: raw.password,
          role: "agent", // always forced
          type: raw.type.toUpperCase(),
          employeeBase: raw.employeeBase,
          location: raw.location,
          doj: new Date(raw.doj),
          mobile: raw.mobile ? Number(raw.mobile) : undefined,
          pan: raw.pan || undefined,
          ctc: raw.ctc ? Number(raw.ctc) : undefined,
          telecmiId: raw.telecmiId || undefined,
          programName: raw.programName || undefined,
          programType: raw.programType || undefined,
          programManager: raw.programManager || undefined,
          status: raw.status && VALID_STATUSES.includes(raw.status.toLowerCase())
            ? raw.status.toLowerCase()
            : "active",
        });
        created.push({ row: rowNum, employeeCode: user.employeeCode, name: user.employeeName, email: user.email });
      } catch (err) {
        failed.push({ row: rowNum, employeeCode: raw.employeeCode, email: raw.email, reason: err.message });
      }
    }

    return sendResponse(res, 200, "Bulk agent creation complete", {
      total: dataRows.length,
      created: created.length,
      failed: failed.length,
      createdList: created,
      failedList: failed,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const changeOwnPassword = asyncHandler(async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return sendError(next, "Current password and new password are required", 400);
    }

    if (newPassword.length < 6) {
      return sendError(next, "New password must be at least 6 characters", 400);
    }

    const user = await User.findById(req.user._id).select("+password");
    if (!user) {
      return sendError(next, "User not found", 404);
    }

    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return sendError(next, "Current password is incorrect", 401);
    }

    user.password = newPassword;
    await user.save();

    return sendResponse(res, 200, "Password changed successfully", null);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Get all program managers for dropdown
 * @route   GET /api/users/program-managers
 * @access  Private
 */
const getProgramManagers = asyncHandler(async (req, res, next) => {
  try {
    const managers = await User.find({ role: UserRoleEnum.PROGRAM_MANAGER })
      .select("employeeName email employeeCode _id")
      .sort({ employeeName: 1 })
      .lean();
    return sendResponse(res, 200, "Program managers retrieved successfully", managers);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

export {
  resetUserPassword,
  registerUser,
  loginUser,
  updateUserProfile,
  getUserProfile,
  getUsersByRole,
  deleteUser,
  bulkCreateAgents,
  logout,
  getAllUsers,
  changeOwnPassword,
  getProgramManagers,
};
