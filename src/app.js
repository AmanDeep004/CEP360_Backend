import express, { json } from "express";
import cors from "cors";
import helmet from "helmet";
import router from "./router.js";
import errorHandler from "./middlewares/errorHandler.js";

const app = express();

app.use(cors());
app.use(helmet());
app.use(json());
app.use(errorHandler);

app.use("/api", router);

export default app;