import { Router } from "express";
import multer from "multer";
import {
  registerUser,
  loginUser,
  updateUserProfile,
  getUserProfile,
  getAllUsers,
  getUsersByRole,
  deleteUser,
  logout,
  resetUserPassword,
  bulkCreateAgents,
  changeOwnPassword,
  // getUsers,
} from "../controllers/userController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls|csv)$/i)) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel (.xlsx, .xls) or CSV files are allowed"), false);
    }
  },
});

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
router.put(
  "/resetPassword",
  protect,
  authorize(RESOURCE_MANAGER, ADMIN),
  resetUserPassword
);

router.get("/users-by-role", protect, authorize(...ALL), getUsersByRole);
router.delete("/:id", protect, authorize(ADMIN, RESOURCE_MANAGER), deleteUser);
router.post("/logout", protect, logout);
router.put("/change-password", protect, authorize(...ALL), changeOwnPassword);

router.post(
  "/bulk-create-agents",
  protect,
  authorize(RESOURCE_MANAGER, ADMIN),
  excelUpload.single("file"),
  bulkCreateAgents
);

// Admin only routes
// router.get("/", protect, authorize("admin"), getUsers);
export default router;
