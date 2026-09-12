import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.LEDGERLY_VITE_API_TARGET || "http://localhost:8788";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": apiTarget,
      "/auth": apiTarget,
      "/system": apiTarget,
      "/docs": apiTarget,
      "/openapi.json": apiTarget,
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
