import { loadRootEnv, initDb, closePool, closeHisPool, ensureStorageReady, ensureRolePermissionsCache } from "@workspace/db";
import { logger } from "./lib/logger";
import { getJwtSecret } from "./lib/auth";
import { startScheduledReleaseJob, stopScheduledReleaseJob } from "./lib/scheduled-release";
import app from "./app";
import { attachMessageLiveServer } from "./lib/message-live";

loadRootEnv();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function prepareUntilReady(): Promise<void> {
  const retryDelayMs = 5_000;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      getJwtSecret();
      await initDb();
      await ensureRolePermissionsCache();
      ensureStorageReady();
      if (attempt > 1) {
        logger.info({ attempt }, "Startup dependencies ready");
      }
      return;
    } catch (err) {
      logger.error({ err, attempt, retryDelayMs }, "Startup not ready; retrying");
      await closePool().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

async function main(): Promise<void> {
  await prepareUntilReady();
  startScheduledReleaseJob();

  const server = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
  const live = attachMessageLiveServer(server);

  const shutdown = async () => {
    stopScheduledReleaseJob();
    live.close();
    server.close();
    await closeHisPool().catch(() => undefined);
    await closePool();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((err) => {
  logger.error({ err }, "Failed to start API server");
  process.exit(1);
});
