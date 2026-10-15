import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const LOG_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "password",
  "*.password",
  "newPassword",
  "*.newPassword",
  "req.body.newPassword",
  "err.body",
  "err.raw.body",
] as const;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [...LOG_REDACT_PATHS],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
