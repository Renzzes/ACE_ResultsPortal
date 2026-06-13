import { useLocation } from "wouter";
import { UserRound, Shield } from "lucide-react";
import aceLogo from "@assets/ace_logo_new_1781354030491.jpg";

export default function HomePage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#0a1f5c] flex-col items-center justify-center p-12">
        <div className="text-center text-white space-y-4 max-w-sm">
          <div className="w-24 h-24 rounded-2xl overflow-hidden mx-auto mb-6 bg-white flex items-center justify-center">
            <img src={aceLogo} alt="ACE Medical Center" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">ACE Medical Center</h1>
          <p className="text-blue-200 text-lg">Cebu</p>
          <div className="border-t border-white/20 pt-6 mt-6">
            <p className="text-blue-100 text-sm leading-relaxed">
              Secure diagnostic results management for patients, physicians, and hospital personnel.
            </p>
          </div>
        </div>
      </div>

      {/* Right panel — portal selection */}
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-8">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl overflow-hidden mx-auto bg-white border border-border flex items-center justify-center">
              <img src={aceLogo} alt="ACE Medical Center" className="w-full h-full object-contain" />
            </div>
            <h1 className="text-2xl font-bold text-[#0a1f5c]">ACE Medical Center</h1>
            <p className="text-muted-foreground text-sm">Cebu</p>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-gray-900">Welcome</h2>
            <p className="text-muted-foreground text-sm">Choose how you would like to access the system.</p>
          </div>

          <div className="space-y-4">
            {/* Patient Portal */}
            <button
              onClick={() => setLocation("/portal")}
              className="w-full group flex items-center gap-4 bg-white border-2 border-border hover:border-[#0a1f5c] rounded-xl p-5 text-left transition-all duration-150 shadow-sm hover:shadow-md"
            >
              <div className="w-12 h-12 bg-teal-50 group-hover:bg-teal-100 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors">
                <UserRound className="w-6 h-6 text-teal-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900 text-sm">Access Patient Portal</p>
                <p className="text-xs text-muted-foreground mt-0.5">View your diagnostic results using your access code</p>
              </div>
            </button>

            {/* Staff Portal */}
            <button
              onClick={() => setLocation("/login")}
              className="w-full group flex items-center gap-4 bg-[#0a1f5c] hover:bg-[#0d2870] rounded-xl p-5 text-left transition-all duration-150 shadow-sm hover:shadow-md"
            >
              <div className="w-12 h-12 bg-white rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0">
                <img src={aceLogo} alt="ACE" className="w-full h-full object-contain" />
              </div>
              <div>
                <p className="font-semibold text-white text-sm">Access Staff Portal</p>
                <p className="text-xs text-blue-200 mt-0.5">For hospital personnel, physicians, and administrators</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
