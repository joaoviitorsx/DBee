import { Graph, layout as dagreLayout } from "@dagrejs/dagre";

import type { DatabaseSchema, ForeignKey } from "@dbee/shared";

/**
 * Layout de um diagrama entidade-relacionamento (ERD), por `dagre`.
 *
 * ## Por que dagre
 *
 * A primeira versão era um force-directed próprio; para poucas arestas ele
 * espalhava as tabelas soltas e deixava muito espaço vazio. `dagre` é layout em
 * **camadas** (Sugiyama): posiciona por posto ao longo das FKs e é o que dá a
 * um ERD a leitura de "quem referencia quem" de cima para baixo. É determinístico
 * por construção — mesma entrada, mesmo desenho — sem precisar semear posição.
 *
 * A fronteira desta troca estava desenhada de propósito: o formato de saída
 * (`DiagramLayout`) não mudou, então só o miolo deste arquivo trocou. Quem
 * consome o layout não soube da diferença.
 */

export interface NodeBox {
  readonly id: string; // schema.relation
  readonly schema: string;
  readonly relation: string;
  readonly kind: string;
  readonly columns: readonly { name: string; type: string; pk: boolean; fk: boolean }[];
  readonly width: number;
  readonly height: number;
  x: number;
  y: number;
}

export interface Edge {
  readonly id: string;
  readonly from: string; // node id da tabela com a FK
  readonly to: string; // node id da tabela referenciada
  readonly label: string; // colunas → colunas
}

export interface DiagramLayout {
  readonly nodes: readonly NodeBox[];
  readonly edges: readonly Edge[];
  readonly width: number;
  readonly height: number;
}

const LARGURA = 220;
const ALTURA_CABECALHO = 30;
const ALTURA_LINHA = 18;
/** Teto de colunas desenhadas por tabela: o resto vira "+N". */
const MAX_COLUNAS = 12;

/**
 * Id de nó estável e sem colisão.
 *
 * `${schema}.${relation}` colide: o schema `"a.b"` com a tabela `c` e o schema
 * `a` com a tabela `"b.c"` dão o mesmo `a.b.c` — identificador Postgres aceita
 * ponto quando citado. `JSON.stringify` de um par é inambíguo (`["a.b","c"]` ≠
 * `["a","b.c"]`) e não tem byte de controle. O `.` do rótulo visível é montado
 * à parte, a partir de `schema`/`relation`.
 */
export const nodeId = (schema: string, relation: string): string => JSON.stringify([schema, relation]);

function alturaDe(colunas: number): number {
  return ALTURA_CABECALHO + Math.min(colunas, MAX_COLUNAS + 1) * ALTURA_LINHA;
}

/**
 * Monta os nós e arestas a partir do schema, sem posicionar.
 *
 * Só relações que são tabela entram como candidatas a FK de origem, mas
 * qualquer relação pode ser **alvo** de uma FK. Uma FK que aponta para tabela
 * fora do schema carregado é descartada — o diagrama mostra o que existe na
 * árvore, não inventa nó para o que não veio.
 */
export function construirGrafo(schema: DatabaseSchema): { nodes: NodeBox[]; edges: Edge[] } {
  const nodes: NodeBox[] = [];
  const existe = new Set<string>();

  for (const s of schema.schemas) {
    for (const rel of s.relations) {
      const id = nodeId(s.name, rel.name);
      existe.add(id);
      const fkCols = new Set(rel.foreignKeys.flatMap((fk) => fk.columns));
      nodes.push({
        id,
        schema: s.name,
        relation: rel.name,
        kind: rel.kind,
        columns: rel.columns.map((c) => ({
          name: c.name,
          type: c.dataType,
          pk: c.isPrimaryKey,
          fk: fkCols.has(c.name),
        })),
        width: LARGURA,
        height: alturaDe(rel.columns.length),
        x: 0,
        y: 0,
      });
    }
  }

  const edges: Edge[] = [];
  const vistas = new Set<string>();
  for (const s of schema.schemas) {
    for (const rel of s.relations) {
      const from = nodeId(s.name, rel.name);
      for (const fk of rel.foreignKeys) {
        const to = nodeId(fk.referencedSchema, fk.referencedTable);
        // FK para fora do que foi carregado: não há nó, não há aresta.
        if (!existe.has(to)) continue;
        const id = `${from}→${to}:${fk.name}`;
        if (vistas.has(id)) continue;
        vistas.add(id);
        edges.push({ id, from, to, label: rotuloFk(fk) });
      }
    }
  }

  return { nodes, edges };
}

const rotuloFk = (fk: ForeignKey): string =>
  `${fk.columns.join(", ")} → ${fk.referencedColumns.join(", ")}`;

/**
 * Calcula as posições com `dagre` e devolve o layout assentado.
 *
 * `rankdir: "LR"` — as tabelas são caixas altas (uma linha por coluna), e
 * empilhá-las de cima para baixo faria um diagrama estreito e comprido. Da
 * esquerda para a direita elas ficam lado a lado por posto, o que lê melhor.
 *
 * A aresta vai da tabela **referenciada** para a que referencia (`to → from`),
 * então a tabela pai fica num posto à esquerda da filha — a direção natural de
 * "esta depende daquela".
 */
export function calcularLayout(schema: DatabaseSchema): DiagramLayout {
  const { nodes, edges } = construirGrafo(schema);
  if (nodes.length === 0) return { nodes, edges, width: 400, height: 300 };

  const g = new Graph({ multigraph: true });
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 90, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));

  const porId = new Map(nodes.map((no) => [no.id, no]));
  for (const no of nodes) {
    g.setNode(no.id, { width: no.width, height: no.height });
  }
  for (const e of edges) {
    // Só liga o que dagre conhece; `to → from` deixa o pai à esquerda.
    if (porId.has(e.from) && porId.has(e.to)) g.setEdge(e.to, e.from, {}, e.id);
  }

  dagreLayout(g);

  // dagre devolve o CENTRO de cada nó; o resto do código usa o canto.
  for (const no of nodes) {
    const dn = g.node(no.id) as { x: number; y: number } | undefined;
    if (dn === undefined) continue;
    no.x = dn.x - no.width / 2;
    no.y = dn.y - no.height / 2;
  }

  const graph = g.graph() as { width?: number; height?: number };
  return {
    nodes,
    edges,
    width: graph.width ?? 400,
    height: graph.height ?? 300,
  };
}

export const DIAGRAM_CONST = { LARGURA, ALTURA_CABECALHO, ALTURA_LINHA, MAX_COLUNAS };
