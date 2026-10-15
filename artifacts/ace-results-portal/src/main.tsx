import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initPortalPwaCapture } from "./lib/portal-pwa";

initPortalPwaCapture();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      /* install prompt still works via manual Add to Home Screen */
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
