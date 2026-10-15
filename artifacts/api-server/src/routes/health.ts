import { Router } from "express";
import { initDb } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";

const router = Router();

router.get("/healthz", async (_req, res): Promise<void> => {
  try {
    await initDb();
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch {
    res.status(503).json({ status: "unhealthy" });
  }
});

export default router;
