import express from "express";
import cors from "cors";
import { propertiesRouter } from "./routes/properties";
import { issuesRouter } from "./routes/issues";
import { photosRouter } from "./routes/photos";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/properties", propertiesRouter);
app.use("/api/issues", issuesRouter);
app.use("/api/photos", photosRouter);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || "internal error" });
});

app.listen(PORT, () => {
  console.log(`MaintenanceMap API listening on http://localhost:${PORT}`);
});
