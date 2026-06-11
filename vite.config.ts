import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import type { ClientRequest } from "node:http";
import { fileURLToPath, URL } from "node:url";

function normalizeCodexProxyHeaders(proxyReq: ClientRequest) {
  proxyReq.removeHeader("origin");
  proxyReq.removeHeader("referer");
  proxyReq.setHeader("User-Agent", "ArtWorkshop-Proxy/1.0");
}

function rewriteCodexImageProxyPath(proxyPath: string) {
  const stripped = proxyPath.replace(/^\/codex-image-api/, "");
  if (stripped === "/v1" || stripped.startsWith("/v1/")) {
    return stripped;
  }

  return `/v1${stripped.startsWith("/") ? stripped : `/${stripped}`}`;
}

const codexImageProxy = {
  target: "https://www.tokenbook.cc",
  changeOrigin: true,
  secure: true,
  rewrite: rewriteCodexImageProxyPath,
  configure: (proxy: { on: (event: "proxyReq", handler: (proxyReq: ClientRequest) => void) => void }) => {
    proxy.on("proxyReq", normalizeCodexProxyHeaders);
  },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const imageJobApiUrl = env.ART_WORKSHOP_IMAGE_JOB_API_URL || "http://127.0.0.1:8787";
  const wavespeedApiKey = env.WAVESPEED_API_KEY || process.env.WAVESPEED_API_KEY || "";
  const wavespeedProxy = {
    target: "https://api.wavespeed.ai",
    changeOrigin: true,
    secure: true,
    rewrite: (path: string) => path.replace(/^\/wavespeed-api/, "/api/v3"),
    configure: (proxy: {
      on: (event: "proxyReq", handler: (proxyReq: { setHeader: (name: string, value: string) => void }) => void) => void;
    }) => {
      proxy.on("proxyReq", (proxyReq) => {
        if (wavespeedApiKey) {
          proxyReq.setHeader("Authorization", `Bearer ${wavespeedApiKey}`);
        }
      });
    },
  };

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      proxy: {
        "/api": {
          target: imageJobApiUrl,
          changeOrigin: true,
          xfwd: true,
        },
        "/codex-image-api": codexImageProxy,
        "/wavespeed-api": wavespeedProxy,
      },
    },
    preview: {
      proxy: {
        "/api": {
          target: imageJobApiUrl,
          changeOrigin: true,
          xfwd: true,
        },
        "/codex-image-api": codexImageProxy,
        "/wavespeed-api": wavespeedProxy,
      },
    },
  };
});
