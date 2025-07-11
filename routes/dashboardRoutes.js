import { Router } from "express";
const router = Router();
import { dashboardData } from "../controllers/dashboardController.js";
import { protect } from "../middleware/authMiddleware.js";

router.get("/dashboardData", protect, dashboardData);

export default router;
