import { Router } from "express";
import multer from "multer";
import { protect, authorize } from "../../middleware/authMiddleware.js";
import {
  getAllData,
  batchCreateFromExcel,
  updateData,
} from "../../controllers/masterDbController/masterController.js";
import { UserRoleEnum } from "../../utils/enum.js";
const router = Router();
const { ADMIN, PROGRAM_MANAGER, PRESALES_MANAGER, AGENT, RESOURCE_MANAGER } =
  UserRoleEnum;
const upload = multer({ dest: "uploads/" });

router.post(
  "/batchCreateFromExcel",
  upload.single("file"),
  protect,
  batchCreateFromExcel
);

router.put("/update/:id", protect, updateData);
router.get("/getAllData", protect, getAllData);

export default router;
