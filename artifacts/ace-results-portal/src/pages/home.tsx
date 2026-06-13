import { useLocation } from "wouter";
import { UserRound, Shield } from "lucide-react";
import aceLogo from "@assets/ace_logo_new_1781354030491.jpg";

export default function HomePage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen flex flex-col items-center bg-gray-50">

      {/* ── Header / Hero ──────────────────────────────────────── */}
      <div className="w-full bg-[#1a5c2a] flex flex-col items-center pt-10 pb-12 px-6 text-center text-white">
        {/* Logo */}
        <div className="w-28 h-28 rounded-full bg-white flex items-center justify-center shadow-xl ring-4 ring-white/30 mb-5">
          <img
            src={aceLogo}
            alt="Allied Care Experts Medical Center"
            className="w-24 h-24 object-contain rounded-full"
          />
        </div>

        {/* Name */}
        <h1 className="text-2xl font-extrabold tracking-wide uppercase leading-tight">
          Allied Care Experts
        </h1>
        <p className="text-lg font-semibold tracking-widest text-green-200 mt-0.5 uppercase">
          Medical Center
        </p>
        <p className="text-sm tracking-[0.25em] text-green-300 mt-1 uppercase">
          Cebu
        </p>

        {/* Tagline */}
        <p className="mt-4 text-green-100 text-sm max-w-xs leading-relaxed">
          Secure diagnostic results management for patients, physicians, and hospital personnel.
        </p>
      </div>

      {/* ── Welcome / Buttons ─────────────────────────────────── */}
      <div className="w-full max-w-md flex-1 flex flex-col justify-center px-6 py-10 space-y-6">

        <div className="text-center space-y-1">
          <h2 className="text-xl font-bold text-gray-800">Welcome</h2>
          <p className="text-sm text-gray-500">How would you like to access the system?</p>
        </div>

        <div className="space-y-4">
          {/* Patient Portal */}
          <button
            onClick={() => setLocation("/portal")}
            className="w-full group flex items-center gap-4 bg-white border-2 border-gray-200 hover:border-[#1a5c2a] rounded-2xl px-5 py-4 text-left shadow-sm hover:shadow-md transition-all duration-150"
          >
            <div className="w-12 h-12 rounded-xl bg-green-50 group-hover:bg-green-100 flex items-center justify-center flex-shrink-0 transition-colors">
              <UserRound className="w-6 h-6 text-[#1a5c2a]" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm leading-tight">Access Patient Portal</p>
              <p className="text-xs text-gray-500 mt-0.5 leading-snug">View your diagnostic results using your access code</p>
            </div>
          </button>

          {/* Staff Portal */}
          <button
            onClick={() => setLocation("/login")}
            className="w-full group flex items-center gap-4 bg-[#1a5c2a] hover:bg-[#155224] rounded-2xl px-5 py-4 text-left shadow-sm hover:shadow-md transition-all duration-150"
          >
            <div className="w-12 h-12 rounded-xl bg-white/15 group-hover:bg-white/25 flex items-center justify-center flex-shrink-0 transition-colors overflow-hidden">
              <img src={aceLogo} alt="ACE" className="w-11 h-11 object-contain rounded-lg" />
            </div>
            <div>
              <p className="font-semibold text-white text-sm leading-tight">Access Staff Portal</p>
              <p className="text-xs text-green-200 mt-0.5 leading-snug">For hospital personnel, physicians, and administrators</p>
            </div>
          </button>
        </div>

        <p className="text-center text-xs text-gray-400">
          Est. 2020 · Allied Care Experts Medical Center, Cebu
        </p>
      </div>
    </div>
  );
}
