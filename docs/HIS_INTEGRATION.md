# LiveDB_ACE integration (read-only HIS identity)

## Architecture

```
LiveDB_ACE (hospital source of truth)
    ↓  SELECT only
HIS patient identity (patid / names / DOB)
    ↓
ACE_ResultsPortal.dbo.patients.patient_his_id
    ↓
results / patient_physicians / audit_logs / portal auth
```

**The Results Portal does not write to LiveDB_ACE.**

- No INSERT / UPDATE / DELETE / DDL against LiveDB_ACE
- Application SQL is SELECT-only and parameterized
- Prefer a SQL login with SELECT-only grants on required views

## Databases

| Role | Env | Database |
|------|-----|----------|
| Portal app | `DB_*` | `ACE_ResultsPortal` |
| Hospital HIS | `HIS_DB_*` or `HOSPITAL_DB_DATABASE` | `LiveDB_ACE` |

Portal pool always connects to `DB_DATABASE`.  
HIS pool connects to `HIS_DB_DATABASE` / `HOSPITAL_DB_DATABASE` (never the portal DB).

### Environment variables

Portal (required):

- `DB_SERVER`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`

Hospital (required database name; host/credentials fall back to `DB_*`):

- `HOSPITAL_DB_DATABASE=LiveDB_ACE` **or** `HIS_DB_DATABASE=LiveDB_ACE`
- Optional overrides: `HIS_DB_SERVER`, `HIS_DB_PORT`, `HIS_DB_USER`, `HIS_DB_PASSWORD`, `HIS_DB_ENCRYPT`, `HIS_DB_TRUST_SERVER_CERTIFICATE`, pool timeouts

Never put HIS credentials in frontend code.

## Canonical HIS lookup (inspected)

Schema discovery script:

```bash
pnpm --filter @workspace/scripts exec tsx ./src/inspect-livedb-schema.ts
```

**Selected sources (confirmed columns):**

1. `dbo.vwReportPatientProfile`
   - `patid`
   - `PatientFirstName`, `PatientLastName`, `PatientMiddleName`
   - `BirthDate` (datetime)
   - `PK_emdpatients`
   - `registrydate` (for TOP 1 ordering)

2. `dbo.vwPatientMstrList`
   - `patid`, `PatientID` (alternate hospital identifier)
   - `isDied`

**Portal `patient_his_id` is always the verified `patid`**, even if the user entered `PatientID`.

Related base tables inspected (not used for the primary identity query):

- `EipPatientDemographics` (`patientid`, `nameFirst`, `nameLast`, `dateofbirth`, `active`)
- `EipPatientNames`, `EipPatientIdentifiers`, `EipPatientTelecoms`
- `emdPatients` (`PK_emdPatients`, `patid`, `eipPatientUID`, `EipPatDemogId`)

`EipPatientDemographics.patientid` did not match the known test `patid` for the probe patient; the verified hospital views are preferred.

## Flows

### Portal first-time verification

`POST /api/portal/verify-identity`

Body: `{ patientHisId, lastName, dateOfBirth }` (`YYYY-MM-DD`)

1. Validate / normalize
2. Read-only LiveDB_ACE match
3. Generic failure if no match (no enumeration)
4. If match: find or create `ACE_ResultsPortal.dbo.patients`
5. New accounts return plaintext `accessCode` once
6. Existing accounts reuse portal row (access code not regenerated)

### Portal access-code login

`POST /api/portal/verify` — HIS ID + last name + access code (unchanged factors).  
Soft HIS correspondence check logs missing hospital rows for review; LiveDB outage does **not** invalidate the portal session path.

### Staff patient creation

1. `GET /api/patients/hospital-lookup?patientHisId=`
2. `POST /api/patients` — identity fields taken from LiveDB_ACE; optional mobile/email/physician only from staff input

## Error handling

| Condition | HTTP | Message |
|-----------|------|---------|
| Wrong HIS ID / name / DOB | 401 | Patient information could not be verified. |
| LiveDB unavailable | 503 | Patient verification is temporarily unavailable… |
| Rate limited | 429 | Too many attempts… |

## Local testing

```bash
pnpm --filter @workspace/scripts exec tsx ./src/inspect-livedb-schema.ts
pnpm --filter @workspace/scripts exec tsx ./src/probe-livedb-identity.ts
pnpm --filter @workspace/scripts test-patient-hospital
pnpm --filter @workspace/scripts exec tsx --test ./src/test-portal-verify-identity.ts
```

Tests must never modify LiveDB_ACE.
