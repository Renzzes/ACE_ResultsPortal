import type { ErrorRequestHandler } from "express";
import multer from "multer";
import { getMaxFileBytes } from "@workspace/db";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";
import { loggedRequestBodyFailure } from "../lib/request-body-error";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const bodyFailure = loggedRequestBodyFailure(err);
  if (bodyFailure) {
    logger.error(bodyFailure.log, "Rejected request body");
    res.status(bodyFailure.status).json({ error: bodyFailure.clientError });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, ...(err.extra ?? {}) });
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: `File exceeds maximum size of ${getMaxFileBytes()} bytes.` });
      return;
    }
    res.status(400).json({ error: "Invalid upload." });
    return;
  }

  if (err instanceof Error && err.message.includes("Invalid file type")) {
    res.status(400).json({ error: err.message });
    return;
  }

  logger.error({ err }, "Unhandled API error");
  res.status(500).json({ error: "Internal server error" });
};
