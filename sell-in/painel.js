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

const sellIn = { fileName: "", text: "", rows: 0, headers: [], unit: "linha" };

function showDashView(which, keep) {
  const view = which === "in" ? "in" : "out";
  const changed = document.body.dataset.view !== view;
  document.body.dataset.view = view;
  const out = document.getElementById("viewOut");
  const incoming = document.getElementById("viewIn");
  const tools = document.getElementById("outTools");
  if (out) out.hidden = view !== "out";
  if (incoming) incoming.hidden = view !== "in";
  if (tools) tools.hidden = view !== "out";
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
  if (changed && view === "out" && !keep && typeof renderAll === "function" && typeof state !== "undefined" && state.meta) {
    requestAnimationFrame(() => renderAll());
  }
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
  const loading = document.getElementById("loading");
  const loadingText = document.getElementById("loadingText");
  const error = document.getElementById("errorIn");
  if (loading) loading.hidden = false;
  if (loadingText) loadingText.textContent = "Lendo o sell-in…";
  if (error) error.hidden = true;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = textFromCsvBuffer(reader.result);
      const parsed = countCsvRows(text);
      sellIn.text = text;
      sellIn.fileName = file.name;
      sellIn.rows = parsed.rows;
      sellIn.headers = parsed.headers;
      sellIn.unit = parsed.unit;
      showSellInFile();
    } catch (err) {
      if (error) {
        error.hidden = false;
        error.textContent = err.message || "Não foi possível ler o arquivo.";
      }
    } finally {
      if (loading) loading.hidden = true;
      const input = document.getElementById("fileIn");
      if (input) input.value = "";
    }
  };
  reader.onerror = () => {
    if (loading) loading.hidden = true;
    if (error) {
      error.hidden = false;
      error.textContent = "Falha ao ler o arquivo. Tente novamente.";
    }
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
