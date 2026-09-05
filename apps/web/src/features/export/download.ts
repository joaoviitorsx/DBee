import type { ExportRequest } from "@dbee/shared";

/**
 * Baixa um export.
 *
 * **Não usa o Eden Treaty de propósito.** O Treaty lê o corpo inteiro para
 * devolver um valor tipado, e o corpo aqui é o ponto: ele começa a sair antes
 * da última linha existir. Ler tudo antes de salvar desfaria no navegador o que
 * o servidor faz com cursor.
 */

/**
 * `showSaveFilePicker` não está no `lib.dom` do TypeScript 5.9.
 *
 * A declaração é mínima de propósito — só o que este arquivo usa. Declarar o
 * resto da File System Access API seria inventar tipos para código que não
 * existe aqui.
 */
interface WritableFileStream {
  write: (dado: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort: (motivo?: unknown) => Promise<void>;
}
interface SaveFileHandle {
  createWritable: () => Promise<WritableFileStream>;
}
interface SaveOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}
type SaveFilePicker = (options?: SaveOptions) => Promise<SaveFileHandle>;

const picker = (): SaveFilePicker | null => {
  const w = window as unknown as { showSaveFilePicker?: SaveFilePicker };
  return typeof w.showSaveFilePicker === "function" ? w.showSaveFilePicker : null;
};

const ACEITA: Record<ExportRequest["format"], { descricao: string; mime: string; ext: string }> = {
  csv: { descricao: "CSV", mime: "text/csv", ext: ".csv" },
  json: { descricao: "JSON", mime: "application/json", ext: ".json" },
  ndjson: { descricao: "NDJSON", mime: "application/x-ndjson", ext: ".ndjson" },
  sql: { descricao: "SQL", mime: "application/sql", ext: ".sql" },
};

export interface Progresso {
  readonly bytes: number;
}

export class ExportCancelado extends Error {
  constructor() {
    super("export cancelado");
    this.name = "ExportCancelado";
  }
}

/** Nome sugerido, tirado do `content-disposition` que o servidor manda. */
function nomeDoCabecalho(res: Response, format: ExportRequest["format"]): string {
  const cd = res.headers.get("content-disposition") ?? "";
  return /filename="([^"]+)"/.exec(cd)?.[1] ?? `dbee${ACEITA[format].ext}`;
}

async function mensagemDeErro(res: Response): Promise<string> {
  try {
    const corpo: unknown = await res.json();
    if (typeof corpo === "object" && corpo !== null && "message" in corpo) {
      const { message } = corpo;
      if (typeof message === "string") return message;
    }
  } catch {
    /* corpo não-JSON: cai no genérico abaixo */
  }
  return `o servidor recusou o export (${String(res.status)})`;
}

export async function baixarExport(
  connectionId: string,
  pedido: ExportRequest,
  onProgress?: (p: Progresso) => void,
  signal?: AbortSignal,
): Promise<{ bytes: number; filename: string }> {
  const res = await fetch(`/api/connections/${connectionId}/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(pedido),
    ...(signal === undefined ? {} : { signal }),
  });

  if (!res.ok) throw new Error(await mensagemDeErro(res));
  const corpo = res.body;
  if (corpo === null) throw new Error("o servidor não devolveu corpo");

  const filename = nomeDoCabecalho(res, pedido.format);
  const salvar = picker();

  // Caminho bom: escreve em disco enquanto chega. Nada do arquivo passa pela
  // memória da aba, então uma tabela de 2 GB não derruba o navegador.
  if (salvar !== null) {
    const tipo = ACEITA[pedido.format];
    let handle: SaveFileHandle;
    try {
      handle = await salvar({
        suggestedName: filename,
        types: [{ description: tipo.descricao, accept: { [tipo.mime]: [tipo.ext] } }],
      });
    } catch {
      // Usuário fechou o seletor de arquivo. Cancelar o corpo aqui é o que
      // solta a transação do outro lado.
      await corpo.cancel();
      throw new ExportCancelado();
    }

    const destino = await handle.createWritable();
    const reader = corpo.getReader();
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await destino.write(value);
        bytes += value.byteLength;
        onProgress?.({ bytes });
      }
      await destino.close();
    } catch (err: unknown) {
      await destino.abort().catch(() => undefined);
      throw err;
    }
    return { bytes, filename };
  }

  // Caminho de reserva (Firefox, Safari): o navegador só sabe salvar um Blob
  // pronto, então o arquivo inteiro passa pela memória da aba. O servidor
  // continua em stream — o teto que se perde é o do cliente. Registrado no
  // ATRITO.md.
  const blob = await res.blob();
  onProgress?.({ bytes: blob.size });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  return { bytes: blob.size, filename };
}

/** Escreve no disco em stream, sem passar pela memória da aba. */
export const salvaEmStream = (): boolean => picker() !== null;
