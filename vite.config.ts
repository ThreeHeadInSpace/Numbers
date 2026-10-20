import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  ...(mode === "pages-demo"
    ? {
        base: "/Numbers/",
        envDir: false,
        envPrefix: [],
        build: { outDir: "dist/pages" },
      }
    : { build: { outDir: "dist/client" } }),
}));
