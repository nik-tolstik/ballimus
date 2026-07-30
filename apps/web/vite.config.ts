import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const publicHost = process.env.VITE_PUBLIC_HOST;
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "@tanstack/react-query"],
          "ui-vendor": ["framer-motion", "lucide-react", "radix-ui", "sonner", "next-themes"],
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    allowedHosts: publicHost === undefined ? [] : [publicHost],
    proxy: {
      "/v1": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
