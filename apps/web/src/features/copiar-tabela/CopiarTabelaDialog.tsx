import { COPIA_TABELA_MAX_ROWS, COPIA_TABELA_ROWS_PADRAO, type Connection } from "@dbee/shared";
import { capacidadesDe } from "@dbee/shared/puro";
import { useMutation } from "@tanstack/react-query";
import { CopyPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button, Field, Input, ModalPainel } from "../../components/ui";
import { useT } from "../../i18n";
import { api } from "../../lib/api";
import { mensagemDeErro } from "../../lib/erroApi";
import { useDatabases } from "../tree/useTree";

export interface OrigemCopia {
  readonly connectionId: string;
  readonly database: string;
  readonly schema: string;
  readonly table: string;
}

const selectCls = "h-10 w-full cursor-pointer rounded-[4px] border border-line bg-sunken px-2 text-sm text-ink";
const ehMysql = (c: Connection | undefined): boolean => c?.engine === "mysql" || c?.engine === "mariadb";

/**
 * "Copiar tabela para…" (ideia I10). Pede o script ao servidor e abre numa
 * aba de consulta **da conexão de destino**. Nunca executa (ADR 018): o
 * script já nasce com o cabeçalho "revise antes de rodar", e a aba abre em
 * leitura como qualquer outra — gravar exige o interruptor de escrita.
 *
 * A lista de destinos é a que o servidor já devolveu para esta pessoa
 * (`/connections`), então só aparece o que ela acessa.
 */
export function CopiarTabelaDialog({
  connections,
  origem,
  onClose,
  onAbrirScript,
}: {
  readonly connections: readonly Connection[];
  readonly origem: OrigemCopia;
  readonly onClose: () => void;
  readonly onAbrirScript: (connectionId: string, database: string, sql: string) => void;
}) {
  const t = useT();
  // Mongo/Redis não têm editor de SQL: não há onde abrir o script.
  const destinos = connections.filter((c) => capacidadesDe(c.engine)?.sqlLivre !== false);
  const [destinoId, setDestinoId] = useState(destinos.find((c) => c.id !== origem.connectionId)?.id ?? origem.connectionId);
  const destino = destinos.find((c) => c.id === destinoId);
  const dbs = useDatabases(destinoId, destino !== undefined);
  const [database, setDatabase] = useState("");
  const dbEfetivo = database !== "" ? database : (dbs.data?.find((d) => d.isDefault)?.name ?? destino?.database ?? "");
  const [schema, setSchema] = useState("");
  const [tabela, setTabela] = useState("");
  const [linhas, setLinhas] = useState(String(COPIA_TABELA_ROWS_PADRAO));
  const n = Number(linhas);
  const linhasValidas = Number.isInteger(n) && n >= 0 && n <= COPIA_TABELA_MAX_ROWS;

  const gerar = useMutation({
    mutationFn: async () => {
      const schemaDestino = schema.trim() !== "" ? schema.trim() : ehMysql(destino) ? dbEfetivo : undefined;
      const { data, error } = await api.api
        .connections({ id: origem.connectionId })
        .tables({ schema: origem.schema })({ table: origem.table })["copy-script"].post({
          database: origem.database,
          targetConnectionId: destinoId,
          maxRows: n,
          ...(schemaDestino === undefined || schemaDestino === "" ? {} : { targetSchema: schemaDestino }),
          ...(tabela.trim() === "" ? {} : { targetTable: tabela.trim() }),
        });
      if (error !== null) throw new Error(mensagemDeErro(error, t("copiar.erro")));
      return data;
    },
    onSuccess: (r) => {
      onAbrirScript(destinoId, dbEfetivo, r.sql);
      toast.warning(t("copiar.revise"), {
        description: [
          r.truncated ? t("copiar.truncado", { n: String(r.rowCount) }) : t("copiar.linhasGeradas", { n: String(r.rowCount) }),
          ...r.warnings,
        ].join(" · "),
      });
      onClose();
    },
  });

  return (
    <ModalPainel
      titulo={t("copiar.titulo", { tabela: `${origem.schema}.${origem.table}` })}
      descricao={t("copiar.descricao")}
      icone={<CopyPlus aria-hidden className="h-4 w-4" />}
      onClose={onClose}
      rodape={
        <Button
          variant="solido"
          size="sm"
          disabled={destino === undefined || dbEfetivo === "" || !linhasValidas}
          loading={gerar.isPending}
          loadingLabel={t("copiar.gerando")}
          onClick={() => { gerar.mutate(); }}
        >
          {t("copiar.gerar")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("copiar.destino")} htmlFor="ct-conexao">
            <select id="ct-conexao" className={selectCls} value={destinoId} onChange={(e) => { setDestinoId(e.target.value); setDatabase(""); }}>
              {destinos.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.engine})</option>)}
            </select>
          </Field>
          <Field label={t("copiar.database")} htmlFor="ct-db" error={dbs.isError ? dbs.error.message : undefined}>
            <select id="ct-db" className={selectCls} value={dbEfetivo} onChange={(e) => { setDatabase(e.target.value); }}>
              {(dbs.data ?? (destino === undefined ? [] : [{ name: destino.database, isDefault: true }])).map((d) => (
                <option key={d.name} value={d.name}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Field label={t("copiar.schema")} htmlFor="ct-schema" hint={t("copiar.opcional")}>
            <Input id="ct-schema" mono maxLength={128} placeholder={ehMysql(destino) ? dbEfetivo : origem.schema} value={schema} onChange={(e) => { setSchema(e.target.value); }} />
          </Field>
          <Field label={t("copiar.tabela")} htmlFor="ct-tabela" hint={t("copiar.opcional")}>
            <Input id="ct-tabela" mono maxLength={128} placeholder={origem.table} value={tabela} onChange={(e) => { setTabela(e.target.value); }} />
          </Field>
        </div>
        <Field
          label={t("copiar.linhas")}
          htmlFor="ct-linhas"
          hint={t("copiar.linhasDica", { max: COPIA_TABELA_MAX_ROWS.toLocaleString() })}
          error={linhasValidas ? undefined : t("copiar.linhasInvalidas", { max: String(COPIA_TABELA_MAX_ROWS) })}
        >
          <Input id="ct-linhas" type="number" min={0} max={COPIA_TABELA_MAX_ROWS} value={linhas} invalid={!linhasValidas} onChange={(e) => { setLinhas(e.target.value); }} className="w-40" />
        </Field>
        <p className="rounded-[4px] border border-line bg-sunken px-3 py-2 text-2xs leading-relaxed text-subtle">{t("copiar.nuncaExecuta")}</p>
        {gerar.isError ? <p role="alert" className="text-xs text-danger">{gerar.error.message}</p> : null}
      </div>
    </ModalPainel>
  );
}
