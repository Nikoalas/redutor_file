(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var PRESETS = [
    { nome: "Alta", dpi: 200, q: 0.85 },
    { nome: "Equilibrada", dpi: 150, q: 0.75 },
    { nome: "Máxima compactação", dpi: 110, q: 0.6 }
  ];
  var MAX_PIXELS = 24e6;
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  // parts: arquivos finais (1 ou mais); full: PDF completo usado na comparação
  var S = { file: null, bytes: null, doc: null, pages: 0, full: null, parts: [], resDoc: null, cancel: false, busy: false, page: 1, signed: false };

  function fmt(n) {
    if (n >= 1048576) return (n / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " MB";
    return Math.max(1, Math.round(n / 1024)).toLocaleString("pt-BR") + " KB";
  }
  function show(el, on) { el.hidden = !on; }
  function msg(el, t) { el.textContent = t || ""; show(el, !!t); }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function mode() { return document.querySelector('input[name="mode"]:checked').value; }

  /* ---------- arquivo ---------- */
  var drop = $("drop"), input = $("file");
  drop.addEventListener("click", function () { input.click(); });
  drop.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function (e) { var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) loadFile(f); });
  input.addEventListener("change", function () { if (input.files[0]) loadFile(input.files[0]); });

  function setControls(on) {
    $("s2").setAttribute("aria-disabled", on ? "false" : "true");
    document.querySelectorAll('input[name="mode"],#preset,#limit,#range,#gray,#split,#meta,#run').forEach(function (el) { el.disabled = !on; });
  }

  // Procura /ByteRange (assinatura digital) nos últimos bytes do arquivo.
  function detectSigned(buf) {
    var tail = new Uint8Array(buf, Math.max(0, buf.byteLength - 8e6));
    var s = ""; for (var i = 0; i < tail.length; i += 32768) s += String.fromCharCode.apply(null, tail.subarray(i, i + 32768));
    return /\/ByteRange\s*\[/.test(s) && /\/Type\s*\/Sig|\/SubFilter/.test(s);
  }

  async function loadFile(file) {
    msg($("loadErr"), ""); show($("s3"), false); show($("signWarn"), false); setControls(false);
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { msg($("loadErr"), "Esse arquivo não é um PDF. Escolha um arquivo .pdf."); return; }
    try {
      if (!window.pdfjsLib || !window.PDFLib) throw new Error("libs");
      var buf = await file.arrayBuffer();
      var doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
      S.file = file; S.bytes = buf; S.doc = doc; S.pages = doc.numPages; S.full = null; S.parts = []; S.resDoc = null;
      S.signed = detectSigned(buf);
      $("fName").textContent = file.name;
      $("fMeta").textContent = fmt(file.size) + " · " + doc.numPages + (doc.numPages === 1 ? " página" : " páginas");
      show($("fileInfo"), true); show($("signWarn"), S.signed); setControls(true);
    } catch (err) {
      var m = String(err && (err.name || err.message) || err);
      if (/Password/i.test(m)) msg($("loadErr"), "Este PDF está protegido por senha. Remova a senha e tente de novo.");
      else if (/libs/.test(m)) msg($("loadErr"), "Não foi possível carregar as bibliotecas de PDF. Verifique a conexão e recarregue.");
      else msg($("loadErr"), "Não consegui abrir este PDF. O arquivo pode estar corrompido.");
    }
  }

  document.querySelectorAll('input[name="mode"]').forEach(function (r) {
    r.addEventListener("change", function () { show($("imgOpts"), mode() !== "lossless"); });
  });

  /* ---------- utilidades de processamento ---------- */
  function progress(f, label) {
    show($("prog"), true);
    $("barFill").style.width = Math.round(f * 100) + "%";
    $("progLabel").textContent = label;
  }
  function toBlob(cv, q) {
    return new Promise(function (res, rej) { cv.toBlob(function (b) { b ? res(b) : rej(new Error("jpeg")); }, "image/jpeg", q); });
  }
  // "3-8, 12" -> conjunto de páginas. Vazio = todas.
  function parseRange(txt, n) {
    var set = {}; txt = (txt || "").trim();
    if (!txt) { for (var i = 1; i <= n; i++) set[i] = 1; return set; }
    txt.split(",").forEach(function (part) {
      var m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!m) throw new Error("Intervalo de páginas inválido: “" + part.trim() + "”");
      var a = +m[1], b = m[2] ? +m[2] : a;
      for (var k = Math.max(1, Math.min(a, b)); k <= Math.min(n, Math.max(a, b)); k++) set[k] = 1;
    });
    return set;
  }
  async function hasText(i) {
    var p = await S.doc.getPage(i);
    var t = await p.getTextContent();
    var c = t.items.reduce(function (a, it) { return a + (it.str ? it.str.trim().length : 0); }, 0);
    p.cleanup();
    return c > 40;
  }
  function stripMeta(pdf) {
    pdf.setTitle(""); pdf.setAuthor(""); pdf.setSubject(""); pdf.setKeywords([]);
    pdf.setProducer(""); pdf.setCreator("");
    pdf.setCreationDate(new Date(0)); pdf.setModificationDate(new Date(0));
  }

  async function rasterPage(i, preset, gray) {
    var page = await S.doc.getPage(i);
    var v1 = page.getViewport({ scale: 1 });
    var scale = preset.dpi / 72;
    if (v1.width * scale * v1.height * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (v1.width * v1.height));
    var vp = page.getViewport({ scale: scale });
    var cv = document.createElement("canvas");
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    var ctx = cv.getContext("2d", { willReadFrequently: gray });
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    if (gray) {
      var id = ctx.getImageData(0, 0, cv.width, cv.height), d = id.data;
      for (var k = 0; k < d.length; k += 4) { var g = (d[k] * .299 + d[k + 1] * .587 + d[k + 2] * .114) | 0; d[k] = d[k + 1] = d[k + 2] = g; }
      ctx.putImageData(id, 0, 0);
    }
    var blob = await toBlob(cv, preset.q);
    var jpg = new Uint8Array(await blob.arrayBuffer());
    cv.width = 0; cv.height = 0; page.cleanup();
    return { jpg: jpg, w: v1.width, h: v1.height };
  }

  // items: [{i, r?}] onde r = página rasterizada; sem r = copia a página original (texto preservado).
  async function build(items, src, wipe) {
    var out = await PDFLib.PDFDocument.create();
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      if (it.r) {
        var img = await out.embedJpg(it.r.jpg);
        out.addPage([it.r.w, it.r.h]).drawImage(img, { x: 0, y: 0, width: it.r.w, height: it.r.h });
      } else {
        var cp = await out.copyPages(src, [it.i - 1]);
        out.addPage(cp[0]);
      }
    }
    if (wipe) stripMeta(out);
    return await out.save({ useObjectStreams: true });
  }

  // Divide em partes: estima peso de cada página e agrupa de forma gulosa; confere o tamanho real depois.
  async function splitParts(items, src, wipe, limit) {
    var avg = S.file.size / S.pages, parts = [], cur = [], sum = 0, cap = limit * 0.95;
    function w(it) { return it.r ? it.r.jpg.length + 2048 : avg; }
    items.forEach(function (it) {
      if (cur.length && sum + w(it) > cap) { parts.push(cur); cur = []; sum = 0; }
      cur.push(it); sum += w(it);
    });
    if (cur.length) parts.push(cur);
    var out = [];
    for (var p = 0; p < parts.length; p++) {
      progress(0.9 + 0.1 * p / parts.length, "Gravando parte " + (p + 1) + " de " + parts.length + "…");
      out.push(await build(parts[p], src, wipe)); await tick();
    }
    return out;
  }

  /* ---------- fluxo principal ---------- */
  $("cancel").addEventListener("click", function () { S.cancel = true; });

  $("run").addEventListener("click", async function () {
    if (S.busy || !S.bytes) return;
    S.busy = true; S.cancel = false;
    msg($("runErr"), ""); show($("s3"), false);
    $("run").disabled = true; show($("cancel"), true);
    var started = Date.now();
    try {
      var m = mode(), wipe = $("meta").checked, n = S.pages;
      var limitMb = parseFloat($("limit").value), limit = isFinite(limitMb) && limitMb > 0 ? limitMb * 1048576 : 0;
      var src = await PDFLib.PDFDocument.load(S.bytes, { updateMetadata: false, ignoreEncryption: true });
      var full, label, items = null;

      if (m === "lossless") {
        progress(0.3, "Reorganizando a estrutura do arquivo…");
        if (wipe) stripMeta(src);
        full = await src.save({ useObjectStreams: true });
        label = "Sem perdas";
      } else {
        var range = parseRange($("range").value, n), gray = $("gray").checked;
        // decide quais páginas serão rasterizadas
        var plan = [];
        for (var i = 1; i <= n; i++) {
          if (S.cancel) throw new Error("cancelado");
          progress(0.05 * i / n, "Analisando página " + i + " de " + n);
          var raster = !!range[i] && (m === "image" || !(await hasText(i)));
          plan.push({ i: i, raster: raster });
          if (i % 10 === 0) await tick();
        }
        var nRaster = plan.filter(function (p) { return p.raster; }).length;
        var start = parseInt($("preset").value, 10), last = limit ? PRESETS.length - 1 : start;
        for (var p = start; p <= last; p++) {
          var pr = PRESETS[p], done = 0;
          items = [];
          for (var k = 0; k < plan.length; k++) {
            if (S.cancel) throw new Error("cancelado");
            var pl = plan[k];
            if (pl.raster) {
              progress(0.05 + 0.85 * done / Math.max(1, nRaster), pr.nome + " (" + pr.dpi + " dpi) · página " + pl.i + " de " + n);
              items.push({ i: pl.i, r: await rasterPage(pl.i, pr, gray) }); done++;
            } else items.push({ i: pl.i });
          }
          progress(0.9, "Montando o arquivo…");
          full = await build(items, src, wipe);
          label = pr.nome + ", " + pr.dpi + " dpi";
          if (!limit || full.length <= limit) break;
        }
        S.nRaster = nRaster; S.nKept = n - nRaster;
        if (!nRaster) label = "nenhuma página precisou ser reduzida";
      }

      S.full = full; S.parts = [full]; var extra = "", kind = "";
      if (limit && full.length > limit) {
        if ($("split").checked && items) {
          S.parts = await splitParts(items, src, wipe, limit);
          extra = "Mesmo na melhor compactação o arquivo ficou com " + fmt(full.length) + ", acima do limite de " + fmt(limit) + ". Ele foi dividido em " + S.parts.length + " partes; confira o tamanho de cada uma.";
          kind = S.parts.some(function (b) { return b.length > limit; }) ? "bad" : "ok";
        } else { extra = "Mesmo na melhor compactação o arquivo ficou com " + fmt(full.length) + ", acima do limite de " + fmt(limit) + ". Ative a divisão automática ou reduza menos páginas."; kind = "bad"; }
      }
      await showResult(started, label, extra, kind, m);
    } catch (err) {
      if (err && err.message === "cancelado") msg($("runErr"), "Processo cancelado.");
      else msg($("runErr"), "Algo deu errado" + (err && err.message ? " (" + err.message + ")" : "") + ". Tente uma qualidade menor ou um arquivo menor.");
    } finally {
      S.busy = false; $("run").disabled = false; show($("cancel"), false); show($("prog"), false);
    }
  });

  async function showResult(started, label, extra, kind, m) {
    var o = S.file.size, n = S.full.length;
    $("szOrig").textContent = fmt(o); $("szNew").textContent = fmt(n);
    var pct = Math.round((1 - n / o) * 100);
    $("szPct").textContent = pct > 0 ? "−" + pct + "%" : pct === 0 ? "0%" : "+" + Math.abs(pct) + "%";
    var text = extra;
    if (!text && n >= o) { text = "O resultado não ficou menor que o original. Tente outra qualidade ou mantenha o original."; kind = ""; }
    if (!text) { text = "Pronto em " + Math.max(1, Math.round((Date.now() - started) / 1000)) + " s (" + label + "). Confira as páginas abaixo antes de baixar."; kind = "ok"; }
    var note = $("resNote"); note.textContent = text; note.className = "note" + (kind ? " " + kind : ""); show(note, true);

    var ck = [];
    if (m !== "lossless") ck.push([true, S.nKept + " página(s) mantida(s) com texto original, " + S.nRaster + " reduzida(s)"]);
    ck.push([!S.signed, S.signed ? "O original já estava assinado: a assinatura foi perdida" : "O original não tinha assinatura digital"]);
    ck.push([true, $("meta").checked ? "Metadados removidos" : "Metadados mantidos"]);
    ck.push([S.parts.length === 1, S.parts.length === 1 ? "Arquivo único" : "Dividido em " + S.parts.length + " partes"]);
    $("check").innerHTML = "";
    ck.forEach(function (c) { var li = document.createElement("li"); li.textContent = c[1]; if (!c[0]) li.className = "no"; $("check").appendChild(li); });

    var row = $("saveRow"); row.innerHTML = "";
    var base = S.file.name.replace(/\.pdf$/i, "");
    S.parts.forEach(function (b, idx) {
      var btn = document.createElement("button");
      btn.textContent = S.parts.length === 1 ? "Baixar PDF reduzido" : "Baixar parte " + (idx + 1) + " (" + fmt(b.length) + ")";
      btn.addEventListener("click", function () { download(b, base + (S.parts.length === 1 ? "-reduzido" : "-parte" + (idx + 1)) + ".pdf"); });
      row.appendChild(btn);
    });

    msg($("saveErr"), "");
    S.resDoc = await pdfjsLib.getDocument({ data: new Uint8Array(S.full.slice(0)) }).promise;
    S.page = 1; $("pgTotal").textContent = S.pages;
    show($("s3"), true); await drawPage();
    $("s3").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- comparação ---------- */
  var chain = Promise.resolve();
  function drawPage() {
    chain = chain.then(async function () {
      $("pgNow").textContent = S.page;
      var w = Math.min(520, Math.max(240, $("cvA").parentElement.clientWidth - 2 || 400));
      await renderTo(S.doc, S.page, $("cvA"), w);
      await renderTo(S.resDoc, S.page, $("cvB"), w);
    }).catch(function () {});
    return chain;
  }
  async function renderTo(doc, n, cv, w) {
    var page = await doc.getPage(n), v1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: w / v1.width });
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    var ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise; page.cleanup();
  }
  $("prev").addEventListener("click", function () { if (S.page > 1) { S.page--; drawPage(); } });
  $("next").addEventListener("click", function () { if (S.page < S.pages) { S.page++; drawPage(); } });

  /* ---------- download ---------- */
  function download(bytes, name) {
    msg($("saveErr"), "");
    try {
      var url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      var a = document.createElement("a"); a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    } catch (err) {
      msg($("saveErr"), "Não foi possível salvar o arquivo" + (err && err.message ? " (" + err.message + ")" : "") + ".");
    }
  }
})();
