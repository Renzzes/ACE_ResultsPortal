import { Router } from "express";
import fs from "fs";
import {
  patientsRepo,
  patientPhysiciansRepo,
  resultPhysiciansRepo,
  resultReviewsRepo,
  ResultReviewSchemaError,
  resultsRepo,
  usersRepo,
  withTransaction,
  deleteTempUpload,
  deleteStoredFile,
  finalizeStoredFile,
  sanitizeOriginalFileName,
  tempRelativeName,
  validateStoredUpload,
  type ResultCategory,
  type ReleaseOption,
  type ResultStatus,
} from "@workspace/db";
import {
  ListResultsQueryParams,
  GetResultParams,
  UpdateResultParams,
  DeleteResultParams,
  ReleaseResultParams,
  GetResultDownloadUrlParams,
  UpdateResultBody,
  ReleaseResultBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { upload, getFilePath, deleteFile } from "../lib/storage";
import { signDownloadToken, verifyToken } from "../lib/auth";
import { denyAccess, logAudit } from "../lib/audit";
import { formatResult, resolvePatientPortalEmail } from "../lib/formatters";
import { assertAssignablePhysician, canAccessResult, canMutateResult } from "../lib/result-access";
import {
  canArchiveResult,
  canRegenerateAccessCode,
  canDeleteResult,
  canReleaseResult,
  canRestoreArchive,
  canUploadCategory,
  canUploadResults,
  requestedCategoryWithinScope,
  resolveResultCategoryScope,
  resolveServerUploadCategory,
  scopeFailure,
} from "../lib/rbac";
import { notifyResultUploaded } from "../lib/notify-result-upload";
import {
  isValidRecipientEmail,
  issueResultAccessCode,
  normalizeRecipientEmail,
  revealResultAccessCodeForPrint,
} from "../lib/result-access-code";
import { notifyResultAssigned } from "../lib/notify-result-assigned";
import { notifyPatientResultReleased } from "../lib/notify-result-released";
import { notifyStaffOfPhysicianReview } from "../lib/notify-result-reviewed";
import { staffDirectoryConstraint } from "../lib/patient-department-access";
import {
  evaluateStaffUploadAccess,
  parseAssignmentPhysicianSelection,
  parseUploadPhysicianSelection,
} from "../lib/staff-result-workflow";
import {
  RESULT_REVIEW_SCHEMA_MESSAGE,
  authorizePhysicianReview,
  loadReviewExtras,
  parseReviewComment,
  sessionReviewerId,
} from "../lib/result-review";
import type { AuthUser } from "../middlewares/auth";

const router = Router();
const ASSIGNMENT_SCHEMA_MSG =
  "Result physician assignment schema is not installed. Run docs/migration/sql/010_result_physician_assignment.sql against ACE_ResultsPortal.";

async function resultExtras(
  r: { patientId: number; uploadedById: number; id?: number },
  viewer?: { role: string; userId: number },
) {
  const [patient, uploader, reviewerIds] = await Promise.all([
    patientsRepo.findPatientById(r.patientId),
    usersRepo.findUserById(r.uploadedById),
    r.id != null ? resultPhysiciansRepo.listPhysicianIdsForResult(r.id) : Promise.resolve([] as number[]),
  ]);
  const assignedPhysicians = (
    await Promise.all(
      reviewerIds.map(async (physicianId) => {
        const doc = await usersRepo.findUserById(physicianId);
        return doc
          ? { id: doc.id, name: `Dr. ${doc.lastName}, ${doc.firstName}` }
          : null;
      }),
    )
  ).filter((row): row is { id: number; name: string } => row != null);
  const reviewFields = r.id != null && viewer
    ? await loadReviewExtras(r.id, viewer, assignedPhysicians)
    : {};
  return {
    patientHisId: patient?.patientHisId ?? "",
    patientName: patient ? `${patient.lastName}, ${patient.firstName}` : "",
    uploadedByName: uploader ? `${uploader.firstName} ${uploader.lastName}` : `User #${r.uploadedById}`,
    assignedPhysician: assignedPhysicians[0] ?? null,
    assignedPhysicians,
    ...reviewFields,
  };
}

async function scopedListFilters(user: AuthUser): Promise<
  | { kind: "deny"; status: 403 | 500 | 503; error: string }
  | { kind: "empty" }
  | {
      kind: "ok";
      categories: ResultCategory[] | "all";
      filters: {
        categories?: ResultCategory[];
        patientIds?: number[];
        physicianId?: number;
        physicianReviewResultIds?: number[];
      };
    }
> {
  const scope = await resolveResultCategoryScope(user.role);
  const failure = scopeFailure(scope);
  if (failure) return { kind: "deny", status: failure.status, error: failure.error };
  if (scope.status !== "ok") return { kind: "empty" };
  const filters: {
    categories?: ResultCategory[];
    patientIds?: number[];
    physicianId?: number;
    physicianReviewResultIds?: number[];
  } = {};
  if (scope.categories !== "all") filters.categories = scope.categories;
  if (user.role === "physician") {
    filters.physicianId = user.userId;
    filters.patientIds = await patientPhysiciansRepo.listAssignedPatientIds(user.userId);
    filters.physicianReviewResultIds = await resultPhysiciansRepo.listResultIdsForPhysician(user.userId);
  } else {
    const constraint = await staffDirectoryConstraint(user.role);
    if (constraint.kind === "error") {
      return { kind: "deny", status: constraint.status, error: constraint.error };
    }
    if (constraint.kind === "ids") {
      filters.patientIds = constraint.ids;
    }
  }
  return { kind: "ok", categories: scope.categories, filters };
}

router.get("/results", requireAuth, async (req, res): Promise<void> => {
  const params = ListResultsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const scope = await scopedListFilters(req.user!);
  if (scope.kind === "deny") {
    if (scope.status === 403) {
      await denyAccess(req, res, {
        error: scope.error,
        details: "Unauthorized attempt to list results outside department scope",
      });
      return;
    }
    res.status(scope.status).json({ error: scope.error });
    return;
  }
  if (scope.kind === "empty") {
    res.json({ data: [], total: 0, page: params.data.page ?? 1, limit: params.data.limit ?? 20 });
    return;
  }

  const { patientId, category, status, uploadedBy, dateFrom, dateTo, search, page = 1, limit = 20 } = params.data;
  const categoryGate = requestedCategoryWithinScope(category, scope.categories);
  if (categoryGate.denied) {
    res.json({ data: [], total: 0, page, limit });
    return;
  }
  const searchTerm = search?.trim() ?? "";
  let patientIds = scope.filters.patientIds;
  if (searchTerm) {
    const matched = await patientsRepo.searchPatientIdsByName(searchTerm);
    patientIds = patientIds ? matched.filter((id) => patientIds!.includes(id)) : matched;
    if (patientIds.length === 0 && !(scope.filters.physicianReviewResultIds?.length)) {
      res.json({ data: [], total: 0, page, limit });
      return;
    }
  }
  const result = await resultsRepo.listResults({
    ...scope.filters,
    patientIds,
    patientId,
    category: categoryGate.category,
    status:
      req.user!.role === "physician"
        ? undefined
        : (status as ResultStatus | undefined),
    uploadedBy,
    dateFrom: dateFrom ? new Date(dateFrom) : undefined,
    dateTo: dateTo ? new Date(dateTo) : undefined,
    page,
    limit,
  });

  const formatted = await Promise.all(
    result.data.map(async (row) => formatResult(row, await resultExtras(row, req.user!))),
  );
  res.json({ data: formatted, total: result.total, page, limit });
});

router.post("/results/upload", requireAuth, upload.single("file"), async (req, res): Promise<void> => {
  const uploaded = req.file;
  const cleanupTemp = () => {
    if (uploaded) deleteTempUpload(uploaded.filename);
  };

  if (!canUploadResults(req.user!.role)) {
    cleanupTemp();
    await denyAccess(req, res, {
      error: "Not authorized to upload results",
      details: "Unauthorized attempt to upload result",
    });
    return;
  }
  if (!uploaded) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const patientId = parseInt(String(req.body.patientId), 10);
  const releaseOption = req.body.releaseOption as ReleaseOption;
  const scheduledReleaseDate = req.body.scheduledReleaseDate || null;
  const remarks = req.body.remarks || null;
  const physicianSelection = parseUploadPhysicianSelection(req.body ?? {});
  if (!physicianSelection.ok) {
    cleanupTemp();
    res.status(400).json({ error: physicianSelection.error });
    return;
  }

  // Optional physician assignment is a private read-only copy for continuity of care.
  // It does not release the result to the patient and does not require physician approval.

  if (!patientId || !releaseOption) {
    cleanupTemp();
    res.status(400).json({ error: "Missing required fields: patientId, releaseOption" });
    return;
  }

  // Department roles: category is derived from the authenticated staff role (client ignored).
  // Global/"all" roles (Medical Records / Super Admin): require a valid client category.
  const requestedCategory =
    typeof req.body.category === "string" ? String(req.body.category).trim() : undefined;
  const categoryResolved = await resolveServerUploadCategory(req.user!.role, requestedCategory);
  if (!categoryResolved.ok) {
    cleanupTemp();
    if (categoryResolved.status === 403) {
      await denyAccess(req, res, {
        error: categoryResolved.error,
        details: "Unauthorized attempt to upload without an authorized category",
      });
      return;
    }
    res.status(categoryResolved.status).json({ error: categoryResolved.error });
    return;
  }
  const category = categoryResolved.category;

  const selectedPhysicianIds = physicianSelection.selection.kind === "set"
    ? physicianSelection.selection.ids
    : [];

  const validatedPhysicianIds: number[] = [];
  if (selectedPhysicianIds.length > 0) {
    if (!(await resultPhysiciansRepo.schemaReady())) {
      cleanupTemp();
      res.status(503).json({ error: ASSIGNMENT_SCHEMA_MSG });
      return;
    }
    for (const physicianId of selectedPhysicianIds) {
      const physicianOk = await assertAssignablePhysician(physicianId);
      if (!physicianOk.ok) {
        cleanupTemp();
        await denyAccess(req, res, {
          error: physicianOk.error,
          details: "Unauthorized attempt to assign result to non-physician or inactive user",
        });
        return;
      }
      validatedPhysicianIds.push(physicianOk.userId);
    }
  }

  const patient = await patientsRepo.findPatientById(patientId);
  if (!patient) {
    cleanupTemp();
    res.status(400).json({ error: "Patient not found" });
    return;
  }

  const rawRecipientEmail =
    typeof req.body.recipientEmail === "string"
      ? req.body.recipientEmail
      : typeof req.body.patientEmail === "string"
        ? req.body.patientEmail
        : "";
  const recipientEmail = normalizeRecipientEmail(
    rawRecipientEmail || resolvePatientPortalEmail(patient.email) || "",
  );
  if (!isValidRecipientEmail(recipientEmail)) {
    cleanupTemp();
    res.status(400).json({
      error: "A valid Patient Email Address is required to send the document access code.",
    });
    return;
  }

  let uploadAccess: Awaited<ReturnType<typeof evaluateStaffUploadAccess>>;
  try {
    uploadAccess = await evaluateStaffUploadAccess(req.user!.role, patient.id, category);
  } catch (err) {
    cleanupTemp();
    throw err;
  }
  if (!uploadAccess.ok) {
    cleanupTemp();
    if (uploadAccess.status === 403) {
      await denyAccess(req, res, {
        error: uploadAccess.error,
        details: "Unauthorized attempt to upload a result",
        patientHisId: patient.patientHisId,
      });
      return;
    }
    res.status(uploadAccess.status).json({ error: uploadAccess.error });
    return;
  }

  const validated = validateStoredUpload(uploaded.path, uploaded.originalname, uploaded.mimetype, uploaded.size);
  if (!validated.ok) {
    cleanupTemp();
    res.status(400).json({ error: validated.error });
    return;
  }

  const originalFileName = sanitizeOriginalFileName(uploaded.originalname);
  let status: ResultStatus = "pending";
  let dateReleased: Date | null = null;
  if (releaseOption === "immediate") {
    status = "released";
    dateReleased = new Date();
  }

  let createdId: number | null = null;
  try {
    const created = await withTransaction(async (tx) => {
      const row = await resultsRepo.insertResult(
        {
          patientId,
          category,
          fileName: tempRelativeName(uploaded.filename),
          originalFileName,
          fileType: validated.fileType,
          fileSizeBytes: uploaded.size,
          releaseOption,
          scheduledReleaseDate,
          dateReleased,
          status,
          remarks,
          uploadedById: req.user!.userId,
        },
        tx,
      );
      if (validatedPhysicianIds.length > 0) {
        await resultPhysiciansRepo.reconcileAssignments(
          {
            resultId: row.id,
            physicianIds: validatedPhysicianIds,
            assignedById: req.user!.userId,
          },
          tx,
        );
      }
      return row;
    });
    createdId = created.id;

    const relative = finalizeStoredFile(uploaded.filename, created.id, validated.fileType);
    const updated = await resultsRepo.updateResultFileName(created.id, relative);
    const row = updated ?? created;

    await logAudit({
      action: "upload",
      req,
      userId: req.user!.userId,
      userName: req.user!.username,
      patientHisId: patient.patientHisId,
      resultId: row.id,
      details:
        validatedPhysicianIds.length > 0
          ? `Uploaded ${originalFileName} (${category}); result_assigned physicianIds=${validatedPhysicianIds.join(",")}`
          : `Uploaded ${originalFileName} (${category})`,
    });

    // Best-effort operational notifications (assigned physicians + admins).
    void notifyResultUploaded({
      resultId: row.id,
      patientId,
      category,
      uploaderUserId: req.user!.userId,
    }).catch(() => undefined);

    for (const physicianUserId of validatedPhysicianIds) {
      void notifyResultAssigned({
        resultId: row.id,
        physicianUserId,
      }).catch(() => undefined);
    }

    // Patient portal notify only when the result is actually released on upload.
    if (row.status === "released") {
      void notifyPatientResultReleased({
        resultId: row.id,
        patientId,
        category,
      }).catch(() => undefined);
    }

    const issued = await issueResultAccessCode({
      result: row,
      patient,
      email: recipientEmail,
      mode: "upload",
    });
    await logAudit({
      action: "access_code_regen",
      req,
      userId: req.user!.userId,
      userName: req.user!.username,
      patientHisId: patient.patientHisId,
      resultId: row.id,
      details: JSON.stringify({
        operation: "result_access_code_issue",
        mode: "upload",
        emailAccepted: issued.ok ? true : issued.emailAccepted,
        emailedToMasked: issued.ok ? issued.emailedToMasked : null,
      }),
    });

    const finalRow = issued.result ?? row;
    res.status(201).json({
      ...formatResult(finalRow, await resultExtras(finalRow, req.user!)),
      accessCodeEmail: {
        accepted: issued.ok === true,
        status: issued.ok ? "accepted" : "failed",
        error: issued.ok ? null : issued.error,
        emailedToMasked: issued.ok ? issued.emailedToMasked : null,
      },
    });
  } catch (err) {
    if (createdId !== null) {
      try {
        await resultsRepo.deleteResult(createdId);
      } catch {
        /* compensation best-effort */
      }
      deleteStoredFile(`results/${createdId}/result.${validated.fileType}`);
    }
    cleanupTemp();
    throw err;
  }
});

router.get("/results/file/:token", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const payload = verifyToken(token);
  if (!payload || payload["type"] !== "download" || payload["forType"] !== "staff") {
    res.status(401).json({ error: "Invalid or expired download link" });
    return;
  }

  const resultId = payload["resultId"] as number;
  const subjectId = payload["subjectId"] as number | undefined;
  if (!subjectId) {
    res.status(401).json({ error: "Invalid or expired download link" });
    return;
  }

  const user = await usersRepo.findUserById(subjectId);
  if (!user || !user.isActive) {
    await denyAccess(req, res, {
      error: "Not authorized to download this result",
      details: "Unauthorized attempt to download result via token (inactive or missing user)",
      userId: subjectId,
      resultId,
    });
    return;
  }

  const result = await resultsRepo.findResultById(resultId);
  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }
  if (!(await canAccessResult({ userId: user.id, username: user.username, role: user.role }, result))) {
    await denyAccess(req, res, {
      error: "Not authorized to download this result",
      details: "Unauthorized attempt to download result via token",
      userId: user.id,
      userName: user.username,
      resultId: result.id,
    });
    return;
  }

  let filePath: string;
  try {
    filePath = getFilePath(result.fileName);
  } catch {
    res.status(400).json({ error: "Invalid file path" });
    return;
  }
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found on disk" });
    return;
  }

  const mimeMap: Record<string, string> = {
    pdf: "application/pdf",
    jpeg: "image/jpeg",
    png: "image/png",
  };
  const inline = String(req.query.inline ?? "") === "1";
  res.setHeader("Content-Type", mimeMap[result.fileType] ?? "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(result.originalFileName)}"`,
  );
  fs.createReadStream(filePath).pipe(res);
});

router.get("/results/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetResultParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const result = await resultsRepo.findResultById(params.data.id);
  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }
  if (!(await canAccessResult(req.user!, result))) {
    await denyAccess(req, res, {
      error: "Not authorized to access this result",
      details: "Unauthorized attempt to access result",
      resultId: result.id,
    });
    return;
  }
  await logAudit({
    action: "view",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    resultId: result.id,
    details: "Viewed result",
  });
  res.json(formatResult(result, await resultExtras(result, req.user!)));
});

router.put("/results/:id/assignment", requireAuth, async (req, res): Promise<void> => {
  // Staff-only private copy assignment. Does not change patient visibility or release status.
  const params = GetResultParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!canUploadResults(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Not authorized to assign results",
      details: "Unauthorized attempt to assign result physician",
    });
    return;
  }
  if (!(await resultPhysiciansRepo.schemaReady())) {
    res.status(503).json({ error: ASSIGNMENT_SCHEMA_MSG });
    return;
  }

  const existing = await resultsRepo.findResultById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Result not found" });
    return;
  }
  if (!(await canMutateResult(req.user!, existing))) {
    await denyAccess(req, res, {
      error: "Not authorized to assign this result",
      details: "Unauthorized attempt to assign result outside scope",
      resultId: existing.id,
    });
    return;
  }

  const selection = parseAssignmentPhysicianSelection(req.body ?? {});
  if (!selection.ok) {
    res.status(400).json({ error: selection.error });
    return;
  }
  if (selection.selection.kind === "omit") {
    res.json(formatResult(existing, await resultExtras(existing, req.user!)));
    return;
  }

  const validatedPhysicianIds: number[] = [];
  for (const physicianId of selection.selection.ids) {
    const physicianOk = await assertAssignablePhysician(physicianId);
    if (!physicianOk.ok) {
      await denyAccess(req, res, {
        error: physicianOk.error,
        details: "Unauthorized attempt to assign result to non-physician or inactive user",
        resultId: existing.id,
      });
      return;
    }
    validatedPhysicianIds.push(physicianOk.userId);
  }

  const { previousPhysicianIds, currentPhysicianIds, insertedPhysicianIds } = await withTransaction(async (tx) =>
    resultPhysiciansRepo.reconcileAssignments(
      {
        resultId: existing.id,
        physicianIds: validatedPhysicianIds,
        assignedById: req.user!.userId,
      },
      tx,
    ),
  );

  const removed = previousPhysicianIds.filter((id) => !currentPhysicianIds.includes(id));
  await logAudit({
    action: "edit",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    resultId: existing.id,
    details: currentPhysicianIds.length === 0
      ? "result_assignment_removed"
      : `result_assigned physicianIds=${currentPhysicianIds.join(",")}${removed.length ? `; removed=${removed.join(",")}` : ""}`,
  });

  for (const physicianUserId of insertedPhysicianIds) {
    void notifyResultAssigned({
      resultId: existing.id,
      physicianUserId,
    }).catch(() => undefined);
  }

  res.json(formatResult(existing, await resultExtras(existing, req.user!)));
});

router.patch("/results/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateResultParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateResultBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await resultsRepo.findResultById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Result not found" });
    return;
  }
  if (!(await canMutateResult(req.user!, existing))) {
    await denyAccess(req, res, {
      error: "Not authorized to modify this result",
      details: "Unauthorized attempt to modify result",
      resultId: existing.id,
    });
    return;
  }

  if (parsed.data.category && !(await canUploadCategory(req.user!.role, parsed.data.category))) {
    await denyAccess(req, res, {
      error: "You don't have permission to perform this action.",
      details: `Unauthorized attempt to change result category=${parsed.data.category}`,
      resultId: existing.id,
    });
    return;
  }

  const nextStatus = parsed.data.status as ResultStatus | undefined;
  if (nextStatus && nextStatus !== existing.status) {
    if (nextStatus === "released") {
      res.status(400).json({ error: "Use POST /api/results/:id/release to release results" });
      return;
    }
    if (nextStatus === "archived") {
      if (!canArchiveResult(req.user!.role)) {
        await denyAccess(req, res, {
          error: "You don't have permission to perform this action.",
          details: "Unauthorized attempt to archive result",
          resultId: existing.id,
        });
        return;
      }
    } else if (nextStatus === "pending") {
      if (existing.status !== "archived" || !canRestoreArchive(req.user!.role)) {
        await denyAccess(req, res, {
          error: "You don't have permission to perform this action.",
          details: "Unauthorized attempt to restore archived result",
          resultId: existing.id,
        });
        return;
      }
    } else {
      res.status(400).json({ error: "Unsupported status transition" });
      return;
    }
  }

  const updated = await withTransaction(async (tx) => {
    const row = await resultsRepo.updateResult(
      params.data.id,
      {
        category: parsed.data.category as ResultCategory | undefined,
        releaseOption: parsed.data.releaseOption as ReleaseOption | undefined,
        scheduledReleaseDate: parsed.data.scheduledReleaseDate,
        remarks: parsed.data.remarks,
        status: nextStatus,
      },
      tx,
    );
    if (!row) return null;
    await logAudit(
      {
        action: "edit",
        req,
        userId: req.user!.userId,
        userName: req.user!.username,
        resultId: row.id,
        details: "Updated result metadata",
      },
      tx,
    );
    return row;
  });

  if (!updated) {
    res.status(404).json({ error: "Result not found" });
    return;
  }
  res.json(formatResult(updated, await resultExtras(updated, req.user!)));
});

router.delete("/results/:id", requireAuth, async (req, res): Promise<void> => {
  if (!canDeleteResult(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to delete result",
    });
    return;
  }
  const params = DeleteResultParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const result = await resultsRepo.findResultById(params.data.id);
  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }
  if (!(await canMutateResult(req.user!, result))) {
    await denyAccess(req, res, {
      error: "Not authorized to delete this result",
      details: "Unauthorized attempt to delete result",
      resultId: result.id,
    });
    return;
  }

  await withTransaction(async (tx) => {
    await logAudit(
      {
        action: "delete",
        req,
        userId: req.user!.userId,
        userName: req.user!.username,
        resultId: result.id,
        details: `Deleted result: ${result.originalFileName}`,
      },
      tx,
    );
    await resultsRepo.deleteResult(result.id, tx);
  });
  deleteFile(result.fileName);
  res.json({ message: "Result deleted successfully" });
});

router.post("/results/:id/release", requireAuth, async (req, res): Promise<void> => {
  if (!canReleaseResult(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to release result",
    });
    return;
  }
  const params = ReleaseResultParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = ReleaseResultBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await resultsRepo.findResultById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Result not found" });
    return;
  }
  if (!(await canMutateResult(req.user!, existing))) {
    await denyAccess(req, res, {
      error: "Not authorized to release this result",
      details: "Unauthorized attempt to release result",
      resultId: existing.id,
    });
    return;
  }

  const patch: Parameters<typeof resultsRepo.updateResult>[1] = {
    releaseOption: parsed.data.releaseOption as ReleaseOption,
  };
  if (parsed.data.releaseOption === "immediate") {
    patch.status = "released";
    patch.dateReleased = new Date();
  } else if (parsed.data.scheduledReleaseDate) {
    patch.scheduledReleaseDate = parsed.data.scheduledReleaseDate;
  }

  const updated = await withTransaction(async (tx) => {
    const row = await resultsRepo.updateResult(params.data.id, patch, tx);
    if (!row) return null;
    await logAudit(
      {
        action: "edit",
        req,
        userId: req.user!.userId,
        userName: req.user!.username,
        resultId: row.id,
        details: `Released result with option: ${parsed.data.releaseOption}`,
      },
      tx,
    );
    return row;
  });

  if (!updated) {
    res.status(404).json({ error: "Result not found" });
    return;
  }

  // Patient portal notify only on transition into released (immediate release).
  if (updated.status === "released" && parsed.data.releaseOption === "immediate") {
    void notifyPatientResultReleased({
      resultId: updated.id,
      patientId: updated.patientId,
      category: updated.category,
    }).catch(() => undefined);
  }

  res.json(formatResult(updated, await resultExtras(updated, req.user!)));
});

router.get("/results/:id/download", requireAuth, async (req, res): Promise<void> => {
  const params = GetResultDownloadUrlParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const result = await resultsRepo.findResultById(params.data.id);
  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }
  if (!(await canAccessResult(req.user!, result))) {
    await denyAccess(req, res, {
      error: "Not authorized to download this result",
      details: "Unauthorized attempt to download result",
      resultId: result.id,
    });
    return;
  }

  const token = signDownloadToken({
    resultId: result.id,
    forType: "staff",
    subjectId: req.user!.userId,
  });
  await logAudit({
    action: "download",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    resultId: result.id,
    details: "Generated download link",
  });
  res.json({
    url: `/api/results/file/${token}`,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
});

router.put("/results/:id/review", requireAuth, async (req, res): Promise<void> => {
  if (req.user!.role !== "physician") {
    await denyAccess(req, res, {
      error: "Not authorized to review this result",
      details: "Unauthorized attempt to review a result",
    });
    return;
  }
  const resultId = parseInt(String(req.params.id), 10);
  if (!resultId) {
    res.status(400).json({ error: "Invalid result ID" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  if ("reviewedAt" in body || "reviewed_at" in body) {
    res.status(400).json({ error: "reviewedAt is set by the server" });
    return;
  }
  const comment = parseReviewComment(body.comment);
  if (!comment.ok) {
    res.status(400).json({ error: comment.error });
    return;
  }
  const result = await resultsRepo.findResultById(resultId);
  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }
  const access = await authorizePhysicianReview(req.user!, result);
  if (!access.ok) {
    await denyAccess(req, res, {
      error: access.error,
      details: "Unauthorized attempt to review a result",
      resultId: result.id,
    });
    return;
  }
  if (!(await resultReviewsRepo.schemaReady())) {
    res.status(503).json({ error: RESULT_REVIEW_SCHEMA_MESSAGE });
    return;
  }
  let saved;
  try {
    saved = await resultReviewsRepo.upsertReview({
      resultId: result.id,
      physicianId: sessionReviewerId(req.user!.userId),
      comment: comment.comment,
    });
  } catch (err) {
    if (err instanceof ResultReviewSchemaError) {
      res.status(503).json({ error: RESULT_REVIEW_SCHEMA_MESSAGE });
      return;
    }
    throw err;
  }
  const physician = await usersRepo.findUserById(req.user!.userId);
  const physicianName = physician
    ? `Dr. ${physician.lastName}, ${physician.firstName}`
    : `Physician #${saved.physicianId}`;
  await logAudit({
    action: "edit",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    resultId: result.id,
    details: "result_reviewed",
  });
  void notifyStaffOfPhysicianReview({
    resultId: result.id,
    patientId: result.patientId,
    category: result.category,
    physicianUserId: req.user!.userId,
    physicianName,
    comment: saved.comment,
    uploadedById: result.uploadedById ?? null,
  });
  res.json({
    resultId: saved.resultId,
    physicianId: saved.physicianId,
    physicianName,
    reviewed: true,
    reviewedAt: saved.reviewedAt.toISOString(),
    comment: saved.comment,
  });
});

router.post("/results/:id/regenerate-access-code", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid result id" });
    return;
  }
  if (!canRegenerateAccessCode(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Not authorized to regenerate access codes",
      details: "Unauthorized attempt to regenerate result access code",
      resultId: id,
    });
    return;
  }

  const result = await resultsRepo.findResultById(id);
  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }
  const access = await canAccessResult(req.user!, result);
  if (!access) {
    await denyAccess(req, res, {
      error: "Not authorized to access this result",
      details: "Unauthorized attempt to regenerate result access code",
      resultId: result.id,
    });
    return;
  }

  const patient = await patientsRepo.findPatientById(result.patientId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const rawEmail =
    typeof req.body?.email === "string"
      ? req.body.email
      : typeof req.body?.recipientEmail === "string"
        ? req.body.recipientEmail
        : "";
  const recipientEmail = normalizeRecipientEmail(
    rawEmail || resolvePatientPortalEmail(patient.email) || "",
  );
  if (!isValidRecipientEmail(recipientEmail)) {
    res.status(400).json({
      error: "A valid recipient email is required to regenerate and send the document access code.",
    });
    return;
  }

  const issued = await issueResultAccessCode({
    result,
    patient,
    email: recipientEmail,
    mode: "regenerate",
  });
  await logAudit({
    action: "access_code_regen",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    patientHisId: patient.patientHisId,
    resultId: result.id,
    details: JSON.stringify({
      operation: "result_access_code_regenerate",
      emailAccepted: issued.ok ? true : issued.emailAccepted,
      emailedToMasked: issued.ok ? issued.emailedToMasked : null,
    }),
  });

  if (!issued.ok) {
    res.status(issued.status).json({
      error: issued.error,
      accessCodeEmail: {
        accepted: issued.emailAccepted === true,
        status: issued.emailAccepted ? "uncertain" : "failed",
      },
    });
    return;
  }

  res.json({
    ...formatResult(issued.result, await resultExtras(issued.result, req.user!)),
    accessCodeEmail: {
      accepted: true,
      status: "accepted",
      emailedToMasked: issued.emailedToMasked,
    },
  });
});

router.post("/results/:id/resend-access-code", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid result id" });
    return;
  }
  if (!canRegenerateAccessCode(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Not authorized to resend access codes",
      details: "Unauthorized attempt to resend result access code",
      resultId: id,
    });
    return;
  }

  const result = await resultsRepo.findResultById(id);
  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }
  const access = await canAccessResult(req.user!, result);
  if (!access) {
    await denyAccess(req, res, {
      error: "Not authorized to access this result",
      details: "Unauthorized attempt to resend result access code",
      resultId: result.id,
    });
    return;
  }
  const patient = await patientsRepo.findPatientById(result.patientId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const rawEmail =
    typeof req.body?.email === "string"
      ? req.body.email
      : typeof req.body?.recipientEmail === "string"
        ? req.body.recipientEmail
        : "";
  const recipientEmail = normalizeRecipientEmail(
    rawEmail || resolvePatientPortalEmail(patient.email) || "",
  );
  if (!isValidRecipientEmail(recipientEmail)) {
    res.status(400).json({ error: "A valid recipient email is required." });
    return;
  }

  const issued = await issueResultAccessCode({
    result,
    patient,
    email: recipientEmail,
    mode: "retry_email",
  });
  await logAudit({
    action: "access_code_regen",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    patientHisId: patient.patientHisId,
    resultId: result.id,
    details: JSON.stringify({
      operation: "result_access_code_resend",
      emailAccepted: issued.ok ? true : issued.emailAccepted,
      emailedToMasked: issued.ok ? issued.emailedToMasked : null,
    }),
  });
  if (!issued.ok) {
    res.status(issued.status).json({ error: issued.error });
    return;
  }
  res.json({
    ...formatResult(issued.result, await resultExtras(issued.result, req.user!)),
    accessCodeEmail: {
      accepted: true,
      status: "accepted",
      emailedToMasked: issued.emailedToMasked,
    },
  });
});

router.get("/results/:id/print-ready", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid result id" });
    return;
  }

  const result = await resultsRepo.findResultById(id);
  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }
  const access = await canAccessResult(req.user!, result);
  if (!access) {
    await denyAccess(req, res, {
      error: "Not authorized to access this result",
      details: "Unauthorized attempt to generate print-ready result",
      resultId: result.id,
    });
    return;
  }

  const accessCode = revealResultAccessCodeForPrint(result);
  if (!accessCode) {
    res.status(409).json({
      error: "No active document access code. Upload email issuance or regenerate first.",
    });
    return;
  }

  let filePath: string;
  try {
    filePath = getFilePath(result.fileName);
  } catch {
    res.status(400).json({ error: "Invalid file path" });
    return;
  }
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found on disk" });
    return;
  }

  try {
    const { buildPrintReadyPdf } = await import("../lib/result-print");
    const original = fs.readFileSync(filePath);
    const stamped = await buildPrintReadyPdf({
      originalBytes: original,
      fileType: result.fileType,
      accessCode,
      documentLabel: result.originalFileName,
    });
    const patient = await patientsRepo.findPatientById(result.patientId);
    await logAudit({
      action: "download",
      req,
      userId: req.user!.userId,
      userName: req.user!.username,
      patientHisId: patient?.patientHisId ?? null,
      resultId: result.id,
      details: "result_print_ready_generated",
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(`print-${result.originalFileName.replace(/\.pdf$/i, "")}.pdf`)}"`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.send(Buffer.from(stamped));
  } catch (err) {
    res.status(500).json({ error: "Unable to build print-ready document." });
  }
});


export default router;
