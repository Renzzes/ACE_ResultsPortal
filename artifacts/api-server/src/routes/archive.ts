import { Router } from "express";
import { patientsRepo, resultsRepo, withTransaction } from "@workspace/db";
import { ListArchivedResultsQueryParams, RestoreArchivedResultParams } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { denyAccess, logAudit } from "../lib/audit";
import { formatResult } from "../lib/formatters";
import { canListArchive, canRestoreArchive, resolveResultCategoryScope, scopeFailure } from "../lib/rbac";
import { staffDirectoryConstraint } from "../lib/patient-department-access";
import { statusAfterRestore } from "../lib/staff-result-workflow";

const router = Router();

router.get("/archive", requireAuth, async (req, res): Promise<void> => {
  if (!canListArchive(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to list archived results",
    });
    return;
  }
  const params = ListArchivedResultsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const scope = await resolveResultCategoryScope(req.user!.role);
  const failure = scopeFailure(scope);
  if (failure) {
    if (failure.status === 403) {
      await denyAccess(req, res, {
        error: failure.error,
        details: "Unauthorized attempt to list archived results outside department scope",
      });
      return;
    }
    res.status(failure.status).json({ error: failure.error });
    return;
  }
  if (scope.status !== "ok") {
    res.json({ data: [], total: 0, page: params.data.page ?? 1, limit: params.data.limit ?? 20 });
    return;
  }

  const membership = await staffDirectoryConstraint(req.user!.role);
  if (membership.kind === "error") {
    if (membership.status === 403) {
      await denyAccess(req, res, {
        error: membership.error,
        details: "Unauthorized attempt to list archived results outside department membership",
      });
      return;
    }
    res.status(membership.status).json({ error: membership.error });
    return;
  }

  const { search, page = 1, limit = 20 } = params.data;
  let patientIds: number[] | undefined;
  if (search) {
    patientIds = await patientsRepo.searchPatientIdsByName(search);
    if (patientIds.length === 0) {
      res.json({ data: [], total: 0, page, limit });
      return;
    }
  }
  if (membership.kind === "ids") {
    patientIds = patientIds
      ? patientIds.filter((id) => membership.ids.includes(id))
      : membership.ids;
    if (patientIds.length === 0) {
      res.json({ data: [], total: 0, page, limit });
      return;
    }
  }

  const archived = await resultsRepo.listArchivedResults({
    patientIds,
    categories: scope.categories === "all" ? undefined : scope.categories,
    page,
    limit,
  });
  const formatted = await Promise.all(
    archived.data.map(async (r) => {
      const patient = await patientsRepo.findPatientById(r.patientId);
      return {
        id: r.id,
        patientId: r.patientId,
        patientHisId: patient?.patientHisId ?? "",
        patientName: patient ? `${patient.lastName}, ${patient.firstName}` : "",
        category: r.category,
        originalFileName: r.originalFileName,
        fileType: r.fileType,
        archivedAt: r.updatedAt.toISOString(),
        originalUploadedAt: r.uploadedAt.toISOString(),
        remarks: r.remarks ?? null,
      };
    }),
  );

  res.json({ data: formatted, total: archived.total, page, limit });
});

router.post("/archive/:id/restore", requireAuth, async (req, res): Promise<void> => {
  if (!canRestoreArchive(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to restore archived result",
    });
    return;
  }
  const params = RestoreArchivedResultParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const existing = await resultsRepo.findResultById(params.data.id);
  if (!existing || existing.status !== "archived") {
    res.status(404).json({ error: "Archived result not found" });
    return;
  }

  const scope = await resolveResultCategoryScope(req.user!.role);
  const failure = scopeFailure(scope);
  if (failure) {
    if (failure.status === 403) {
      await denyAccess(req, res, {
        error: failure.error,
        details: "Unauthorized attempt to restore archived result outside department scope",
        resultId: existing.id,
      });
      return;
    }
    res.status(failure.status).json({ error: failure.error });
    return;
  }
  if (scope.status !== "ok" || (scope.categories !== "all" && !scope.categories.includes(existing.category))) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to restore archived result outside department scope",
      resultId: existing.id,
    });
    return;
  }

  const membership = await staffDirectoryConstraint(req.user!.role);
  if (membership.kind === "error") {
    if (membership.status === 403) {
      await denyAccess(req, res, {
        error: membership.error,
        details: "Unauthorized attempt to restore archived result outside department membership",
        resultId: existing.id,
      });
      return;
    }
    res.status(membership.status).json({ error: membership.error });
    return;
  }
  if (membership.kind === "ids" && !membership.ids.includes(existing.patientId)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to restore archived result outside department membership",
      resultId: existing.id,
    });
    return;
  }

  const restored = await withTransaction(async (tx) => {
    const row = await resultsRepo.updateResult(params.data.id, { status: statusAfterRestore() }, tx);
    if (!row) return null;
    const patient = await patientsRepo.findPatientById(row.patientId, tx);
    await logAudit(
      {
        action: "edit",
        req,
        userId: req.user!.userId,
        userName: req.user!.username,
        patientHisId: patient?.patientHisId,
        resultId: row.id,
        details: "Restored archived result",
      },
      tx,
    );
    return { row, patient };
  });

  if (!restored) {
    res.status(404).json({ error: "Archived result not found" });
    return;
  }

  res.json(
    formatResult(restored.row, {
      patientHisId: restored.patient?.patientHisId ?? "",
      patientName: restored.patient
        ? `${restored.patient.lastName}, ${restored.patient.firstName}`
        : "",
    }),
  );
});

export default router;
