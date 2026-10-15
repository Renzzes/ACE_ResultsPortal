/**
 * Stamp version.json on every production build.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versionPath = path.join(rootDir, "version.json");
const rootPkgPath = path.join(rootDir, "package.json");

function readPkgVersion(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    const pkg = JSON.parse(readFileSync(filePath, "utf8"));
    return pkg.version ? String(pkg.version) : null;
  } catch {
    return null;
  }
}

function git(cmd) {
  try {
    return execSync(cmd, { cwd: rootDir, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const packageVersion = readPkgVersion(rootPkgPath) || "0.0.0";
const prior = existsSync(versionPath) ? JSON.parse(readFileSync(versionPath, "utf8")) : {};
const gitCommit = git("git rev-parse --short HEAD") || prior.gitCommit || "unknown";
const gitBranch = git("git rev-parse --abbrev-ref HEAD") || prior.gitBranch || "unknown";
const buildDate = new Date().toISOString();
const builder = process.env.USERNAME || process.env.USER || os.userInfo().username || "unknown";
const deploymentPackageName = `ACERPTS-OneClick-${packageVersion}`;

const stamped = {
  name: String(prior.name || "ACE Results Portal"),
  application: "ACE Results Portal",
  version: packageVersion,
  packageVersion,
  buildDate,
  buildTime: buildDate.replace("T", " ").slice(0, 16),
  gitCommit,
  gitBranch,
  commit: gitCommit,
  builder,
  nodeVersion: process.version,
  deploymentPackageName,
  deploymentMode: "production",
};

writeFileSync(versionPath, JSON.stringify(stamped, null, 2) + "\n");
console.log(
  `[stamp-version] ${stamped.application} ${stamped.version} build=${stamped.buildDate} commit=${stamped.gitCommit} branch=${stamped.gitBranch} package=${stamped.deploymentPackageName}`,
);
