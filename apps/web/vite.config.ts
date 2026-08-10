import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, ".", "");
  return {
    base: normalizeBasePath(
      environment.VITE_BOOKBRIDGE_BASE_PATH || "/libraryHelper/",
    ),
    build: {
      outDir: "dist",
      sourcemap: true,
    },
    plugins: [react()],
  };
});

function normalizeBasePath(value: string): string {
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
}
