import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    cors: true,
    // the repo root contains a `.devcontainer -> .` symlink; never walk into it
    watch: {
      ignored: ["**/.devcontainer/**", "**/dist/**", "**/.git/**"],
      followSymlinks: false,
    },
    fs: { strict: false },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 20000,
    // one self-contained HTML file: double-click it, no server needed
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
