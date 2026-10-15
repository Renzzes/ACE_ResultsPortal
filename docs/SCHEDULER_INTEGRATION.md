# ShanScheduler integration (read-only appointments)

Phase 7A / 7A.1 — Patient Portal reads appointments from **ShanScheduler** only. No writes.

## Architecture

```
Portal JWT.patientId
    ↓
ACE_ResultsPortal.dbo.patients.id
    ↓
patients.portal_user_id → users (role=patient, is_active=1)
    ↓
patients.patient_his_id
    ↓
ShanScheduler.dbo.Appointments.PatientHisId
    ↓
LEFT JOIN dbo.Doctors / dbo.Departments / dbo.Specialties
```

| System | Role |
| --- | --- |
| **ShanScheduler** | Appointment source of truth (SELECT only) |
| **ACE_ResultsPortal** | Patient portal identity source |
| **LiveDB_ACE** | Hospital demographics (not used for appointments; read-only) |

**No cross-database foreign key** exists or is created between ACE_ResultsPortal and ShanScheduler.

## Integration key (ONLY)

```
ShanScheduler.dbo.Appointments.PatientHisId
                =
ACE_ResultsPortal.dbo.patients.patient_his_id
```

Column type (ShanScheduler team migration): `NVARCHAR(64) NULL`.

**Prohibited matching:** first/middle/last name, email, mobile, DOB, AppointmentReference, Appointment ID, fuzzy/best-match.

Leading zeros are preserved (`0001240` stays `0001240`). Lookup uses parameterized `NVARCHAR(64)`.

## New-patient behavior

A ShanScheduler appointment with `PatientHisId = NULL` is **not** visible in the Patient Portal.

The portal does **not**:

- create portal accounts from appointments
- create ACE patients from appointments
- update patients from appointments

## Environment

| Variable | Purpose |
| --- | --- |
| `SCHEDULER_DB_DATABASE` | Required. e.g. `ShanScheduler` |
| `SCHEDULER_DB_SERVER` | Optional; defaults to `DB_SERVER` |
| `SCHEDULER_DB_USER` / `SCHEDULER_DB_PASSWORD` | Optional; defaults to portal DB credentials |
| `SCHEDULER_PATIENT_HIS_ID_COLUMN` | Optional override; default **`PatientHisId`** |

Inspect schema (SELECT only):

```bash
pnpm --filter @workspace/scripts run inspect-shanscheduler
```

## Appointment rules

Hospital timezone: **Asia/Manila (UTC+8)** via server-side `hospitalTodayIso()`.

### Today

- `AppointmentDate = @today` (Asia/Manila calendar date)
- `PatientHisId = @patientHisId`
- Exclude status (case-insensitive): `cancelled`, `canceled`, `no-show`, `no show`, `rescheduled`
- Order: `AppointmentTime`, then `AppointmentReference`
- All matching rows returned

### Next

- `AppointmentDate > @today` (strictly after today — later-today slots stay in Today)
- Same PatientHisId + status filters
- Earliest one row only

### Empty results

- `today: []` → UI: “No appointment today”
- `next: null` → UI: “No next appointment”

### Failure / unconfigured

| Condition | `appointments.status` |
| --- | --- |
| Missing/blank `patients.patient_his_id` | `unconfigured` |
| `PatientHisId` column not yet in ShanScheduler | `unconfigured` |
| Scheduler connection/query failure | `unavailable` |

Patient overview (profile, doctors, results) continues; only appointments degrade.

## API

`GET /api/portal/overview` includes:

```json
{
  "appointments": {
    "status": "ok | unavailable | unconfigured",
    "today": [],
    "next": null,
    "message": "optional when unavailable/unconfigured"
  }
}
```

Patient identity is always from JWT; client `patientId` query params are ignored. Staff/physician/admin JWTs cannot call portal routes.

## dbo.Appointments (inspected)

| Column | Type | Notes |
| --- | --- | --- |
| ID | varchar(50) | PK |
| AppointmentReference | nvarchar(40) | |
| DoctorID | varchar(50) | → Doctors.ID (logical) |
| AppointmentDate | date | |
| AppointmentTime | nvarchar(10) | |
| PatientFirstName / Last / Middle | nvarchar | Display only — **not** used for join |
| PatientContactNumber / PatientEmail | nvarchar | **not** used for join |
| ReasonForVisit | nvarchar(max) | |
| Status | nvarchar(20) | |
| **PatientHisId** | nvarchar(64) NULL | **Join key** (added by ShanScheduler team) |
| Notes | nvarchar(max) | Not returned to portal |
| CreatedAt / UpdatedAt | datetime | |

## Safety

| Operation | ShanScheduler | ACE_ResultsPortal | LiveDB_ACE |
| --- | --- | --- | --- |
| SELECT | Yes | Yes | Yes (existing HIS paths) |
| INSERT / UPDATE / DELETE / DDL | **0** | **0** for this phase | **0** |

No ACE appointment cache table. No background sync.
