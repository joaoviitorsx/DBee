/**
 * Nome legível de um SQLSTATE, para o `title` do `kbd` do painel de erro
 * (ui-detalhes §3.6). Só os códigos que aparecem no dia a dia; o resto cai na
 * classe (os dois primeiros caracteres), e uma classe desconhecida fica sem
 * nome — inventar seria pior que calar.
 *
 * Nomes do apêndice A da documentação do Postgres; o MySQL/SQLite devolvem
 * SQLSTATE das mesmas classes quando devolvem.
 */
const CODIGOS: Readonly<Record<string, string>> = {
  "42601": "syntax_error",
  "42P01": "undefined_table",
  "42703": "undefined_column",
  "42883": "undefined_function",
  "42702": "ambiguous_column",
  "42804": "datatype_mismatch",
  "42P07": "duplicate_table",
  "42501": "insufficient_privilege",
  "42803": "grouping_error",
  "23505": "unique_violation",
  "23503": "foreign_key_violation",
  "23502": "not_null_violation",
  "23514": "check_violation",
  "22P02": "invalid_text_representation",
  "22012": "division_by_zero",
  "22003": "numeric_value_out_of_range",
  "22007": "invalid_datetime_format",
  "22008": "datetime_field_overflow",
  "25006": "read_only_sql_transaction",
  "57014": "query_canceled",
  "40001": "serialization_failure",
  "40P01": "deadlock_detected",
  "53300": "too_many_connections",
  "08006": "connection_failure",
};

const CLASSES: Readonly<Record<string, string>> = {
  "08": "connection_exception",
  "22": "data_exception",
  "23": "integrity_constraint_violation",
  "25": "invalid_transaction_state",
  "28": "invalid_authorization_specification",
  "40": "transaction_rollback",
  "42": "syntax_error_or_access_rule_violation",
  "53": "insufficient_resources",
  "54": "program_limit_exceeded",
  "57": "operator_intervention",
  XX: "internal_error",
};

export function nomeDoSqlstate(codigo: string): string | null {
  return CODIGOS[codigo] ?? CLASSES[codigo.slice(0, 2)] ?? null;
}
