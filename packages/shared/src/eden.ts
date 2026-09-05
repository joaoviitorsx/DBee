/**
 * Configuração do cliente Eden — o contrato de **desserialização** entre server
 * e web (DBee.md §11.43).
 *
 * `parseDate: false` é **obrigatório**. Por padrão o Eden Treaty reanalisa o JSON
 * da resposta e converte QUALQUER string que pareça data ISO em objeto `Date`.
 * Isso quebra a regra 10 ("todo valor de célula trafega como string"): uma célula
 * `date`/`timestamptz` — ou uma coluna de texto cujo valor pareça data — chegaria
 * como `Date`, o grid renderizaria `[object Date]` e a aba estouraria; pior,
 * silenciosamente perderia a representação textual exata do Postgres.
 *
 * Fica aqui, no `shared`, e não solto no `lib/api.ts`, por um motivo: o teste de
 * fronteira (`eden-boundary.integration.test.ts`) importa **este mesmo objeto** e
 * prova, atravessando o Eden contra Postgres real, que date/timestamptz/texto
 * chegam string. Se alguém inverter este valor numa atualização de dependência, o
 * teste falha — a linha não é mais "uma linha que some sem nada acusar".
 */
export const EDEN_CONFIG = { parseDate: false } as const;
