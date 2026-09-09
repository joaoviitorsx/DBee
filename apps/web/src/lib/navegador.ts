/**
 * Duas APIs do navegador que **só existem em contexto seguro**, com o caminho
 * de volta para quando ele não existe.
 *
 * ## O ambiente que quebrou
 *
 * O DBee é alcançado pelo IP da tailnet, em `http://100.x.y.z:3001` — sem TLS,
 * e um IP nunca é "potencialmente confiável" como `localhost`. Medido num
 * origin assim:
 *
 *   isSecureContext ......... false
 *   crypto.randomUUID ....... ausente
 *   crypto.getRandomValues .. presente
 *   navigator.clipboard ..... ausente
 *   document.execCommand .... presente
 *
 * O efeito não foi degradação, foi funcionalidade morta: `crypto.randomUUID()`
 * lança `is not a function` e derruba o clique inteiro de **executar consulta**,
 * e `navigator.clipboard.writeText` estoura em `undefined` no Ctrl+C da grade.
 * Nos dois casos o código assumia contexto seguro sem verificar.
 *
 * Servir por HTTPS resolveria os dois — e continua sendo o certo. Mas a
 * ferramenta não pode exigir isso para funcionar: quem acessa pela tailnet já
 * está numa rede privada, e é justamente o cenário de uso descrito no README.
 */

/**
 * UUID v4, com ou sem contexto seguro.
 *
 * `getRandomValues` **não** exige contexto seguro (só `randomUUID` e
 * `crypto.subtle` exigem), então a aleatoriedade continua sendo a do sistema —
 * o fallback não troca CSPRNG por `Math.random`, que aqui seria inaceitável: o
 * `queryId` identifica a consulta a cancelar, e colisão cancelaria a query de
 * outra pessoa.
 */
/**
 * O `crypto` **como ele de fato é**, e não como o `lib.dom` o descreve.
 *
 * O TypeScript declara `crypto.randomUUID` como sempre presente. Não é: fora de
 * contexto seguro ele não existe, e foi exatamente essa promessa do tipo que
 * deixou o `crypto.randomUUID()` passar por typecheck, lint e revisão, para
 * quebrar só na produção que roda em `http://` por IP. O tipo mentindo é parte
 * da causa, então aqui ele é redeclarado dizendo a verdade.
 */
interface CryptoReal {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(alvo: T) => T;
}

export function uuidV4(): string {
  const c = globalThis.crypto as CryptoReal | undefined;
  if (typeof c?.randomUUID === "function") return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    // Navegador sem `crypto` nenhum não existe entre os que o DBee suporta;
    // ainda assim, falhar alto é melhor que devolver id previsível em silêncio.
    throw new Error("navegador sem crypto.getRandomValues: não há como gerar id de consulta");
  }
  // Versão 4 e variante RFC 4122 — o que distingue um UUID v4 de 16 bytes soltos.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Copia texto para a área de transferência.
 *
 * Tenta a API moderna e, sem ela (ou se ela recusar), cai no `execCommand`
 * legado — que funciona sem contexto seguro e é o único caminho no acesso por
 * IP sem TLS.
 *
 * O caminho legado precisa de um nó selecionável no documento. Ele nasce fora
 * de vista e some no mesmo quadro; `position: fixed` e `top: 0` evitam que o
 * navegador role a página até ele, que é o defeito clássico dessa técnica.
 *
 * Devolve se copiou. Quem chama decide o que dizer — a grade acende o "copiado",
 * e nada acende quando falha, porque avisar "copiado" sem ter copiado é pior
 * que não avisar.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  const area = navigator.clipboard as Clipboard | undefined;
  if (area !== undefined) {
    try {
      await area.writeText(texto);
      return true;
    } catch {
      // Permissão negada ou documento sem foco: ainda há o caminho legado.
    }
  }
  return copiaLegada(texto);
}

function copiaLegada(texto: string): boolean {
  const antes = document.activeElement;
  const campo = document.createElement("textarea");
  campo.value = texto;
  // `readOnly` evita o teclado virtual no toque; o resto tira o campo de vista
  // sem tirá-lo do documento, que é o que `execCommand` exige.
  campo.readOnly = true;
  campo.setAttribute("aria-hidden", "true");
  campo.style.position = "fixed";
  campo.style.top = "0";
  campo.style.left = "0";
  campo.style.width = "1px";
  campo.style.height = "1px";
  campo.style.padding = "0";
  campo.style.border = "none";
  campo.style.opacity = "0";

  document.body.appendChild(campo);
  try {
    campo.select();
    campo.setSelectionRange(0, texto.length);
    /*
     * `execCommand` é depreciado, e é exatamente por isso que ele está aqui: é
     * o único caminho de cópia que sobra sem contexto seguro, e é o ambiente em
     * que o DBee roda. Depreciado não é removido — nenhum navegador atual o
     * tirou, justamente porque milhões de páginas em HTTP dependem dele.
     * Quando a produção passar a servir por HTTPS, este ramo deixa de ser
     * alcançado sozinho: a API moderna vem antes.
     */
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    campo.remove();
    // Devolve o foco a quem o tinha, senão o Ctrl+C seguinte não chega ao grid.
    if (antes instanceof HTMLElement) antes.focus();
  }
}
