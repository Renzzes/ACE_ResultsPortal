export const PORTAL_MOCK = {
  firstName: "Maria",
  middleName: "Elena",
  lastName: "Cruz",
  patientHisId: "DEV-PT-001",
  dateOfBirth: "May 12, 1988",
  gender: "Female",
  age: "38 years old",
  bloodType: "O+",
  mobileNumber: "+63 917 555 0140",
  email: "maria.cruz@email.test",
  username: "maria.cruz",
  address: "123 Mango Avenue, Cebu City",
  civilStatus: "Married",
  occupation: "Teacher",
  philHealthNo: "12-345678901-2",
  lastVisit: "August 26, 2026",
  photo: "patient-portrait.png",
  appointment: {
    time: "10:30 AM",
    date: "Tue, Aug 26, 2026",
    month: "August",
    day: "26",
    reference: "ACE-APT-24086",
    clinic: "Internal Medicine Clinic",
    doctorId: "doc-1",
    doctorName: "Dr. Elena Cruz",
    doctorSpecialty: "Internal Medicine",
    location: "ACE Medical Center, Cebu",
    room: "Clinic 3, 2nd Floor",
    status: "Confirmed",
    type: "Follow-up consultation",
    duration: "30 minutes",
    purpose: "Review of recent laboratory results (CBC, fasting blood sugar, and lipid profile) and blood pressure follow-up.",
    notes: "Please arrive 15 minutes early and bring a valid ID. Fasting is not required for this visit.",
  },
  nextAppointment: {
    time: "2:00 PM",
    date: "Wed, Sep 9, 2026",
    shortDate: "Sep 09, 2026",
  },
  doctors: [
    { id: "doc-1", name: "Dr. Elena Cruz", specialty: "Internal Medicine", tone: "bg-[#dceee3] text-[#2f7d4a]" },
    { id: "doc-2", name: "Dr. Paolo Reyes", specialty: "Family Medicine", tone: "bg-[#f8ecef] text-[#8e3344]" },
    { id: "doc-3", name: "Dr. Marco Villanueva", specialty: "Cardiology", tone: "bg-[#eef3ea] text-[#1a4d2e]" },
    { id: "doc-4", name: "Dr. Hannah Lim", specialty: "Radiology", tone: "bg-[#f4e9d8] text-[#8a5a2b]" },
  ],
  departments: [
    { id: "all", label: "All" },
    { id: "laboratory", label: "Laboratory" },
    { id: "radiology", label: "Radiology" },
    { id: "ultrasound", label: "Ultrasound" },
    { id: "ct_scan", label: "CT Scan" },
    { id: "mri", label: "MRI" },
    { id: "ecg", label: "ECG" },
    { id: "echo_2d", label: "2D Echo" },
    { id: "internal_medicine", label: "Internal Medicine" },
  ],
  results: [
    { id: "res-1", name: "CBC Panel.pdf", category: "Laboratory", date: "Jul 03, 2026", status: "Released", fileType: "pdf", remarks: "Within reference range" },
    { id: "res-2", name: "Fasting Blood Sugar.pdf", category: "Laboratory", date: "Jul 03, 2026", status: "Released", fileType: "pdf", remarks: "Follow-up with Internal Medicine" },
    { id: "res-3", name: "Lipid Profile.pdf", category: "Laboratory", date: "Jul 03, 2026", status: "Released", fileType: "pdf", remarks: null },
    { id: "res-4", name: "Chest X-ray.pdf", category: "Radiology", date: "May 18, 2026", status: "Released", fileType: "pdf", remarks: "No acute cardiopulmonary findings" },
    { id: "res-5", name: "ECG Tracing.pdf", category: "ECG", date: "May 18, 2026", status: "Released", fileType: "pdf", remarks: null },
  ],
  history: [
    { id: "h1", kind: "result" as const, title: "CBC Panel.pdf released", detail: "Laboratory", time: "Jul 03, 2026 — 09:15 AM" },
    { id: "h2", kind: "result" as const, title: "Fasting Blood Sugar.pdf released", detail: "Laboratory", time: "Jul 03, 2026 — 09:10 AM" },
    { id: "h3", kind: "result" as const, title: "Lipid Profile.pdf released", detail: "Laboratory", time: "Jul 03, 2026 — 09:08 AM" },
    { id: "h4", kind: "appointment" as const, title: "Appointment scheduled", detail: "Internal Medicine Clinic · Dr. Elena Cruz", time: "Jun 25, 2026 — 02:30 PM" },
    { id: "h5", kind: "result" as const, title: "Chest X-ray.pdf released", detail: "Radiology", time: "May 18, 2026 — 11:40 AM" },
    { id: "h6", kind: "result" as const, title: "ECG Tracing.pdf released", detail: "ECG", time: "May 18, 2026 — 11:45 AM" },
    { id: "h7", kind: "visit" as const, title: "Clinic visit completed", detail: "ACE Medical Center, Cebu", time: "May 18, 2026 — 10:00 AM" },
  ],
  notifications: [],
  health: {
    bloodType: "O+",
    height: "162 cm",
    weight: "58 kg",
    bmi: "22.1",
    bmiStatus: "Normal",
  },
  activity: [
    { id: "a1", title: "Lab result released", detail: "CBC Panel.pdf", time: "Jul 03, 2026 — 09:15 AM", kind: "result" as const },
    { id: "a2", title: "Appointment scheduled", detail: "Internal Medicine Clinic", time: "Jun 25, 2026 — 02:30 PM", kind: "appointment" as const },
    { id: "a3", title: "Lab result released", detail: "Fasting Blood Sugar.pdf", time: "Jul 03, 2026 — 09:10 AM", kind: "result" as const },
  ],
} as const;

export function portalMockName() {
  return `${PORTAL_MOCK.firstName} ${PORTAL_MOCK.middleName} ${PORTAL_MOCK.lastName}`;
}

export function portalMockInitials() {
  return "MC";
}

export type PortalMockResult = (typeof PORTAL_MOCK.results)[number];

export function portalPhotoKey(patientId?: number | string | null) {
  return patientId ?? PORTAL_MOCK.patientHisId;
}
