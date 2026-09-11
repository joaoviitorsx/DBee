import { describe, expect, it } from "bun:test";

import {
  deslocamentoDe,
  ehCortePorTempo,
  ehFusoDesconhecido,
  saborDaVersao,
  sqlDeFusoPorDeslocamento,
  sqlDeFusoPorNome,
  sqlDeTimeout,
} from "./sessao";

describe("sabor do servidor", () => {
  it("reconhece MariaDB pela string de versão, e o resto é MySQL", () => {
    expect(saborDaVersao("11.8.9-MariaDB-ubu2404")).toBe("mariadb");
    expect(saborDaVersao("10.11.2-MARIADB")).toBe("mariadb");
    expect(saborDaVersao("8.4.11")).toBe("mysql");
    expect(saborDaVersao("5.7.44-log")).toBe("mysql");
  });
});

describe("limite de tempo por consulta", () => {
  it("MySQL recebe milissegundos inteiros; MariaDB, segundos com decimais", () => {
    expect(sqlDeTimeout("mysql", 1500)).toBe("SET SESSION max_execution_time = 1500");
    expect(sqlDeTimeout("mariadb", 1500)).toBe("SET SESSION max_statement_time = 1.500");
  });

  it("zero passa: significa SEM limite nos dois", () => {
    expect(sqlDeTimeout("mysql", 0)).toContain("= 0");
    expect(sqlDeTimeout("mariadb", 0)).toContain("= 0.000");
  });

  /*
   * O valor é concatenado no SQL porque `SET SESSION` não aceita placeholder
   * para variável de sistema. Então a única defesa é ele ser número mesmo, e
   * estes casos são essa defesa.
   */
  it("recusa o que não é número finito e não negativo", () => {
    for (const ruim of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => sqlDeTimeout("mysql", ruim), String(ruim)).toThrow();
    }
  });

  it("reconhece o corte pelo errno, que é o que os dois preenchem", () => {
    // MySQL manda code e errno; MariaDB manda só o errno — medido.
    expect(ehCortePorTempo({ code: "ER_QUERY_TIMEOUT", errno: 3024 })).toBe(true);
    expect(ehCortePorTempo({ errno: 1969 })).toBe(true);
    expect(ehCortePorTempo({ code: "ER_QUERY_TIMEOUT" })).toBe(false);
    expect(ehCortePorTempo({ errno: 1146 })).toBe(false);
    expect(ehCortePorTempo(null)).toBe(false);
    expect(ehCortePorTempo("erro")).toBe(false);
  });
});

describe("fuso da sessão", () => {
  it("tenta o nome IANA primeiro", () => {
    expect(sqlDeFusoPorNome("America/Bahia")).toBe("SET SESSION time_zone = 'America/Bahia'");
  });

  it("o deslocamento cobre meia hora e quarenta e cinco minutos", () => {
    const jan = new Date("2026-01-15T12:00:00Z");
    expect(deslocamentoDe("UTC", jan)).toBe("+00:00");
    expect(deslocamentoDe("Asia/Kolkata", jan)).toBe("+05:30");
    // +13:45 e não +12:45: em janeiro Chatham está em horário de verão. A
    // primeira versão deste caso dizia +12:45, medido em setembro — o próprio
    // teste caiu na armadilha que o caso seguinte descreve.
    expect(deslocamentoDe("Pacific/Chatham", jan)).toBe("+13:45");
    expect(deslocamentoDe("Pacific/Chatham", new Date("2026-07-15T12:00:00Z"))).toBe("+12:45");
    expect(deslocamentoDe("America/Bahia", jan)).toBe("-03:00");
  });

  /*
   * O limite do plano B, dito por teste: ele é o deslocamento de um INSTANTE.
   * Um fuso com horário de verão dá respostas diferentes em janeiro e em julho,
   * e é por isso que o nome vem primeiro.
   */
  it("o deslocamento é de um instante — horário de verão muda a resposta", () => {
    const verao = deslocamentoDe("America/New_York", new Date("2026-07-15T12:00:00Z"));
    const inverno = deslocamentoDe("America/New_York", new Date("2026-01-15T12:00:00Z"));
    expect(verao).toBe("-04:00");
    expect(inverno).toBe("-05:00");
    expect(verao).not.toBe(inverno);
  });

  it("o SQL do plano B usa o deslocamento, não o nome", () => {
    const sql = sqlDeFusoPorDeslocamento("America/Bahia", new Date("2026-01-15T12:00:00Z"));
    expect(sql).toBe("SET SESSION time_zone = '-03:00'");
    expect(sql).not.toContain("Bahia");
  });

  it("reconhece 1298 como fuso desconhecido, nos dois servidores", () => {
    expect(ehFusoDesconhecido({ code: "ER_UNKNOWN_TIME_ZONE", errno: 1298 })).toBe(true);
    expect(ehFusoDesconhecido({ errno: 1298 })).toBe(true);
    expect(ehFusoDesconhecido({ errno: 1146 })).toBe(false);
    expect(ehFusoDesconhecido(undefined)).toBe(false);
  });
});
