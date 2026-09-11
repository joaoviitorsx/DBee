/* ==========================================================================
   DBee — motor de movimento da landing
   ==========================================================================

   Duas camadas de animação, cada uma no que faz melhor:

   1. anime.js (vendorizado, ~17 KB) orquestra o movimento DISCRETO e encenado:
      a entrada do herói, a revelação das seções pela rolagem, os contadores, o
      flutuar da abelha e o pulsar do cubo de mel. Disparado por
      IntersectionObserver — nada anima fora da tela. Tudo em transform e
      opacity: nenhuma propriedade que force recálculo de layout.

   2. Um único rAF próprio faz o movimento CONTÍNUO ligado à rolagem — parallax
      com inércia, marquise de velocidade, trilho horizontal preso, cursor e
      botão magnético, barra de progresso. anime.js não faz "scrub" de rolagem;
      este laço faz, e é o que dá a massa dos sites de piloto: o conteúdo reage
      a QUÃO RÁPIDO você rola, não só a onde parou.

   NÃO existe scroll hijacking (o padrão Lenis com translate3d por rAF): ele
   quebra `position: sticky`, a busca do navegador, o Page Down e o gesto de
   toque. A rolagem aqui é a nativa; o peso vem de LERP nos elementos.

   O favo e o pólen atrás do herói são um <canvas> 2D próprio — leve de
   propósito: um Three.js de 600 KB para partículas de fundo pagaria caro por um
   efeito que o canvas 2D entrega. Ele só desenha enquanto o herói está na tela.

   prefers-reduced-motion: o movimento sai; o conteúdo, nunca. O CSS já garante
   o estado final — o JS só evita gastar quadro. Sem JS, a página nasce legível.
   ========================================================================== */
(function () {
  "use strict";

  var doc = document;
  var root = doc.documentElement;
  var anime = window.anime || null;

  /* Marca no <html> que o anime.js está presente. O CSS usa `.js:not(.anime)`
     como caminho de fallback: se o anime.js não carregar, as revelações e o
     texto fatiado aparecem de uma vez (sem animação), mas legíveis. */
  if (anime) root.classList.add("anime");

  var mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var mqFine = window.matchMedia("(hover: hover) and (pointer: fine)");
  /* A MESMA condição do CSS, altura incluída. Se as duas divergirem, o JS mede
     e translada um trilho que o CSS não montou — e a seção some sem erro. */
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

  var EASE = "cubicBezier(.16,1,.3,1)";

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
     selecionável e copiável inteiro. Sem script, o título é um <h1> normal.

     Duas granularidades: palavra para títulos de seção (cascata legível),
     caractere só para o H1 do herói — a entrada mais lenta e mais cara da
     página, que acontece uma vez.

     O `aria-label` guarda a frase inteira antes do corte: sem ele, um leitor
     de tela anuncia letra por letra.
     ------------------------------------------------------------------------ */
  function fatiar(el, porCaractere) {
    if (el.dataset.split === "1") return;
    el.dataset.split = "1";
    var frase = el.textContent.replace(/\s+/g, " ").trim();
    el.setAttribute("aria-label", frase);

    var frag = doc.createDocumentFragment();
    frase.split(" ").forEach(function (palavra, iw) {
      if (iw > 0) frag.appendChild(doc.createTextNode(" "));
      var w = doc.createElement("span");
      w.className = "w";
      w.setAttribute("aria-hidden", "true");

      if (porCaractere) {
        Array.prototype.forEach.call(palavra, function (ch) {
          var c = doc.createElement("span");
          c.textContent = ch;
          w.appendChild(c);
        });
      } else {
        var inner = doc.createElement("span");
        inner.textContent = palavra;
        w.appendChild(inner);
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
     3. Revelação por entrada no viewport, com anime.js
     ------------------------------------------------------------------------ */

  /* Estado final imediato, sem animação — o caminho do reduced-motion e do
     fallback sem anime.js. */
  function mostrar(el) {
    el.classList.add("is-in");
    el.style.opacity = "1";
    el.style.transform = "none";
    if (el.dataset.conta !== undefined) el.textContent = el.dataset.conta;
  }
  function revelarTudo() {
    $$("[data-fx], .split-words, .split-chars").forEach(function (el) {
      el.classList.add("is-in");
    });
    $$("[data-conta]").forEach(function (el) {
      el.textContent = el.dataset.conta;
    });
  }

  /* Um elemento [data-fx] entra por opacity + transform, pela curva com peso. */
  function revelarFx(el) {
    var tipo = el.dataset.fx;
    /* A máscara das capturas é dirigida pelo CSS (clip-path composto), não pelo
       anime.js: `clip-path` interpolado por biblioteca não é confiável, e o CSS
       já resolve. Só precisa da classe. */
    if (tipo === "mask") {
      el.classList.add("is-in");
      return;
    }
    if (!anime) {
      el.classList.add("is-in");
      return;
    }
    var d = parseFloat(el.style.getPropertyValue("--fx-delay")) || 0;
    var props = {
      targets: el,
      opacity: [0, 1],
      easing: EASE,
      duration: 720,
      delay: d,
      complete: function () {
        el.style.willChange = "auto";
      }
    };
    if (tipo === "up") props.translateY = [30, 0];
    else if (tipo === "scale") {
      props.translateY = [26, 0];
      props.scale = [0.97, 1];
    }
    anime(props);
  }

  /* Título fatiado: cada pedaço sobe de dentro de uma máscara, escalonado. */
  function revelarSplit(el) {
    if (!anime) {
      el.classList.add("is-in");
      return;
    }
    var chars = el.classList.contains("split-chars");
    var spans = $$(".w > span", el);
    if (spans.length === 0) return;
    anime({
      targets: spans,
      translateY: ["110%", "0%"],
      rotate: chars ? ["4deg", "0deg"] : "0deg",
      duration: chars ? 1000 : 860,
      delay: anime.stagger(chars ? 16 : 46),
      easing: chars ? "cubicBezier(.16,1.06,.3,1)" : EASE
    });
  }

  /* Contador: sobe até o valor com desaceleração. O texto final é o do
     `data-conta` LITERAL — assim "0,093" mantém a vírgula e "100 mil" continua
     "100 mil". O que se anima é a ilusão; o valor exibido no fim é o do HTML. */
  function contar(el) {
    var alvoTexto = el.dataset.conta;
    var num = parseFloat(alvoTexto.replace(/[^\d.,-]/g, "").replace(",", "."));
    if (reduced || !anime || isNaN(num)) {
      el.textContent = alvoTexto;
      return;
    }
    var casas = (alvoTexto.split(/[.,]/)[1] || "").replace(/\D+$/, "").length;
    var proxy = { v: 0 };
    anime({
      targets: proxy,
      v: num,
      duration: 1100,
      easing: "easeOutExpo",
      update: function () {
        el.textContent = proxy.v.toFixed(casas).replace(".", ",");
      },
      complete: function () {
        el.textContent = alvoTexto;
      }
    });
  }

  var io = null;
  if ("IntersectionObserver" in window && !reduced) {
    io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          var t = e.target;
          if (
            t.classList.contains("split-words") ||
            t.classList.contains("split-chars")
          ) {
            revelarSplit(t);
          } else if (t.dataset.conta !== undefined) {
            contar(t);
          } else {
            revelarFx(t);
          }
          io.unobserve(t);
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

    /* `:not([data-enter])`: o herói é revelado por entrada(), depois da
       cortina do preloader. Se o observador o revelasse, ele apareceria por
       baixo do preloader e a entrada escalonada sumiria. */
    $$("[data-fx]:not([data-enter])").forEach(function (el) {
      io.observe(el);
    });
    $$(
      ".split-words:not([data-enter]), .split-chars:not([data-enter])"
    ).forEach(function (el) {
      io.observe(el);
    });
    $$("[data-conta]").forEach(function (el) {
      io.observe(el);
    });
  } else {
    revelarTudo();
  }

  mqReduce.addEventListener("change", function (e) {
    reduced = e.matches;
    if (reduced) revelarTudo();
  });

  /* ------------------------------------------------------------------------
     3b. Entrada do herói e a abelha que flutua
     ------------------------------------------------------------------------ */
  function iniciarAbelha() {
    if (reduced || !anime) return;
    var bee = $("[data-bee]");
    if (bee) {
      anime({
        targets: bee,
        translateY: [-11, 11],
        duration: 3600,
        direction: "alternate",
        loop: true,
        easing: "easeInOutSine"
      });
    }
    var glow = $("[data-glow]");
    if (glow) {
      /* O cubo de mel respira: escala e brilho em contrafase suave. */
      anime({
        targets: glow,
        scale: [0.9, 1.09],
        opacity: [0.5, 0.95],
        duration: 2200,
        direction: "alternate",
        loop: true,
        easing: "easeInOutQuad"
      });
    }
  }

  function entrada() {
    var enters = $$("[data-enter]");
    if (reduced || !anime) {
      enters.forEach(mostrar);
      $$(".split-chars[data-enter], .split-words[data-enter]").forEach(function (
        el
      ) {
        el.classList.add("is-in");
      });
      return;
    }

    var tl = anime.timeline({ easing: EASE, duration: 760 });
    tl.add({ targets: ".hero__badge", opacity: [0, 1], translateY: [14, 0] });

    var tituloSpans = $$(".hero__title .w > span");
    if (tituloSpans.length) {
      tl.add(
        {
          targets: tituloSpans,
          translateY: ["110%", "0%"],
          rotate: ["4deg", "0deg"],
          duration: 1000,
          delay: anime.stagger(26),
          easing: "cubicBezier(.16,1.06,.3,1)"
        },
        "-=520"
      );
    } else {
      /* Herói sem fatiar (não deveria acontecer com anime): revela o título. */
      var titulo = $(".hero__title");
      if (titulo) tl.add({ targets: titulo, opacity: [0, 1] }, "-=520");
    }

    tl.add(
      { targets: ".hero__sub", opacity: [0, 1], translateY: [26, 0] },
      "-=640"
    );
    tl.add(
      { targets: ".hero__actions", opacity: [0, 1], translateY: [24, 0] },
      "-=580"
    );
    tl.add({ targets: ".hero__meta", opacity: [0, 1] }, "-=560");
    tl.add(
      {
        targets: ".hero__art",
        opacity: [0, 1],
        translateY: [34, 0],
        scale: [0.94, 1],
        duration: 1150
      },
      "-=980"
    );
    tl.add({ targets: ".hero__scroll", opacity: [0, 1] }, "-=520");

    tl.finished.then(iniciarAbelha);
  }
  if (preload === null) entrada();

  /* ------------------------------------------------------------------------
     4. Cena — favo e pólen à deriva (canvas 2D leve)
     Só desenha enquanto o herói está na tela: o laço para quando a cena some
     e volta ao rolar de volta ao topo. Sem WebGL, sem dependência.
     ------------------------------------------------------------------------ */
  (function cena() {
    var canvas = $("[data-cena]");
    if (canvas === null || reduced) return;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.hidden = false;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 0;
    var H = 0;
    var parts = [];
    var raf = 0;
    var pmx = 0;
    var pmy = 0;

    function medir() {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function criar() {
      parts = [];
      var n = Math.round(clamp((W * H) / 20000, 22, 80));
      for (var i = 0; i < n; i++) {
        var z = Math.random(); /* profundidade 0..1: perto = maior, mais rápido */
        parts.push({
          x: Math.random() * W,
          y: Math.random() * H,
          z: z,
          r: 1 + z * 2.6,
          vy: -(0.05 + z * 0.2),
          vx: (Math.random() - 0.5) * 0.12,
          a: 0.1 + z * 0.42,
          hex: Math.random() < 0.16,
          s: 6 + z * 15,
          rot: Math.random() * 6.283,
          spin: (Math.random() - 0.5) * 0.008
        });
      }
    }

    function hexPath(x, y, s, rot) {
      ctx.beginPath();
      for (var k = 0; k < 6; k++) {
        var ang = rot + (k * Math.PI) / 3;
        var px = x + Math.cos(ang) * s;
        var py = y + Math.sin(ang) * s;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }

    function frame() {
      raf = 0;
      var y = window.scrollY || window.pageYOffset || 0;
      /* Some antes de a primeira seção cobrir a cena, para não haver borda. */
      var op = clamp(1 - y / (H * 0.9), 0, 1);
      canvas.style.opacity = op.toFixed(3);
      if (op <= 0.01) return; /* dorme; acorda no scroll de volta ao topo */

      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.y += p.vy;
        p.x += p.vx;
        p.rot += p.spin;
        if (p.y < -24) {
          p.y = H + 24;
          p.x = Math.random() * W;
        }
        if (p.x < -24) p.x = W + 24;
        else if (p.x > W + 24) p.x = -24;

        /* Parallax de ponteiro e de rolagem por profundidade. */
        var px = p.x + pmx * p.z * 42 - y * p.z * 0.14;
        var py = p.y + pmy * p.z * 30;

        ctx.globalAlpha = p.a * op;
        if (p.hex) {
          hexPath(px, py, p.s, p.rot);
          ctx.strokeStyle = "#e9a319";
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(px, py, p.r, 0, 6.2832);
          ctx.fillStyle = "#f0b53a";
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      raf = window.requestAnimationFrame(frame);
    }

    function acordarCena() {
      if (!raf && !doc.hidden) raf = window.requestAnimationFrame(frame);
    }

    medir();
    criar();
    acordarCena();

    var tc;
    window.addEventListener(
      "resize",
      function () {
        window.clearTimeout(tc);
        tc = window.setTimeout(function () {
          medir();
          criar();
          acordarCena();
        }, 160);
      },
      { passive: true }
    );
    window.addEventListener(
      "pointermove",
      function (e) {
        pmx = e.clientX / W - 0.5;
        pmy = e.clientY / H - 0.5;
        acordarCena();
      },
      { passive: true }
    );
    window.addEventListener(
      "scroll",
      function () {
        if ((window.scrollY || 0) < H * 0.9) acordarCena();
      },
      { passive: true }
    );
    doc.addEventListener("visibilitychange", function () {
      if (doc.hidden) {
        if (raf) {
          window.cancelAnimationFrame(raf);
          raf = 0;
        }
      } else {
        acordarCena();
      }
    });
  })();

  /* ------------------------------------------------------------------------
     5. Cabeçalho que reage à direção da rolagem
     ------------------------------------------------------------------------ */
  var header = $(".header");
  var ultimoY = 0;

  function atualizarHeader(y) {
    if (header === null) return;
    header.classList.toggle("is-stuck", y > 12);
    /* Histerese de 6px: sem ela o cabeçalho pisca com o ricochete do toque. */
    if (Math.abs(y - ultimoY) > 6) {
      var descendo = y > ultimoY && y > 240;
      header.classList.toggle("is-hidden", descendo && !reduced);
      ultimoY = y;
    }
  }

  /* ------------------------------------------------------------------------
     6. Índice de capítulo
     O marcador fixo que diz em que ponto da história você está.
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
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );
    capitulos.forEach(function (c) {
      ioCap.observe(c);
    });

    var rodape = doc.querySelector(".footer");
    if (rodape !== null) {
      new IntersectionObserver(
        function (es) {
          es.forEach(function (e) {
            indice.classList.toggle("is-fim", e.isIntersecting);
          });
        },
        { rootMargin: "0px 0px -10% 0px", threshold: 0 }
      ).observe(rodape);
    }
  }

  /* ------------------------------------------------------------------------
     7. Parallax com inércia (custom property --py; o transform mora no CSS)
     ------------------------------------------------------------------------ */
  var camadas = $$("[data-parallax]").map(function (el) {
    return { el: el, k: parseFloat(el.dataset.parallax) || 0.1, atual: 0, alvo: 0 };
  });

  /* ------------------------------------------------------------------------
     8. Marquise de velocidade
     ------------------------------------------------------------------------ */
  var marquises = $$("[data-marquise]").map(function (el) {
    return { el: el, base: parseFloat(el.dataset.marquise) || 0.35, pos: 0, larg: 0 };
  });

  function medirMarquises() {
    marquises.forEach(function (m) {
      m.larg = m.el.scrollWidth / 2;
    });
  }

  /* ------------------------------------------------------------------------
     9. Trilho horizontal dos motores
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
    rail.style.height = window.innerHeight + railLen + "px";
  }

  /* ------------------------------------------------------------------------
     10. Cursor e botão magnético (só com ponteiro fino)
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
        imas.forEach(function (im) {
          var r = im.el.getBoundingClientRect();
          var dx = e.clientX - (r.left + r.width / 2);
          var dy = e.clientY - (r.top + r.height / 2);
          var raio = Math.max(r.width, r.height) * 0.95;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < raio) {
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
     11. O laço. Um só. (movimento contínuo ligado à rolagem)
     ------------------------------------------------------------------------ */
  var sujo = true;
  var rodando = false;

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
      l.atual += (l.alvo - l.atual) * 0.085 * dt;
      if (Math.abs(l.alvo - l.atual) > 0.05) vivo = true;
      l.el.style.setProperty("--py", l.atual.toFixed(2) + "px");
    }

    if (railLen > 0 && railTrack !== null) {
      railX += (railAlvo - railX) * 0.11 * dt;
      if (Math.abs(railAlvo - railX) > 0.1) vivo = true;
      railTrack.style.transform = "translate3d(" + railX.toFixed(2) + "px,0,0)";
    }

    for (i = 0; i < marquises.length; i++) {
      var m = marquises[i];
      if (m.larg === 0) continue;
      m.pos -= (m.base + veloSuave * 0.55) * dt;
      if (m.pos <= -m.larg) m.pos += m.larg;
      if (m.pos > 0) m.pos -= m.larg;
      m.el.style.transform = "translate3d(" + m.pos.toFixed(2) + "px,0,0)";
      vivo = true;
    }

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

  if (doc.fonts !== undefined && doc.fonts.ready !== undefined) {
    doc.fonts.ready.then(function () {
      medirRail();
      medirMarquises();
      if (!reduced) acordar();
    });
  }

  /* ------------------------------------------------------------------------
     12. Copiar comando
     ------------------------------------------------------------------------ */
  $$("[data-copy]").forEach(function (botao) {
    var rotulo = $(".copy__txt", botao);
    var original = rotulo !== null ? rotulo.textContent : "";
    botao.addEventListener("click", function () {
      var alvo = doc.getElementById(botao.dataset.copy);
      if (alvo === null) return;
      /* `innerText` devolve U+00A0 onde o HTML tem `&nbsp;`, e colar isso num
         terminal quebra o comando de um jeito que não se vê. */
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
