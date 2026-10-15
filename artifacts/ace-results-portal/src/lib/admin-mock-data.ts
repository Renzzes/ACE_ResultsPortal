export type AdminRole = string;

export type AdminAccount = {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export type AdminPatientAccount = {
  id: number;
  patientHisId: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  email: string;
  mobileNumber: string;
  createdAt: string;
  resultCount: number;
  portalActive: boolean;
  accessCodeRequestedAt?: string | null;
  dateOfBirth?: string | null;
};

export type AdminSession = {
  id: string;
  name: string;
  role: string;
  location: string;
  device: string;
  started: string;
  status: "active" | "idle";
};

export type AdminStorageFile = {
  id: string;
  name: string;
  kind: string;
  size: string;
  owner: string;
  updated: string;
};

export type AdminChatMessage = {
  id: string;
  from: "admin" | "them";
  text: string;
  time: string;
  seen?: boolean;
};

export type AdminThread = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  subtitle: string;
  online: boolean;
  unread: number;
  lastTime: string;
  messages: AdminChatMessage[];
};

export const ADMIN_STAFF: AdminAccount[] = [
  { id: 81001, username: "ace.admin", firstName: "Sofia", lastName: "Ramirez", email: "sofia.ramirez@acemedical.ph", role: "super_admin", isActive: true, lastLoginAt: "2026-08-24T03:12:00.000Z", createdAt: "2024-01-08T00:00:00.000Z" },
  { id: 81002, username: "records.desk", firstName: "Liza", lastName: "Tan", email: "liza.tan@acemedical.ph", role: "medical_records", isActive: true, lastLoginAt: "2026-08-24T02:40:00.000Z", createdAt: "2024-03-14T00:00:00.000Z" },
  { id: 81003, username: "lab.station2", firstName: "Carlo", lastName: "Reyes", email: "carlo.reyes@acemedical.ph", role: "laboratory", isActive: true, lastLoginAt: "2026-08-24T01:18:00.000Z", createdAt: "2024-05-02T00:00:00.000Z" },
  { id: 81004, username: "rad.imaging", firstName: "Irene", lastName: "Santiago", email: "irene.santiago@acemedical.ph", role: "radiology", isActive: true, lastLoginAt: "2026-08-23T22:05:00.000Z", createdAt: "2024-06-19T00:00:00.000Z" },
  { id: 81005, username: "lab.night", firstName: "Gino", lastName: "Torres", email: "gino.torres@acemedical.ph", role: "laboratory", isActive: false, lastLoginAt: "2026-07-12T16:20:00.000Z", createdAt: "2025-01-11T00:00:00.000Z" },
];

export const ADMIN_DOCTORS: AdminAccount[] = [
  { id: 82001, username: "dr.elena", firstName: "Elena", lastName: "Cruz", email: "elena.cruz@acemedical.ph", role: "physician", isActive: true, lastLoginAt: "2026-08-24T03:01:00.000Z", createdAt: "2023-11-02T00:00:00.000Z" },
  { id: 82002, username: "dr.paolo", firstName: "Paolo", lastName: "Reyes", email: "paolo.reyes@acemedical.ph", role: "physician", isActive: true, lastLoginAt: "2026-08-24T02:22:00.000Z", createdAt: "2023-12-18T00:00:00.000Z" },
  { id: 82003, username: "dr.marco", firstName: "Marco", lastName: "Villanueva", email: "marco.villanueva@acemedical.ph", role: "physician", isActive: true, lastLoginAt: "2026-08-23T18:44:00.000Z", createdAt: "2024-02-09T00:00:00.000Z" },
  { id: 82004, username: "dr.hannah", firstName: "Hannah", lastName: "Lim", email: "hannah.lim@acemedical.ph", role: "physician", isActive: true, lastLoginAt: "2026-08-23T11:10:00.000Z", createdAt: "2024-04-21T00:00:00.000Z" },
];

export const ADMIN_PATIENTS: AdminPatientAccount[] = [
  { id: 83001, patientHisId: "DEV-PT-001", firstName: "Maria", lastName: "Cruz", middleName: "Elena", email: "maria.cruz@email.test", mobileNumber: "+63 917 555 0140", createdAt: "2025-11-12T00:00:00.000Z", resultCount: 5, portalActive: true, accessCodeRequestedAt: "2026-08-27T04:00:00.000Z" },
  { id: 83002, patientHisId: "DEMO-ACE-101", firstName: "Miguel", lastName: "Santos", middleName: null, email: "miguel.santos@email.test", mobileNumber: "+63 918 555 2201", createdAt: "2026-03-04T00:00:00.000Z", resultCount: 3, portalActive: true, accessCodeRequestedAt: null },
  { id: 83003, patientHisId: "DEMO-ACE-104", firstName: "Angela", lastName: "Cruz", middleName: "Mae", email: "angela.cruz@email.test", mobileNumber: "+63 919 555 1188", createdAt: "2026-04-18T00:00:00.000Z", resultCount: 2, portalActive: true, accessCodeRequestedAt: null },
  { id: 83004, patientHisId: "DEMO-ACE-109", firstName: "Enzo", lastName: "Garcia", middleName: null, email: "enzo.garcia@email.test", mobileNumber: "+63 917 555 4410", createdAt: "2026-06-02T00:00:00.000Z", resultCount: 1, portalActive: false, accessCodeRequestedAt: null },
];

export const ADMIN_SESSIONS: AdminSession[] = [
  { id: "s1", name: "Sofia Ramirez", role: "Administrator", location: "Admin office", device: "Chrome · Windows", started: "08:12 AM", status: "active" },
  { id: "s2", name: "Dr. Elena Cruz", role: "Physician", location: "IM Clinic", device: "Safari · iPad", started: "08:40 AM", status: "active" },
  { id: "s3", name: "Carlo Reyes", role: "Laboratory", location: "Lab Station 2", device: "Edge · Windows", started: "07:55 AM", status: "active" },
  { id: "s4", name: "Maria Elena Cruz", role: "Patient portal", location: "Cebu City", device: "Chrome · Android", started: "09:04 AM", status: "idle" },
  { id: "s5", name: "Irene Santiago", role: "Radiology", location: "Imaging", device: "Chrome · Windows", started: "08:21 AM", status: "active" },
];

export const ADMIN_STORAGE = {
  usedGb: 86.1,
  quotaGb: 200,
  availableGb: 113.9,
  usedPct: 42.8,
  files: 15339,
  results: 12842,
  images: 241,
  other: 67,
  growth: "+32.9 GB",
};

export const ADMIN_STORAGE_FILES: AdminStorageFile[] = [
  { id: "f1", name: "CBC-Panel-DEV-PT-001.pdf", kind: "Laboratory", size: "1.2 MB", owner: "lab.station2", updated: "Today, 09:15 AM" },
  { id: "f2", name: "Chest-Xray-DEMO-ACE-101.pdf", kind: "Radiology", size: "4.8 MB", owner: "rad.imaging", updated: "Today, 08:44 AM" },
  { id: "f3", name: "ECG-Tracing-DEV-PT-001.pdf", kind: "ECG", size: "860 KB", owner: "records.desk", updated: "Yesterday, 04:12 PM" },
  { id: "f4", name: "Lipid-Profile-DEMO-ACE-104.pdf", kind: "Laboratory", size: "940 KB", owner: "lab.station2", updated: "Yesterday, 11:08 AM" },
  { id: "f5", name: "2D-Echo-DEMO-ACE-109.pdf", kind: "Cardiology", size: "6.1 MB", owner: "dr.marco", updated: "Mon, 02:30 PM" },
];

export const ADMIN_ALERTS = [
  { id: "a1", level: "warn" as const, title: "3 failed portal logins", body: "Same HIS ID tried an incorrect password.", time: "4m ago" },
  { id: "a2", level: "ok" as const, title: "API healthy", body: "Database and file storage responding.", time: "Live" },
  { id: "a3", level: "info" as const, title: "12 results pending release", body: "Laboratory 8 · Radiology 4", time: "12m ago" },
  { id: "a4", level: "warn" as const, title: "Storage climbing", body: "Imaging uploads added 1.1 GB today.", time: "1h ago" },
];

export const ADMIN_THREADS: AdminThread[] = [
  {
    id: "ad-ops",
    name: "Operations Desk",
    firstName: "Ops",
    lastName: "Desk",
    subtitle: "Hospital operations",
    online: true,
    unread: 1,
    lastTime: "2m",
    messages: [
      { id: "m1", from: "them", text: "Morning. Two walk-in labs are waiting for encoding.", time: "8:12 AM" },
      { id: "m2", from: "admin", text: "Assign them to Station 2 and flag if WBC is high.", time: "8:14 AM", seen: true },
      { id: "m3", from: "them", text: "Copy. Imaging also asked about last night’s archive restore.", time: "8:16 AM" },
    ],
  },
  {
    id: "ad-doc",
    name: "Dr. Elena Cruz",
    firstName: "Elena",
    lastName: "Cruz",
    subtitle: "Internal Medicine",
    online: true,
    unread: 0,
    lastTime: "18m",
    messages: [
      { id: "m1", from: "them", text: "Can records release the CBC for Maria Cruz after I review?", time: "8:02 AM" },
      { id: "m2", from: "admin", text: "Yes. I’ll keep it pending until you mark it reviewed.", time: "8:04 AM", seen: true },
    ],
  },
  {
    id: "ad-pt",
    name: "Maria Elena Cruz",
    firstName: "Maria",
    lastName: "Cruz",
    subtitle: "Patient portal · DEV-PT-001",
    online: false,
    unread: 1,
    lastTime: "1h",
    messages: [
      { id: "m1", from: "them", text: "I cannot open yesterday’s result on my phone.", time: "7:40 AM" },
      { id: "m2", from: "admin", text: "We reset the download link. Please try again from Results.", time: "7:46 AM", seen: true },
      { id: "m3", from: "them", text: "It works now. Thank you.", time: "7:51 AM" },
    ],
  },
];

export function adminUnreadCount() {
  return ADMIN_THREADS.reduce((sum, thread) => sum + thread.unread, 0);
}

export function adminDisplayName(account: { firstName: string; lastName: string }) {
  return `${account.firstName} ${account.lastName}`.trim();
}

export const ADMIN_ROLE_LABELS: Record<string, string> = {
  super_admin: "Administrator",
  medical_records: "Medical Records",
  laboratory: "Laboratory",
  radiology: "Radiology",
  endoscopy: "Endoscopy",
  physician: "Physician",
};

export const STAFF_ROLE_OPTIONS = [
  { value: "super_admin", label: "Administrator" },
  { value: "medical_records", label: "Medical Records" },
  { value: "laboratory", label: "Laboratory" },
  { value: "radiology", label: "Radiology" },
  { value: "endoscopy", label: "Endoscopy" },
] as const;

export const ADMIN_KPI = {
  patients: 1452,
  patientsDelta: "+23 this week",
  staff: 28,
  staffDelta: "+2 this month",
  doctors: 18,
  doctorsDelta: "+1 this month",
  results: 12842,
  resultsDelta: "+156 today",
  pending: 46,
  pendingHint: "Requires action",
  storagePct: 42.8,
  storageUsed: 86.1,
  storageTotal: 200,
};

export const ADMIN_OVERVIEW_SERIES = [
  { day: "May 18", uploaded: 210, released: 198, registrations: 8, logins: 74 },
  { day: "May 19", uploaded: 246, released: 232, registrations: 11, logins: 81 },
  { day: "May 20", uploaded: 198, released: 190, registrations: 6, logins: 69 },
  { day: "May 21", uploaded: 274, released: 261, registrations: 14, logins: 92 },
  { day: "May 22", uploaded: 301, released: 288, registrations: 9, logins: 88 },
  { day: "May 23", uploaded: 268, released: 255, registrations: 12, logins: 95 },
  { day: "May 24", uploaded: 345, released: 332, registrations: 16, logins: 108 },
];

export const ADMIN_STORAGE_BREAKDOWN = [
  { name: "Results Files", value: 64.2, color: "#2F8F57" },
  { name: "Backups", value: 12.1, color: "#8B3A46" },
  { name: "System Files", value: 9.8, color: "#B7791F" },
];

export const ADMIN_STORAGE_OVERVIEW_SLICES = [
  ...ADMIN_STORAGE_BREAKDOWN,
  { name: "Other", value: 0, color: "#9AA59E" },
];

export const ADMIN_ACTIVITY_FEED = [
  { id: "af1", kind: "patient", title: "New patient registered", detail: "Juan Dela Cruz (DEV-PT-1453)", actor: "records.desk", time: "3 min ago" },
  { id: "af2", kind: "release", title: "Lab result released", detail: "CBC Panel.pdf for Juan Dela Cruz", actor: "lab.station2", time: "7 min ago" },
  { id: "af3", kind: "doctor", title: "Doctor account created", detail: "Dr. Maria Santos", actor: "ace.admin", time: "15 min ago" },
  { id: "af4", kind: "staff", title: "Staff account updated", detail: "Clarence Emmanuel", actor: "ace.admin", time: "23 min ago" },
  { id: "af5", kind: "password", title: "Patient password reset", detail: "Maria Elena Cruz", actor: "ace.admin", time: "31 min ago" },
  { id: "af6", kind: "system", title: "System backup completed", detail: "Nightly snapshot stored", actor: "System", time: "1 hour ago" },
];

export const ADMIN_PENDING_RESULTS = [
  { id: "pr1", name: "CT Scan Result", patient: "Juan Dela Cruz", department: "Radiology", when: "Uploaded 2 hours ago" },
  { id: "pr2", name: "MRI Result", patient: "Maria Santos", department: "Radiology", when: "Uploaded 3 hours ago" },
  { id: "pr3", name: "CBC Panel", patient: "Miguel Santos", department: "Laboratory", when: "Uploaded 4 hours ago" },
  { id: "pr4", name: "2D Echo", patient: "Angela Cruz", department: "Cardiology", when: "Uploaded 5 hours ago" },
];

export const ADMIN_RECENT_REGISTRATIONS = [
  { id: 1453, name: "Juan Dela Cruz", hisId: "DEV-PT-1453", when: "May 24, 2026 2:45 PM" },
  { id: 1452, name: "Ana Marie Lopez", hisId: "DEV-PT-1452", when: "May 24, 2026 1:12 PM" },
  { id: 1451, name: "Rafael Go", hisId: "DEV-PT-1451", when: "May 24, 2026 11:08 AM" },
  { id: 1450, name: "Bea Navarro", hisId: "DEV-PT-1450", when: "May 23, 2026 4:40 PM" },
  { id: 1449, name: "Luis Bautista", hisId: "DEV-PT-1449", when: "May 23, 2026 9:15 AM" },
];

export const ADMIN_RECENT_MESSAGES = [
  { id: "rm1", name: "Dr. Elena Cruz", body: "Request for patient record access", time: "5m ago", unread: true },
  { id: "rm2", name: "Clarence Emmanuel", body: "Lab equipment maintenance scheduled", time: "1h ago", unread: true },
  { id: "rm3", name: "System Notification", body: "Backup completed successfully", time: "2h ago", unread: false },
  { id: "rm4", name: "Irene Santiago", body: "Chest X-ray queue is clear", time: "3h ago", unread: false },
];

export const ADMIN_NOTIFICATIONS = [
  { id: "n1", title: "12 results pending release", body: "Laboratory 8 · Radiology 4", time: "4m", href: "/admin/results", unread: true },
  { id: "n2", title: "3 failed login attempts", body: "Portal HIS ID tried an incorrect password.", time: "18m", href: "/admin/monitor", unread: true },
  { id: "n3", title: "Storage usage above 40%", body: "Imaging uploads added 1.1 GB today.", time: "1h", href: "/admin/storage", unread: true },
  { id: "n4", title: "New doctor account created", body: "Dr. Maria Santos is pending first login.", time: "2h", href: "/admin/doctors", unread: false },
  { id: "n5", title: "Backup completed", body: "Nightly snapshot stored successfully.", time: "6h", href: "/admin/monitor", unread: false },
];

export const ADMIN_HEALTH = [
  { id: "web", name: "Web Application", state: "Operational" as const, ms: "18 ms" },
  { id: "db", name: "Database", state: "Operational" as const, ms: "24 ms" },
  { id: "files", name: "File Storage", state: "Operational" as const, ms: "31 ms" },
  { id: "auth", name: "Authentication", state: "Operational" as const, ms: "12 ms" },
  { id: "api", name: "API", state: "Operational" as const, ms: "16 ms" },
  { id: "backup", name: "Backup System", state: "Operational" as const, ms: "—" },
];

export function adminNotificationCount() {
  return ADMIN_NOTIFICATIONS.filter((item) => item.unread).length;
}

export type StorageTrendRange = "7d" | "30d" | "90d" | "6m" | "1y";

export const STORAGE_TREND_OPTIONS: { id: StorageTrendRange; label: string }[] = [
  { id: "7d", label: "7 Days" },
  { id: "30d", label: "30 Days" },
  { id: "90d", label: "90 Days" },
  { id: "6m", label: "6 Months" },
  { id: "1y", label: "1 Year" },
];

export type AdminStorageCategoryId = "results" | "backups" | "system" | "temp";

export type AdminStorageCategory = {
  id: AdminStorageCategoryId;
  name: string;
  description: string;
  sizeGb: number;
  pctOfUsed: number;
  files: number;
  lastUpdated: string;
  color: string;
};

export const ADMIN_STORAGE_CATEGORIES: AdminStorageCategory[] = [
  { id: "results", name: "Results Files", description: "Lab results, reports, documents", sizeGb: 64.2, pctOfUsed: 74.6, files: 12842, lastUpdated: "May 24, 2026 2:30 PM", color: "#2F8F57" },
  { id: "backups", name: "Backups", description: "Database and file snapshots", sizeGb: 12.1, pctOfUsed: 14.1, files: 156, lastUpdated: "May 24, 2026 1:15 PM", color: "#8B3A46" },
  { id: "system", name: "System Files", description: "Application and configuration files", sizeGb: 9.8, pctOfUsed: 11.4, files: 2341, lastUpdated: "May 24, 2026 12:45 PM", color: "#B7791F" },
  { id: "temp", name: "Temporary Files", description: "Cache and upload staging files", sizeGb: 0, pctOfUsed: 0, files: 0, lastUpdated: "May 24, 2026 11:20 AM", color: "#8A938E" },
];

export const ADMIN_STORAGE_BACKUPS = [
  { id: "b1", label: "Nightly snapshot", window: "May 24, 2026 1:15 AM", kind: "Matched DB + files" },
  { id: "b2", label: "Weekly full copy", window: "May 18, 2026 1:10 AM", kind: "Matched DB + files" },
  { id: "b3", label: "Weekly full copy", window: "May 11, 2026 1:08 AM", kind: "Matched DB + files" },
];

export type AdminStorageBrowserFile = {
  id: string;
  file: string;
  patient: string;
  department: string;
  result: string;
  size: string;
  uploaded: string;
  status: "Released" | "Pending" | "Archived";
};

export const ADMIN_STORAGE_BROWSER_FILES: AdminStorageBrowserFile[] = [
  { id: "sf1", file: "CBC_Result.pdf", patient: "Juan Dela Cruz", department: "Laboratory", result: "CBC", size: "2.4 MB", uploaded: "Aug 24, 2026", status: "Released" },
  { id: "sf2", file: "Chest_Xray.pdf", patient: "Maria Elena Cruz", department: "Radiology", result: "Chest X-ray", size: "4.8 MB", uploaded: "Aug 24, 2026", status: "Released" },
  { id: "sf3", file: "Lipid_Profile.pdf", patient: "Angela Cruz", department: "Laboratory", result: "Lipid Profile", size: "940 KB", uploaded: "Aug 23, 2026", status: "Pending" },
  { id: "sf4", file: "ECG_Tracing.pdf", patient: "Miguel Santos", department: "ECG", result: "ECG", size: "860 KB", uploaded: "Aug 23, 2026", status: "Released" },
  { id: "sf5", file: "2D_Echo.pdf", patient: "Enzo Garcia", department: "Cardiology", result: "2D Echo", size: "6.1 MB", uploaded: "Aug 22, 2026", status: "Archived" },
  { id: "sf6", file: "Urinalysis.pdf", patient: "Ana Marie Lopez", department: "Laboratory", result: "Urinalysis", size: "1.1 MB", uploaded: "Aug 22, 2026", status: "Released" },
  { id: "sf7", file: "CT_Scan.pdf", patient: "Rafael Go", department: "Radiology", result: "CT Scan", size: "12.6 MB", uploaded: "Aug 21, 2026", status: "Pending" },
  { id: "sf8", file: "Ultrasound_Abdomen.pdf", patient: "Bea Navarro", department: "Ultrasound", result: "Abdomen UTZ", size: "3.3 MB", uploaded: "Aug 20, 2026", status: "Released" },
];

const TREND_DAYS: Record<StorageTrendRange, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "6m": 183,
  "1y": 365,
};

const TREND_START: Record<StorageTrendRange, number> = {
  "7d": 81.4,
  "30d": 53.2,
  "90d": 38.1,
  "6m": 22.4,
  "1y": 12.8,
};

export function adminStorageTrend(range: StorageTrendRange) {
  const days = TREND_DAYS[range];
  const startGb = TREND_START[range];
  const endGb = ADMIN_STORAGE.usedGb;
  const end = new Date(Date.UTC(2026, 7, 24));
  const points: { date: string; label: string; gb: number }[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const t = days === 1 ? 1 : 1 - i / (days - 1);
    const wobble = Math.sin(i * 0.37) * (range === "7d" ? 0.35 : 1.45) * (1 - t);
    const gb = Number(Math.max(4, startGb + (endGb - startGb) * t + wobble).toFixed(1));
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - i);
    points.push({
      date: date.toISOString().slice(0, 10),
      label: date.toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "UTC" }),
      gb,
    });
  }
  const values = points.map((point) => point.gb);
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const growth = Number((last - first).toFixed(1));
  return {
    points,
    avg: Number((values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)).toFixed(1)),
    min: Math.min(...values),
    max: Math.max(...values),
    growth,
    growthPct: first === 0 ? 0 : Number(((growth / first) * 100).toFixed(1)),
  };
}
