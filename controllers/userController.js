import User from "../models/userModel.js";
import errorHandler from "../utils/index.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;
/**
 * @desc    Register a new user
 * @route   POST /api/users
 * @access  Public
 */
const registerUser = asyncHandler(async (req, res, next) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    // Check if user exists
    const userExists = await User.findOne({ email: email.toLowerCase() });
    if (userExists) {
      return sendError(next, "User already exists", 400);
    }
    // Create user
    const user = await User.create({
      firstName,
      lastName,
      email: email.toLowerCase(),
      password,
    });
    if (user) {
      return sendResponse(res, 200, "User Created.", user._id);
    }
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
  const { email, password } = req.body;
  // Validate email & password
  if (!email || !password) {
    return sendError(next, "Please provide an email and password", 400);
  }
  // Check for user
  const userData = await User.findOne({ email: email.toLowerCase() });
  if (!userData) {
    return sendError(next, "Invalid credentials", 400);
  }
  // Check if password matches
  const isMatch = await userData.matchPassword(password);
  if (!isMatch) {
    return sendError(next, "Invalid credentials", 400);
  }
  const token = userData.getSignedJwtToken();
  res.cookie("token", token, {
    httpOnly: true, // Prevents JavaScript access
    secure: true, // Ensures cookie is sent over HTTPS
    sameSite: "Strict", // Prevents CSRF attacks
    expires: new Date(Date.now() + 3600000), // Cookie expiration (1 hour)
    path: "/", // Path where the cookie is valid
  });
  const data = {
    _id: userData._id,
    firstName: userData.firstName,
    lastName: userData?.lastName,
    token,
    role: userData.role,
  };
  return sendResponse(res, 200, "Login successfully.", data);
});

/**
 * @desc    Get user profile
 * @route   GET /api/users/profile
 * @access  Private
 */
const getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    setTimeout(() => {
      console.log("User data fetched successfully");
      return sendResponse(res, 200, "User data.", user);
    }, 2000); // Simulate a delay of 2 seconds
  } else {
    throw createError("User not found", 404);
  }
});

/**
 * @desc    Update user profile
 * @route   PUT /api/users/profile
 * @access  Private
 */
const updateUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    throw createError("User not found", 404);
  }

  user.firstName = req.body.firstName || user.firstName;
  user.email = req.body.email || user.email;
  user.linkedinData = req.body.linkedinData || user.linkedinData;
  user.lastName = req.body.lastName || user.lastName;

  if (req.body.password) {
    user.password = req.body.password;
  }

  const updatedUser = await user.save();

  return res.status(200).json({
    success: true,
    data: {
      _id: updatedUser._id,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      email: updatedUser.email,
      role: updatedUser.role,
      token: updatedUser.getSignedJwtToken(),
    },
  });
});

const logout = asyncHandler(async (req, res, next) => {
  try {
    res.cookie("token", "", {
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      expires: new Date(0),
      path: "/",
    });
    const error = new Error("first case");
    error.data = { logOut: true };
    error.statusCode = 400;
    return next(error);
  } catch (error) {
    next(error);
  }
});

export { registerUser, loginUser, updateUserProfile, getUserProfile, logout };
