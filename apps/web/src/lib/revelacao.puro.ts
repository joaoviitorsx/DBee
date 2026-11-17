/**
 * Raio do círculo que, centrado em (x, y), cobre a janela inteira: a distância
 * até o canto mais longe. Usado pela revelação da troca de tema.
 */
export function raioDeRevelacao(x: number, y: number, largura: number, altura: number): number {
  return Math.hypot(Math.max(x, largura - x), Math.max(y, altura - y));
}

/** Um quadro da troca de tema: o recorte do tema novo e onde a abelha está. */
export interface QuadroDeMel {
  readonly recorte: string;
  readonly x: number;
  readonly y: number;
}

/** Fração do tempo total em que a abelha voa; o resto é o mel assentando. */
const VOO = 0.82;

/** Arranca devagar, cruza rápido, desacelera (easeInOutCubic). */
function voo(u: number): number {
  const v = Math.min(Math.max(u / VOO, 0), 1);
  return v < 0.5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2;
}

const n1 = (v: number): string => v.toFixed(1);

/**
 * Catmull-Rom (tensão 0,5) virado Bézier cúbica: borda contínua, sem bico.
 * `fechada` liga o último ponto no primeiro.
 */
export function curvaSuave(pts: readonly (readonly [number, number])[], fechada: boolean): string {
  const k = pts.length;
  const at = (i: number): readonly [number, number] => {
    if (fechada) return pts[((i % k) + k) % k] ?? [0, 0];
    return pts[Math.min(Math.max(i, 0), k - 1)] ?? [0, 0];
  };
  let d = "";
  const fim = fechada ? k : k - 1;
  for (let i = 0; i < fim; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${n1(c1x)},${n1(c1y)} ${n1(c2x)},${n1(c2y)} ${n1(p2[0])},${n1(p2[1])}`;
  }
  return d;
}

/**
 * Mola amortecida, um passo semi-implícito. Levemente subamortecida (ζ≈0,8)
 * para o mel passar um fio do alvo e assentar.
 */
function mola(x: number, v: number, alvo: number, k: number, dt: number): [number, number] {
  const c = 2 * Math.sqrt(k) * 0.8;
  const v2 = v + (k * (alvo - x) - c * v) * dt;
  return [x + v2 * dt, v2];
}

const SUBPASSOS = 12;

/**
 * "Poça de mel" (docs/arte-login.md, "Troca de tema", v2): uma gota nasce no
 * botão e se espalha numa poça de borda orgânica até cobrir a janela. A abelha
 * puxa a poça em direção ao centro; cada ponto da borda segue o alvo com mola
 * amortecida, mais rígida na direção da abelha e mais arrastada nos lados,
 * com lóbulos que diminuem até a borda se acomodar.
 *
 * Devolve `quadros + 1` quadros igualmente espaçados no tempo: a física já
 * embute a aceleração, então a animação entre eles é linear.
 */
export function quadrosDePoca(
  quadros: number,
  bx: number,
  by: number,
  largura: number,
  altura: number,
): QuadroDeMel[] {
  const PONTOS = 18;
  const rmax = raioDeRevelacao(bx, by, largura, altura) * 1.2;
  const dirx = largura / 2 - bx;
  const diry = altura / 2 - by;
  const tb = Math.atan2(diry, dirx);
  const angulos = Array.from({ length: PONTOS }, (_, j) => (2 * Math.PI * j) / PONTOS);
  const peso = angulos.map((a) => ((1 + Math.cos(a - tb)) / 2) ** 2);
  const fase = angulos.map((_, j) => (j * 2.399) % (2 * Math.PI)); // ângulo áureo: irregular sem acaso
  const r = angulos.map(() => 4);
  const v = angulos.map(() => 0);
  const saida: QuadroDeMel[] = [];
  const dt = 1 / quadros / SUBPASSOS;
  for (let q = 0; q <= quadros; q++) {
    const u = q / quadros;
    // A abelha voa colada à borda da frente, um corpo à frente do mel: é ela
    // que puxa, e o olho segue um ponto só.
    const frente = Math.max(...angulos.map((_, j) => (r[j] ?? 0) * (peso[j] ?? 0)));
    const db = q === 0 ? 0 : frente + 22 + 30 * voo(u);
    const pts = angulos.map((a, j): [number, number] => {
      const rr = Math.max(r[j] ?? 0, 0);
      return [bx + rr * Math.cos(a), by + rr * Math.sin(a)];
    });
    saida.push({
      recorte: `path("M${n1(pts[0]?.[0] ?? bx)},${n1(pts[0]?.[1] ?? by)}${curvaSuave(pts, true)} Z")`,
      x: bx + Math.cos(tb) * db,
      y: by + Math.sin(tb) * db,
    });
    for (let s = 0; s < SUBPASSOS; s++) {
      const us = u + (s / SUBPASSOS) / quadros;
      const dbs = voo(us) * rmax * 1.15;
      const assenta = Math.min(Math.max((us - 0.55) / 0.45, 0), 1);
      for (let j = 0; j < PONTOS; j++) {
        const w = peso[j] ?? 0;
        const lobo = 1 + 0.09 * (1 - assenta) * Math.sin(3 * (angulos[j] ?? 0) + (fase[j] ?? 0) + us * 4);
        const puxado = dbs * (0.5 + 0.42 * w) * lobo;
        const alvo = puxado + (rmax - puxado) * assenta;
        [r[j], v[j]] = mola(r[j] ?? 0, v[j] ?? 0, Math.max(alvo, 4), 60 + 110 * w, dt);
      }
    }
  }
  return saida;
}
