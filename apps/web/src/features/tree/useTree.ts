import type { Connection, DatabaseInfo, DatabaseSchema } from "@dbee/shared";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { api } from "../../lib/api";
import { connectionsKey } from "../../lib/query";
import type { SchemaTarget } from "./plan";

/**
 * Estado de expansão e busca lazy da árvore.
 *
 * **Lazy é requisito, não otimização.** Cada nó de conexão expandido custa uma
 * ida ao Postgres para listar databases, e cada database custa uma introspecção
 * de catálogo inteira. Buscar tudo de antemão abriria conexão em todo banco de
 * produção cadastrado no momento em que a tela carrega — inclusive nos que o
 * usuário não vai tocar hoje.
 */

export interface TreeState {
  readonly expanded: ReadonlySet<string>;
  readonly toggle: (node: string) => void;
  readonly isExpanded: (node: string) => boolean;
}

export function useTreeExpansion(): TreeState {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const toggle = useCallback((node: string) => {
    setExpanded((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(node)) proximo.add(node);
      return proximo;
    });
  }, []);

  const isExpanded = useCallback((node: string) => expanded.has(node), [expanded]);

  return { expanded, toggle, isExpanded };
}

export function useConnections() {
  return useQuery({
    queryKey: connectionsKey,
    queryFn: async (): Promise<Connection[]> => {
      const { data, error } = await api.api.connections.get();
      if (error !== null) throw new Error("não foi possível carregar as conexões");
      return data;
    },
  });
}

export const databasesKey = (id: string): readonly unknown[] => ["databases", id];
export const schemaKey = (id: string, db: string): readonly unknown[] => ["schema", id, db];

/**
 * Databases de uma conexão. `enabled` amarrado à expansão: nó fechado não
 * dispara requisição nenhuma.
 */
export function useDatabases(connectionId: string, enabled: boolean) {
  return useQuery({
    queryKey: databasesKey(connectionId),
    enabled,
    queryFn: async (): Promise<DatabaseInfo[]> => {
      const { data, error } = await api.api.connections({ id: connectionId }).databases.get();
      if (error !== null) throw new Error(mensagemDe(error));
      return data;
    },
  });
}

/** Árvore de um database. Também só busca quando o nó está expandido. */
export function useSchema(connectionId: string, database: string, enabled: boolean) {
  return useQuery({
    queryKey: schemaKey(connectionId, database),
    enabled,
    queryFn: async (): Promise<DatabaseSchema> => {
      const { data, error } = await api.api
        .connections({ id: connectionId })
        .schema.get({ query: { database } });
      if (error !== null) throw new Error(mensagemDe(error));
      return data;
    },
  });
}

/**
 * Carrega em paralelo as árvores dos databases expandidos.
 *
 * Um hook por database quebraria a regra dos hooks — a lista muda conforme o
 * usuário expande. `useQueries` aceita a lista variável.
 */
export function useExpandedSchemas(alvos: readonly SchemaTarget[]) {
  return useQueries({
    queries: alvos.map((alvo) => ({
      queryKey: schemaKey(alvo.connectionId, alvo.database),
      queryFn: async (): Promise<DatabaseSchema> => {
        const { data, error } = await api.api
          .connections({ id: alvo.connectionId })
          .schema.get({ query: { database: alvo.database } });
        if (error !== null) throw new Error(mensagemDe(error));
        return data;
      },
    })),
  });
}

/** O erro do Postgres vai inteiro para a UI (CLAUDE.md). */
function mensagemDe(error: unknown): string {
  if (typeof error === "object" && error !== null && "value" in error) {
    const { value } = error;
    if (typeof value === "object" && value !== null && "message" in value) {
      if (typeof value.message === "string") return value.message;
    }
  }
  return "não foi possível carregar";
}
