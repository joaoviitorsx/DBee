/**
 * Escritor de ZIP em stream, sem dependência.
 *
 * ## Por que ZIP, e por que escrito à mão
 *
 * Exportar CSV de **várias** tabelas precisa de um arquivo por tabela — CSVs
 * concatenados num arquivo só não são lidos por nenhuma ferramenta (o Adminer
 * faz isso, e o resultado não abre no Excel). Faltava um container.
 *
 * TAR seria mais simples, mas o cabeçalho dele exige o **tamanho antes dos
 * dados**, e o tamanho de uma tabela só se sabe depois de percorrê-la. Guardar
 * a tabela inteira em memória para descobrir o tamanho desfaz o cursor da §6.
 *
 * ZIP resolve isso com o **data descriptor** (bit 3 do flag): o cabeçalho local
 * sai com zeros e os valores reais vão depois dos dados. É o mecanismo padrão
 * para zip em stream, e todo descompactador entende.
 *
 * `Bun.zstdCompress`/`gzip` não servem: comprimem um fluxo, não empacotam
 * vários arquivos.
 *
 * ## Compressão
 *
 * As entradas saem **armazenadas** (método 0), sem compressão. Deflate exigiria
 * passar cada entrada por um `CompressionStream` e contar os dois tamanhos, o
 * que dobra a máquina de estado do escritor por um ganho que o usuário já tem
 * pelo caminho `.sql.gz`. Registrado como escolha, não como esquecimento.
 */

/** Tabela do CRC-32 (polinômio 0xEDB88320), montada uma vez. */
const TABELA_CRC = (() => {
  const tabela = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tabela[i] = c >>> 0;
  }
  return tabela;
})();

/** CRC-32 incremental — o ZIP exige um por entrada, sobre os bytes crus. */
export function crc32(bytes: Uint8Array, anterior = 0): number {
  let c = (anterior ^ 0xffffffff) >>> 0;
  for (const byte of bytes) {
    // `& 0xff` garante 0..255, e a tabela tem 256 posições — o índice nunca sai
    // da faixa. `?? 0` existe só para o tipo; é inalcançável.
    const passo = TABELA_CRC[(c ^ byte) & 0xff] ?? 0;
    c = (passo ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

const ASSINATURA_LOCAL = 0x04034b50;
const ASSINATURA_DESCRITOR = 0x08074b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_FIM = 0x06054b50;

/** Bit 3: tamanhos e CRC vão **depois** dos dados, no data descriptor. */
const FLAG_DESCRITOR = 0x0008;
/** Bit 11: o nome do arquivo está em UTF-8. Sem ele, acento vira lixo. */
const FLAG_UTF8 = 0x0800;

const METODO_ARMAZENADO = 0;

interface EntradaFechada {
  readonly nome: Uint8Array;
  readonly crc: number;
  readonly tamanho: number;
  readonly offset: number;
}

function u32(valor: number): number[] {
  return [valor & 0xff, (valor >>> 8) & 0xff, (valor >>> 16) & 0xff, (valor >>> 24) & 0xff];
}

function u16(valor: number): number[] {
  return [valor & 0xff, (valor >>> 8) & 0xff];
}

/**
 * Data/hora no formato MS-DOS, que é o que o ZIP guarda.
 *
 * Segundos têm resolução de 2 (o campo tem 5 bits), e o ano é contado de 1980.
 * Não é bug: é o formato.
 */
function dataDos(quando: Date): { hora: number; data: number } {
  return {
    hora:
      (quando.getHours() << 11) | (quando.getMinutes() << 5) | (Math.floor(quando.getSeconds() / 2)),
    data:
      ((quando.getFullYear() - 1980) << 9) | ((quando.getMonth() + 1) << 5) | quando.getDate(),
  };
}

/**
 * Monta um ZIP entrada por entrada, devolvendo os bytes a emitir.
 *
 * Quem usa controla o ritmo: `abrir` → `escrever`* → `fechar` por arquivo, e
 * `finalizar` no fim. Nada é acumulado além do diretório central, que é uma
 * entrada de ~50 bytes por arquivo.
 */
export class ZipWriter {
  #offset = 0;
  #entradas: EntradaFechada[] = [];
  #aberta: { nome: Uint8Array; offset: number; crc: number; tamanho: number } | null = null;
  readonly #quando: Date;

  constructor(quando: Date = new Date()) {
    this.#quando = quando;
  }

  /** Bytes do cabeçalho local. Chamar uma vez por arquivo. */
  abrir(nome: string): Uint8Array {
    if (this.#aberta !== null) throw new Error("entrada anterior não foi fechada");

    const nomeBytes = new TextEncoder().encode(nome);
    const { hora, data } = dataDos(this.#quando);

    const cabecalho = [
      ...u32(ASSINATURA_LOCAL),
      ...u16(20), // versão mínima para extrair
      ...u16(FLAG_DESCRITOR | FLAG_UTF8),
      ...u16(METODO_ARMAZENADO),
      ...u16(hora),
      ...u16(data),
      // CRC e tamanhos ficam zerados: os reais vão no descritor, depois dos dados.
      ...u32(0),
      ...u32(0),
      ...u32(0),
      ...u16(nomeBytes.length),
      ...u16(0), // sem campo extra
    ];

    const bytes = new Uint8Array(cabecalho.length + nomeBytes.length);
    bytes.set(cabecalho, 0);
    bytes.set(nomeBytes, cabecalho.length);

    this.#aberta = { nome: nomeBytes, offset: this.#offset, crc: 0, tamanho: 0 };
    this.#offset += bytes.length;
    return bytes;
  }

  /** Passa os dados adiante e vai somando CRC e tamanho. */
  escrever(dados: Uint8Array): Uint8Array {
    const aberta = this.#aberta;
    if (aberta === null) throw new Error("nenhuma entrada aberta");
    aberta.crc = crc32(dados, aberta.crc);
    aberta.tamanho += dados.length;
    this.#offset += dados.length;
    return dados;
  }

  /** Bytes do data descriptor. Fecha a entrada corrente. */
  fechar(): Uint8Array {
    const aberta = this.#aberta;
    if (aberta === null) throw new Error("nenhuma entrada aberta");

    const descritor = new Uint8Array([
      ...u32(ASSINATURA_DESCRITOR),
      ...u32(aberta.crc),
      ...u32(aberta.tamanho),
      ...u32(aberta.tamanho),
    ]);

    this.#entradas.push({
      nome: aberta.nome,
      crc: aberta.crc,
      tamanho: aberta.tamanho,
      offset: aberta.offset,
    });
    this.#aberta = null;
    this.#offset += descritor.length;
    return descritor;
  }

  /** Diretório central + fim do arquivo. Nada mais pode ser escrito depois. */
  finalizar(): Uint8Array {
    if (this.#aberta !== null) throw new Error("entrada aberta ao finalizar");

    const inicioCentral = this.#offset;
    const partes: number[] = [];
    const { hora, data } = dataDos(this.#quando);

    for (const entrada of this.#entradas) {
      partes.push(
        ...u32(ASSINATURA_CENTRAL),
        ...u16(20), // versão que criou
        ...u16(20), // versão mínima para extrair
        ...u16(FLAG_DESCRITOR | FLAG_UTF8),
        ...u16(METODO_ARMAZENADO),
        ...u16(hora),
        ...u16(data),
        ...u32(entrada.crc),
        ...u32(entrada.tamanho),
        ...u32(entrada.tamanho),
        ...u16(entrada.nome.length),
        ...u16(0), // extra
        ...u16(0), // comentário
        ...u16(0), // disco
        ...u16(0), // atributos internos
        ...u32(0), // atributos externos
        ...u32(entrada.offset),
        ...entrada.nome,
      );
    }

    const tamanhoCentral = partes.length;
    partes.push(
      ...u32(ASSINATURA_FIM),
      ...u16(0), // número do disco
      ...u16(0), // disco do diretório central
      ...u16(this.#entradas.length),
      ...u16(this.#entradas.length),
      ...u32(tamanhoCentral),
      ...u32(inicioCentral),
      ...u16(0), // comentário
    );

    return new Uint8Array(partes);
  }
}
