import { customFetch } from "@workspace/api-client-react";

export type StaffDeskResult = {
  id: number;
  patientId: number;
  category: string;
  originalFileName: string;
  status: string;
  uploadedAt: string;
  patientHisId: string;
  patientName: string;
};

export type StaffDeskPatient = {
  id: number;
  patientHisId: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  dateOfBirth: string;
  createdAt: string;
  resultCount: number;
};

export type StaffDeskReview = {
  id: number;
  resultId: number;
  physicianId: number;
  physicianName: string;
  comment: string | null;
  reviewedAt: string;
  patientId: number;
  patientHisId: string;
  patientName: string;
  category: string;
  originalFileName: string;
};

export type StaffDeskOverview = {
  pendingLabel: string;
  stats: {
    totalPatients: number;
    totalPhysicians: number;
    totalPending: number;
    totalReleased: number;
    totalArchived: number;
    uploadsToday: number;
    reviewedToday: number;
    totalResults: number;
  };
  activity7d: Array<{ date: string; label: string; count: number }>;
  statusBreakdown: Array<{ status: string; count: number }>;
  categoryBreakdown: Array<{ category: string; count: number }>;
  recentPatients: StaffDeskPatient[];
  recentResults: StaffDeskResult[];
  pendingResults: StaffDeskResult[];
  recentReviews: StaffDeskReview[];
  canViewAudit: boolean;
  recentActivity: Array<{
    id: number;
    action: string;
    userId?: number | null;
    userName?: string | null;
    patientHisId?: string | null;
    resultId?: number | null;
    details?: string | null;
    createdAt: string;
  }>;
};

export function fetchStaffDeskOverview() {
  return customFetch<StaffDeskOverview>("/api/dashboard/staff-desk");
}
