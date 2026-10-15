import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { findRepoRoot, loadRootEnv } from "./load-env";

export const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const DEFAULT_STORAGE_RELATIVE = path.join("artifacts", "api-server", "uploads");

export const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);
export const ALLOWED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png"]);

export type StoredFileType = "pdf" | "jpeg" | "png";

const LEGACY_BASENAME = /^[A-Za-z0-9._-]+\.(pdf|jpe?g|png)$/i;
const NEW_RELATIVE = /^results\/([1-9][0-9]*)\/result\.(pdf|jpeg|png)$/;
const TMP_RELATIVE = /^tmp\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpeg|png)$/;

let cachedRoot: string | null = null;

export function resetResultStorageCache(): void {
  cachedRoot = null;
}

export function getMaxFileBytes(): number {
  loadRootEnv();
  const raw = process.env.RESULT_MAX_FILE_BYTES;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_MAX_FILE_BYTES;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("RESULT_MAX_FILE_BYTES must be a positive integer.");
  }
  return Math.floor(parsed);
}

export function resolveStorageRoot(): string {
  loadRootEnv();
  const repoRoot = findRepoRoot();
  const configured = process.env.RESULT_STORAGE_ROOT?.trim();
  const candidate =
    configured && configured.length > 0
      ? path.isAbsolute(configured)
        ? configured
        : path.resolve(repoRoot, configured)
      : path.resolve(repoRoot, DEFAULT_STORAGE_RELATIVE);
  return path.resolve(candidate);
}

export function getStorageRoot(): string {
  if (!cachedRoot) {
    cachedRoot = resolveStorageRoot();
  }
  return cachedRoot;
}

export function ensureStorageReady(): string {
  const root = getStorageRoot();
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
  fs.mkdirSync(path.join(root, "results"), { recursive: true });
  return root;
}

export function fileTypeFromMime(mimetype: string): StoredFileType | null {
  if (mimetype === "application/pdf") return "pdf";
  if (mimetype === "image/jpeg" || mimetype === "image/jpg") return "jpeg";
  if (mimetype === "image/png") return "png";
  return null;
}

export function fileTypeFromExtension(originalName: string): StoredFileType | null {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".jpg" || ext === ".jpeg") return "jpeg";
  if (ext === ".png") return "png";
  return null;
}

export function storedExtension(fileType: StoredFileType): ".pdf" | ".jpeg" | ".png" {
  if (fileType === "pdf") return ".pdf";
  if (fileType === "png") return ".png";
  return ".jpeg";
}

export function detectTypeFromMagic(bytes: Buffer): StoredFileType | null {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "pdf";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  return null;
}

function readMagic(filePath: string): Buffer {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(8);
    const n = fs.readSync(fd, buf, 0, 8, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

export function sanitizeOriginalFileName(input: string): string {
  if (typeof input !== "string" || input.includes("\0")) {
    return "upload";
  }
  const posix = input.replace(/\\/g, "/");
  const base = posix.split("/").pop()?.trim() ?? "";
  const cleaned = base.replace(/[<>:"|?*\u0000-\u001f]/g, "_").replace(/^\.+/, "");
  const safe = cleaned.slice(0, 200).trim();
  if (!safe || safe === "." || safe === "..") {
    return "upload";
  }
  return safe;
}

function rejectUnsafeInput(fileName: string): string {
  if (typeof fileName !== "string" || fileName.length === 0 || fileName.includes("\0")) {
    throw new Error("Invalid file name");
  }
  if (fileName.includes("..")) {
    throw new Error("Invalid file name");
  }
  if (/^[a-zA-Z]:[\\/]/.test(fileName) || fileName.startsWith("\\\\") || fileName.startsWith("//")) {
    throw new Error("Invalid file name");
  }
  if (path.isAbsolute(fileName)) {
    throw new Error("Invalid file name");
  }
  return fileName.replace(/\\/g, "/");
}

export function normalizeStoredFileKey(fileName: string): string {
  const posix = rejectUnsafeInput(fileName);
  if (posix !== posix.trim() || posix.startsWith("/") || posix.includes("//")) {
    throw new Error("Invalid file name");
  }
  if (NEW_RELATIVE.test(posix) || TMP_RELATIVE.test(posix)) {
    return posix;
  }
  if (posix.includes("/") || posix.includes(":")) {
    throw new Error("Invalid file name");
  }
  if (!LEGACY_BASENAME.test(posix)) {
    throw new Error("Invalid file name");
  }
  return posix;
}

function assertInsideRoot(resolved: string, root: string): void {
  const leftRaw = path.resolve(resolved);
  const rightRaw = path.resolve(root);
  const left = process.platform === "win32" ? leftRaw.toLowerCase() : leftRaw;
  const right = process.platform === "win32" ? rightRaw.toLowerCase() : rightRaw;
  const prefix = right.endsWith(path.sep) ? right : right + path.sep;
  if (left !== right && !left.startsWith(prefix)) {
    throw new Error("Invalid file path");
  }
}

export function getStoredFilePath(fileName: string): string {
  const key = normalizeStoredFileKey(fileName);
  const root = getStorageRoot();
  const resolved = path.resolve(root, ...key.split("/"));
  assertInsideRoot(resolved, root);
  if (fs.existsSync(resolved)) {
    const real = fs.realpathSync(resolved);
    assertInsideRoot(real, root);
    return real;
  }
  return resolved;
}

export function storedFileExists(fileName: string): boolean {
  try {
    const filePath = getStoredFilePath(fileName);
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function deleteStoredFile(fileName: string): void {
  try {
    const filePath = getStoredFilePath(fileName);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      fs.unlinkSync(filePath);
    }
    const key = normalizeStoredFileKey(fileName);
    const match = NEW_RELATIVE.exec(key);
    if (match) {
      const dir = path.dirname(filePath);
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
      }
    }
  } catch {
    /* cleanup must not throw */
  }
}

export function tempRelativeName(multerFilename: string): string {
  const base = path.basename(multerFilename);
  if (base !== multerFilename.replace(/\\/g, "/")) {
    throw new Error("Invalid file name");
  }
  return normalizeStoredFileKey(`tmp/${base}`);
}

export function deleteTempUpload(multerFilename: string): void {
  try {
    deleteStoredFile(tempRelativeName(multerFilename));
  } catch {
    /* cleanup must not throw */
  }
}

export function finalRelativeName(resultId: number, fileType: StoredFileType): string {
  if (!Number.isInteger(resultId) || resultId < 1) {
    throw new Error("Invalid file name");
  }
  return `results/${resultId}/result.${fileType}`;
}

export function newTempFilename(fileType: StoredFileType): string {
  return `${crypto.randomUUID()}${storedExtension(fileType)}`;
}

export function validateUploadClaims(
  originalName: string,
  mimetype: string,
): { ok: true; fileType: StoredFileType } | { ok: false; error: string } {
  const extType = fileTypeFromExtension(originalName);
  const mimeType = fileTypeFromMime(mimetype);
  if (!extType || !ALLOWED_EXTENSIONS.has(path.extname(originalName).toLowerCase())) {
    return { ok: false, error: "Invalid file type. Only PDF, JPEG, and PNG are allowed." };
  }
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimetype)) {
    return { ok: false, error: "Invalid file type. Only PDF, JPEG, and PNG are allowed." };
  }
  if (extType !== mimeType) {
    return { ok: false, error: "Invalid file type. Only PDF, JPEG, and PNG are allowed." };
  }
  return { ok: true, fileType: extType };
}

export function validateStoredUpload(
  absPath: string,
  originalName: string,
  mimetype: string,
  sizeBytes: number,
): { ok: true; fileType: StoredFileType } | { ok: false; error: string } {
  const claims = validateUploadClaims(originalName, mimetype);
  if (!claims.ok) return claims;

  const maxBytes = getMaxFileBytes();
  if (!Number.isFinite(sizeBytes) || sizeBytes < 1) {
    return { ok: false, error: "Empty file is not allowed." };
  }
  if (sizeBytes > maxBytes) {
    return { ok: false, error: `File exceeds maximum size of ${maxBytes} bytes.` };
  }

  const root = getStorageRoot();
  const resolved = path.resolve(absPath);
  assertInsideRoot(resolved, root);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { ok: false, error: "Uploaded file is missing." };
  }
  const stat = fs.statSync(resolved);
  if (stat.size > maxBytes) {
    return { ok: false, error: `File exceeds maximum size of ${maxBytes} bytes.` };
  }
  if (stat.size < 1) {
    return { ok: false, error: "Empty file is not allowed." };
  }

  const magicType = detectTypeFromMagic(readMagic(resolved));
  if (!magicType || magicType !== claims.fileType) {
    return { ok: false, error: "Invalid file type. Only PDF, JPEG, and PNG are allowed." };
  }
  return { ok: true, fileType: claims.fileType };
}

export function finalizeStoredFile(multerFilename: string, resultId: number, fileType: StoredFileType): string {
  const tmpKey = tempRelativeName(multerFilename);
  const tmpPath = getStoredFilePath(tmpKey);
  if (!fs.existsSync(tmpPath) || !fs.statSync(tmpPath).isFile()) {
    throw new Error("Uploaded file is missing.");
  }

  const relative = finalRelativeName(resultId, fileType);
  const destPath = path.resolve(getStorageRoot(), ...relative.split("/"));
  assertInsideRoot(destPath, getStorageRoot());
  if (fs.existsSync(destPath)) {
    throw new Error("Stored file already exists.");
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.renameSync(tmpPath, destPath);
  return relative;
}

export interface StorageFileRef {
  resultId: number;
  fileName: string;
}

export interface MissingStoredFile {
  resultId: number;
  expectedRelativePath: string;
  fileExists: false;
}

export interface OrphanStoredFile {
  relativePath: string;
  resultId: null;
  fileExists: true;
}

export interface ConsistentStoredFile {
  resultId: number;
  expectedRelativePath: string;
  fileExists: true;
}

export interface StorageInspection {
  storageRoot: string;
  consistent: ConsistentStoredFile[];
  missing: MissingStoredFile[];
  orphans: OrphanStoredFile[];
  invalidKeys: Array<{ resultId: number; fileName: string }>;
}

function walkFiles(dir: string, root: string, acc: string[]): void {
  if (!fs.existsSync(dir)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      walkFiles(abs, root, acc);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const rel = path.relative(root, abs).split(path.sep).join("/");
    acc.push(rel);
  }
}

export function inspectStorage(refs: StorageFileRef[]): StorageInspection {
  const root = ensureStorageReady();
  const expected = new Map<string, number>();
  const consistent: ConsistentStoredFile[] = [];
  const missing: MissingStoredFile[] = [];
  const invalidKeys: Array<{ resultId: number; fileName: string }> = [];

  for (const ref of refs) {
    let key: string;
    try {
      key = normalizeStoredFileKey(ref.fileName);
    } catch {
      invalidKeys.push({ resultId: ref.resultId, fileName: "[rejected]" });
      continue;
    }
    expected.set(key, ref.resultId);
    if (storedFileExists(key)) {
      consistent.push({ resultId: ref.resultId, expectedRelativePath: key, fileExists: true });
    } else {
      missing.push({ resultId: ref.resultId, expectedRelativePath: key, fileExists: false });
    }
  }

  const onDisk: string[] = [];
  walkFiles(root, root, onDisk);
  const orphans: OrphanStoredFile[] = [];
  for (const rel of onDisk) {
    if (!expected.has(rel)) {
      orphans.push({ relativePath: rel, resultId: null, fileExists: true });
    }
  }

  return { storageRoot: root, consistent, missing, orphans, invalidKeys };
}
