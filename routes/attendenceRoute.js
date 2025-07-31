import { Router } from "express";
import {
  getAllAttendenceDetails,
  getAllAttendenceDetailsByPmandByMonth,
} from "../controllers/attendenceController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";

const router = Router();
const { ADMIN, PROGRAM_MANAGER, AGENT } = UserRoleEnum;

router.get("/", protect, getAllAttendenceDetails);
router.get(
  "/attendenceByPmAndMonth",
  protect,
  getAllAttendenceDetailsByPmandByMonth
);
//to get all attendence details within a range for admin and resource manager
router.get("/getAllAttendenceDetails", protect, getAllAttendenceDetails);
export default router;
