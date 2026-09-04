import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import pkg from "../../package.json" with { type: "json" };

// A versão exibida na UI vem do package.json da raiz — uma fonte só, a mesma
// que a tag do release e a do binário no container.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
