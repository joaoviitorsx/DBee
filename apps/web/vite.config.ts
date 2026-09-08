import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// A versão exibida na UI **não** vem daqui. Havia um `define` com a
// `pkg.version` da raiz, bumpada à mão; o binário do servidor passou a afirmar
// a tag do git (DBee.md §8), e manter as duas era garantir que um dia elas
// discordassem na mesma tela. Quem sabe o que está rodando é o servidor: a UI
// lê de `GET /meta/version`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
