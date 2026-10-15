import { useEffect, useState } from "react";
import { fileToPhotoDataUrl } from "@/lib/doctor-photo";

const EVENT = "ace-patient-photo";

function storageKey(patientId: number | string) {
  return `ace_patient_photo_${patientId}`;
}

export function readPatientPhoto(patientId?: number | string | null) {
  if (patientId == null) return null;
  try {
    return window.localStorage.getItem(storageKey(patientId));
  } catch {
    return null;
  }
}

export function usePatientPhoto(patientId?: number | string | null) {
  const [photo, setPhoto] = useState<string | null>(() => readPatientPhoto(patientId));

  useEffect(() => {
    setPhoto(readPatientPhoto(patientId));
    const sync = () => setPhoto(readPatientPhoto(patientId));
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [patientId]);

  const savePhoto = async (file: File) => {
    const dataUrl = await fileToPhotoDataUrl(file);
    if (patientId == null) return dataUrl;
    window.localStorage.setItem(storageKey(patientId), dataUrl);
    window.dispatchEvent(new Event(EVENT));
    setPhoto(dataUrl);
    return dataUrl;
  };

  return { photo, savePhoto };
}
