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
  if (changed && view === "out" && !keep && typeof renderAll === "function" && typeof state !== "undefined" && state.meta) {
    requestAnimationFrame(() => renderAll());
  }
}

document.getElementById("tabSellOut")?.addEventListener("click", () => showDashView("out"));
document.getElementById("tabSellIn")?.addEventListener("click", () => showDashView("in"));
window.addEventListener("hashchange", () => {
  showDashView(location.hash === "#sell-in" ? "in" : "out");
});

showDashView(location.hash === "#sell-in" ? "in" : "out", true);
