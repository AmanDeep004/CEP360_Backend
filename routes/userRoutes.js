import { Router } from "express";
import {
  registerUser,
  loginUser,
  updateUserProfile,
  getUserProfile,
  logout,
  // getUsers,
} from "../controllers/userController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
const router = Router();
router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/user", protect, getUserProfile);
router.put("/user", protect, updateUserProfile);
router.post("/logout", logout);
// Admin only routes
// router.get("/", protect, authorize("admin"), getUsers);
export default router;
