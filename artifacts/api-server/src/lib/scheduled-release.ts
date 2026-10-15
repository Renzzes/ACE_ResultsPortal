import { patientsRepo, resultsRepo, auditLogsRepo } from "@workspace/db";
import { logger } from "./logger";
import { notifyPatientResultReleased } from "./notify-result-released";

const INTERVAL_MS = 60_000;
let timer: NodeJS.Timeout | null = null;

export function startScheduledReleaseJob(): void {
  if (timer) return;
  void runOnce();
  timer = setInterval(() => {
    void runOnce();
  }, INTERVAL_MS);
  timer.unref?.();
}

export function stopScheduledReleaseJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function runOnce(): Promise<void> {
  try {
    const released = await resultsRepo.releaseDueScheduledResults();
    for (const result of released) {
      const patient = await patientsRepo.findPatientById(result.patientId);
      try {
        await auditLogsRepo.insertAuditLog({
          action: "edit",
          userId: null,
          userName: "system",
          patientHisId: patient?.patientHisId ?? null,
          resultId: result.id,
          ipAddress: "system",
          details: "Scheduled release applied by in-process worker",
        });
      } catch (err) {
        logger.error({ err, resultId: result.id }, "Failed to audit scheduled release");
      }

      void notifyPatientResultReleased({
        resultId: result.id,
        patientId: result.patientId,
        category: result.category,
      }).catch(() => undefined);
    }
    if (released.length > 0) {
      logger.info({ count: released.length }, "Scheduled results released");
    }
  } catch (err) {
    logger.error({ err }, "Scheduled release job failed");
  }
}
