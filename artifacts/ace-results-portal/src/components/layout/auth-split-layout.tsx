import type { ReactNode } from "react";

export function publicAsset(file: string) {
  const base = import.meta.env.BASE_URL || "/";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}${file.replace(/^\//, "")}`;
}

export function AuthSplitLayout({
  children,
  onRegister,
}: {
  children: ReactNode;
  onRegister?: () => void;
}) {
  return (
    <div className="min-h-screen bg-white lg:grid lg:grid-cols-2">
      <button
        type="button"
        onClick={onRegister}
        className="relative hidden min-h-screen w-full cursor-pointer overflow-hidden bg-[#f3f3f3] text-left lg:block"
      >
        <img
          src={publicAsset("Register_Illustration.png")}
          alt="Not yet registered? Click here to create an account"
          className="absolute inset-0 h-full w-full object-contain object-center"
        />
      </button>

      <div className="flex min-h-screen w-full flex-col justify-center px-5 py-10 sm:px-8 md:px-12 lg:px-10 xl:px-16">
        <div className="mx-auto w-full max-w-xl lg:max-w-none">
          <img
            src={publicAsset("logo_ace.png")}
            alt="Allied Care Experts Medical Center - Cebu"
            className="mx-auto h-32 w-auto object-contain sm:h-36 lg:h-40"
          />
          <p className="mx-auto mt-3 mb-8 max-w-md text-center text-sm text-gray-500">
            Secure access to diagnostic results for patients, physicians, and hospital staff.
          </p>
          {children}
        </div>
      </div>
    </div>
  );
}
