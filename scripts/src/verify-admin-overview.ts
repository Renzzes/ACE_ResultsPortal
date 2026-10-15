import { loadRootEnv, initDb, closePool, adminOverviewRepo } from "@workspace/db";

async function main() {
  loadRootEnv();
  await initDb();
  const o = await adminOverviewRepo.getAdminOverview();
  process.stdout.write(
    JSON.stringify(
      {
        metrics: o.metrics,
        activityCount: o.activity.length,
        sampleActivity: o.activity.slice(0, 3).map((a) => ({
          action: a.action,
          user: a.userName,
          at: a.createdAt.toISOString(),
        })),
        registrations: o.recentRegistrations.map((r) => ({
          id: r.id,
          his: r.patientHisId,
          name: `${r.firstName} ${r.lastName}`,
        })),
        pending: o.pendingResults.length,
        hasChartData: o.systemOverview.hasData,
        health: o.systemHealth,
        storage: o.storage,
        messagingAvailable: o.messagingAvailable,
      },
      null,
      2,
    ) + "\n",
  );
  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await closePool();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
