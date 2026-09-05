/**
 * Rate limit em memória, só para a rota de login (DBee.md §7).
 *
 * Em memória basta porque o DBee é **uma instância** — store distribuído seria
 * um serviço a mais no compose, e o §3 diz "um container" de propósito.
 *
 * Janela fixa, não deslizante: a diferença entre as duas só importa contra um
 * atacante que sincroniza com a borda da janela, e aqui o que existe do outro
 * lado é uma pessoa que errou a senha. Janela fixa é 20 linhas e não erra.
 */
export interface LimiteConfig {
  /** Tentativas permitidas dentro da janela. */
  readonly tentativas: number;
  readonly janelaMs: number;
}

export interface Veredito {
  readonly permitido: boolean;
  /** Segundos até a janela virar. Só faz sentido quando bloqueado. */
  readonly esperarSegundos: number;
  readonly restantes: number;
}

interface Balde {
  contagem: number;
  /** Quando esta janela termina. */
  fim: number;
}

/**
 * Contador por chave.
 *
 * O `podar` roda a cada registro e é O(n) sobre as chaves — aceitável porque
 * `n` é "quantas pessoas tentaram entrar nos últimos minutos", não um número de
 * escala. Sem ele, um atacante variando o nome de usuário faria o mapa crescer
 * sem teto, que é um caminho de negação de serviço pela porta dos fundos.
 */
export class RateLimiter {
  readonly #config: LimiteConfig;
  readonly #baldes = new Map<string, Balde>();

  constructor(config: LimiteConfig) {
    this.#config = config;
  }

  /** Consulta **sem** consumir — para decidir antes de fazer o trabalho caro. */
  consultar(chave: string, agora = Date.now()): Veredito {
    const balde = this.#baldes.get(chave);
    if (balde === undefined || balde.fim <= agora) {
      return { permitido: true, esperarSegundos: 0, restantes: this.#config.tentativas };
    }
    const restantes = Math.max(0, this.#config.tentativas - balde.contagem);
    return {
      permitido: restantes > 0,
      esperarSegundos: Math.max(1, Math.ceil((balde.fim - agora) / 1000)),
      restantes,
    };
  }

  /** Registra uma tentativa e devolve o veredito **depois** dela. */
  registrar(chave: string, agora = Date.now()): Veredito {
    this.#podar(agora);

    const balde = this.#baldes.get(chave);
    if (balde === undefined || balde.fim <= agora) {
      this.#baldes.set(chave, { contagem: 1, fim: agora + this.#config.janelaMs });
      return {
        permitido: true,
        esperarSegundos: 0,
        restantes: this.#config.tentativas - 1,
      };
    }

    balde.contagem++;
    const restantes = Math.max(0, this.#config.tentativas - balde.contagem);
    return {
      permitido: restantes > 0,
      esperarSegundos: Math.max(1, Math.ceil((balde.fim - agora) / 1000)),
      restantes,
    };
  }

  /** Login bem-sucedido zera o contador daquela chave. */
  limpar(chave: string): void {
    this.#baldes.delete(chave);
  }

  /** Só para teste. */
  get tamanho(): number {
    return this.#baldes.size;
  }

  #podar(agora: number): void {
    for (const [chave, balde] of this.#baldes) {
      if (balde.fim <= agora) this.#baldes.delete(chave);
    }
  }
}
