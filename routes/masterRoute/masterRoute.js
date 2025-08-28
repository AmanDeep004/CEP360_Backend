import { Router } from "express";
import multer from "multer";
import { protect, authorize } from "../../middleware/authMiddleware.js";
import {
  createData,
  batchCreateData,
  batchCreateFromExcel,
  updateData,
  deleteData,
  getAllData,
  getDataById,
} from "../../controllers/masterDbController/masterController.js";
import { UserRoleEnum } from "../../utils/enum.js";
const router = Router();
const { ADMIN, PROGRAM_MANAGER, PRESALES_MANAGER, AGENT, RESOURCE_MANAGER } =
  UserRoleEnum;
const upload = multer({ dest: "uploads/" });

router.post("/createData", protect, createData);
router.post("/batchCreateData", protect, batchCreateData);
// router.post(
//   "/batchCreateFromExcel",
//   upload.single("file"),
//   protect,
//   batchCreateFromExcel
// );
router.post("/batchCreateFromExcel", protect, batchCreateFromExcel);
router.put("/update/:type/:id", protect, updateData);
router.get("/getAllData", protect, getAllData);
router.get("/getDataBYId/:type/:id", protect, getDataById);
router.delete("/delete/:type/:id", protect, deleteData);

export default router;
