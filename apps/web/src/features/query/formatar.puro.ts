import type { DialetoSql } from "@dbee/shared/puro";
import { format, type SqlLanguage } from "sql-formatter";

/**
 * Formatar SQL (roadmap-dbeaver item 4). Só texto do editor: o resultado nunca
 * é usado para validar ou reescrever o SQL antes de executar (regra 8). O
 * editor aplica como uma transação — `Ctrl+Z` desfaz.
 *
 * O dialeto vem da engine da aba: formatar MySQL com a gramática do Postgres
 * quebraria crase e `\'` dentro de string.
 */
const LINGUAGEM: Record<DialetoSql, SqlLanguage> = {
  postgres: "postgresql",
  mysql: "mysql",
  sqlite: "sqlite",
};

/** `null` quando o formatador não entende o texto: o editor fica como está. */
export function formatarSql(sql: string, dialeto: DialetoSql): string | null {
  if (sql.trim() === "") return null;
  try {
    return format(sql, {
      language: LINGUAGEM[dialeto],
      keywordCase: "upper",
      tabWidth: 2,
      // `:nome` de snippet (ADR 019) não pode virar `: nome`.
      ...(dialeto === "postgres" ? { paramTypes: { named: [":"] } } : {}),
    });
  } catch {
    return null;
  }
}
