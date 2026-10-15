import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler } from "./middlewares/error";

function resolveProductionClientDir(): string | null {
  if (process.env.NODE_ENV !== "production") {
    return null;
  }
  const candidates = [
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "client"),
    path.resolve(process.cwd(), "client"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return null;
}

function parseCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN ?? "";
  const fromEnv = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (process.env.NODE_ENV !== "production") {
    const defaults = [
      "http://localhost:8080",
      "http://127.0.0.1:8080",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ];
    return [...new Set([...fromEnv, ...defaults])];
  }

  if (fromEnv.length === 0) {
    throw new Error("CORS_ORIGIN is required in production and must not be *.");
  }
  if (fromEnv.includes("*")) {
    throw new Error("CORS_ORIGIN must not include * for authenticated APIs.");
  }
  return fromEnv;
}

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

const allowedOrigins = parseCorsOrigins();
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);

app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const clientDir = resolveProductionClientDir();
if (clientDir) {
  app.use(express.static(clientDir, { index: false }));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res, next) => {
    const indexPath = path.join(clientDir, "index.html");
    if (!fs.existsSync(indexPath)) {
      next();
      return;
    }
    res.sendFile(indexPath);
  });
}

app.use(errorHandler);

export default app;
