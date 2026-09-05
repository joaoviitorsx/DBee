import { describe, expect, it } from "bun:test";

import { connectionNode, databaseNode } from "./keys";
import { plannedDatabaseTargets, plannedSchemaTargets } from "./plan";

const conexoes = ["c1", "c2", "c3"];
const databases = [
  { connectionId: "c1", databases: ["app", "relatorios"] },
  { connectionId: "c2", databases: ["outro"] },
];

describe("a árvore não busca nada de nó fechado", () => {
  it("nada expandido: nenhuma listagem de database", () => {
    // Buscar tudo de antemão abriria conexão em todo banco de produção
    // cadastrado no instante em que a tela carrega.
    expect(plannedDatabaseTargets(conexoes, new Set())).toEqual([]);
  });

  it("nada expandido: nenhuma introspecção de schema", () => {
    expect(plannedSchemaTargets(databases, new Set())).toEqual([]);
  });

  it("conexão expandida lista os databases DELA e de mais ninguém", () => {
    expect(plannedDatabaseTargets(conexoes, new Set([connectionNode("c2")]))).toEqual(["c2"]);
  });

  it("conexão expandida ainda NÃO busca schema — só a listagem de databases", () => {
    // Expandir a conexão mostra os databases; a introspecção só acontece ao
    // expandir um database.
    expect(plannedSchemaTargets(databases, new Set([connectionNode("c1")]))).toEqual([]);
  });

  it("database expandido busca só aquele database", () => {
    const expanded = new Set([connectionNode("c1"), databaseNode("c1", "app")]);
    expect(plannedSchemaTargets(databases, expanded)).toEqual([
      { connectionId: "c1", database: "app" },
    ]);
  });

  it("dois databases expandidos buscam os dois", () => {
    const expanded = new Set([
      connectionNode("c1"),
      databaseNode("c1", "app"),
      databaseNode("c1", "relatorios"),
    ]);
    expect(plannedSchemaTargets(databases, expanded)).toHaveLength(2);
  });

  it("colapsar a conexão cancela a busca dos databases dentro dela", () => {
    // O database continua marcado como expandido, mas o nó pai está fechado:
    // fechar um nó tem que parar o trabalho de tudo que está abaixo.
    const expanded = new Set([databaseNode("c1", "app")]);
    expect(plannedSchemaTargets(databases, expanded)).toEqual([]);
  });

  it("expansão de outra conexão não vaza para esta", () => {
    const expanded = new Set([connectionNode("c2"), databaseNode("c1", "app")]);
    expect(plannedSchemaTargets(databases, expanded)).toEqual([]);
  });

  it("database que não existe na conexão é ignorado", () => {
    const expanded = new Set([connectionNode("c1"), databaseNode("c1", "sumiu")]);
    expect(plannedSchemaTargets(databases, expanded)).toEqual([]);
  });
});
