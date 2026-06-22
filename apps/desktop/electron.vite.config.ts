import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    // Externalize node_modules deps, but BUNDLE the @aurascholar/* workspace
    // packages: their compiled ESM uses extensionless imports that raw Node
    // ESM can't resolve, so they must be bundled into the main output.
    plugins: [externalizeDepsPlugin({ exclude: ["@aurascholar/db", "@aurascholar/cite"] })],
    build: {
      outDir: "out/main",
      lib: { entry: resolve(__dirname, "electron/main.ts") },
      rollupOptions: {
        // better-sqlite3 is a native module — keep it external so its prebuilt
        // binary is required at runtime rather than bundled.
        external: ["better-sqlite3"],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      lib: { entry: resolve(__dirname, "electron/preload.ts") },
    },
  },
  renderer: {
    root: ".",
    plugins: [react()],
    build: {
      outDir: "out/renderer",
      target: "es2022",
      rollupOptions: {
        input: resolve(__dirname, "index.html"),
      },
    },
  },
});
