import User from "../models/userModel.js";
import Campaign from "../models/campaignModel.js";
import errorHandler from "../utils/index.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;
import { UserRoleEnum } from "../utils/enum.js";

const { ADMIN, PROGRAM_MANAGER, RESOURCE_MANAGER, AGENT, DATABASE_MANAGER } =
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
      role,
      code,
      employeeBase,
      programName,
      programType,
      signature,
      programManager,
      location,
      status,
      doj,
      pan,
      ctc,
      telecmiId,
    } = req.body;

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
      employeeBase,
      programName,
      programType,
      signature,
      programManager,
      location,
      status: status || "active",
      doj,
      pan,
      ctc,
      telecmiId,
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
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      token,
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
      "type",
      "code",
      "employeeBase",
      "programName",
      "programType",
      "signature",
      "programManager",
      "location",
      "status",
      "pan",
      "telecmiId",
    ];

    // console.log("User role:", req.user.role);
    if (req.user.role === ADMIN || req.user.role === RESOURCE_MANAGER) {
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

    return sendResponse(res, 200, "Profile updated successfully", {
      _id: updatedUser._id,
      employeeName: updatedUser.employeeName,
      email: updatedUser.email,
      role: updatedUser.role,
      status: updatedUser.status,
    });
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
    const users = await User.find({}).select("-password");

    return sendResponse(res, 200, "Users retrieved successfully", users);
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
    const users = await User.find({ role: { $in: roles } })
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
    res.cookie("token", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      expires: new Date(0),
      path: "/",
    });

    return sendError(next, "Logout SuccessFully", 500, { logOut: true });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

export {
  registerUser,
  loginUser,
  updateUserProfile,
  getUserProfile,
  getUsersByRole,
  deleteUser,
  logout,
  getAllUsers,
};
