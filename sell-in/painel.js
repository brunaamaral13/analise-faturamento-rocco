"use strict";

const VIEW_COPY = {
  out: {
    brand: "Sell-out",
    title: "Desempenho sell-out",
    source: "Dados via Bookinfo"
  },
  in: {
    brand: "Sell-in",
    title: "Desempenho sell-in",
    source: "O que a Rocco faturou para a loja"
  }
};

const sellIn = { fileName: "", text: "", rows: 0, headers: [], unit: "linha", buffer: null, summary: "" };

function showDashView(which, keep) {
  const view = which === "in" ? "in" : "out";
  const changed = document.body.dataset.view !== view;
  document.body.dataset.view = view;
  const out = document.getElementById("viewOut");
  const incoming = document.getElementById("viewIn");
  const tools = document.getElementById("outTools");
  const navOut = document.getElementById("navOut");
  const navIn = document.getElementById("navIn");
  if (out) out.hidden = view !== "out";
  if (incoming) incoming.hidden = view !== "in";
  if (tools) tools.hidden = view !== "out";
  if (navOut) navOut.hidden = view !== "out";
  if (navIn) navIn.hidden = view !== "in";
  document.getElementById("tabSellOut")?.setAttribute("aria-pressed", String(view === "out"));
  document.getElementById("tabSellIn")?.setAttribute("aria-pressed", String(view === "in"));
  const text = VIEW_COPY[view];
  const brand = document.getElementById("brandPanel");
  const title = document.getElementById("viewTitle");
  const source = document.getElementById("viewSource");
  if (brand) brand.textContent = text.brand;
  if (title) title.textContent = text.title;
  if (source) source.textContent = text.source;
  const hash = view === "in" ? "#sell-in" : "#sell-out";
  if (location.hash !== hash) history.replaceState(null, "", hash);
  syncImportLabel();
  syncSideBase(view);
  if (changed && view === "out" && !keep && typeof renderAll === "function" && typeof state !== "undefined" && state.meta) {
    requestAnimationFrame(() => renderAll());
  }
}

function syncSideBase(view) {
  const base = document.getElementById("sideBase");
  if (!base) return;
  if (view === "in") {
    base.textContent = sellIn.summary || (sellIn.fileName ? "Lendo o sell-in…" : "Nenhuma base de sell-in");
    if (typeof renderSideFilters === "function") renderSideFilters();
    return;
  }
  if (typeof state !== "undefined" && state.meta) {
    base.textContent = `${state.fileName || "Base"} · por mês`;
  } else {
    base.textContent = "Nenhuma base carregada";
  }
  if (typeof renderSideFilters === "function") renderSideFilters();
}

function setSellInLoading(on) {
  const loading = document.getElementById("loading");
  const loadingText = document.getElementById("loadingText");
  if (loading) loading.hidden = !on;
  if (on && loadingText) loadingText.textContent = "Lendo o sell-in…";
}

function revealSellIn() {
  const frame = document.getElementById("sellInFrame");
  const empty = document.getElementById("sellInEmpty");
  if (empty) empty.hidden = true;
  if (frame) frame.hidden = false;
}

function showSellInError(message) {
  const frame = document.getElementById("sellInFrame");
  const empty = document.getElementById("sellInEmpty");
  const error = document.getElementById("errorIn");
  if (frame) frame.hidden = true;
  if (empty) empty.hidden = false;
  if (error) {
    error.hidden = false;
    error.textContent = message || "Não foi possível ler o arquivo.";
  }
  setSellInLoading(false);
}

function mountSellIn() {
  const frame = document.getElementById("sellInFrame");
  if (!frame || !sellIn.buffer) return;
  const send = () => {
    frame.contentWindow?.postMessage({
      type: "sell-in-file",
      name: sellIn.fileName,
      buffer: sellIn.buffer
    }, location.origin);
  };
  if (!frame.getAttribute("src")) {
    frame.addEventListener("load", () => {
      frame.dataset.ready = "1";
      send();
    }, { once: true });
    frame.src = "sell-in/dashboard.html?embed=1";
    return;
  }
  if (frame.dataset.ready === "1") send();
  else frame.addEventListener("load", () => {
    frame.dataset.ready = "1";
    send();
  }, { once: true });
}

function syncImportLabel() {
  const label = document.getElementById("fileLabel");
  const meta = document.getElementById("fileMeta");
  if (!label || !meta) return;
  const onIn = document.body.dataset.view === "in";
  if (onIn) {
    label.textContent = sellIn.fileName ? "Trocar CSV" : "Importar CSV";
    meta.textContent = sellIn.fileName || "Sell-in Rocco";
    return;
  }
  if (typeof state !== "undefined" && state.fileName) {
    label.textContent = "Trocar CSV";
    meta.textContent = state.fileName;
    return;
  }
  label.textContent = "Importar CSV";
  meta.textContent = "Sell-out acumulado Rocco";
}

function cellText(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").trim();
}

function splitSellInLine(line) {
  const split = typeof splitCsvLine === "function" ? splitCsvLine : (row) => row.split(";");
  return split(String(line || ""));
}

function isClientHeader(value) {
  return /^c[oó]d\.?\s*cliente$/i.test(cellText(value));
}

function countCsvRows(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n|\r/);
  if (!lines.some((line) => cellText(line) !== "")) throw new Error("Arquivo sem dados.");
  const table = lines.map(splitSellInLine);
  let headerIdx = table.findIndex((cells) => cells.some(isClientHeader));
  const unit = headerIdx >= 0 ? "cliente" : "linha";
  if (headerIdx < 0) headerIdx = table.findIndex((cells) => cells.some((cell) => cellText(cell) !== ""));
  if (headerIdx < 0) throw new Error("Arquivo sem dados.");
  const headers = table[headerIdx].map(cellText);
  if (!headers.some(Boolean)) throw new Error("Não encontrei o cabeçalho do sell-in.");
  const codeCol = headers.findIndex(isClientHeader);
  let rows = 0;
  for (let i = headerIdx + 1; i < table.length; i++) {
    const cells = table[i];
    if (codeCol >= 0) {
      if (cellText(cells[codeCol]) !== "") rows++;
    } else if (cells.some((cell) => cellText(cell) !== "")) rows++;
  }
  if (!rows) throw new Error("Nenhuma linha válida encontrada.");
  return { headers, rows, unit };
}

function showSellInFile() {
  const title = document.getElementById("sellInTitle");
  const text = document.getElementById("sellInText");
  const button = document.getElementById("pickIn");
  const error = document.getElementById("errorIn");
  if (error) error.hidden = true;
  if (!sellIn.fileName) return;
  if (title) title.textContent = sellIn.fileName;
  if (text) {
    const n = sellIn.rows.toLocaleString("pt-BR");
    const linhas = sellIn.unit === "cliente"
      ? (sellIn.rows === 1 ? "1 cliente importado" : `${n} clientes importados`)
      : (sellIn.rows === 1 ? "1 linha importada" : `${n} linhas importadas`);
    text.textContent = `${linhas}. A base de sell-out continua na outra aba.`;
  }
  if (button) button.textContent = "Trocar arquivo";
  syncImportLabel();
}

function readSellInFile(file) {
  if (typeof state !== "undefined" && !state.seller) return;
  const error = document.getElementById("errorIn");
  if (error) error.hidden = true;
  setSellInLoading(true);
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = textFromCsvBuffer(reader.result);
      const parsed = countCsvRows(text);
      sellIn.text = text;
      sellIn.buffer = reader.result;
      sellIn.fileName = file.name;
      sellIn.rows = parsed.rows;
      sellIn.headers = parsed.headers;
      sellIn.unit = parsed.unit;
      sellIn.summary = "";
      showSellInFile();
      syncSideBase("in");
      mountSellIn();
    } catch (err) {
      showSellInError(err.message || "Não foi possível ler o arquivo.");
    } finally {
      const input = document.getElementById("fileIn");
      if (input) input.value = "";
    }
  };
  reader.onerror = () => {
    showSellInError("Falha ao ler o arquivo. Tente novamente.");
  };
  reader.readAsArrayBuffer(file);
}

function textFromCsvBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (err) {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

document.getElementById("tabSellOut")?.addEventListener("click", () => showDashView("out"));
document.getElementById("tabSellIn")?.addEventListener("click", () => showDashView("in"));
document.getElementById("pickIn")?.addEventListener("click", () => document.getElementById("fileIn")?.click());
document.getElementById("fileIn")?.addEventListener("change", () => {
  const file = document.getElementById("fileIn")?.files?.[0];
  if (file) readSellInFile(file);
});
document.getElementById("dropIn")?.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) readSellInFile(file);
});
document.getElementById("navIn")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-goto-in]");
  if (!button) return;
  const id = button.getAttribute("data-goto-in");
  document.querySelectorAll("#navIn button").forEach((item) => {
    item.classList.toggle("is-active", item === button);
  });
  document.getElementById("sellInFrame")?.contentWindow?.postMessage({ type: "sell-in-goto", id }, location.origin);
});

window.addEventListener("message", (event) => {
  if (event.origin !== location.origin) return;
  const data = event.data || {};
  if (data.type === "sell-in-ready") {
    sellIn.summary = data.summary || sellIn.summary;
    setSellInLoading(false);
    revealSellIn();
    if (document.body.dataset.view === "in") syncSideBase("in");
  }
  if (data.type === "sell-in-error") showSellInError(data.message);
});
document.addEventListener("drop", (event) => {
  if (document.body.dataset.view !== "in") return;
  if (event.target instanceof Element && event.target.closest("#dropIn")) return;
  const file = event.dataTransfer?.files?.[0];
  if (file) readSellInFile(file);
});
window.addEventListener("hashchange", () => {
  showDashView(location.hash === "#sell-in" ? "in" : "out");
});

showDashView(location.hash === "#sell-in" ? "in" : "out", true);
