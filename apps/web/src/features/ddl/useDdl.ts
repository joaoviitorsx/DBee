import type { CreateDatabaseRequest, CreateTableRequest } from "@dbee/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { databasesKey, schemaKey } from "../tree/useTree";

/**
 * Criar tabela e criar database (ADR 010).
 *
 * O erro do Postgres é repassado inteiro: `already exists`, `permission
 * denied`, `invalid locale name` dizem exatamente o que fazer, e trocá-los por
 * "não foi possível criar" seria jogar fora a única informação útil.
 */
export class FalhaDdl extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "FalhaDdl";
  }
}

/** O corpo de erro do Eden é `unknown`; só `code` e `message` interessam. */
function falhaDe(valor: unknown): FalhaDdl {
  if (typeof valor === "object" && valor !== null) {
    const corpo = valor as { code?: unknown; message?: unknown };
    return new FalhaDdl(
      typeof corpo.code === "string" ? corpo.code : "erro",
      typeof corpo.message === "string" ? corpo.message : "não foi possível criar",
    );
  }
  return new FalhaDdl("erro", "não foi possível criar");
}

export function useCriarTabela(connectionId: string, database: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pedido: CreateTableRequest): Promise<string> => {
      const { data, error } = await api.api
        .connections({ id: connectionId })
        .ddl.table.post(pedido);
      if (error !== null) throw falhaDe(error.value);
      return data.sql;
    },
    // A tabela nova só aparece na árvore depois que o catálogo é relido — sem
    // isto a pessoa cria e não vê, e conclui que não funcionou.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: schemaKey(connectionId, database) });
    },
  });
}

export function useCriarDatabase(connectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pedido: CreateDatabaseRequest): Promise<string> => {
      const { data, error } = await api.api
        .connections({ id: connectionId })
        .ddl.database.post(pedido);
      if (error !== null) throw falhaDe(error.value);
      return data.sql;
    },
    onSuccess: () => {
      // A lista de databases da conexão é outra chave — o database novo entra lá.
      void qc.invalidateQueries({ queryKey: databasesKey(connectionId) });
    },
  });
}
