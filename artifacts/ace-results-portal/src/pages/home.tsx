import { useLocation } from "wouter";
import { UserRound, ShieldCheck } from "lucide-react";
import aceLogo from "@assets/ace_logo_new_1781354030491.jpg";

export default function HomePage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">

      {/* ── Branding hero ───────────────────────────────────────── */}
      <div className="bg-[#1a5c2a] flex flex-col items-center pt-14 pb-12 px-6 text-center text-white">
        <div className="w-28 h-28 rounded-full bg-white flex items-center justify-center shadow-2xl ring-4 ring-white/20 mb-5">
          <img
            src={aceLogo}
            alt="Allied Care Experts Medical Center"
            className="w-[104px] h-[104px] object-contain rounded-full"
          />
        </div>
        <h1 className="text-2xl font-extrabold tracking-wide uppercase leading-snug">
          Allied Care Experts
        </h1>
        <p className="text-sm font-semibold tracking-[0.2em] text-green-200 uppercase mt-1">
          Medical Center
        </p>
        <p className="text-xs tracking-[0.3em] text-green-300/80 mt-0.5 uppercase">Cebu</p>
        <div className="mt-4 w-10 h-px bg-white/30" />
        <p className="mt-3 text-green-100/75 text-xs max-w-[260px] leading-relaxed">
          Secure diagnostic results management for patients, physicians, and hospital personnel.
        </p>
      </div>

      {/* ── Portal selection ────────────────────────────────────── */}
      <div className="flex-1 flex flex-col justify-center px-5 py-10">
        <div className="w-full max-w-sm mx-auto space-y-6">

          <div className="text-center">
            <h2 className="text-xl font-bold text-gray-800">Welcome</h2>
            <p className="text-sm text-gray-500 mt-0.5">How would you like to access the system?</p>
          </div>

          {/* Side-by-side buttons */}
          <div className="grid grid-cols-2 gap-4">

            {/* Patient Portal */}
            <button
              onClick={() => setLocation("/portal")}
              className="group flex flex-col items-center gap-3 bg-white border-2 border-gray-200 hover:border-[#1a5c2a] active:scale-[0.97] rounded-2xl px-4 py-6 text-center shadow-sm hover:shadow-md transition-all"
            >
              <div className="w-14 h-14 rounded-2xl bg-green-50 group-hover:bg-green-100 flex items-center justify-center transition-colors">
                <UserRound className="w-7 h-7 text-[#1a5c2a]" />
              </div>
              <div>
                <p className="font-bold text-gray-900 text-sm leading-tight">Patient Portal</p>
                <p className="text-[11px] text-gray-400 mt-1 leading-snug">Access with your code</p>
              </div>
            </button>

            {/* Staff Portal */}
            <button
              onClick={() => setLocation("/login")}
              className="group flex flex-col items-center gap-3 bg-[#1a5c2a] hover:bg-[#155224] active:scale-[0.97] rounded-2xl px-4 py-6 text-center shadow-sm hover:shadow-md transition-all"
            >
              <div className="w-14 h-14 rounded-2xl bg-white/15 group-hover:bg-white/25 flex items-center justify-center transition-colors overflow-hidden">
                <img src={aceLogo} alt="ACE" className="w-12 h-12 object-contain rounded-xl" />
              </div>
              <div>
                <p className="font-bold text-white text-sm leading-tight">Staff Portal</p>
                <p className="text-[11px] text-green-200 mt-1 leading-snug">Hospital personnel login</p>
              </div>
            </button>
          </div>

          <p className="text-center text-[11px] text-gray-400">
            Est. 2020 · Allied Care Experts Medical Center, Cebu
          </p>
        </div>
      </div>
    </div>
  );
}
