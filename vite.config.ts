import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const base = process.env.VITE_BASE_PATH || env.VITE_BASE_PATH || "/";
  return {
    base,
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (id.includes("@supabase")) return "supabase";
            if (
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/scheduler/")
            )
              return "react";
            if (id.includes("/qrcode/")) return "qr";
          },
        },
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "prompt",
        manifest: {
          name: "Agronorte · Recepción de Sandía",
          short_name: "Agronorte",
          lang: "es-PY",
          theme_color: "#36741B",
          background_color: "#f5f7f0",
          display: "standalone",
          start_url: base,
          scope: base,
          icons: [
            {
              src: base + "icon-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: base + "icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
          ],
        },
        workbox: {
          navigateFallback: base + "index.html",
          globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        },
      }),
    ],
  };
});
