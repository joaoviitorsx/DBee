import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { crc32, ZipWriter } from "./zip";

/**
 * O que trava um escritor de ZIP não é o formato "parecer certo" — é um
 * descompactador de verdade aceitar o arquivo. Estes testes montam o zip e
 * mandam o `unzip` do sistema conferir e extrair.
 */

const disponivel = (cmd: string[]): boolean => {
  try {
    return Bun.spawnSync(cmd).exitCode === 0;
  } catch {
    return false;
  }
};

const temUnzip = disponivel(["unzip", "-v"]);
/**
 * O `unzip` do Info-ZIP **ignora a flag UTF-8** e lê o nome como CP437 —
 * `operações` vira `opera├з├╡es`. Não é defeito do arquivo (o `-t` passa); é
 * limitação conhecida dele. O `zipfile` do Python honra a flag, então nome
 * acentuado é conferido por ali.
 */
const temPython = disponivel(["python3", "-c", "import zipfile"]);

const enc = new TextEncoder();

/** Junta os pedaços que o escritor devolve num arquivo só. */
function montar(arquivos: readonly { nome: string; conteudo: string }[]): Uint8Array {
  const zip = new ZipWriter(new Date("2026-09-08T12:34:56Z"));
  const partes: Uint8Array[] = [];
  for (const arquivo of arquivos) {
    partes.push(zip.abrir(arquivo.nome));
    // Em pedaços, como o export faz — um `escrever` por lote de FETCH.
    for (const pedaco of arquivo.conteudo.match(/[\s\S]{1,7}/g) ?? []) {
      partes.push(zip.escrever(enc.encode(pedaco)));
    }
    partes.push(zip.fechar());
  }
  partes.push(zip.finalizar());

  const total = partes.reduce((n, p) => n + p.length, 0);
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    saida.set(p, pos);
    pos += p.length;
  }
  return saida;
}

describe("crc32", () => {
  /** Vetor conhecido: CRC-32 de "123456789" é 0xCBF43926. */
  it("bate com o vetor de referência", () => {
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926);
  });

  it("incremental dá o mesmo que de uma vez", () => {
    const inteiro = crc32(enc.encode("abcdef"));
    const parcial = crc32(enc.encode("def"), crc32(enc.encode("abc")));
    expect(parcial).toBe(inteiro);
  });

  it("vazio é zero", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("ZipWriter", () => {
  it("começa com a assinatura de arquivo local", () => {
    const zip = montar([{ nome: "a.txt", conteudo: "oi" }]);
    // "PK\x03\x04"
    expect([zip[0], zip[1], zip[2], zip[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("recusa uso fora de ordem", () => {
    const zip = new ZipWriter();
    expect(() => zip.escrever(enc.encode("x"))).toThrow();
    expect(() => zip.fechar()).toThrow();
    zip.abrir("a");
    expect(() => zip.abrir("b")).toThrow();
    expect(() => zip.finalizar()).toThrow();
  });

  describe.if(temUnzip)("contra o unzip do sistema", () => {
    /** A prova que vale: um descompactador real aceita e extrai igual. */
    it("gera um zip íntegro, e o conteúdo volta idêntico", async () => {
      const arquivos = [
        { nome: "public.clientes.csv", conteudo: "id;nome\r\n1;O'Brien & Cia\r\n2;Produção\r\n" },
        { nome: "public.notas.csv", conteudo: "id;valor\r\n1;10.00\r\n" },
        // Acento no NOME do arquivo, não só no conteúdo.
        { nome: "public.operações.csv", conteudo: "coluna\r\nvalor\r\n" },
      ];
      const zip = montar(arquivos);

      const dir = mkdtempSync(join(tmpdir(), "dbee-zip-"));
      const caminho = join(dir, "d.zip");
      await Bun.write(caminho, zip);

      // `-t` confere o CRC de TODAS as entradas, acentuadas inclusive. É aqui
      // que um data descriptor errado cai.
      const teste = Bun.spawnSync(["unzip", "-t", caminho]);
      expect(teste.stdout.toString()).toContain("No errors detected");
      expect(teste.exitCode).toBe(0);

      // Conteúdo por extração: só os nomes ASCII, porque o Info-ZIP grava o
      // acentuado com outro nome (ver o comentário em `temPython`).
      Bun.spawnSync(["unzip", "-o", "-q", caminho, "-d", dir]);
      for (const arquivo of arquivos.filter((a) => !/[^\u0020-\u007E]/.test(a.nome))) {
        expect(await Bun.file(join(dir, arquivo.nome)).text()).toBe(arquivo.conteudo);
      }
    });

    it.if(temPython)("o nome acentuado sai exato para quem honra a flag UTF-8", async () => {
      const zip = montar([{ nome: "public.operações.csv", conteudo: "a\r\n" }]);
      const dir = mkdtempSync(join(tmpdir(), "dbee-zip-"));
      const caminho = join(dir, "acento.zip");
      await Bun.write(caminho, zip);

      const r = Bun.spawnSync([
        "python3", "-c",
        "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);" +
          "print(z.namelist()[0]);print(bool(z.infolist()[0].flag_bits & 0x800));" +
          "print(z.testzip())",
        caminho,
      ]);
      const [nome, flag, corrompido] = r.stdout.toString().trim().split("\n");
      expect(nome).toBe("public.operações.csv");
      expect(flag).toBe("True");
      // `testzip()` devolve None quando nenhuma entrada está corrompida.
      expect(corrompido).toBe("None");
    });

    it("aguenta entrada grande, escrita em muitos pedaços", async () => {
      // ~600 KB em pedaços de 7 bytes: exercita o CRC incremental de verdade.
      const conteudo = "linha de dados;com ponto e vírgula\r\n".repeat(17_000);
      const zip = montar([{ nome: "grande.csv", conteudo }]);

      const dir = mkdtempSync(join(tmpdir(), "dbee-zip-"));
      const caminho = join(dir, "g.zip");
      await Bun.write(caminho, zip);

      expect(Bun.spawnSync(["unzip", "-t", caminho]).exitCode).toBe(0);
      Bun.spawnSync(["unzip", "-o", "-q", caminho, "-d", dir]);
      expect(await Bun.file(join(dir, "grande.csv")).text()).toBe(conteudo);
    });

    it("zip sem nenhuma entrada continua válido", async () => {
      const zip = montar([]);
      const dir = mkdtempSync(join(tmpdir(), "dbee-zip-"));
      const caminho = join(dir, "vazio.zip");
      await Bun.write(caminho, zip);
      // `unzip -t` de um zip vazio devolve 1 com "Empty zipfile" — o que importa
      // é não ser um arquivo corrompido.
      const r = Bun.spawnSync(["unzip", "-t", caminho]);
      expect((r.stdout.toString() + r.stderr.toString()).toLowerCase()).toContain(
        "zipfile is empty",
      );
    });
  });
});
