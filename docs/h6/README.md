# H.6 — Production readiness documentation

Planning artifacts for ACE Results Portal after H.5.4. These documents are **design and approval records**. They do **not** authorize production changes.

| Document | Purpose |
| --- | --- |
| [H6.1_DECISION_REGISTER.md](./H6.1_DECISION_REGISTER.md) | Owner decisions, dependencies, gates (canonical decision status) |
| [H6.1_REMAINING_DEPENDENCIES_REPORT.md](./H6.1_REMAINING_DEPENDENCIES_REPORT.md) | Audit continuation: baseline freshness, remaining blockers, exit criteria |
| [H6.1_READ_ONLY_VERIFICATION_LOG.md](./H6.1_READ_ONLY_VERIFICATION_LOG.md) | Fresh read-only probe evidence (append-only; pre-acceptance) |
| [H6.1_LIVEDB_READ_ONLY_BOUNDARY_AUDIT.md](./H6.1_LIVEDB_READ_ONLY_BOUNDARY_AUDIT.md) | LiveDB_ACE vs ACE_ResultsPortal write-boundary audit |
| [H6.1_LIVEDB_READ_ONLY_REMEDIATION_PLAN.md](./H6.1_LIVEDB_READ_ONLY_REMEDIATION_PLAN.md) | P0 plan: dedicated HIS read-only SQL login cutover (not implemented) |
| [H6.1_P0_REMEDIATION_PLAN.md](./H6.1_P0_REMEDIATION_PLAN.md) | Finding-by-finding P0 remediation (Deliverable A) |
| [H6.1_DOMAIN_NETWORK_ARCHITECTURE.md](./H6.1_DOMAIN_NETWORK_ARCHITECTURE.md) | Domain, Cloudflare, LAN/VPN design (Deliverable B) |
| [H6.1_P0_CHANGE_CHECKLIST.md](./H6.1_P0_CHANGE_CHECKLIST.md) | Maintenance-window checklist (Deliverable C) |
| [H6.1_INDEPENDENT_ARCHITECTURE_RECOMMENDATION.md](./H6.1_INDEPENDENT_ARCHITECTURE_RECOMMENDATION.md) | Independent recommendation & disagreements (Deliverable D) |
| [H6.1_RISK_REGISTER_GO_NO_GO.md](./H6.1_RISK_REGISTER_GO_NO_GO.md) | Risks and public-exposure go/no-go (Deliverable E) |
| [H6.1_IMPLEMENTATION_APPROVAL_BOUNDARY.md](./H6.1_IMPLEMENTATION_APPROVAL_BOUNDARY.md) | What was inspected vs proposed vs unchanged (Deliverable F) |

## Status

| Phase | Status |
| --- | --- |
| H.6.1 Architecture & Infrastructure Audit | Documentation complete pending **owner acceptance**; findings **not remediated**; live evidence as-of 2026-10-15 ~12:42 |
| H.6.1 P0 remediation design + domain plan | **Planning only** — owner decisions recorded; **no implementation authorization** |
| Public Patient/Doctor exposure | **NO-GO** |
| H.6.2+ | **Not authorized** until H.6.1 is accepted and separately authorized |

## Selected root domain (not verified live)

**Selected:** `acemccebu.results.com`  

Ownership, registration, availability, and Cloudflare zone setup are **not verified**. No domain purchase, DNS, or Tunnel configuration was performed in this documentation update.

Proposed hostnames (planning only):

- `patient.acemccebu.results.com`
- `doctor.acemccebu.results.com`
- `staff.acemccebu.results.com`
- `admin.acemccebu.results.com`

See [H6.1_DECISION_REGISTER.md](./H6.1_DECISION_REGISTER.md) for decided vs open items.

## Related

- Parent plan: `ACE_ResultsPortal_H6_Production_Readiness_Security_Audit_Plan.docx`
- Backup contract: [../backup/README.md](../backup/README.md)
- Storage: [../storage/README.md](../storage/README.md)
