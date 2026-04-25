import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

const codexImageProxy = {
  target: "https://sgdr.funai.vip",
  changeOrigin: true,
  secure: true,
  rewrite: (path: string) => path.replace(/^\/codex-image-api/, ""),
};

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/codex-image-api": codexImageProxy,
    },
  },
  preview: {
    proxy: {
      "/codex-image-api": codexImageProxy,
    },
  },
});
