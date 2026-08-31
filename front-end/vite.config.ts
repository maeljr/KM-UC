import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    server: {
      proxy: {
        "/api/generation": {
          target: "http://127.0.0.1:8001",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/generation/, ""),
        },
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  },
});