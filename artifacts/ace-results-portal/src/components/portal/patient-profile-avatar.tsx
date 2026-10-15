import { Camera } from "lucide-react";
import { useId, useRef } from "react";
import { cn } from "@/lib/utils";
import { portalInitials } from "@/lib/patient-identity";
import { usePatientPhoto } from "@/lib/patient-photo";

const SIZE_CLASS = {
  hero: "h-40 w-40 text-4xl sm:h-[180px] sm:w-[180px] xl:h-[196px] xl:w-[196px] xl:text-5xl",
  dashboard: "h-24 w-24 text-xl",
  lg: "h-11 w-11 text-sm",
  md: "h-10 w-10 text-xs",
  sm: "h-9 w-9 text-[11px]",
} as const;

type PatientProfileAvatarProps = {
  patientId?: number | string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  size?: keyof typeof SIZE_CLASS;
  src?: string | null;
  editable?: boolean;
  className?: string;
};

export function PatientProfileAvatar({
  patientId,
  firstName,
  lastName,
  fullName,
  size = "md",
  src,
  editable = false,
  className,
}: PatientProfileAvatarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { photo, savePhoto } = usePatientPhoto(patientId);
  const imageSrc = photo || src;
  const initials = portalInitials(firstName, lastName);
  const alt = fullName || [firstName, lastName].filter(Boolean).join(" ") || "Patient profile photo";

  async function onFile(file?: File) {
    if (!file) return;
    await savePhoto(file);
  }

  const avatar = (
    <div
      className={cn(
        "relative overflow-hidden rounded-full",
        SIZE_CLASS[size],
        size === "hero" || size === "dashboard"
          ? "bg-[#d7e6dc] shadow-[0_10px_28px_rgb(21_61_43_/_0.14)] ring-[4px] ring-white"
          : "bg-[hsl(var(--pt-green))] text-white ring-2 ring-white/25",
        className,
      )}
    >
      {imageSrc ? (
        <img src={imageSrc} alt={alt} className="h-full w-full object-cover" />
      ) : size === "hero" ? (
        <PortraitFallback initials={initials} name={alt} />
      ) : (
        <span className="flex h-full w-full items-center justify-center font-semibold tracking-wide" aria-label={alt}>
          {initials}
        </span>
      )}
    </div>
  );

  if (!editable) return avatar;

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--pt-green))] focus-visible:ring-offset-2"
        aria-label={imageSrc ? `Change profile photo for ${alt}` : `Add a profile photo for ${alt}`}
      >
        {avatar}
        <span className={`absolute bottom-0 right-0 flex items-center justify-center rounded-full bg-[#2F7D4A] text-white ring-2 ring-white ${
          size === "sm" ? "h-4 w-4" : "h-5 w-5"
        }`}>
          <Camera className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void onFile(file);
        }}
      />
    </div>
  );
}

function PortraitFallback({ initials, name }: { initials: string; name: string }) {
  const gradientId = useId().replace(/:/g, "");
  const bgId = `${gradientId}-bg`;
  const toneId = `${gradientId}-tone`;
  return (
    <div className="relative h-full w-full" aria-label={name}>
      <svg viewBox="0 0 200 200" className="h-full w-full" aria-hidden>
        <defs>
          <linearGradient id={bgId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e7f3eb" />
            <stop offset="100%" stopColor="#c5d9cc" />
          </linearGradient>
          <linearGradient id={toneId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f3e4d4" />
            <stop offset="100%" stopColor="#d7b899" />
          </linearGradient>
        </defs>
        <rect width="200" height="200" fill={`url(#${bgId})`} />
        <circle cx="100" cy="86" r="42" fill={`url(#${toneId})`} />
        <ellipse cx="100" cy="210" rx="78" ry="86" fill="#2f7d4a" />
        <ellipse cx="100" cy="214" rx="70" ry="78" fill="#3f8f5a" />
      </svg>
      <span className="absolute inset-x-0 bottom-7 text-center text-lg font-bold tracking-[0.18em] text-white">
        {initials}
      </span>
    </div>
  );
}
