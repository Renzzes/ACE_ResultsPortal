import { useState, useEffect } from "react";
import { useLocation, Redirect } from "wouter";
import {
  useGetPortalResults,
  getGetPortalResultsQueryKey,
  useGetPortalResultDownloadUrl,
  getGetPortalResultDownloadUrlQueryKey,
  usePatientPortalLogout,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Download, FileText, Image as ImageIcon, Eye, X, LogOut } from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  laboratory: "Laboratory", radiology: "Radiology", ultrasound: "Ultrasound",
  ct_scan: "CT Scan", mri: "MRI", ecg: "ECG", echo_2d: "2D Echo",
  rehabilitation: "Rehabilitation", other: "Other Diagnostics",
};

const CATEGORY_COLORS: Record<string, string> = {
  laboratory: "bg-blue-50 text-blue-700 border-blue-200",
  radiology: "bg-purple-50 text-purple-700 border-purple-200",
  ultrasound: "bg-teal-50 text-teal-700 border-teal-200",
  ct_scan: "bg-indigo-50 text-indigo-700 border-indigo-200",
  mri: "bg-violet-50 text-violet-700 border-violet-200",
  ecg: "bg-orange-50 text-orange-700 border-orange-200",
  echo_2d: "bg-pink-50 text-pink-700 border-pink-200",
  rehabilitation: "bg-green-50 text-green-700 border-green-200",
  other: "bg-gray-50 text-gray-600 border-gray-200",
};

interface ViewerState {
  url: string;
  fileType: string;
  fileName: string;
}

function ResultCard({ result, onView }: { result: any; onView: (r: any) => void }) {
  const [downloadEnabled, setDownloadEnabled] = useState(false);
  const [viewEnabled, setViewEnabled] = useState(false);

  const { data: downloadData } = useGetPortalResultDownloadUrl(
    result.id,
    { query: { enabled: downloadEnabled, queryKey: [...getGetPortalResultDownloadUrlQueryKey(result.id), "dl"] } }
  );

  const { data: viewData } = useGetPortalResultDownloadUrl(
    result.id,
    { query: { enabled: viewEnabled, queryKey: [...getGetPortalResultDownloadUrlQueryKey(result.id), "view"] } }
  );

  useEffect(() => {
    if (downloadData?.url && downloadEnabled) {
      const link = document.createElement("a");
      link.href = downloadData.url;
      link.download = result.originalFileName;
      link.click();
      setDownloadEnabled(false);
    }
  }, [downloadData?.url, downloadEnabled]);

  useEffect(() => {
    if (viewData?.url && viewEnabled) {
      onView({ url: viewData.url, fileType: result.fileType, fileName: result.originalFileName });
      setViewEnabled(false);
    }
  }, [viewData?.url, viewEnabled]);

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
            {result.fileType === "pdf"
              ? <FileText className="w-5 h-5 text-red-500" />
              : <ImageIcon className="w-5 h-5 text-blue-500" />
            }
          </div>
          <div className="min-w-0">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[result.category] ?? "bg-gray-50 text-gray-700 border-gray-200"}`}>
              {CATEGORY_LABELS[result.category] ?? result.category}
            </span>
            <p className="font-medium mt-1 truncate">{result.originalFileName}</p>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span className="uppercase">{result.fileType}</span>
              <span>Released {result.dateReleased ? new Date(result.dateReleased).toLocaleDateString("en-PH") : "—"}</span>
              <span>Uploaded {new Date(result.uploadedAt).toLocaleDateString("en-PH")}</span>
            </div>
            {result.remarks && (
              <p className="text-xs text-muted-foreground mt-1 italic">{result.remarks}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setViewEnabled(true)}
            className="gap-1.5"
          >
            <Eye className="w-4 h-4" />
            View
          </Button>
          <Button
            size="sm"
            onClick={() => setDownloadEnabled(true)}
            className="gap-1.5"
          >
            <Download className="w-4 h-4" />
            Download
          </Button>
        </div>
      </div>
    </div>
  );
}

function FileViewer({ viewer, onClose }: { viewer: ViewerState; onClose: () => void }) {
  const isImage = viewer.fileType === "jpeg" || viewer.fileType === "png";
  const isPdf = viewer.fileType === "pdf";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/60 border-b border-white/10 flex-shrink-0">
        <div className="text-white min-w-0">
          <p className="font-medium truncate text-sm">{viewer.fileName}</p>
          <p className="text-xs text-white/60 uppercase">{viewer.fileType}</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={viewer.url}
            download={viewer.fileName}
            className="flex items-center gap-1.5 text-sm text-white/80 hover:text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Download className="w-4 h-4" />
            Save
          </a>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/20 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        {isImage && (
          <img
            src={viewer.url}
            alt={viewer.fileName}
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          />
        )}
        {isPdf && (
          <iframe
            src={viewer.url}
            title={viewer.fileName}
            className="w-full h-full rounded-lg shadow-2xl bg-white"
            style={{ minHeight: "80vh" }}
          />
        )}
      </div>
    </div>
  );
}

export default function PortalResultsPage() {
  const [, setLocation] = useLocation();
  const { portalAuth, portalLogout } = useAuth();
  const { toast } = useToast();
  const [viewer, setViewer] = useState<ViewerState | null>(null);

  const portalLogoutMutation = usePatientPortalLogout();

  if (!portalAuth.patient || !portalAuth.token) {
    return <Redirect to="/portal" />;
  }

  const { data: results, isLoading } = useGetPortalResults({
    query: { queryKey: getGetPortalResultsQueryKey() }
  });

  const handleLogout = () => {
    portalLogoutMutation.mutate(undefined, {
      onSettled: () => {
        portalLogout();
        setLocation("/portal");
      },
    });
  };

  const resultList = Array.isArray(results) ? results : [];

  return (
    <>
      {viewer && <FileViewer viewer={viewer} onClose={() => setViewer(null)} />}

      <div className="min-h-screen bg-muted/30">
        {/* Header */}
        <header className="bg-card border-b border-border px-4 py-4 sticky top-0 z-10">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <div>
              <h1 className="font-bold text-primary">ACE Medical Center</h1>
              <p className="text-sm text-muted-foreground">
                {portalAuth.patient.lastName}, {portalAuth.patient.firstName}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2">
              <LogOut className="w-4 h-4" />Logout
            </Button>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-primary">My Diagnostic Results</h2>
            <p className="text-muted-foreground text-sm">Your released results from ACE Medical Center Cebu</p>
          </div>

          {isLoading ? (
            <div className="text-center py-16 text-muted-foreground">Loading your results...</div>
          ) : resultList.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto">
                <FileText className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-lg font-medium text-muted-foreground">No results available yet</p>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Your results will appear here once released by our medical team. Please check back later.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {resultList.map((r) => (
                <ResultCard key={r.id} result={r} onView={setViewer} />
              ))}
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground pb-4">
            ACE Medical Center Cebu — Confidential Medical Records
          </p>
        </main>
      </div>
    </>
  );
}
