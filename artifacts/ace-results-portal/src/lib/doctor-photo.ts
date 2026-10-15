import { useEffect, useState } from "react";

const EVENT = "ace-doctor-photo";

function storageKey(userId: number | string) {
  return `ace_doctor_photo_${userId}`;
}

export function readDoctorPhoto(userId?: number | string | null) {
  if (userId == null) return null;
  try {
    return window.localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

export function useDoctorPhoto(userId?: number | string | null) {
  const [photo, setPhoto] = useState<string | null>(() => readDoctorPhoto(userId));

  useEffect(() => {
    setPhoto(readDoctorPhoto(userId));
    const sync = () => setPhoto(readDoctorPhoto(userId));
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [userId]);

  const savePhoto = async (file: File) => {
    const dataUrl = await fileToPhotoDataUrl(file);
    if (userId == null) return dataUrl;
    window.localStorage.setItem(storageKey(userId), dataUrl);
    window.dispatchEvent(new Event(EVENT));
    setPhoto(dataUrl);
    return dataUrl;
  };

  return { photo, savePhoto };
}

export function fileToPhotoDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Please choose a JPG or PNG image."));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error("Image must be under 5 MB."));
      return;
    }
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const max = 512;
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not process that image."));
        return;
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", 0.88));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that image."));
    };
    image.src = objectUrl;
  });
}

export function doctorInitials(firstName?: string, lastName?: string) {
  return `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase() || "DR";
}

export function isCompactViewport() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
}
