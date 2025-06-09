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
import {UserRoleEnum}  from '../utils/enum.js';

const {ADMIN, PROGRAM_MANAGER, RESOURCE_MANAGER, AGENT, DATABASE_MANAGER} = UserRoleEnum;
const router = Router();
router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/user", protect,authorize(ADMIN,PROGRAM_MANAGER), getUserProfile);
router.put("/user", protect, authorize(ADMIN,PROGRAM_MANAGER), updateUserProfile);
router.post("/logout", logout);
// Admin only routes
// router.get("/", protect, authorize("admin"), getUsers);
export default router;
