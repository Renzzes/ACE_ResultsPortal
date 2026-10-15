export interface StaffAppointment {
  id: string;
  patientName: string;
  hisId: string;
  physician: string;
  department: string;
  time: string;
  date: string;
  reason: string;
  status: "ongoing" | "checked-in" | "scheduled" | "completed";
}

export interface StaffChatMessage {
  id: string;
  from: "staff" | "them";
  text: string;
  time: string;
  seen?: boolean;
}

export interface StaffThread {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  subtitle: string;
  online: boolean;
  unread: number;
  lastTime: string;
  messages: StaffChatMessage[];
}

export interface StaffNotification {
  id: string;
  title: string;
  body: string;
  time: string;
  href: string;
  unread: boolean;
}

export const STAFF_TODAY_APPOINTMENTS: StaffAppointment[] = [
  { id: "sa-1", patientName: "Miguel Santos", hisId: "DEMO-ACE-101", physician: "Dr. Elena Cruz", department: "Internal Medicine", time: "Ongoing", date: "Today", reason: "Heavy Cold", status: "ongoing" },
  { id: "sa-2", patientName: "Rhea Kiran", hisId: "DEMO-ACE-102", physician: "Dr. Paolo Reyes", department: "Family Medicine", time: "12:30 PM", date: "Today", reason: "Health Checkup", status: "checked-in" },
  { id: "sa-3", patientName: "Angela Cruz", hisId: "DEMO-ACE-104", physician: "Dr. Elena Cruz", department: "Internal Medicine", time: "01:15 PM", date: "Today", reason: "Fever Consult", status: "scheduled" },
  { id: "sa-4", patientName: "Liza Tan", hisId: "DEMO-ACE-106", physician: "Dr. Marco Villanueva", department: "Cardiology", time: "02:30 PM", date: "Today", reason: "Chest Pain Review", status: "scheduled" },
  { id: "sa-5", patientName: "Enzo Garcia", hisId: "DEMO-ACE-109", physician: "Dr. Hannah Lim", department: "Orthopedics", time: "03:45 PM", date: "Today", reason: "Sports Injury", status: "scheduled" },
  { id: "sa-6", patientName: "Sofia Mendoza", hisId: "DEMO-ACE-114", physician: "Dr. Paolo Reyes", department: "Pediatrics", time: "04:20 PM", date: "Today", reason: "Cough and Colds", status: "scheduled" },
  { id: "sa-7", patientName: "Katrina Ong", hisId: "DEMO-ACE-116", physician: "Dr. Elena Cruz", department: "Internal Medicine", time: "05:00 PM", date: "Today", reason: "Migraine Follow-up", status: "scheduled" },
];

export const STAFF_RECENT_APPOINTMENTS: StaffAppointment[] = [
  { id: "ra-1", patientName: "Carlo Reyes", hisId: "DEMO-ACE-103", physician: "Dr. Elena Cruz", department: "Internal Medicine", time: "10:15 AM", date: "Yesterday", reason: "Lab Follow-up", status: "completed" },
  { id: "ra-2", patientName: "Paolo Diaz", hisId: "DEMO-ACE-107", physician: "Dr. Marco Villanueva", department: "Endocrinology", time: "09:40 AM", date: "Yesterday", reason: "Diabetes Follow-up", status: "completed" },
  { id: "ra-3", patientName: "Bea Navarro", hisId: "DEMO-ACE-110", physician: "Dr. Hannah Lim", department: "OB-GYN", time: "03:20 PM", date: "Yesterday", reason: "Prenatal Check", status: "completed" },
  { id: "ra-4", patientName: "Victor Ramos", hisId: "DEMO-ACE-111", physician: "Dr. Elena Cruz", department: "Internal Medicine", time: "11:00 AM", date: "Mon", reason: "Hypertension Review", status: "completed" },
  { id: "ra-5", patientName: "Luis Bautista", hisId: "DEMO-ACE-117", physician: "Dr. Marco Villanueva", department: "Cardiology", time: "02:00 PM", date: "Mon", reason: "Cardiac Clearance", status: "completed" },
  { id: "ra-6", patientName: "Irene Santiago", hisId: "DEMO-ACE-120", physician: "Dr. Paolo Reyes", department: "Family Medicine", time: "08:30 AM", date: "Sun", reason: "Wellness Check", status: "completed" },
  { id: "ra-7", patientName: "Gino Torres", hisId: "DEMO-ACE-113", physician: "Dr. Marco Villanueva", department: "Cardiology", time: "04:10 PM", date: "Sat", reason: "ECG Follow-up", status: "completed" },
];

export const STAFF_THREADS: StaffThread[] = [
  {
    id: "st-lab",
    name: "Laboratory Desk",
    firstName: "Lab",
    lastName: "Desk",
    subtitle: "Diagnostics · Station 2",
    online: true,
    unread: 2,
    lastTime: "4m",
    messages: [
      { id: "m1", from: "them", text: "CBC for DEMO-ACE-101 is ready for encoding.", time: "11:02 AM" },
      { id: "m2", from: "staff", text: "Copy. I’ll attach it to Miguel Santos and queue for release.", time: "11:04 AM", seen: true },
      { id: "m3", from: "them", text: "Please flag the high WBC so the attending can review first.", time: "11:06 AM" },
      { id: "m4", from: "them", text: "Also, two walk-in lipid panels are still pending scan.", time: "11:07 AM" },
    ],
  },
  {
    id: "st-rad",
    name: "Radiology",
    firstName: "Rad",
    lastName: "Unit",
    subtitle: "Imaging · Ground floor",
    online: true,
    unread: 1,
    lastTime: "22m",
    messages: [
      { id: "m1", from: "staff", text: "Chest x-ray for Liza Tan — is the file uploaded?", time: "10:40 AM", seen: true },
      { id: "m2", from: "them", text: "Yes, CXR-TAN-0818.pdf is in the tray. Status still pending physician review.", time: "10:48 AM" },
    ],
  },
  {
    id: "st-records",
    name: "Medical Records",
    firstName: "Records",
    lastName: "Office",
    subtitle: "Records · 2F",
    online: false,
    unread: 0,
    lastTime: "1h",
    messages: [
      { id: "m1", from: "them", text: "Archive batch for July MRI studies is complete.", time: "9:15 AM" },
      { id: "m2", from: "staff", text: "Noted. I’ll spot-check the restore path this afternoon.", time: "9:22 AM", seen: true },
    ],
  },
  {
    id: "st-nurse",
    name: "OPD Nurse Station",
    firstName: "Nurse",
    lastName: "Elena",
    subtitle: "Outpatient · Nurse Elena",
    online: true,
    unread: 0,
    lastTime: "2h",
    messages: [
      { id: "m1", from: "them", text: "Rhea Kiran has checked in for 12:30 PM physical.", time: "10:12 AM" },
      { id: "m2", from: "staff", text: "Thanks. Chart is open — please send her to holding after vitals.", time: "10:14 AM", seen: true },
    ],
  },
  {
    id: "st-doc",
    name: "Dr. Elena Cruz",
    firstName: "Elena",
    lastName: "Cruz",
    subtitle: "Attending · Internal Medicine",
    online: false,
    unread: 0,
    lastTime: "Yesterday",
    messages: [
      { id: "m1", from: "them", text: "Please hold release on Santos CBC until I review this afternoon.", time: "Yesterday" },
      { id: "m2", from: "staff", text: "Held. I’ll ping you when the rest of today’s labs land.", time: "Yesterday", seen: true },
    ],
  },
];

export const STAFF_NOTIFICATIONS: StaffNotification[] = [
  { id: "sn1", title: "Pending laboratory result", body: "CBC for Miguel Santos is waiting to be released.", time: "4m", href: "/results", unread: true },
  { id: "sn2", title: "New appointment today", body: "Angela Cruz · Fever consult at 1:15 PM with Dr. Elena Cruz.", time: "18m", href: "/dashboard", unread: true },
  { id: "sn3", title: "Unread message", body: "Laboratory Desk: two walk-in lipid panels are still pending scan.", time: "22m", href: "/messages", unread: true },
  { id: "sn4", title: "Patient registered", body: "A new HIS record was added to the desk queue.", time: "1h", href: "/patients", unread: false },
  { id: "sn5", title: "Active doctors", body: "Review physicians available for assignment.", time: "Yesterday", href: "/doctors", unread: false },
];

export function staffUnreadCount() {
  return STAFF_THREADS.reduce((sum, thread) => sum + thread.unread, 0);
}

export function staffAppointmentTone(status: StaffAppointment["status"]) {
  if (status === "ongoing") return { label: "Ongoing", className: "bg-[hsl(var(--st-maroon-soft))] text-[hsl(var(--st-maroon))]" };
  if (status === "checked-in") return { label: "Checked in", className: "bg-[hsl(var(--st-green-soft))] text-[hsl(var(--st-green))]" };
  if (status === "completed") return { label: "Completed", className: "bg-[hsl(var(--st-cream))] text-[hsl(var(--st-muted))]" };
  return { label: "Scheduled", className: "bg-[hsl(var(--st-green-soft))]/70 text-[hsl(var(--st-green))]" };
}

export const STAFF_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const STAFF_DAILY_APPOINTMENT_STATS = [
  { day: "Sat", clinic: 18, online: 12 },
  { day: "Sun", clinic: 10, online: 8 },
  { day: "Mon", clinic: 12, online: 40 },
  { day: "Tue", clinic: 22, online: 18 },
  { day: "Wed", clinic: 16, online: 24 },
  { day: "Thu", clinic: 20, online: 14 },
  { day: "Fri", clinic: 14, online: 22 },
];

export const STAFF_APPOINTMENT_STATS = [
  { day: "Sat", visitors: 32 },
  { day: "Sun", visitors: 21 },
  { day: "Mon", visitors: 50 },
  { day: "Tue", visitors: 38 },
  { day: "Wed", visitors: 44 },
  { day: "Thu", visitors: 36 },
  { day: "Fri", visitors: 41 },
];

export const STAFF_PATIENT_OVERVIEW = [
  { name: "Child", value: 8, color: "#F4B942" },
  { name: "Adult", value: 10, color: "#7BC67E" },
  { name: "Older", value: 12, color: "#E8A0B0" },
  { name: "Teen", value: 40, color: "#2A9B8F" },
];

export type StaffDeskPatient = {
  id: string;
  name: string;
  age: number;
  datetime: string;
  appointedFor: string;
  mode: "Online" | "Offline";
  hisId: string;
};

export const STAFF_DESK_PATIENTS: StaffDeskPatient[] = [
  { id: "p1", name: "Miguel Santos", age: 32, datetime: "20 Aug 2026 - 11:30 AM", appointedFor: "CBC", mode: "Offline", hisId: "DEMO-ACE-101" },
  { id: "p2", name: "Rhea Kiran", age: 38, datetime: "20 Aug 2026 - 12:30 PM", appointedFor: "BMP", mode: "Online", hisId: "DEMO-ACE-102" },
  { id: "p3", name: "Angela Cruz", age: 30, datetime: "20 Aug 2026 - 1:15 PM", appointedFor: "CT Scan", mode: "Offline", hisId: "DEMO-ACE-104" },
  { id: "p4", name: "Liza Tan", age: 35, datetime: "20 Aug 2026 - 2:30 PM", appointedFor: "2D Echo", mode: "Online", hisId: "DEMO-ACE-106" },
  { id: "p5", name: "Enzo Garcia", age: 28, datetime: "20 Aug 2026 - 3:45 PM", appointedFor: "MRI", mode: "Offline", hisId: "DEMO-ACE-109" },
  { id: "p6", name: "Sofia Mendoza", age: 22, datetime: "20 Aug 2026 - 4:20 PM", appointedFor: "X-Ray", mode: "Online", hisId: "DEMO-ACE-114" },
];

export type StaffUpcoming = {
  id: string;
  name: string;
  time: string;
  mode: "Online" | "Offline";
  day: number;
};

export const STAFF_UPCOMING: StaffUpcoming[] = [
  { id: "u12", name: "Irene Santiago", time: "4:05PM", mode: "Offline", day: 3 },
  { id: "u1", name: "Cody Fisher", time: "8:30AM", mode: "Offline", day: 4 },
  { id: "u2", name: "Rhea Kiran", time: "8:30AM", mode: "Online", day: 4 },
  { id: "u3", name: "Miguel Santos", time: "9:15AM", mode: "Offline", day: 4 },
  { id: "u4", name: "Liza Tan", time: "10:00AM", mode: "Online", day: 4 },
  { id: "u7", name: "Sofia Mendoza", time: "11:20AM", mode: "Offline", day: 4 },
  { id: "u8", name: "Katrina Ong", time: "1:00PM", mode: "Online", day: 4 },
  { id: "u10", name: "Paolo Diaz", time: "2:15PM", mode: "Offline", day: 4 },
  { id: "u11", name: "Bea Navarro", time: "3:40PM", mode: "Online", day: 4 },
  { id: "u5", name: "Angela Cruz", time: "1:15PM", mode: "Offline", day: 5 },
  { id: "u13", name: "Victor Ramos", time: "2:00PM", mode: "Online", day: 5 },
  { id: "u6", name: "Enzo Garcia", time: "3:45PM", mode: "Offline", day: 6 },
  { id: "u9", name: "Carlo Reyes", time: "4:10PM", mode: "Online", day: 7 },
];

export function shiftChart<T extends Record<string, number | string>>(rows: T[], month: number, keys: (keyof T)[]) {
  const delta = (month % 5) - 2;
  return rows.map((row) => {
    const next = { ...row };
    for (const key of keys) {
      const value = Number(row[key]);
      if (Number.isFinite(value)) {
        (next[key] as number) = Math.max(4, value + delta * 2);
      }
    }
    return next;
  });
}

