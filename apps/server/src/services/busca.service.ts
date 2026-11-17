import type { SearchResponse } from "@dbee/shared";
import { buscarNoCatalogo } from "@dbee/shared/puro";

import type { ConnectionsRepository } from "../db/connections.repo";
import type { Ator } from "../lib/ator";
import type { SchemaService } from "./schema.service";

/**
 * Busca global (roadmap-dbeaver item 9).
 *
 * A permissão é o primeiro passo, não um filtro no fim: só entram no casamento
 * os catálogos das conexões de `list(ator)`. O cache do `SchemaService` é
 * compartilhado entre usuários, e ler dele sem esse recorte mostraria a um
 * `member` o nome das tabelas de uma conexão que ele não enxerga.
 */
export class BuscaService {
  readonly #conexoes: ConnectionsRepository;
  readonly #schema: SchemaService;

  constructor({ conexoes, schema }: { conexoes: ConnectionsRepository; schema: SchemaService }) {
    this.#conexoes = conexoes;
    this.#schema = schema;
  }

  buscar(termo: string, limite: number, ator: Ator): SearchResponse {
    const visiveis = this.#conexoes.list(ator);
    const nomes = new Map(visiveis.map((c) => [c.id, c.name]));
    const catalogos = this.#schema.emCache(visiveis.map((c) => c.id)).map((c) => ({
      ...c,
      connectionName: nomes.get(c.connectionId) ?? c.connectionId,
    }));
    const comCatalogo = new Set(catalogos.map((c) => c.connectionId));
    const { hits, truncated } = buscarNoCatalogo(catalogos, termo, limite);
    return {
      hits,
      truncated,
      semCatalogo: visiveis.filter((c) => !comCatalogo.has(c.id)).map((c) => ({ id: c.id, name: c.name })),
    };
  }
}
