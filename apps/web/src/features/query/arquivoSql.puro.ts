/** Teto do `.sql` aberto no editor (I4): acima disso o CodeMirror sofre e não é "consulta". */
export const LIMITE_ARQUIVO_SQL = 2 * 1024 * 1024;

/** Nome do arquivo a partir do título da aba, sem caractere que o SO recusa. */
export function nomeArquivoSql(titulo: string): string {
  const base = titulo.replace(/[\\/:*?"<>|\p{Cc}]+/gu, "_").trim().replace(/\.sql$/i, "");
  return `${base === "" ? "consulta" : base}.sql`;
}
