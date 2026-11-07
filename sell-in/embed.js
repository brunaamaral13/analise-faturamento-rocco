"use strict";

const embed = new URLSearchParams(location.search).get("embed") === "1";
if (embed) document.body.classList.add("is-embed");

function deliverSellIn(buffer, name) {
  try {
    ingest(buffer, name || "sell-in.csv");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      parent.postMessage({
        type: "sell-in-ready",
        summary: document.getElementById("sideBase")?.textContent || ""
      }, location.origin);
    }));
  } catch (error) {
    parent.postMessage({
      type: "sell-in-error",
      message: error.message || "Não foi possível ler esse CSV."
    }, location.origin);
  }
}

window.addEventListener("message", (event) => {
  if (event.origin !== location.origin) return;
  const data = event.data || {};
  if (data.type === "sell-in-file" && data.buffer) deliverSellIn(data.buffer, data.name);
  if (data.type === "sell-in-goto" && data.id) {
    document.getElementById(data.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});
