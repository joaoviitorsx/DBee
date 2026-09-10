import {
  csvLine,
  EXTENSAO_BUNDLE,
  SEPARADOR_BUNDLE,
  type BundleFormat,
} from "@dbee/shared";

/**
 * Formatação comum ao dump de várias tabelas, independente da engine.
 *
 * ## Por que num lugar só
 *
 * O bundle do Postgres (`pg/bundle.ts`) e o das outras engines
 * (`driver/bundle.ts`) produzem o **mesmo** arquivo — mesmo `.zip`, mesmo
 * cabeçalho de coluna, mesmo desempate de nome. O que muda entre eles é a
 * origem das linhas (cursor do `pg` contra a grade de keyset do driver), não o
 * formato de saída. Duplicar estas duas funções seria manter duas cópias de uma
 * regra de segurança (o nome da entrada do zip) divergindo com o tempo — o
 * defeito que este projeto chama de "um segundo lugar para esquecer".
 *
 * Mora em `lib/` e não em `pg/` para o `driver/` poder reusá-la sem depender do
 * `pg/`: o driver existe justamente para **não** ser o Postgres.
 */

/**
 * Nome da entrada no `.zip`, a partir de schema e tabela.
 *
 * Era `${schema}.${table}.${ext}` cru, e nome de tabela é **entrada do
 * usuário**: identificador de banco aceita ponto, barra e quase tudo quando
 * citado. Isso trazia dois problemas de verdade, não hipotéticos — as tabelas
 * existem no banco de teste:
 *
 * - **Barra vira diretório.** `zz_barra/tabela` produzia a entrada
 *   `zz_hostil.zz_barra/tabela.csv`, isto é, uma pasta dentro do zip. Com `..`
 *   no nome, o caminho ainda tenta sair dela — o `unzip` do Info-ZIP recusa,
 *   mas depender da educação do extrator alheio não é contenção.
 * - **Colisão silenciosa.** `zz_a` + `"b.c"` e `"zz_a.b"` + `c` dão o mesmo
 *   nome; o zip aceita duas entradas homônimas e, ao extrair, uma sobrescreve a
 *   outra. A pessoa pediu duas tabelas e recebeu um arquivo, sem aviso.
 *
 * Separador some, byte de controle some, e o desempate é sufixo numérico — a
 * segunda tabela sai como `nome (2).csv` em vez de sumir.
 */
export function nomeDeEntrada(
  schema: string,
  table: string,
  format: BundleFormat,
  usados: Set<string>,
): string {
  // Separador de caminho e byte de controle viram `_`. O resto fica como
  // está: acento, espaço e hífen são legítimos num nome de tabela.
  // eslint-disable-next-line no-control-regex -- o byte de controle é o alvo
  const limpo = `${schema}.${table}`.replace(/[/\\\u0000-\u001f]/g, "_");
  const ext = EXTENSAO_BUNDLE[format];
  let nome = `${limpo}.${ext}`;
  for (let i = 2; usados.has(nome); i++) nome = `${limpo} (${String(i)}).${ext}`;
  usados.add(nome);
  return nome;
}

/** Cabeçalho de coluna, e cada linha, dos formatos tabulares (`csv`/`tsv`). */
export function linhaTabular(
  valores: readonly (string | null)[],
  format: BundleFormat,
): string {
  const sep = SEPARADOR_BUNDLE[format];
  if (format === "tsv") {
    return (
      valores
        .map((v) => (v ?? "").replaceAll("\t", " ").replaceAll("\n", " ").replaceAll("\r", ""))
        .join("\t") + "\r\n"
    );
  }
  return csvLine(valores, sep);
}
