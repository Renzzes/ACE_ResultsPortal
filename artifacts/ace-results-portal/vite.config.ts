import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const repoRoot = path.resolve(import.meta.dirname, "../..");

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const basePath = env.BASE_PATH || "/";
  const frontendPort = Number(env.VITE_PORT || 8080);
  // Never use process PORT here: Vite/preview often sets PORT to the UI port (8080),
  // which would proxy /api to itself and 404 login.
  const apiPort = Number(env.API_PORT || 5000);

  if (Number.isNaN(frontendPort) || frontendPort <= 0) {
    throw new Error(`Invalid VITE_PORT value: "${env.VITE_PORT}"`);
  }
  if (Number.isNaN(apiPort) || apiPort <= 0) {
    throw new Error(`Invalid PORT value: "${env.PORT}"`);
  }

  return {
    envDir: repoRoot,
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
        ? [
            await import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, ".."),
              }),
            ),
            await import("@replit/vite-plugin-dev-banner").then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port: frontendPort,
      strictPort: true,
      host: "0.0.0.0",
      allowedHosts: true,
      watch: {
        usePolling: true,
        interval: 300,
      },
      fs: {
        strict: true,
      },
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
          ws: true,
        },
      },
    },
    preview: {
      port: frontendPort,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
