import { useEffect, useState } from "react";
import { fileToPhotoDataUrl } from "@/lib/doctor-photo";

const EVENT = "ace-staff-photo";

function storageKey(userId: number | string) {
  return `ace_staff_photo_${userId}`;
}

export function readStaffPhoto(userId?: number | string | null) {
  if (userId == null) return null;
  try {
    return window.localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

export function useStaffPhoto(userId?: number | string | null) {
  const [photo, setPhoto] = useState<string | null>(() => readStaffPhoto(userId));

  useEffect(() => {
    setPhoto(readStaffPhoto(userId));
    const sync = () => setPhoto(readStaffPhoto(userId));
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
