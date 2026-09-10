/* ==========================================================================
   DBee — motor de movimento da landing
   ==========================================================================

   Sem dependência externa, e não por purismo: a regra do projeto proíbe CDN em
   runtime, e vendorizar GSAP+Lenis custaria ~90 KB de JS para fazer o que cabe
   em ~12 KB aqui.

   Duas decisões que valem explicação, porque a alternativa é a "de manual":

   1. NÃO existe scroll hijacking. Um wrapper com translate3d por rAF (o padrão
      Lenis) daria mais inércia, mas quebra `position: sticky`, quebra a busca
      do navegador, quebra o Page Down do teclado e briga com o gesto de toque.
      A rolagem aqui é a nativa. O peso vem de LERP nos elementos — parallax,
      cursor, trilho, marquise, botão magnético — e de um sinal de VELOCIDADE
      derivado da rolagem, que é o que dá a sensação de massa dos sites de
      piloto: o conteúdo reage a quão rápido você rola, não só a onde parou.

   2. Um único rAF e um único listener de scroll passivo. Ler layout
      (getBoundingClientRect) e escrever estilo em fases separadas dentro do
      mesmo quadro evita layout thrashing. Tudo que se escreve é transform,
      opacity, ou uma custom property que só alimenta transform e opacity.

   O laço dorme quando nada se move (`vivo`), e acorda no scroll, no ponteiro e
   no resize.
   ========================================================================== */
(function () {
  "use strict";

  var doc = document;
  var root = doc.documentElement;

  /* prefers-reduced-motion: o movimento sai; o conteúdo, nunca.
     O CSS já garante o estado final — aqui o JS só evita gastar quadro. */
  var mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var mqFine = window.matchMedia("(hover: hover) and (pointer: fine)");
  /* A MESMA condição do CSS, altura incluída. Se as duas divergirem, o JS mede
     e translada um trilho que o CSS não montou — e a seção some da tela sem
     erro nenhum no console. */
  var mqRail = window.matchMedia("(min-width: 1000px) and (min-height: 800px)");

  var reduced = mqReduce.matches;

  function $(sel, ctx) {
    return (ctx || doc).querySelector(sel);
  }
  function $$(sel, ctx) {
    return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel));
  }
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  /* ------------------------------------------------------------------------
     1. Preloader
     Sai no `load` (fontes e primeira imagem resolvidas) com um teto de 2 s: se
     um asset pendurar, a página aparece assim mesmo. Uma tela de carregamento
     que não sai é pior que nenhuma.
     ------------------------------------------------------------------------ */
  var preload = $(".preload");
  if (preload !== null) {
    var saiu = false;
    var sair = function () {
      if (saiu) return;
      saiu = true;
      preload.classList.add("is-done");
      root.classList.add("is-ready");
      window.setTimeout(function () {
        preload.style.display = "none";
      }, 1000);
      entrada();
    };
    window.addEventListener("load", function () {
      window.setTimeout(sair, 240);
    });
    window.setTimeout(sair, 2000);
  }

  /* ------------------------------------------------------------------------
     2. Tipografia fatiada
     Em JS, e não no HTML, para o markup continuar legível e o texto continuar
     selecionável e copiável inteiro. Sem script, o título é um <h1> normal —
     que é o que ele já é.

     Duas granularidades, e a diferença importa: palavra para títulos de seção
     (cascata legível), caractere só para o H1 do herói — a entrada mais lenta
     e mais cara da página, que acontece uma vez.

     O `aria-label` guarda a frase inteira antes do corte: sem ele, um leitor
     de tela anuncia letra por letra.
     ------------------------------------------------------------------------ */
  function fatiar(el, porCaractere) {
    if (el.dataset.split === "1") return;
    el.dataset.split = "1";
    var frase = el.textContent.replace(/\s+/g, " ").trim();
    el.setAttribute("aria-label", frase);

    var frag = doc.createDocumentFragment();
    var i = 0;
    frase.split(" ").forEach(function (palavra, iw) {
      if (iw > 0) frag.appendChild(doc.createTextNode(" "));
      var w = doc.createElement("span");
      w.className = "w";
      w.setAttribute("aria-hidden", "true");

      if (porCaractere) {
        Array.prototype.forEach.call(palavra, function (ch) {
          var c = doc.createElement("span");
          c.textContent = ch;
          /* 26ms por caractere COM TETO: numa frase longa o atraso linear puro
             faria a última letra chegar meio segundo depois da primeira, e a
             frase pareceria travada em vez de entrando. */
          c.style.setProperty("--w-delay", Math.min(i * 26, 720) + "ms");
          w.appendChild(c);
          i++;
        });
      } else {
        var inner = doc.createElement("span");
        inner.textContent = palavra;
        inner.style.setProperty("--w-delay", i * 55 + "ms");
        w.appendChild(inner);
        i++;
      }
      frag.appendChild(w);
    });
    el.textContent = "";
    el.appendChild(frag);
  }

  if (!reduced) {
    $$(".split-chars").forEach(function (el) {
      fatiar(el, true);
    });
    $$(".split-words").forEach(function (el) {
      fatiar(el, false);
    });
  }

  /* ------------------------------------------------------------------------
     3. Revelação por entrada no viewport
     ------------------------------------------------------------------------ */
  function revelarTudo() {
    $$("[data-fx], .split-words, .split-chars").forEach(function (el) {
      el.classList.add("is-in");
    });
  }

  var io = null;
  if ("IntersectionObserver" in window && !reduced) {
    io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.add("is-in");
          if (e.target.dataset.conta !== undefined) contar(e.target);
          io.unobserve(e.target);
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 }
    );

    /* Escalonamento calculado uma vez, por grupo: filhos de um mesmo
       [data-fx-group] entram em cascata em vez de todos juntos. */
    $$("[data-fx-group]").forEach(function (grupo) {
      $$("[data-fx]", grupo).forEach(function (el, i) {
        el.style.setProperty("--fx-delay", Math.min(i, 8) * 80 + "ms");
      });
    });

    /* `:not([data-enter])`: o herói já está na tela quando a página carrega.
       Se o observador o revelasse, ele apareceria por baixo do preloader e a
       cortina subiria sobre um herói já montado — a entrada escalonada some.
       Quem tem [data-enter] é revelado por entrada(), depois da cortina. */
    $$("[data-fx]:not([data-enter])").forEach(function (el) {
      io.observe(el);
    });
    $$(".split-words:not([data-enter]), .split-chars:not([data-enter])").forEach(
      function (el) {
        io.observe(el);
      }
    );
    $$("[data-conta]").forEach(function (el) {
      io.observe(el);
    });
  } else {
    revelarTudo();
    $$("[data-conta]").forEach(function (el) {
      el.textContent = el.dataset.conta;
    });
  }

  mqReduce.addEventListener("change", function (e) {
    reduced = e.matches;
    if (reduced) revelarTudo();
  });

  function entrada() {
    $$("[data-enter]").forEach(function (el, i) {
      window.setTimeout(function () {
        el.classList.add("is-in");
      }, 90 + i * 110);
    });
  }
  if (preload === null) entrada();

  /* ------------------------------------------------------------------------
     4. Contador
     Sobe até o valor com desaceleração. O texto final é o do `data-conta`
     LITERAL, não um número reformatado: assim "0,093" mantém a vírgula e
     "100 mil" continua sendo "100 mil". O que se anima é a ilusão de contagem;
     o valor exibido no fim é exatamente o que está no HTML.
     ------------------------------------------------------------------------ */
  function contar(el) {
    var alvoTexto = el.dataset.conta;
    var num = parseFloat(alvoTexto.replace(/[^\d.,-]/g, "").replace(",", "."));
    if (reduced || isNaN(num)) {
      el.textContent = alvoTexto;
      return;
    }
    var casas = (alvoTexto.split(/[.,]/)[1] || "").replace(/\D+$/, "").length;
    var inicio = performance.now();
    var dur = 1100;
    var passo = function (agora) {
      var t = clamp((agora - inicio) / dur, 0, 1);
      /* easeOutExpo: quase todo o movimento no começo, e o número "assenta" no
         fim em vez de parar de repente. */
      var e = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      if (t < 1) {
        el.textContent = (num * e).toFixed(casas).replace(".", ",");
        window.requestAnimationFrame(passo);
      } else {
        el.textContent = alvoTexto;
      }
    };
    window.requestAnimationFrame(passo);
  }

  /* ------------------------------------------------------------------------
     5. Cabeçalho que reage à direção da rolagem
     ------------------------------------------------------------------------ */
  var header = $(".header");
  var ultimoY = 0;

  function atualizarHeader(y) {
    if (header === null) return;
    header.classList.toggle("is-stuck", y > 12);
    /* Histerese de 6px: sem ela o cabeçalho pisca com o ricochete elástico do
       toque, que produz dezenas de inversões de direção por segundo. */
    if (Math.abs(y - ultimoY) > 6) {
      var descendo = y > ultimoY && y > 240;
      header.classList.toggle("is-hidden", descendo && !reduced);
      ultimoY = y;
    }
  }

  /* ------------------------------------------------------------------------
     6. Índice de capítulo
     O marcador fixo que diz em que ponto da história você está. É o que
     transforma nove blocos empilhados numa narrativa numerada.
     ------------------------------------------------------------------------ */
  var indice = $("[data-indice]");
  var indiceNum = $("[data-indice-num]");
  var indiceNome = $("[data-indice-nome]");
  var capitulos = $$("[data-cap]");

  if (indice !== null && capitulos.length > 0 && "IntersectionObserver" in window) {
    var totalEl = $("[data-indice-total]");
    if (totalEl !== null) {
      totalEl.textContent = ("0" + String(capitulos.length)).slice(-2);
    }

    var ioCap = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          var i = capitulos.indexOf(e.target);
          if (i < 0) return;
          var n = ("0" + String(i + 1)).slice(-2);
          if (indiceNum !== null && indiceNum.textContent === n) return;
          indice.classList.add("is-troca");
          window.setTimeout(
            function () {
              if (indiceNum !== null) indiceNum.textContent = n;
              if (indiceNome !== null) indiceNome.textContent = e.target.dataset.cap;
              indice.classList.remove("is-troca");
            },
            reduced ? 0 : 180
          );
        });
      },
      /* Faixa fina no meio da tela: o capítulo "atual" é o que está sob os
         olhos, não o que encostou na borda. */
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );
    capitulos.forEach(function (c) {
      ioCap.observe(c);
    });
  }

  /* ------------------------------------------------------------------------
     7. Parallax com inércia
     O JS escreve só a custom property --py; o transform mora no CSS, para um
     `transform` de outra regra (hover, revelação) não ser sobrescrito por
     estilo inline.
     ------------------------------------------------------------------------ */
  var camadas = $$("[data-parallax]").map(function (el) {
    return { el: el, k: parseFloat(el.dataset.parallax) || 0.1, atual: 0, alvo: 0 };
  });

  /* ------------------------------------------------------------------------
     8. Marquise de velocidade
     Anda sozinha, devagar, e ACELERA com a rolagem — inclusive invertendo o
     sentido quando se rola para cima. É o truque que dá massa à página: o
     texto responde a quão rápido você rola, não a onde você parou.

     O conteúdo é duplicado no HTML e o deslocamento é módulo da metade da
     largura, então a emenda nunca aparece.
     ------------------------------------------------------------------------ */
  var marquises = $$("[data-marquise]").map(function (el) {
    return { el: el, base: parseFloat(el.dataset.marquise) || 0.35, pos: 0, larg: 0 };
  });

  function medirMarquises() {
    marquises.forEach(function (m) {
      /* Metade: o conteúdo está duplicado. */
      m.larg = m.el.scrollWidth / 2;
    });
  }

  /* ------------------------------------------------------------------------
     9. Trilho horizontal dos motores
     A seção prende no viewport e a rolagem vertical vira deslocamento
     horizontal. Só acima de 1000×800: abaixo disso a mesma marcação é uma
     pilha vertical comum, sem pin e sem transform.
     ------------------------------------------------------------------------ */
  var rail = $("[data-rail]");
  var railTrack = $("[data-rail-track]");
  var railBar = $("[data-rail-bar]");
  var railLen = 0;
  var railX = 0;
  var railAlvo = 0;

  function medirRail() {
    if (rail === null || railTrack === null) return;
    if (!mqRail.matches || reduced) {
      rail.style.height = "";
      railTrack.style.transform = "";
      railLen = 0;
      return;
    }
    var gut = parseFloat(getComputedStyle(doc.body).getPropertyValue("--gutter")) || 32;
    railLen = Math.max(0, railTrack.scrollWidth - window.innerWidth + gut);
    /* Altura = uma tela presa + a distância a percorrer. Escrito uma vez por
       resize, nunca por quadro. */
    rail.style.height = window.innerHeight + railLen + "px";
  }

  /* ------------------------------------------------------------------------
     10. Cursor e botão magnético
     Os dois só existem com ponteiro fino — num toque, "magnético" não quer
     dizer nada e o cursor seria um ponto parado no canto.
     ------------------------------------------------------------------------ */
  var cursor = null;
  var cursorTexto = null;
  var cx = -100;
  var cy = -100;
  var mx = -100;
  var my = -100;
  var imas = [];

  if (mqFine.matches && !reduced) {
    cursor = doc.createElement("div");
    cursor.className = "cursor";
    cursor.setAttribute("aria-hidden", "true");
    cursorTexto = doc.createElement("span");
    cursor.appendChild(cursorTexto);
    doc.body.appendChild(cursor);

    imas = $$("[data-ima]").map(function (el) {
      return { el: el, x: 0, y: 0, ax: 0, ay: 0 };
    });

    window.addEventListener(
      "pointermove",
      function (e) {
        mx = e.clientX;
        my = e.clientY;

        /*
         * A atração é calculada aqui, e não no laço: um `getBoundingClientRect`
         * por botão por quadro seria leitura de layout a 60 Hz para elementos
         * que não se movem sozinhos. Aqui só roda quando o ponteiro anda.
         */
        imas.forEach(function (im) {
          var r = im.el.getBoundingClientRect();
          var dx = e.clientX - (r.left + r.width / 2);
          var dy = e.clientY - (r.top + r.height / 2);
          var raio = Math.max(r.width, r.height) * 0.95;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < raio) {
            /* A força cai com a distância: perto do centro quase não puxa, na
               borda do raio puxa o máximo. Sem isso o botão gruda e treme. */
            var f = 1 - dist / raio;
            im.ax = dx * 0.34 * f;
            im.ay = dy * 0.44 * f;
          } else {
            im.ax = 0;
            im.ay = 0;
          }
        });
        acordar();
      },
      { passive: true }
    );

    /* Delegação: o estado do cursor não precisa de um listener por elemento. */
    doc.addEventListener(
      "pointerover",
      function (e) {
        if (cursor === null) return;
        var alvo = e.target.closest("[data-cursor], a, button");
        var rotulo = alvo !== null ? alvo.getAttribute("data-cursor") : null;
        cursor.classList.toggle("is-hot", alvo !== null);
        cursor.classList.toggle("is-rotulo", rotulo !== null && rotulo !== "");
        if (cursorTexto !== null) cursorTexto.textContent = rotulo || "";
      },
      { passive: true }
    );
  }

  /* ------------------------------------------------------------------------
     11. O laço. Um só.
     ------------------------------------------------------------------------ */
  var sujo = true;
  var rodando = false;

  /* Velocidade de rolagem, lerpada. É o sinal que alimenta a marquise e a
     inclinação — e a razão de a página parecer ter massa. */
  var yAnterior = window.scrollY || 0;
  var veloSuave = 0;
  var ultimoQuadro = performance.now();

  var heroi = $("[data-heroi]");
  var barra = $("[data-progresso]");

  function acordar() {
    sujo = true;
    if (!rodando) laco();
  }

  window.addEventListener("scroll", acordar, { passive: true });

  var t;
  window.addEventListener(
    "resize",
    function () {
      window.clearTimeout(t);
      t = window.setTimeout(function () {
        medirRail();
        medirMarquises();
        acordar();
      }, 140);
    },
    { passive: true }
  );

  function laco() {
    rodando = true;
    var agora = performance.now();
    /* dt normalizado a 60 Hz: num monitor de 144 Hz um LERP de fator fixo
       andaria mais que o dobro do previsto, e a página teria "peso" diferente
       por hardware. */
    var dt = clamp((agora - ultimoQuadro) / 16.667, 0.2, 3);
    ultimoQuadro = agora;

    var y = window.scrollY || window.pageYOffset;
    var vh = window.innerHeight;
    var i;

    /* --- fase de leitura: tudo que consulta layout acontece aqui --- */
    var metade = vh / 2;
    for (i = 0; i < camadas.length; i++) {
      var c = camadas[i];
      var r = c.el.getBoundingClientRect();
      /* Fora da tela não vale quadro. */
      if (r.bottom < -200 || r.top > vh + 200) continue;
      c.alvo = (r.top + r.height / 2 - metade) * -c.k;
    }

    var railP = 0;
    if (railLen > 0 && rail !== null) {
      railP = clamp(-rail.getBoundingClientRect().top / railLen, 0, 1);
      railAlvo = -railP * railLen;
    }

    /* --- fase de escrita --- */
    atualizarHeader(y);

    var velo = (y - yAnterior) / dt;
    yAnterior = y;
    veloSuave += (velo - veloSuave) * 0.12 * dt;
    if (Math.abs(veloSuave) < 0.02) veloSuave = 0;

    var vivo = false;

    /* Saída do herói: 0 no topo, 1 quando ele já saiu. */
    if (heroi !== null) {
      heroi.style.setProperty("--hero-p", clamp(y / (vh * 0.85), 0, 1).toFixed(4));
    }

    if (barra !== null) {
      var alcance = Math.max(1, doc.documentElement.scrollHeight - vh);
      barra.style.transform = "scaleX(" + clamp(y / alcance, 0, 1).toFixed(4) + ")";
    }

    if (railBar !== null && railLen > 0) {
      railBar.style.transform = "scaleX(" + Math.max(0.08, railP).toFixed(4) + ")";
    }

    for (i = 0; i < camadas.length; i++) {
      var l = camadas[i];
      /* LERP: é daqui que vem o "peso". 0.085 dá arraste perceptível sem
         parecer atrasado — abaixo disso o elemento parece preso à tela. */
      l.atual += (l.alvo - l.atual) * 0.085 * dt;
      if (Math.abs(l.alvo - l.atual) > 0.05) vivo = true;
      l.el.style.setProperty("--py", l.atual.toFixed(2) + "px");
    }

    if (railLen > 0 && railTrack !== null) {
      railX += (railAlvo - railX) * 0.11 * dt;
      if (Math.abs(railAlvo - railX) > 0.1) vivo = true;
      railTrack.style.transform = "translate3d(" + railX.toFixed(2) + "px,0,0)";
    }

    /* Marquise: base constante + empurrão da velocidade de rolagem. */
    for (i = 0; i < marquises.length; i++) {
      var m = marquises[i];
      if (m.larg === 0) continue;
      m.pos -= (m.base + veloSuave * 0.55) * dt;
      /* Módulo nos DOIS sentidos: rolar para cima inverte a marquise, e sem
         isto ela sairia do intervalo e deixaria um vão à vista. */
      if (m.pos <= -m.larg) m.pos += m.larg;
      if (m.pos > 0) m.pos -= m.larg;
      m.el.style.transform = "translate3d(" + m.pos.toFixed(2) + "px,0,0)";
      vivo = true;
    }

    /* Inclinação por velocidade — o efeito mais "de site de piloto" daqui.
       Teto de 3,5°: acima disso o texto fica ilegível durante a rolagem, e uma
       página que não se lê enquanto rola não serve. */
    var incl = clamp(veloSuave * 0.08, -3.5, 3.5);
    root.style.setProperty("--velo-skew", incl.toFixed(3) + "deg");
    if (Math.abs(incl) > 0.01) vivo = true;

    for (i = 0; i < imas.length; i++) {
      var im2 = imas[i];
      im2.x += (im2.ax - im2.x) * 0.18 * dt;
      im2.y += (im2.ay - im2.y) * 0.18 * dt;
      if (Math.abs(im2.ax - im2.x) > 0.05 || Math.abs(im2.ay - im2.y) > 0.05) vivo = true;
      im2.el.style.setProperty("--mx", im2.x.toFixed(2) + "px");
      im2.el.style.setProperty("--my", im2.y.toFixed(2) + "px");
    }

    if (cursor !== null) {
      cx += (mx - cx) * 0.18 * dt;
      cy += (my - cy) * 0.18 * dt;
      if (Math.abs(mx - cx) > 0.1 || Math.abs(my - cy) > 0.1) vivo = true;
      cursor.style.transform =
        "translate3d(" + cx.toFixed(1) + "px," + cy.toFixed(1) + "px,0)";
    }

    if (sujo) {
      sujo = false;
      vivo = true;
    }

    if (vivo) {
      window.requestAnimationFrame(laco);
    } else {
      rodando = false;
    }
  }

  if (!reduced) {
    medirRail();
    medirMarquises();
    mqRail.addEventListener("change", medirRail);
    laco();
  } else {
    atualizarHeader(window.scrollY || 0);
    window.addEventListener(
      "scroll",
      function () {
        atualizarHeader(window.scrollY || 0);
      },
      { passive: true }
    );
  }

  /* A largura da marquise e a do trilho mudam quando a fonte troca do fallback
     para a Sora. Sem remedir, a emenda da marquise aparece e o trilho para
     antes do último cartão. */
  if (doc.fonts !== undefined && doc.fonts.ready !== undefined) {
    doc.fonts.ready.then(function () {
      medirRail();
      medirMarquises();
      if (!reduced) acordar();
    });
  }

  /* ------------------------------------------------------------------------
     12. Copiar comando
     Sem fallback para execCommand: a página só é servida por HTTPS (Pages) ou
     por localhost, e nos dois a Clipboard API existe. Se falhar, o botão diz
     que falhou em vez de fingir que copiou.
     ------------------------------------------------------------------------ */
  $$("[data-copy]").forEach(function (botao) {
    var rotulo = $(".copy__txt", botao);
    var original = rotulo !== null ? rotulo.textContent : "";
    botao.addEventListener("click", function () {
      var alvo = doc.getElementById(botao.dataset.copy);
      if (alvo === null) return;
      /* O `innerText` devolve espaço NÃO-SEPARÁVEL onde o HTML tem `&nbsp;`, e
         colar U+00A0 num terminal quebra o comando de um jeito que não se vê.
         Escrito como escape, e não como o caractere literal: no fonte os dois
         são pixels idênticos, e o `no-irregular-whitespace` reprova o literal. */
      var texto = alvo.innerText.replace(/\u00A0/g, " ");
      navigator.clipboard.writeText(texto).then(
        function () {
          botao.dataset.copied = "1";
          if (rotulo !== null) rotulo.textContent = "Copiado";
          window.setTimeout(function () {
            botao.dataset.copied = "0";
            if (rotulo !== null) rotulo.textContent = original;
          }, 1800);
        },
        function () {
          if (rotulo !== null) rotulo.textContent = "Copie à mão";
        }
      );
    });
  });

  /* ------------------------------------------------------------------------
     13. Trilho de capturas — arrastar com o ponteiro
     A rolagem nativa continua funcionando (toque, roda, teclado). Isto só
     acrescenta o arraste com o botão do mouse, que num trilho horizontal é o
     gesto que a pessoa tenta primeiro no desktop.
     ------------------------------------------------------------------------ */
  var trilho = $("[data-arrasta]");
  if (trilho !== null && mqFine.matches) {
    var pegando = false;
    var x0 = 0;
    var s0 = 0;

    trilho.addEventListener("pointerdown", function (e) {
      pegando = true;
      x0 = e.clientX;
      s0 = trilho.scrollLeft;
      trilho.classList.add("is-pegando");
    });
    trilho.addEventListener("pointermove", function (e) {
      if (!pegando) return;
      e.preventDefault();
      trilho.scrollLeft = s0 - (e.clientX - x0);
    });
    var soltar = function () {
      if (!pegando) return;
      pegando = false;
      trilho.classList.remove("is-pegando");
    };
    trilho.addEventListener("pointerup", soltar);
    trilho.addEventListener("pointerleave", soltar);
    trilho.addEventListener("pointercancel", soltar);
  }

  /* ------------------------------------------------------------------------
     14. Ano do rodapé — a única coisa dinâmica de conteúdo da página.
     ------------------------------------------------------------------------ */
  var ano = $("[data-ano]");
  if (ano !== null) ano.textContent = String(new Date().getFullYear());
})();
