"use strict";

const MONTHS = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const MONTHS_SHORT = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const DIMS = [
  { key: "vendedor", label: "Vendedor", field: "vend" },
  { key: "grupo", label: "Grupo econômico", field: "grupo" },
  { key: "loja", label: "Loja", field: "loja" },
  { key: "uf", label: "UF", field: "uf" },
  { key: "categoria", label: "Categoria", field: "cat" }
];
const SLICE_COLORS = ["#b5191a","#e0a106","#0f7a5a","#1b2a4a","#7c4d9e","#d46a2e","#3d7ea6","#5b8c5a","#b08968","#8d3b4c","#4c6e8a","#c47b9b"];

const state = {
  rows: [],
  meta: null,
  fileName: "",
  filters: { vendedor: new Set(), grupo: new Set(), loja: new Set(), uf: new Set(), categoria: new Set() },
  analysisYear: null,
  periodMonth: null,
  donutDim: "loja",
  search: "",
  openMenu: null,
  menuOptions: {},
  itemGrupo: "",
  itemLoja: "",
  itemCategoria: "",
  sortItem: { key: "fat", dir: "desc" },
  sortGrupo: { key: "fat", dir: "desc" },
  sortLoja: { key: "fat", dir: "desc" }
};

const charts = { colorOf: new Map(), ufByKey: new Map(), hoverUf: null, hoverMonth: null, trendSeries: [] };
const $ = (id) => document.getElementById(id);
const moneyFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const moneyFmtDec = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const numFmt = new Intl.NumberFormat("pt-BR");
const pctFmt = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseMoney(s) {
  if (s == null || s === "") return 0;
  const t = String(s).replace(/R\$\s?/gi, "").trim();
  if (!t) return 0;
  if (t.includes(",") && t.includes(".")) return Number(t.replace(/\./g, "").replace(",", ".")) || 0;
  if (t.includes(",")) return Number(t.replace(",", ".")) || 0;
  return Number(t) || 0;
}

function parseIntBR(s) {
  if (s == null || s === "") return 0;
  return Number(String(s).replace(/\./g, "").replace(",", ".")) || 0;
}

function parseMonth(s) {
  const m = String(s || "").trim().match(/^\d{1,2}\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mo = Number(m[1]) - 1, y = Number(m[2]);
  if (mo < 0 || mo > 11) return null;
  return { y, m: mo, key: y * 12 + mo };
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
      continue;
    }
    if (ch === ";" && !q) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) throw new Error("Arquivo sem dados.");
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const idx = Object.fromEntries(header.map((h, i) => [norm(h), i]));
  const need = ["sku", "descricao", "categoria", "dia", "vendedor", "loja", "uf loja", "grupo economico", "faturamento", "volume"];
  for (const n of need) {
    if (idx[n] == null) throw new Error(`Coluna obrigatória ausente: ${n}`);
  }

  const buckets = new Map();
  const years = new Set();
  let minKey = Infinity, maxKey = -Infinity;
  let linesRead = 0;

  for (let i = 1; i < lines.length; i++) {
    const p = splitCsvLine(lines[i]);
    if (p.length < header.length - 2) continue;
    const month = parseMonth(p[idx.dia]);
    if (!month) continue;
    const sku = (p[idx.sku] || "").trim();
    const cat = (p[idx.categoria] || "").trim() || "—";
    const vend = (p[idx.vendedor] || "").trim() || "—";
    const loja = (p[idx.loja] || "").trim() || "—";
    const uf = (p[idx["uf loja"]] || "").trim().toUpperCase() || "—";
    const grupo = (p[idx["grupo economico"]] || "").trim() || "—";
    const cnpj = idx["cnpj loja"] != null ? (p[idx["cnpj loja"]] || "").trim() : "";
    const cidade = idx["cidade loja"] != null ? (p[idx["cidade loja"]] || "").trim() : "";
    const id = [sku, month.y, month.m, vend, loja, uf, grupo, cat, cnpj, cidade].join("\u0001");
    let row = buckets.get(id);
    if (!row) {
      row = {
        sku,
        desc: (p[idx.descricao] || "").trim(),
        cat,
        autor: idx.autor != null ? (p[idx.autor] || "").trim() : "",
        y: month.y,
        m: month.m,
        key: month.key,
        cnpj,
        vend,
        loja,
        uf,
        cidade,
        grupo,
        fat: 0,
        vol: 0,
        cup: 0
      };
      buckets.set(id, row);
      years.add(month.y);
      if (month.key < minKey) minKey = month.key;
      if (month.key > maxKey) maxKey = month.key;
    }
    row.fat += parseMoney(p[idx.faturamento]);
    row.vol += parseIntBR(p[idx.volume]);
    row.cup += idx.cupons != null ? parseIntBR(p[idx.cupons]) : 0;
    linesRead++;
  }

  const rows = [...buckets.values()];
  if (!rows.length) throw new Error("Nenhuma linha válida encontrada.");
  const yearList = [...years].sort((a, b) => a - b);
  const analysisYear = yearList[yearList.length - 1];
  return {
    rows,
    meta: {
      years: yearList,
      minKey,
      maxKey,
      lastMonth: Object.fromEntries(yearList.map((y) => {
        let last = -1;
        for (const r of rows) if (r.y === y && r.m > last) last = r.m;
        return [y, last];
      })),
      count: rows.length,
      lines: linesRead
    },
    analysisYear
  };
}

function optionsFor(dimKey) {
  const dim = DIMS.find((d) => d.key === dimKey);
  if (!dim || !state.meta) return [];
  const win = windowFor(state.analysisYear);
  const map = new Map();
  for (const r of filteredRows(dimKey)) {
    if (!inWindow(r, win)) continue;
    const v = r[dim.field];
    const cur = map.get(v) || { fat: 0, lojas: new Set() };
    cur.fat += r.fat;
    cur.lojas.add(r.cnpj || r.loja);
    map.set(v, cur);
  }
  const byLojas = dimKey === "vendedor";
  return [...map.entries()]
    .map(([value, cur]) => [value, cur.lojas.size, cur.fat])
    .sort((a, b) => {
      if (byLojas) return b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR");
      return b[2] - a[2] || a[0].localeCompare(b[0], "pt-BR");
    });
}

function otherActiveFilters(exceptKey) {
  return DIMS.filter((d) => d.key !== exceptKey && state.filters[d.key].size > 0);
}

function scopeLabel() {
  const parts = [];
  for (const dim of DIMS) {
    const vals = [...state.filters[dim.key]];
    if (!vals.length) continue;
    parts.push(vals.length === 1 ? `${dim.label}: ${vals[0]}` : `${dim.label}: ${vals.length} selecionados`);
  }
  if (state.periodMonth != null) parts.push(`Mês: ${MONTHS[state.periodMonth]}`);
  return parts.join(" · ");
}

function syncItemFiltersFromGlobal() {
  const grupos = state.filters.grupo;
  const lojas = state.filters.loja;
  const cats = state.filters.categoria;
  if (grupos.size === 1) state.itemGrupo = [...grupos][0];
  else if (state.itemGrupo && grupos.size && !grupos.has(state.itemGrupo)) {
    state.itemGrupo = "";
    state.itemLoja = "";
  }
  if (lojas.size === 1) state.itemLoja = [...lojas][0];
  else if (state.itemLoja && lojas.size && !lojas.has(state.itemLoja)) {
    state.itemLoja = "";
  }
  if (cats.size === 1) state.itemCategoria = [...cats][0];
  else if (state.itemCategoria && cats.size && !cats.has(state.itemCategoria)) {
    state.itemCategoria = "";
  }
}

function pruneIncompatibleFilters() {
  let changed = false;
  for (const dim of DIMS) {
    const set = state.filters[dim.key];
    if (!set.size) continue;
    const allowed = new Set(optionsFor(dim.key).map((opt) => opt[0]));
    for (const v of [...set]) {
      if (!allowed.has(v)) {
        set.delete(v);
        changed = true;
      }
    }
  }
  const beforeGrupo = state.itemGrupo;
  const beforeLoja = state.itemLoja;
  const beforeCat = state.itemCategoria;
  syncItemFiltersFromGlobal();
  if (
    state.itemGrupo !== beforeGrupo
    || state.itemLoja !== beforeLoja
    || state.itemCategoria !== beforeCat
  ) changed = true;
  return changed;
}

function windowFor(year) {
  const last = state.meta.lastMonth[year] ?? 11;
  if (state.periodMonth != null) return { y: year, m0: state.periodMonth, m1: state.periodMonth, kind: "month" };
  return { y: year, m0: 0, m1: last, kind: "ytd" };
}

function inWindow(r, win) {
  return r.y === win.y && r.m >= win.m0 && r.m <= win.m1;
}

function filteredRows(except = null) {
  const f = state.filters;
  return state.rows.filter((r) => {
    for (const dim of DIMS) {
      if (except === dim.key) continue;
      const set = f[dim.key];
      if (set.size && !set.has(r[dim.field])) return false;
    }
    return true;
  });
}

function hasActiveFilters() {
  if (state.periodMonth != null || state.search.trim()) return true;
  return DIMS.some((d) => state.filters[d.key].size);
}

function activeFilterGroups() {
  const groups = [];
  for (const dim of DIMS) {
    const values = [...state.filters[dim.key]];
    if (values.length) groups.push({ key: dim.key, label: dim.label, values });
  }
  if (state.periodMonth != null) groups.push({ key: "mes", label: "Mês", values: [MONTHS[state.periodMonth]] });
  return groups;
}

function sumRows(rows) {
  let fat = 0, vol = 0, cup = 0;
  const lojas = new Set(), grupos = new Set(), skus = new Set();
  for (const r of rows) {
    fat += r.fat; vol += r.vol; cup += r.cup || 0;
    lojas.add(r.cnpj || r.loja);
    grupos.add(r.grupo);
    skus.add(r.sku);
  }
  return { fat, vol, cup, lojas: lojas.size, grupos: grupos.size, skus: skus.size };
}

function pctChange(cur, prev) {
  if (!prev) return cur ? 1 : null;
  return (cur - prev) / prev;
}

function aggregateBy(rows, field) {
  const map = new Map();
  for (const r of rows) {
    const k = r[field];
    const cur = map.get(k) || { key: k, fat: 0, vol: 0, cup: 0, lojas: new Set(), vend: r.vend, grupo: r.grupo };
    cur.fat += r.fat;
    cur.vol += r.vol;
    cur.cup += r.cup || 0;
    cur.lojas.add(r.cnpj || r.loja);
    if (field === "loja") { cur.grupo = r.grupo; cur.vend = r.vend; }
    map.set(k, cur);
  }
  return [...map.values()];
}

function topItems(rows, limit = 40) {
  const map = new Map();
  for (const r of rows) {
    const cur = map.get(r.sku) || { sku: r.sku, desc: r.desc, cat: r.cat, fat: 0, vol: 0 };
    cur.fat += r.fat;
    cur.vol += r.vol;
    if (!cur.desc && r.desc) cur.desc = r.desc;
    if (!cur.cat && r.cat) cur.cat = r.cat;
    map.set(r.sku, cur);
  }
  const all = [...map.values()];
  const totalFat = all.reduce((s, i) => s + i.fat, 0) || 1;
  const items = all.map((it) => ({ ...it, parte: it.fat / totalFat }));
  const key = state.sortItem.key;
  const dir = state.sortItem.dir === "asc" ? 1 : -1;
  items.sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    if (typeof va === "string" || typeof vb === "string") {
      return dir * String(va || "").localeCompare(String(vb || ""), "pt-BR");
    }
    return dir * ((va || 0) - (vb || 0)) || String(a.desc || "").localeCompare(String(b.desc || ""), "pt-BR");
  });
  return items.slice(0, limit);
}

function colorOf(key) {
  if (!charts.colorOf.has(key)) charts.colorOf.set(key, SLICE_COLORS[charts.colorOf.size % SLICE_COLORS.length]);
  return charts.colorOf.get(key);
}

function renderSideFilters() {
  const box = $("sideFilters");
  const list = $("sideFilterList");
  const clearBtn = $("btnSideClear");
  const clearAllBtn = $("btnSideClearAll");
  if (!state.meta) {
    box.hidden = true;
    return;
  }
  const groups = activeFilterGroups();
  const hasFilters = groups.length > 0;
  box.hidden = false;
  clearBtn.hidden = !hasFilters;
  if (clearAllBtn) clearAllBtn.hidden = !hasFilters;
  if (!hasFilters) {
    list.innerHTML = `<li class="is-empty">Nenhum recorte ativo</li>`;
    return;
  }
  list.innerHTML = groups.map((g) => `
    <li>
      <span><b>${esc(g.label)}:</b> ${esc(g.values.join(", "))}</span>
      <button type="button" class="side-filter-x" data-side-clear-dim="${esc(g.key)}" title="Limpar ${esc(g.label)}" aria-label="Limpar ${esc(g.label)}">×</button>
    </li>`).join("");
}

function renderYearSwitch() {
  const el = $("yearSwitch");
  if (!state.meta) { el.innerHTML = ""; return; }
  el.innerHTML = state.meta.years.map((y) =>
    `<button type="button" data-year="${y}" aria-pressed="${y === state.analysisYear}">${y}</button>`
  ).join("");
}

function renderFilterBar() {
  const bar = $("filterBar");
  state.menuOptions = {};
  bar.innerHTML = DIMS.map((dim) => {
    const set = state.filters[dim.key];
    const label = set.size === 0 ? "Todos" : set.size === 1 ? [...set][0] : `${set.size} selecionados`;
    const open = state.openMenu === dim.key;
    const opts = optionsFor(dim.key).slice(0, 120);
    state.menuOptions[dim.key] = opts.map(([value]) => value);
    const others = otherActiveFilters(dim.key);
    const scopeHint = others.length
      ? `Filtrado por: ${others.map((d) => {
          const vals = [...state.filters[d.key]];
          return `${d.label} ${vals.length === 1 ? vals[0] : `(${vals.length})`}`;
        }).join(" · ")}`
      : "";
    const listHtml = opts.length
      ? opts.map(([value, lojasN], idx) => {
          const on = set.has(value);
          const meta = dim.key === "vendedor"
            ? `<small>${numFmt.format(lojasN)} ${lojasN === 1 ? "loja" : "lojas"}</small>`
            : "";
          return `<label class="menu-item"><input type="checkbox" data-dim="${dim.key}" data-opt="${idx}" ${on ? "checked" : ""}><span title="${esc(value)}">${esc(value)}</span>${meta}</label>`;
        }).join("")
      : `<p class="menu-empty">Nenhuma opção neste recorte.</p>`;
    return `
      <div class="menu ${open ? "is-on" : ""}" data-menu="${dim.key}">
        <button type="button" class="menu-btn" data-open="${dim.key}">
          <span class="menu-k">${esc(dim.label)}</span>
          <span class="menu-v" title="${esc(label)}">${esc(label)}</span>
        </button>
        <div class="menu-panel" ${open ? "" : "hidden"}>
          <div class="menu-actions">
            <button type="button" data-clear-dim="${dim.key}">Limpar</button>
            ${opts.length ? `<span class="menu-count">${numFmt.format(opts.length)}</span>` : ""}
          </div>
          ${scopeHint ? `<p class="menu-scope">${esc(scopeHint)}</p>` : ""}
          <div class="menu-list">${listHtml}</div>
        </div>
      </div>`;
  }).join("");
  $("btnClear").hidden = !hasActiveFilters();
  const hint = document.querySelector("#sec-visao .hint");
  if (hint) {
    const scope = scopeLabel();
    hint.textContent = scope
      ? `Recorte ativo — ${scope}. Todos os painéis, rankings e listas usam só esses dados.`
      : "Comece pelo vendedor. Depois cruze grupo econômico, loja, UF ou categoria — os painéis e o ranking de itens acompanham o recorte. A data vale pelo mês inteiro.";
  }
}

function renderChips() {
  const el = $("chips");
  const chips = [];
  for (const dim of DIMS) {
    for (const v of state.filters[dim.key]) {
      chips.push({ kind: "dim", dim: dim.key, value: v, label: `${dim.label}: ${v}` });
    }
  }
  if (state.periodMonth != null) {
    chips.push({ kind: "mes", label: `Mês: ${MONTHS[state.periodMonth]}` });
  }
  el._chips = chips;
  if (!chips.length) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.innerHTML = chips.map((chip, index) =>
    `<button type="button" class="chip" data-chip="${index}" title="Remover ${esc(chip.label)}" aria-label="Remover ${esc(chip.label)}">${esc(chip.label)} <span aria-hidden="true">×</span></button>`
  ).join("");
}

function removeChipFilter(chip) {
  if (!chip) return;
  if (chip.kind === "mes") {
    state.periodMonth = null;
  } else if (chip.kind === "dim" && state.filters[chip.dim]) {
    state.filters[chip.dim].delete(chip.value);
    if (chip.dim === "grupo" && state.itemGrupo === chip.value) {
      state.itemGrupo = "";
      state.itemLoja = "";
    }
    if (chip.dim === "loja" && state.itemLoja === chip.value) state.itemLoja = "";
    if (chip.dim === "categoria" && state.itemCategoria === chip.value) state.itemCategoria = "";
  }
  pruneIncompatibleFilters();
  renderAll();
}

function clearDimFilter(dimKey) {
  if (dimKey === "mes") {
    state.periodMonth = null;
  } else if (state.filters[dimKey]) {
    state.filters[dimKey].clear();
    if (dimKey === "grupo") {
      state.itemGrupo = "";
      state.itemLoja = "";
    }
    if (dimKey === "loja") state.itemLoja = "";
    if (dimKey === "categoria") state.itemCategoria = "";
  }
  pruneIncompatibleFilters();
  renderAll();
}

function roundTopBar(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

function drawTrend(canvas, series) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 640;
  const h = canvas.clientHeight || 280;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const pad = { t: 22, r: 16, b: 40, l: 58 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const max = Math.max(...series.flatMap((s) => s.fat), 1);
  const n = 12;
  const groupW = plotW / n;
  const seriesCount = Math.max(series.length, 1);
  const gap = seriesCount > 1 ? 3 : 0;
  const barW = Math.max(4, Math.min(seriesCount === 1 ? 28 : 14, (groupW * 0.72 - gap * (seriesCount - 1)) / seriesCount));
  const totalBarsW = seriesCount * barW + (seriesCount - 1) * gap;
  const hover = charts.hoverMonth;
  const hits = [];

  ctx.strokeStyle = "#e6e8f0";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#8b909c";
  ctx.font = "11px Outfit, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const value = (max * i) / 4;
    const y = pad.t + plotH - (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
    const label = value >= 1e6 ? `${(value / 1e6).toFixed(1)} mi` : value >= 1e3 ? `${Math.round(value / 1e3)} mil` : `${Math.round(value)}`;
    ctx.fillText(label, pad.l - 8, y);
  }

  for (let i = 0; i < n; i++) {
    const gx = pad.l + i * groupW;
    const selected = state.periodMonth === i;
    const isHot = hover === i;
    if (selected || isHot) {
      ctx.fillStyle = selected ? "rgba(181,25,26,0.08)" : "rgba(27,42,74,0.04)";
      ctx.fillRect(gx + 1, pad.t, groupW - 2, plotH);
    }
    hits.push({ index: i, x: gx, y: pad.t, w: groupW, h: plotH });

    series.forEach((s, sIndex) => {
      const fat = s.fat[i] || 0;
      if (fat <= 0) return;
      const bh = Math.max(2, (fat / max) * plotH);
      const x = gx + (groupW - totalBarsW) / 2 + sIndex * (barW + gap);
      const y = pad.t + plotH - bh;
      ctx.globalAlpha = s.emphasis ? 1 : 0.55;
      ctx.fillStyle = selected && s.emphasis ? "#1c2230" : s.color;
      roundTopBar(ctx, x, y, barW, bh, 4);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = "#667085";
  ctx.font = "12px Outfit, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  MONTHS_SHORT.forEach((m, i) => {
    const x = pad.l + i * groupW + groupW / 2;
    ctx.fillText(m, x, h - 12);
  });

  canvas._trendHit = { pad, plotW, plotH, n, hits, series };
}

function trendMonthAt(canvas, clientX, clientY) {
  const hit = canvas._trendHit;
  if (!hit) return null;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  return hit.hits.find((spot) => x >= spot.x && x <= spot.x + spot.w && y >= spot.y && y <= spot.y + spot.h) || null;
}

function tipPctClass(pct) {
  if (pct == null) return "";
  if (pct > 0) return "up";
  if (pct < 0) return "down";
  return "";
}

function tipPctHtml(pct) {
  if (pct == null) return `<em>—</em>`;
  return `<em class="${tipPctClass(pct)}">${pctFmt.format(pct)}</em>`;
}

function trendTooltipHtml(monthIndex) {
  const series = charts.trendSeries || [];
  const byYear = new Map(series.map((s) => [s.year, s]));
  const month = MONTHS[monthIndex] || MONTHS_SHORT[monthIndex];
  const rows = series.map((s) => {
    const fat = s.fat[monthIndex] || 0;
    const vol = s.vol[monthIndex] || 0;
    const prev = byYear.get(s.year - 1);
    const fatPct = prev ? pctChange(fat, prev.fat[monthIndex] || 0) : null;
    const volPct = prev ? pctChange(vol, prev.vol[monthIndex] || 0) : null;
    const evo = prev
      ? `<div class="row tip-evo"><span>Evolução vs ${s.year - 1}</span><b>Fat. ${tipPctHtml(fatPct)} · Vol. ${tipPctHtml(volPct)}</b></div>`
      : `<div class="row tip-evo"><span>Evolução</span><b>—</b></div>`;
    return `<div class="tip-block">
      <div class="row"><span><i class="dot" style="background:${s.color}"></i>${s.year}</span><b>${moneyFmt.format(fat)} · ${numFmt.format(vol)} un.</b></div>
      ${evo}
    </div>`;
  }).join("");
  return `<b>${esc(month)}</b><div class="tip-k">Faturamento · Volume</div>${rows}`;
}

function drawDonut(canvas, slices, total) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const size = Math.min(canvas.clientWidth || 220, canvas.clientHeight || 220, 220);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2, r = size * 0.38, ri = size * 0.24;
  let a = -Math.PI / 2;
  const hits = [];
  for (const s of slices) {
    const ang = total ? (s.value / total) * Math.PI * 2 : 0;
    hits.push({ ...s, a0: a, a1: a + ang });
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * ri, cy + Math.sin(a) * ri);
    ctx.arc(cx, cy, r, a, a + ang);
    ctx.arc(cx, cy, ri, a + ang, a, true);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    a += ang;
  }
  canvas._donutHit = { cx, cy, r, ri, hits };
}

function renderKpis(curRows, prevRows) {
  const cur = sumRows(curRows);
  const prev = sumRows(prevRows);
  const win = windowFor(state.analysisYear);
  const range = win.kind === "month"
    ? `${MONTHS[win.m0]}/${win.y}`
    : `jan–${MONTHS_SHORT[win.m1]}/${win.y}`;

  $("kpiRevenueLabel").textContent = `Faturamento · ${range}`;
  $("kpiRevenue").textContent = moneyFmt.format(cur.fat);
  $("kpiRevenueSub").textContent = prev.fat ? `Ano anterior: ${moneyFmt.format(prev.fat)}` : "Sem base no ano anterior";
  const pct = pctChange(cur.fat, prev.fat);
  $("kpiVar").textContent = pct == null ? "—" : pctFmt.format(pct);
  $("kpiVarCard").classList.toggle("is-down", pct != null && pct < 0);
  $("kpiVarCard").classList.toggle("is-up", pct != null && pct > 0);
  $("kpiVarSub").textContent = "mesmo intervalo do ano anterior";
  $("kpiActive").textContent = numFmt.format(cur.lojas);
  $("kpiVolume").textContent = numFmt.format(cur.vol);
  $("kpiTicket").textContent = cur.cup ? moneyFmtDec.format(cur.fat / cur.cup) : "—";
  $("kpiGrupos").textContent = numFmt.format(cur.grupos);
  $("kpiSkus").textContent = numFmt.format(cur.skus);
  $("kpiCupons").textContent = numFmt.format(cur.cup);
}

function renderTrend(rows) {
  const years = state.meta.years.slice(-3);
  const series = years.map((y) => {
    const fat = Array(12).fill(0);
    const vol = Array(12).fill(0);
    for (const r of rows) {
      if (r.y !== y) continue;
      fat[r.m] += r.fat;
      vol[r.m] += r.vol;
    }
    return {
      year: y,
      color: y === state.analysisYear ? "#b5191a" : "#9aa3b5",
      fat,
      vol,
      emphasis: y === state.analysisYear
    };
  });
  charts.trendSeries = series;
  drawTrend($("trend"), series);
  const scope = scopeLabel();
  $("chartSub").textContent = scope ? `${scope} · ${years.join(" · ")}` : `Comparativo ${years.join(" · ")}`;
  $("chartSummary").textContent = `Evolução mensal de faturamento e volume para ${years.join(", ")}${scope ? ` no recorte ${scope}` : ""}.`;
}

function renderDonut(rows) {
  const field = DIMS.find((d) => d.key === state.donutDim)?.field || "grupo";
  const agg = aggregateBy(rows, field).sort((a, b) => b.fat - a.fat);
  const total = agg.reduce((s, a) => s + a.fat, 0) || 1;
  const head = agg.slice(0, 8);
  const rest = agg.slice(8).reduce((s, a) => s + a.fat, 0);
  const slices = head.map((a) => ({ key: a.key, value: a.fat, color: colorOf(a.key), lojasN: a.lojas?.size || 0 }));
  if (rest > 0) slices.push({ key: "Outros", value: rest, color: "#c5cad6", lojasN: 0 });
  drawDonut($("donut"), slices, total);
  $("donutTotal").textContent = moneyFmt.format(total);
  $("donutCaption").textContent = DIMS.find((d) => d.key === state.donutDim)?.label || "";
  const donutSub = $("donutSub");
  if (donutSub) {
    const scope = scopeLabel();
    donutSub.textContent = scope ? `Participação no período · ${scope}` : "Participação no período";
  }
  charts.donutSlices = slices;
  state.menuOptions._donut = slices.filter((s) => s.key !== "Outros").map((s) => s.key);
  $("donutLegend").innerHTML = slices.map((s, idx) =>
    `<button type="button" class="slice" data-slice-dim="${state.donutDim}" data-slice-opt="${idx}" ${s.key === "Outros" ? "disabled" : ""}>
      <i style="background:${s.color}"></i>
      <span>${esc(s.key)}</span>
      <b>${((s.value / total) * 100).toFixed(1)}%</b>
    </button>`
  ).join("");
}

function donutSliceTooltipHtml(slice) {
  if (!slice || slice.key === "Outros") return "";
  const withLojas = state.donutDim === "uf" || state.donutDim === "grupo" || state.donutDim === "loja";
  if (!withLojas) {
    return `<b>${esc(slice.key)}</b><div>${moneyFmt.format(slice.value)}</div>`;
  }
  const n = slice.lojasN || 0;
  const lojaLabel = n === 1 ? "1 loja" : `${numFmt.format(n)} lojas`;
  return `<b>${esc(slice.key)}</b><div>${lojaLabel}</div><div>${moneyFmt.format(slice.value)}</div>`;
}

function showDonutSliceTip(event, sliceBtn) {
  if (!sliceBtn || sliceBtn.hasAttribute("disabled")) {
    hideTip("donut");
    return;
  }
  const opt = Number(sliceBtn.getAttribute("data-slice-opt"));
  const slice = charts.donutSlices?.[opt];
  const html = donutSliceTooltipHtml(slice);
  if (!html) {
    hideTip("donut");
    return;
  }
  showTip(event.clientX, event.clientY, html, "donut");
}

function hitDonutSlice(canvas, clientX, clientY) {
  const hit = canvas._donutHit;
  if (!hit) return null;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const dx = x - hit.cx;
  const dy = y - hit.cy;
  const dist = Math.hypot(dx, dy);
  if (dist < hit.ri || dist > hit.r) return null;
  let ang = Math.atan2(dy, dx);
  if (ang < -Math.PI / 2) ang += Math.PI * 2;
  return hit.hits.find((s) => ang >= s.a0 && ang < s.a1) || null;
}

function fillItemFilters(baseRows) {
  let grupos = [...new Set(baseRows.map((r) => r.grupo))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  if (state.filters.grupo.size) grupos = grupos.filter((g) => state.filters.grupo.has(g));
  const lojas = [...new Set(
    baseRows
      .filter((r) => {
        if (state.itemGrupo && r.grupo !== state.itemGrupo) return false;
        if (state.filters.loja.size && !state.filters.loja.has(r.loja)) return false;
        return true;
      })
      .map((r) => r.loja)
  )].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const cats = [...new Set(
    baseRows
      .filter((r) => {
        if (state.itemGrupo && r.grupo !== state.itemGrupo) return false;
        if (state.itemLoja && r.loja !== state.itemLoja) return false;
        if (state.filters.categoria.size && !state.filters.categoria.has(r.cat)) return false;
        return true;
      })
      .map((r) => r.cat)
  )].sort((a, b) => a.localeCompare(b, "pt-BR"));

  const gSel = $("itemGrupo");
  const lSel = $("itemLoja");
  const cSel = $("itemCategoria");
  if (state.itemGrupo && !grupos.includes(state.itemGrupo)) state.itemGrupo = "";
  if (state.itemLoja && !lojas.includes(state.itemLoja)) state.itemLoja = "";
  if (state.itemCategoria && !cats.includes(state.itemCategoria)) state.itemCategoria = "";
  const gVal = state.itemGrupo;
  const lVal = state.itemLoja;
  const cVal = state.itemCategoria;
  state.menuOptions.itemGrupo = grupos;
  state.menuOptions.itemLoja = lojas;
  state.menuOptions.itemCategoria = cats;
  gSel.innerHTML = `<option value="">Todos os grupos</option>` + grupos.map((g, i) => `<option value="${i}" ${g === gVal ? "selected" : ""}>${esc(g)}</option>`).join("");
  lSel.innerHTML = `<option value="">Todas as lojas</option>` + lojas.map((l, i) => `<option value="${i}" ${l === lVal ? "selected" : ""}>${esc(l)}</option>`).join("");
  cSel.innerHTML = `<option value="">Todas as categorias</option>` + cats.map((c, i) => `<option value="${i}" ${c === cVal ? "selected" : ""}>${esc(c)}</option>`).join("");
}

function renderItems(baseRows) {
  fillItemFilters(baseRows);
  let rows = baseRows;
  if (state.itemGrupo) rows = rows.filter((r) => r.grupo === state.itemGrupo);
  if (state.itemLoja) rows = rows.filter((r) => r.loja === state.itemLoja);
  if (state.itemCategoria) rows = rows.filter((r) => r.cat === state.itemCategoria);
  const items = topItems(rows, 40);
  const globalScope = scopeLabel();
  const localScope = [state.itemGrupo, state.itemLoja, state.itemCategoria].filter(Boolean).join(" · ");
  const scope = localScope || globalScope || "recorte geral";
  const sortLabel = ({ sku: "SKU", desc: "descrição", cat: "categoria", vol: "volume", fat: "faturamento", parte: "parte" })[state.sortItem.key] || "faturamento";
  const dirLabel = state.sortItem.dir === "asc" ? "menor → maior" : "maior → menor";
  $("itemsSub").textContent = `Top títulos · ordenado por ${sortLabel} (${dirLabel}) · ${scope}`;
  document.querySelectorAll("[data-sort-item]").forEach((btn) => {
    const active = btn.getAttribute("data-sort-item") === state.sortItem.key;
    btn.classList.toggle("is-sort", active);
    btn.setAttribute("aria-sort", active ? (state.sortItem.dir === "asc" ? "ascending" : "descending") : "none");
  });
  $("itemsBody").innerHTML = items.length
    ? items.map((it, i) => `
      <tr>
        <td class="col-pos">${i + 1}</td>
        <td class="mono">${esc(it.sku)}</td>
        <td><b>${esc(it.desc || "—")}</b></td>
        <td>${esc(it.cat || "—")}</td>
        <td class="num">${numFmt.format(it.vol)}</td>
        <td class="num">${moneyFmt.format(it.fat)}</td>
        <td class="num">${((it.parte || 0) * 100).toFixed(1)}%</td>
      </tr>`).join("")
    : `<tr><td colspan="7" class="empty-row">Sem itens neste recorte de cliente/grupo.</td></tr>`;
}

function renderRankings(curRows, prevRows) {
  const prevGrupo = new Map(aggregateBy(prevRows, "grupo").map((a) => [a.key, a.fat]));
  const prevLoja = new Map(aggregateBy(prevRows, "loja").map((a) => [a.key, a.fat]));
  let grupos = aggregateBy(curRows, "grupo").map((a) => ({
    ...a,
    lojasN: a.lojas.size,
    pct: pctChange(a.fat, prevGrupo.get(a.key) || 0)
  }));
  let lojas = aggregateBy(curRows, "loja").map((a) => ({
    ...a,
    pct: pctChange(a.fat, prevLoja.get(a.key) || 0)
  }));

  const sortVal = (row, key) => {
    if (key === "name") return row.key;
    if (key === "lojas") return row.lojasN;
    if (key === "pct") return row.pct ?? -Infinity;
    return row.fat;
  };
  grupos.sort((a, b) => {
    const dir = state.sortGrupo.dir === "asc" ? 1 : -1;
    const ka = sortVal(a, state.sortGrupo.key), kb = sortVal(b, state.sortGrupo.key);
    if (typeof ka === "string") return dir * ka.localeCompare(kb, "pt-BR");
    return dir * (ka - kb);
  });
  lojas.sort((a, b) => {
    const dir = state.sortLoja.dir === "asc" ? 1 : -1;
    const ka = sortVal(a, state.sortLoja.key), kb = sortVal(b, state.sortLoja.key);
    if (typeof ka === "string") return dir * ka.localeCompare(kb, "pt-BR");
    return dir * (ka - kb);
  });

  const scope = scopeLabel();
  $("grupoCount").textContent = scope
    ? `${numFmt.format(grupos.length)} grupos · ${scope}`
    : `${numFmt.format(grupos.length)} grupos no período`;
  $("lojaCount").textContent = scope
    ? `${numFmt.format(lojas.length)} lojas · ${scope}`
    : `${numFmt.format(lojas.length)} lojas no período`;
  state.menuOptions.pickGrupo = grupos.slice(0, 40).map((g) => g.key);
  state.menuOptions.pickLoja = lojas.slice(0, 50).map((l) => l.key);
  charts.grupoTips = grupos.slice(0, 40);
  $("grupoBody").innerHTML = charts.grupoTips.map((g, i) => `
    <tr data-pick-grupo="${i}" data-grupo-tip="${i}">
      <td class="col-pos">${i + 1}</td>
      <td><button type="button" class="linkish" data-pick-grupo="${i}">${esc(g.key)}</button></td>
      <td class="num">${numFmt.format(g.lojasN)}</td>
      <td class="num">${moneyFmt.format(g.fat)}</td>
      <td class="num ${g.pct != null && g.pct < 0 ? "is-neg" : "is-pos"}">${g.pct == null ? "—" : pctFmt.format(g.pct)}</td>
    </tr>`).join("") || `<tr><td colspan="5" class="empty-row">Nenhum grupo neste recorte.</td></tr>`;
  $("lojaBody").innerHTML = lojas.slice(0, 50).map((l, i) => `
    <tr>
      <td class="col-pos">${i + 1}</td>
      <td><button type="button" class="linkish" data-pick-loja="${i}">${esc(l.key)}</button></td>
      <td>${esc(l.grupo)}</td>
      <td class="col-vend">${esc(l.vend)}</td>
      <td class="num">${moneyFmt.format(l.fat)}</td>
      <td class="num ${l.pct != null && l.pct < 0 ? "is-neg" : "is-pos"}">${l.pct == null ? "—" : pctFmt.format(l.pct)}</td>
    </tr>`).join("") || `<tr><td colspan="6" class="empty-row">Nenhuma loja neste recorte.</td></tr>`;
}

function ufTrendColor(row) {
  if (!row || !row.lojasN) return "#d5d8e0";
  const pct = row.pct;
  if (pct == null) return "#d5d8e0";
  if (pct > 0.005) return "#0f7a5a";
  if (pct < -0.005) return "#8e1214";
  return "#c5cad6";
}

function buildUfStats(curRows, prevRows = []) {
  const map = new Map();
  for (const r of curRows) {
    const cur = map.get(r.uf) || { key: r.uf, fat: 0, vol: 0, prevFat: 0, lojas: new Set() };
    cur.fat += r.fat;
    cur.vol += r.vol;
    cur.lojas.add(r.cnpj || r.loja);
    map.set(r.uf, cur);
  }
  for (const r of prevRows) {
    const cur = map.get(r.uf) || { key: r.uf, fat: 0, vol: 0, prevFat: 0, lojas: new Set() };
    cur.prevFat += r.fat;
    map.set(r.uf, cur);
  }
  const list = [...map.values()]
    .filter((u) => u.lojas.size > 0 || u.fat > 0)
    .map((u) => ({
      key: u.key,
      fat: u.fat,
      vol: u.vol,
      prevFat: u.prevFat,
      lojasN: u.lojas.size,
      pct: pctChange(u.fat, u.prevFat)
    }))
    .sort((a, b) => b.fat - a.fat || a.key.localeCompare(b.key, "pt-BR"));
  return { list, byKey: new Map(list.map((u) => [u.key, u])) };
}

function ensureBrazilMap() {
  const svg = $("brazilSvg");
  if (!svg || svg.dataset.ready === "1" || typeof BRAZIL_PATHS === "undefined") return;
  svg.setAttribute("viewBox", typeof BRAZIL_VIEW !== "undefined" ? BRAZIL_VIEW : "0 0 440 470");
  const keys = Object.keys(BRAZIL_PATHS).filter((uf) => uf !== "DF");
  keys.push("DF");
  svg.innerHTML = keys.map((uf) => `<path data-uf="${uf}" d="${BRAZIL_PATHS[uf]}"></path>`).join("");
  svg.dataset.ready = "1";
}

function paintBrazilMap() {
  ensureBrazilMap();
  const svg = $("brazilSvg");
  if (!svg) return;
  const picked = state.filters.uf;
  const hot = charts.hoverUf;
  svg.querySelectorAll("path[data-uf]").forEach((path) => {
    const row = charts.ufByKey.get(path.dataset.uf);
    path.setAttribute("fill", ufTrendColor(row));
    path.classList.toggle("is-on", picked.has(path.dataset.uf));
    path.classList.toggle("is-hot", hot === path.dataset.uf);
  });
}

function placeTip(x, y, html) {
  const tip = $("tooltip");
  tip.innerHTML = html;
  tip.hidden = false;
  tip.style.left = "0px";
  tip.style.top = "0px";
  const rect = tip.getBoundingClientRect();
  let left = x + 14;
  let top = y + 14;
  if (left + rect.width > window.innerWidth - 8) left = x - rect.width - 12;
  if (top + rect.height > window.innerHeight - 8) top = y - rect.height - 12;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}

function hideTip(kind) {
  const tip = $("tooltip");
  if (kind && tip.dataset.kind !== kind) return;
  tip.hidden = true;
  tip.dataset.kind = "";
}

function showTip(x, y, html, kind) {
  $("tooltip").dataset.kind = kind || "";
  placeTip(x, y, html);
}

function ufTooltipHtml(uf) {
  const row = charts.ufByKey.get(uf);
  if (!row || !row.lojasN) {
    return `<b>${esc(uf)}</b><div>Sem cliente mapeado</div>`;
  }
  const lojaLabel = row.lojasN === 1 ? "1 loja" : `${numFmt.format(row.lojasN)} lojas`;
  const varLabel = row.pct == null ? "—" : pctFmt.format(row.pct);
  return `<b>${esc(uf)} · ${varLabel}</b><div>${lojaLabel}</div><div>${moneyFmt.format(row.fat)}</div>`;
}

function renderUfMap(curRows, prevRows = []) {
  const stats = buildUfStats(curRows, prevRows);
  charts.ufByKey = stats.byKey;
  const scope = scopeLabel();
  const picked = [...state.filters.uf];
  $("ufSub").textContent = scope
    ? `Variação por estado no recorte · ${scope}`
    : "Verde = crescendo · Vermelho = caindo · Cinza = sem cliente mapeado.";
  $("ufCut").textContent = picked.length
    ? `Recorte: ${picked.sort().join(", ")}`
    : `Recorte: todos os estados · ${numFmt.format(stats.list.length)} UFs com venda`;
  paintBrazilMap();
  $("ufList").innerHTML = stats.list.length
    ? stats.list.map((u) => {
      const trend = u.pct == null ? "" : u.pct > 0.005 ? "is-up" : u.pct < -0.005 ? "is-down" : "";
      const varTxt = u.pct == null ? "—" : pctFmt.format(u.pct);
      return `
      <button type="button" class="uf-row ${state.filters.uf.has(u.key) ? "is-on" : ""} ${charts.hoverUf === u.key ? "is-hot" : ""}" data-uf-pick="${esc(u.key)}">
        <span class="uf-code">${esc(u.key)}</span>
        <span class="uf-meta">${numFmt.format(u.lojasN)} ${u.lojasN === 1 ? "loja" : "lojas"} · <em class="${trend}">${varTxt}</em></span>
        <b>${moneyFmt.format(u.fat)}</b>
      </button>`;
    }).join("")
    : `<p class="menu-empty">Nenhuma UF neste recorte.</p>`;
}

function toggleUf(uf) {
  if (!uf || !state.filters.uf) return;
  const set = state.filters.uf;
  if (set.has(uf) && set.size === 1) set.clear();
  else {
    set.clear();
    set.add(uf);
  }
  pruneIncompatibleFilters();
  renderAll();
}

function renderSearch() {
  const box = $("searchHit");
  const q = state.search.trim();
  if (!q || !state.meta) { box.hidden = true; box.innerHTML = ""; $("q").setAttribute("aria-expanded", "false"); return; }
  const nq = norm(q);
  const hits = [];
  const seen = new Set();
  for (const r of filteredRows()) {
    if (hits.length >= 12) break;
    const keys = [r.loja, r.grupo, r.sku, r.desc];
    if (!keys.some((k) => norm(k).includes(nq))) continue;
    const id = `loja:${r.loja}`;
    if (seen.has(id)) continue;
    seen.add(id);
    hits.push(r);
  }
  box.hidden = false;
  $("q").setAttribute("aria-expanded", "true");
  state.menuOptions.searchLoja = hits.map((r) => r.loja);
  box.innerHTML = hits.length
    ? hits.map((r, i) => `<button type="button" data-search-loja="${i}"><b>${esc(r.loja)}</b><small>${esc(r.grupo)} · ${esc(r.vend)}</small></button>`).join("")
    : `<p class="search-more">Nenhum resultado para “${esc(q)}”.</p>`;
}

function renderAll() {
  if (!state.meta) return;
  pruneIncompatibleFilters();
  const base = filteredRows();
  const win = windowFor(state.analysisYear);
  const prevWin = { ...win, y: state.analysisYear - 1 };
  const curRows = base.filter((r) => inWindow(r, win));
  const prevRows = base.filter((r) => inWindow(r, prevWin));

  $("sideBase").textContent = `${state.fileName || "Base"} · por mês`;
  renderYearSwitch();
  renderFilterBar();
  renderChips();
  renderSideFilters();
  renderKpis(curRows, prevRows);
  renderTrend(base);
  renderDonut(curRows);
  renderUfMap(curRows, prevRows);
  renderItems(curRows);
  renderRankings(curRows, prevRows);
  renderSearch();
}

async function ingestText(text, fileName) {
  $("loading").hidden = false;
  $("loadingText").textContent = "Processando sell-out…";
  await new Promise((r) => setTimeout(r, 30));
  try {
    const parsed = parseCsv(text);
    state.rows = parsed.rows;
    state.meta = parsed.meta;
    state.analysisYear = parsed.analysisYear;
    state.fileName = fileName || "sell-out.csv";
    state.menuOptions = {};
    state.filters = { vendedor: new Set(), grupo: new Set(), loja: new Set(), uf: new Set(), categoria: new Set() };
    state.periodMonth = null;
    state.itemGrupo = "";
    state.itemLoja = "";
    state.itemCategoria = "";
    $("empty").hidden = true;
    $("dash").hidden = false;
    $("q").disabled = false;
    $("fileLabel").textContent = "Trocar CSV";
    $("fileMeta").textContent = state.fileName;
    $("error").hidden = true;
    renderAll();
  } catch (err) {
    $("error").hidden = false;
    $("error").textContent = err.message || "Não foi possível ler o arquivo.";
  } finally {
    $("loading").hidden = true;
  }
}

function readFile(file) {
  $("loading").hidden = false;
  $("loadingText").textContent = "Lendo o sell-out…";
  const reader = new FileReader();
  reader.onload = () => ingestText(String(reader.result || ""), file.name);
  reader.onerror = () => {
    $("loading").hidden = true;
    $("error").hidden = false;
    $("error").textContent = "Falha ao ler o arquivo. Tente novamente.";
  };
  reader.readAsText(file, "windows-1252");
}

function toggleFilter(dim, value, on) {
  if (value == null || value === "") return;
  const set = state.filters[dim];
  if (on) set.add(value); else set.delete(value);
  if (dim === "grupo" && !on && state.itemGrupo === value) {
    state.itemGrupo = "";
    state.itemLoja = "";
  }
  if (dim === "loja" && !on && state.itemLoja === value) state.itemLoja = "";
  if (dim === "categoria" && !on && state.itemCategoria === value) state.itemCategoria = "";
  pruneIncompatibleFilters();
  renderAll();
}

function clearFilters() {
  for (const dim of DIMS) state.filters[dim.key].clear();
  state.periodMonth = null;
  state.itemGrupo = "";
  state.itemLoja = "";
  state.itemCategoria = "";
  state.search = "";
  $("q").value = "";
  renderAll();
}

function wire() {
  $("btnFile").addEventListener("click", () => $("file").click());
  $("pick").addEventListener("click", () => $("file").click());
  $("file").addEventListener("change", () => {
    const file = $("file").files?.[0];
    if (file) readFile(file);
  });

  const drop = $("drop");
  ["dragenter", "dragover"].forEach((ev) => document.addEventListener(ev, (e) => {
    e.preventDefault();
    document.body.classList.add("is-drag");
  }));
  ["dragleave", "drop"].forEach((ev) => document.addEventListener(ev, (e) => {
    e.preventDefault();
    document.body.classList.remove("is-drag");
  }));
  drop.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) readFile(file);
  });

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    const goto = t.closest("[data-goto]");
    if (goto) {
      document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("is-active", b === goto));
      $(goto.getAttribute("data-goto"))?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const open = t.closest("[data-open]");
    if (open) {
      const key = open.getAttribute("data-open");
      state.openMenu = state.openMenu === key ? null : key;
      renderFilterBar();
      return;
    }

    const clearDim = t.closest("[data-clear-dim]");
    if (clearDim) {
      clearDimFilter(clearDim.getAttribute("data-clear-dim"));
      return;
    }

    const sideClearDim = t.closest("[data-side-clear-dim]");
    if (sideClearDim) {
      clearDimFilter(sideClearDim.getAttribute("data-side-clear-dim"));
      return;
    }

    const chipBtn = t.closest("#chips [data-chip], .chip[data-chip]");
    if (chipBtn) {
      e.preventDefault();
      const chips = $("chips")._chips || [];
      const chip = chips[Number(chipBtn.getAttribute("data-chip"))];
      if (chip) removeChipFilter(chip);
      return;
    }

    if (t.matches('input[type="checkbox"][data-dim][data-opt]') || t.closest(".menu-item")) {
      return;
    }

    const yearBtn = t.closest("[data-year]");
    if (yearBtn) {
      state.analysisYear = Number(yearBtn.getAttribute("data-year"));
      state.periodMonth = null;
      renderAll();
      return;
    }

    const dimBtn = t.closest("#dimSeg [data-dim]");
    if (dimBtn) {
      state.donutDim = dimBtn.getAttribute("data-dim");
      document.querySelectorAll("#dimSeg [data-dim]").forEach((b) => b.setAttribute("aria-pressed", String(b === dimBtn)));
      renderAll();
      return;
    }

    const slice = t.closest("[data-slice-dim]");
    if (slice && !slice.hasAttribute("disabled")) {
      const dim = slice.getAttribute("data-slice-dim");
      const opt = Number(slice.getAttribute("data-slice-opt"));
      const val = state.menuOptions._donut?.[opt];
      if (dim && val && state.filters[dim]) {
        state.filters[dim].clear();
        state.filters[dim].add(val);
        pruneIncompatibleFilters();
        renderAll();
      }
      return;
    }

    const sortItem = t.closest("[data-sort-item]");
    if (sortItem) {
      const key = sortItem.getAttribute("data-sort-item");
      if (state.sortItem.key === key) state.sortItem.dir = state.sortItem.dir === "desc" ? "asc" : "desc";
      else state.sortItem = { key, dir: key === "sku" || key === "desc" || key === "cat" ? "asc" : "desc" };
      renderAll();
      return;
    }

    const pickGrupo = t.closest("[data-pick-grupo]");
    if (pickGrupo) {
      const g = state.menuOptions.pickGrupo?.[Number(pickGrupo.getAttribute("data-pick-grupo"))];
      if (g) {
        state.filters.grupo.clear();
        state.filters.grupo.add(g);
        state.itemGrupo = g;
        state.itemLoja = "";
        pruneIncompatibleFilters();
        renderAll();
        $("sec-itens").scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }

    const pickLoja = t.closest("[data-pick-loja]");
    if (pickLoja) {
      const l = state.menuOptions.pickLoja?.[Number(pickLoja.getAttribute("data-pick-loja"))];
      if (l) {
        state.filters.loja.clear();
        state.filters.loja.add(l);
        state.itemLoja = l;
        pruneIncompatibleFilters();
        renderAll();
        $("sec-itens").scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }

    const sortG = t.closest("[data-sort-grupo]");
    if (sortG) {
      const key = sortG.getAttribute("data-sort-grupo");
      if (state.sortGrupo.key === key) state.sortGrupo.dir = state.sortGrupo.dir === "desc" ? "asc" : "desc";
      else state.sortGrupo = { key, dir: key === "name" ? "asc" : "desc" };
      renderAll();
      return;
    }

    const sortL = t.closest("[data-sort-loja]");
    if (sortL) {
      const key = sortL.getAttribute("data-sort-loja");
      if (state.sortLoja.key === key) state.sortLoja.dir = state.sortLoja.dir === "desc" ? "asc" : "desc";
      else state.sortLoja = { key, dir: key === "name" ? "asc" : "desc" };
      renderAll();
      return;
    }

    const searchLoja = t.closest("[data-search-loja]");
    if (searchLoja) {
      const l = state.menuOptions.searchLoja?.[Number(searchLoja.getAttribute("data-search-loja"))];
      if (l) {
        state.filters.loja.clear();
        state.filters.loja.add(l);
        state.itemLoja = l;
        state.search = "";
        $("q").value = "";
        pruneIncompatibleFilters();
        renderAll();
      }
      return;
    }

    if (!t.closest(".menu")) {
      if (state.openMenu) {
        state.openMenu = null;
        renderFilterBar();
      }
    }
  });

  $("btnClear").addEventListener("click", clearFilters);
  $("btnSideClear").addEventListener("click", clearFilters);
  $("btnSideClearAll")?.addEventListener("click", clearFilters);

  const donutLegend = $("donutLegend");
  donutLegend.addEventListener("pointermove", (e) => {
    const btn = e.target.closest(".slice[data-slice-opt]");
    showDonutSliceTip(e, btn);
  });
  donutLegend.addEventListener("pointerleave", () => hideTip("donut"));
  donutLegend.addEventListener("click", (e) => {
    const btn = e.target.closest(".slice[data-slice-opt]");
    if (btn) showDonutSliceTip(e, btn);
  });

  const donutCanvas = $("donut");
  donutCanvas.addEventListener("pointermove", (e) => {
    const slice = hitDonutSlice(donutCanvas, e.clientX, e.clientY);
    const html = donutSliceTooltipHtml(slice);
    if (!html) {
      hideTip("donut");
      return;
    }
    showTip(e.clientX, e.clientY, html, "donut");
  });
  donutCanvas.addEventListener("pointerleave", () => hideTip("donut"));

  const grupoBody = $("grupoBody");
  grupoBody.addEventListener("pointermove", (e) => {
    const row = e.target.closest("[data-grupo-tip]");
    if (!row) {
      hideTip("grupo");
      return;
    }
    const g = charts.grupoTips?.[Number(row.getAttribute("data-grupo-tip"))];
    if (!g) {
      hideTip("grupo");
      return;
    }
    const lojaLabel = g.lojasN === 1 ? "1 loja" : `${numFmt.format(g.lojasN || 0)} lojas`;
    showTip(
      e.clientX,
      e.clientY,
      `<b>${esc(g.key)}</b><div>${lojaLabel}</div><div>${moneyFmt.format(g.fat)}</div>`,
      "grupo"
    );
  });
  grupoBody.addEventListener("pointerleave", () => hideTip("grupo"));
  $("chips").addEventListener("click", (e) => {
    const chipBtn = e.target.closest("[data-chip]");
    if (!chipBtn) return;
    e.preventDefault();
    e.stopPropagation();
    const chips = $("chips")._chips || [];
    const chip = chips[Number(chipBtn.getAttribute("data-chip"))];
    if (chip) removeChipFilter(chip);
  });
  $("itemGrupo").addEventListener("change", (e) => {
    const idx = e.target.value;
    state.itemGrupo = idx === "" ? "" : (state.menuOptions.itemGrupo?.[Number(idx)] || "");
    state.itemLoja = "";
    renderAll();
  });
  $("itemLoja").addEventListener("change", (e) => {
    const idx = e.target.value;
    state.itemLoja = idx === "" ? "" : (state.menuOptions.itemLoja?.[Number(idx)] || "");
    renderAll();
  });
  $("itemCategoria").addEventListener("change", (e) => {
    const idx = e.target.value;
    state.itemCategoria = idx === "" ? "" : (state.menuOptions.itemCategoria?.[Number(idx)] || "");
    renderAll();
  });

  $("filterBar").addEventListener("change", (e) => {
    const t = e.target;
    if (!(t instanceof Element) || !t.matches('input[type="checkbox"][data-dim][data-opt]')) return;
    const dim = t.getAttribute("data-dim");
    const opt = Number(t.getAttribute("data-opt"));
    const value = state.menuOptions[dim]?.[opt];
    toggleFilter(dim, value, t.checked);
  });

  const brazilSvg = $("brazilSvg");
  brazilSvg.addEventListener("pointermove", (e) => {
    const path = e.target.closest("path[data-uf]");
    const uf = path?.dataset.uf || null;
    charts.hoverUf = uf;
    paintBrazilMap();
    document.querySelectorAll("#ufList .uf-row").forEach((btn) => {
      btn.classList.toggle("is-hot", btn.getAttribute("data-uf-pick") === uf);
    });
    if (!uf) { hideTip("ufmap"); return; }
    showTip(e.clientX, e.clientY, ufTooltipHtml(uf), "ufmap");
  });
  brazilSvg.addEventListener("pointerleave", () => {
    charts.hoverUf = null;
    hideTip("ufmap");
    paintBrazilMap();
    document.querySelectorAll("#ufList .uf-row").forEach((btn) => btn.classList.remove("is-hot"));
  });
  brazilSvg.addEventListener("click", (e) => {
    const path = e.target.closest("path[data-uf]");
    if (path) toggleUf(path.dataset.uf);
  });

  $("ufList").addEventListener("pointermove", (e) => {
    const btn = e.target.closest("[data-uf-pick]");
    const uf = btn?.getAttribute("data-uf-pick") || null;
    charts.hoverUf = uf;
    paintBrazilMap();
    document.querySelectorAll("#ufList .uf-row").forEach((row) => {
      row.classList.toggle("is-hot", row.getAttribute("data-uf-pick") === uf);
    });
    if (!uf) { hideTip("uflist"); return; }
    showTip(e.clientX, e.clientY, ufTooltipHtml(uf), "uflist");
  });
  $("ufList").addEventListener("pointerleave", () => {
    charts.hoverUf = null;
    hideTip("uflist");
    paintBrazilMap();
    document.querySelectorAll("#ufList .uf-row").forEach((btn) => btn.classList.remove("is-hot"));
  });
  $("ufList").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-uf-pick]");
    if (btn) toggleUf(btn.getAttribute("data-uf-pick"));
  });
  $("q").addEventListener("input", (e) => {
    state.search = e.target.value;
    renderSearch();
  });

  const trend = $("trend");
  trend.addEventListener("pointermove", (e) => {
    if (!state.meta) return;
    const spot = trendMonthAt(trend, e.clientX, e.clientY);
    const next = spot ? spot.index : null;
    trend.style.cursor = spot ? "pointer" : "default";
    if (charts.hoverMonth !== next) {
      charts.hoverMonth = next;
      drawTrend(trend, charts.trendSeries || []);
    }
    if (spot == null) {
      hideTip("trend");
      return;
    }
    showTip(e.clientX, e.clientY, trendTooltipHtml(spot.index), "trend");
  });
  trend.addEventListener("pointerleave", () => {
    charts.hoverMonth = null;
    hideTip("trend");
    if (state.meta) drawTrend(trend, charts.trendSeries || []);
  });
  trend.addEventListener("click", (e) => {
    if (!state.meta) return;
    const spot = trendMonthAt(trend, e.clientX, e.clientY);
    if (!spot) return;
    state.periodMonth = state.periodMonth === spot.index ? null : spot.index;
    renderAll();
  });

  window.addEventListener("resize", () => {
    if (state.meta) renderAll();
  });
}

wire();
