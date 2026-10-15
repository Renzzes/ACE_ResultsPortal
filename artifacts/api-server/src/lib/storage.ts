import path from "node:path";
import multer from "multer";
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  deleteStoredFile,
  deleteTempUpload,
  ensureStorageReady,
  fileTypeFromExtension,
  getMaxFileBytes,
  getStoredFilePath,
  newTempFilename,
  storedFileExists,
  validateUploadClaims,
} from "@workspace/db";

ensureStorageReady();

export function getFileType(mimetype: string): "pdf" | "jpeg" | "png" | null {
  if (mimetype === "application/pdf") return "pdf";
  if (mimetype === "image/jpeg" || mimetype === "image/jpg") return "jpeg";
  if (mimetype === "image/png") return "png";
  return null;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      const root = ensureStorageReady();
      cb(null, path.join(root, "tmp"));
    } catch (err) {
      cb(err as Error, "");
    }
  },
  filename: (_req, file, cb) => {
    const fileType = fileTypeFromExtension(file.originalname);
    if (!fileType) {
      cb(new Error("Invalid file type. Only PDF, JPEG, and PNG are allowed."), "");
      return;
    }
    cb(null, newTempFilename(fileType));
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: getMaxFileBytes() },
  fileFilter: (_req, file, cb) => {
    const claims = validateUploadClaims(file.originalname, file.mimetype);
    const ext = path.extname(file.originalname).toLowerCase();
    if (
      claims.ok &&
      ALLOWED_MIME_TYPES.has(file.mimetype) &&
      ALLOWED_EXTENSIONS.has(ext)
    ) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only PDF, JPEG, and PNG are allowed."));
    }
  },
});

export function getFilePath(fileName: string): string {
  return getStoredFilePath(fileName);
}

export function deleteFile(fileName: string): void {
  deleteStoredFile(fileName);
}

export { deleteTempUpload, storedFileExists };
