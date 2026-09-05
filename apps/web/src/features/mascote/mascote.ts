/**
 * O mascote DBee em vários humores.
 *
 * PNGs 3D pesados (~1 MB) foram reescalados para o tamanho de exibição e
 * convertidos em WebP (~30 KB cada) em `src/assets/`. Importados como URL pelo
 * Vite — entram no grafo do bundle, ganham hash e cache longo, mas cada humor é
 * baixado só quando a `<img>` dele aparece.
 */
import carregando from "../../assets/carregando.webp";
import dormindo from "../../assets/dormindo.webp";
import feliz from "../../assets/feliz.webp";
import joia from "../../assets/joia.webp";
import laptop from "../../assets/laptop.webp";
import pensando from "../../assets/pensando.webp";
import sucesso from "../../assets/sucesso.webp";

export type Humor =
  | "feliz"
  | "laptop"
  | "sucesso"
  | "carregando"
  | "pensando"
  | "dormindo"
  | "joia";

export const MASCOTE: Readonly<Record<Humor, string>> = {
  feliz,
  laptop,
  sucesso,
  carregando,
  pensando,
  dormindo,
  joia,
};
