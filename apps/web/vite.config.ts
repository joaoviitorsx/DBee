import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import pkg from "../../package.json" with { type: "json" };

// A versão exibida na UI vem do package.json da raiz — uma fonte só, a mesma
// que a tag do release e a do binário no container.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    // O front fala com o server em :3001 pelo mesmo origin em dev.
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
