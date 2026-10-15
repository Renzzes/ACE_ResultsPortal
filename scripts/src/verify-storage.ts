import {
  closePool,
  initDb,
  inspectStorage,
  loadRootEnv,
  resultsRepo,
} from "@workspace/db";

loadRootEnv();

async function main(): Promise<void> {
  await initDb();
  try {
    const refs = await resultsRepo.listResultFileRefs();
    const report = inspectStorage(refs.map((row) => ({ resultId: row.id, fileName: row.fileName })));

    console.log("Storage root:");
    console.log(report.storageRoot);
    console.log("");
    console.log("Result rows:");
    console.log(String(refs.length));
    console.log("");
    console.log("Consistent (row + file):");
    console.log(String(report.consistent.length));
    for (const item of report.consistent) {
      console.log(`resultId=${item.resultId} expected=${item.expectedRelativePath} fileExists=YES`);
    }
    console.log("");
    console.log("CASE A — result row without physical file:");
    console.log(String(report.missing.length));
    for (const item of report.missing) {
      console.log(`resultId=${item.resultId} expected=${item.expectedRelativePath} fileExists=NO`);
    }
    console.log("");
    console.log("CASE B — physical file without result row:");
    console.log(String(report.orphans.length));
    for (const item of report.orphans) {
      console.log(`resultId=NONE expected=${item.relativePath} fileExists=YES orphan=YES`);
    }
    console.log("");
    console.log("Invalid stored file keys:");
    console.log(String(report.invalidKeys.length));
    for (const item of report.invalidKeys) {
      console.log(`resultId=${item.resultId} fileName=${item.fileName}`);
    }
    console.log("");
    console.log("Automatic deletion: NOT PERFORMED");

    const problems = report.missing.length + report.orphans.length + report.invalidKeys.length;
    process.exitCode = problems > 0 ? 1 : 0;
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "verify-storage failed");
  process.exit(1);
});
