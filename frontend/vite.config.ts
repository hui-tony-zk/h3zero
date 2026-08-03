import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const rootEnv = loadEnv(mode, repositoryRoot, "H3_");
  const target = rootEnv.H3_MODAL_URL;

  return {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/@tiptap") || id.includes("node_modules/prosemirror") || id.includes("node_modules/@floating-ui")) return "editor";
            if (id.includes("node_modules/framer-motion")) return "motion";
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: target
        ? {
            "/api": {
              target,
              changeOrigin: true,
            },
          }
        : undefined,
    },
  };
});
