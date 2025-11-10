import { Router } from "express";
import {
  approveOrRejectEditRequest,
  getAllPendingEditApprovals,
} from "../controllers/callingDataEditApprovalController.js";
import { protect } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";

const { ADMIN, PROGRAM_MANAGER, PRESALES_MANAGER } = UserRoleEnum;
const router = Router();

router.get("/pending-edit-approvals", protect, getAllPendingEditApprovals);
router.post(
  "/approve-reject-edit-request",
  protect,
  approveOrRejectEditRequest
);

export default router;
