import type { DatabaseTree } from "@dbee/shared";
import { beforeAll, describe, expect, it } from "bun:test";

import { openTestStore } from "../db/client";
import { ConnectionsRepository } from "../db/connections.repo";
import { UsersRepository } from "../db/users.repo";
import type { Drivers } from "../driver/registro";
import type { DriverLeitura } from "../driver/tipos";
import type { Ator } from "../lib/ator";
import type { PoolManager } from "../pg/pool";
import { BuscaService } from "./busca.service";
import { SchemaService } from "./schema.service";

/**
 * Busca global: a permissão recorta ANTES do casamento, e nenhuma tecla vai ao
 * banco. Driver falso conta as idas ao servidor.
 */
let chamadas = 0;
const driver = {
  engine: "postgres" as const,
  arvore: (_c: unknown, database: string): Promise<DatabaseTree> => {
    chamadas++;
    return Promise.resolve({
      database,
      schemas: [{ name: "public", relations: [{ name: "segredo_fiscal", kind: "table", estimatedRows: 1 }] }],
      fetchedAt: new Date().toISOString(),
      cached: false,
    });
  },
} as unknown as DriverLeitura;
const drivers = { para: () => driver } as unknown as Drivers;

let busca: BuscaService;
let schema: SchemaService;
let membro: Ator;
const ADMIN: Ator = { id: "adm", role: "admin" };
let liberada = "";
let proibida = "";

beforeAll(() => {
  const store = openTestStore();
  const repo = new ConnectionsRepository(store.db, store.key);
  const users = new UsersRepository(store.db);
  membro = { id: users.criar("m", "hash", false, "member").id, role: "member" };
  const base = { host: "127.0.0.1", database: "app", username: "u", password: "p" };
  liberada = repo.create({ ...base, name: "liberada" }).id;
  proibida = repo.create({ ...base, name: "proibida" }).id;
  repo.conceder(liberada, membro.id, false, "adm");
  schema = new SchemaService({ repository: repo, pools: {} as unknown as PoolManager, drivers });
  busca = new BuscaService({ conexoes: repo, schema });
});

describe("BuscaService", () => {
  it("sem catálogo em cache: nada casa, nada consulta, e diz quem falta", () => {
    const r = busca.buscar("segredo", 10, membro);
    expect(r.hits).toEqual([]);
    expect(r.semCatalogo.map((c) => c.name)).toEqual(["liberada"]);
    expect(chamadas).toBe(0);
  });

  it("member só acha na conexão concedida, mesmo com as duas em cache", async () => {
    await schema.tree(liberada, undefined, false, ADMIN);
    await schema.tree(proibida, undefined, false, ADMIN);
    chamadas = 0;
    const r = busca.buscar("segredo", 10, membro);
    expect(r.hits.map((h) => h.connectionName)).toEqual(["liberada"]);
    expect(busca.buscar("segredo", 10, ADMIN).hits).toHaveLength(2);
    expect(chamadas).toBe(0);
  });
});
