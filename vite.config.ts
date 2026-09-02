import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
  port: 5173,
  proxy: {
    "/api": "http://localhost:8787",
    "/auth": "http://localhost:8787",
    "/system": "http://localhost:8787",
    "/docs": "http://localhost:8787",
    "/openapi.json": "http://localhost:8787",
  },
},
build: { outDir: "dist", emptyOutDir: true },
});
