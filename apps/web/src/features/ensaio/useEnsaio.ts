import type { ApplyResponse, DryRunResponse } from "@dbee/shared";
import { useRef, useState } from "react";

import { api } from "../../lib/api";
import { uuidV4 } from "../../lib/navegador";
import { contagensEsperadas } from "./ensaio.puro";

/** Erro de transporte/servidor com o `code` que `mensagemDoCodigo` traduz. */
export type ErroEnsaio = Error & { code?: string };

/** O SQL ensaiado e de onde ele saiu no editor (mesma forma da `Execucao`). */
export interface AlvoEnsaio {
  readonly sql: string;
  readonly de: number;
  readonly original: string;
}

/**
 * As fases do ensaio (ADR 021). Não há "aplicado": aplicar devolve o resultado
 * para a aba, e o painel some — o que ficou gravado é o resultado comum.
 */
export type FaseEnsaio =
  | { readonly tipo: "ensaiando"; readonly alvo: AlvoEnsaio }
  | { readonly tipo: "pronto"; readonly alvo: AlvoEnsaio; readonly ensaio: DryRunResponse }
  | { readonly tipo: "aplicando"; readonly alvo: AlvoEnsaio; readonly ensaio: DryRunResponse }
  /** 409 `dry_run_mismatch`: nada gravado, o número de linhas mudou. */
  | { readonly tipo: "divergiu"; readonly alvo: AlvoEnsaio; readonly ensaio: DryRunResponse; readonly mensagem: string }
  | { readonly tipo: "falhou"; readonly alvo: AlvoEnsaio; readonly ensaio: DryRunResponse | null; readonly erro: ErroEnsaio };

function erroDe(error: unknown): ErroEnsaio {
  let message = "falhou";
  let code: string | undefined;
  if (typeof error === "object" && error !== null && "value" in error) {
    const { value } = error;
    if (typeof value === "object" && value !== null) {
      if ("code" in value && typeof value.code === "string") code = value.code;
      if ("message" in value && typeof value.message === "string") message = value.message;
    }
  }
  const e: ErroEnsaio = new Error(message);
  e.code = code ?? "rede";
  return e;
}

/**
 * Ensaio → Aplicar/Descartar. O `queryIdRef` é o da aba: o botão Cancelar da
 * barra cancela o ensaio ou a aplicação em voo do mesmo jeito que cancela o
 * `/query`.
 */
export function useEnsaio({
  connectionId,
  database,
  queryIdRef,
  onAplicado,
}: {
  readonly connectionId: string;
  readonly database: string;
  readonly queryIdRef: { current: string };
  readonly onAplicado: (resposta: ApplyResponse, alvo: AlvoEnsaio) => void;
}) {
  const [fase, setFase] = useState<FaseEnsaio | null>(null);
  // Resposta que chega depois de Descartar (ou de um ensaio mais novo) não
  // pode ressuscitar o painel: só vale a da geração corrente.
  const geracao = useRef(0);

  const ensaiar = async (alvo: AlvoEnsaio): Promise<void> => {
    const minha = ++geracao.current;
    const queryId = uuidV4();
    queryIdRef.current = queryId;
    setFase({ tipo: "ensaiando", alvo });
    const { data, error } = await api.api
      .connections({ id: connectionId })
      .query["dry-run"].post({ sql: alvo.sql, database, queryId })
      .catch((e: unknown) => ({ data: undefined, error: e }));
    if (minha !== geracao.current) return;
    if (data === undefined || data === null) {
      setFase({ tipo: "falhou", alvo, ensaio: null, erro: erroDe(error) });
      return;
    }
    setFase({ tipo: "pronto", alvo, ensaio: data });
  };

  const aplicar = async (confirmName?: string): Promise<void> => {
    if (fase === null || (fase.tipo !== "pronto" && fase.tipo !== "falhou")) return;
    const { alvo, ensaio } = fase;
    if (ensaio === null) return;
    const esperadas = contagensEsperadas(ensaio);
    if (esperadas === null) return;
    const minha = ++geracao.current;
    const queryId = uuidV4();
    queryIdRef.current = queryId;
    setFase({ tipo: "aplicando", alvo, ensaio });
    const { data, error } = await api.api
      .connections({ id: connectionId })
      .query.apply.post({
        sql: alvo.sql,
        database,
        queryId,
        expectedRowCounts: esperadas,
        ...(confirmName === undefined ? {} : { confirmName }),
      })
      .catch((e: unknown) => ({ data: undefined, error: e }));
    if (minha !== geracao.current) return;
    if (data === undefined || data === null) {
      const erro = erroDe(error);
      setFase(
        erro.code === "dry_run_mismatch"
          ? { tipo: "divergiu", alvo, ensaio, mensagem: erro.message }
          : { tipo: "falhou", alvo, ensaio, erro },
      );
      return;
    }
    setFase(null);
    onAplicado(data, alvo);
  };

  const descartar = (): void => {
    geracao.current++;
    setFase(null);
  };

  return { fase, ensaiar, aplicar, descartar };
}
