import { Router } from "express";
import {
  registerUser,
  loginUser,
  updateUserProfile,
  getUserProfile,
  getAllUsers,
  getUsersByRole,
  deleteUser,
  logout,
  // getUsers,
} from "../controllers/userController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";

const {
  ADMIN,
  PROGRAM_MANAGER,
  RESOURCE_MANAGER,
  AGENT,
  DATABASE_MANAGER,
  PRESALES_MANAGER,
  ALL,
} = UserRoleEnum;
const router = Router();
router.post(
  "/register",
  protect,
  authorize(ADMIN, RESOURCE_MANAGER),
  registerUser
);
router.post("/login", loginUser);
router.get("/user", protect, authorize(...ALL), getUserProfile);
router.put(
  "/user",
  protect,
  authorize(ADMIN, RESOURCE_MANAGER),
  updateUserProfile
);
router.get(
  "/allusers",
  protect,
  authorize(ADMIN, RESOURCE_MANAGER, PROGRAM_MANAGER),
  getAllUsers
);

router.get("/users-by-role", protect, authorize(...ALL), getUsersByRole);
router.delete("/:id", protect, authorize(ADMIN, RESOURCE_MANAGER), deleteUser);
router.post("/logout", logout);
// Admin only routes
// router.get("/", protect, authorize("admin"), getUsers);
export default router;
