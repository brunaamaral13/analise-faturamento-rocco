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

const sellIn = { fileName: "", text: "", rows: 0, headers: [] };

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

function countCsvRows(text) {
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) throw new Error("Arquivo sem dados.");
  const split = typeof splitCsvLine === "function" ? splitCsvLine : (line) => line.split(";");
  const headers = split(lines[0]).map((cell) => cell.trim()).filter(Boolean);
  if (!headers.length) throw new Error("Cabeçalho vazio.");
  let rows = 0;
  for (let i = 1; i < lines.length; i++) {
    if (split(lines[i]).some((cell) => String(cell).trim() !== "")) rows++;
  }
  if (!rows) throw new Error("Nenhuma linha válida encontrada.");
  return { headers, rows };
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
    const linhas = sellIn.rows === 1 ? "1 linha" : `${sellIn.rows.toLocaleString("pt-BR")} linhas`;
    text.textContent = `${linhas} importadas. A base de sell-out continua na outra aba.`;
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
      const text = String(reader.result || "");
      const parsed = countCsvRows(text);
      sellIn.text = text;
      sellIn.fileName = file.name;
      sellIn.rows = parsed.rows;
      sellIn.headers = parsed.headers;
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
  reader.readAsText(file, "windows-1252");
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
