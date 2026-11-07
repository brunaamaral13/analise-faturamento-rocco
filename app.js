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

const ACCESS_LOG_URL = "https://script.google.com/macros/s/AKfycbxBZ_YCXrDiwr1hFVlL8PWn6pyfH5-7e7yWknE9HOsIGyMrPyRVRoBG95EHenABRrEv6A/exec";
const SELLER_STORAGE_KEY = "rocco_sellout_vendedor";
const SELLERS = ["Bruna", "Geysa", "Gilsan", "Michael", "Rafaela", "Rossano", "Salete", "Silvia"];

const state = {
  rows: [],
  meta: null,
  fileName: "",
  seller: "",
  sellerPick: "",
  filters: { vendedor: new Set(), grupo: new Set(), loja: new Set(), uf: new Set(), categoria: new Set() },
  analysisYear: null,
  periodMonth: null,
  donutDim: "loja",
  search: "",
  isbnQuery: "",
  titleQuery: "",
  books: [],
  stores: [],
  sku: new Set(),
  skuDesc: new Map(),
  novos: false,
  paradas: false,
  newStoreIds: new Set(),
  newSince: null,
  openMenu: null,
  menuOptions: {},
  itemGrupo: "",
  itemLoja: "",
  itemCategoria: "",
  sortItem: { key: "fat", dir: "desc" },
  sortGrupo: { key: "fat", dir: "desc" },
  sortLoja: { key: "fat", dir: "desc" },
  drawerLoja: null
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
  return [...map.entries()]
    .map(([value, cur]) => [value, cur.lojas.size, cur.fat])
    .sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { sensitivity: "base" }));
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
  if (state.sku.size) {
    const skus = [...state.sku];
    if (skus.length === 1) {
      const desc = state.skuDesc.get(skus[0]);
      parts.push(desc ? `ISBN: ${skus[0]} · ${desc}` : `ISBN: ${skus[0]}`);
    } else {
      parts.push(`ISBN: ${skus.length} títulos`);
    }
  }
  if (state.novos) parts.push(`Novos na base: desde ${monthKeyLabel(state.newSince)}`);
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

function digitsOf(s) {
  return String(s || "").replace(/\D/g, "");
}

function formatCnpj(raw) {
  const d = digitsOf(raw);
  if (d.length !== 14) return raw ? String(raw) : "sem CNPJ";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function periodRangeLabel(win) {
  if (!win) return "";
  if (win.kind === "month") {
    const name = MONTHS[win.m0] || "";
    return `${name.charAt(0).toUpperCase()}${name.slice(1)}/${win.y}`;
  }
  const a = MONTHS[win.m0] || "";
  const b = MONTHS[win.m1] || "";
  if (win.m0 === win.m1) return `${a.charAt(0).toUpperCase()}${a.slice(1)}/${win.y}`;
  return `${a.charAt(0).toUpperCase()}${a.slice(1)} a ${b}/${win.y}`;
}

function storeId(r) {
  return (r.cnpj || r.loja || "").trim() || r.loja;
}

function monthKeyLabel(key) {
  if (key == null || !Number.isFinite(key)) return "";
  return `${MONTHS_SHORT[((key % 12) + 12) % 12]}/${Math.floor(key / 12)}`;
}

function buildNewStores(rows, maxKey) {
  const first = new Map();
  for (const r of rows) {
    const id = storeId(r);
    const cur = first.get(id);
    if (cur == null || r.key < cur) first.set(id, r.key);
  }
  const start = maxKey - 11;
  const ids = new Set();
  for (const [id, key] of first) if (key >= start) ids.add(id);
  state.newStoreIds = ids;
  state.newSince = start;
}

function filteredRows(except = null) {
  const f = state.filters;
  return state.rows.filter((r) => {
    if (state.novos && except !== "novos" && !state.newStoreIds.has(storeId(r))) return false;
    if (except !== "sku" && state.sku.size && !state.sku.has(r.sku)) return false;
    for (const dim of DIMS) {
      if (except === dim.key) continue;
      const set = f[dim.key];
      if (set.size && !set.has(r[dim.field])) return false;
    }
    return true;
  });
}

function hasActiveFilters() {
  if (state.periodMonth != null || state.search.trim() || state.isbnQuery.trim() || state.titleQuery.trim() || state.sku.size || state.novos || state.paradas) return true;
  return DIMS.some((d) => state.filters[d.key].size);
}

function activeFilterGroups() {
  const groups = [];
  for (const dim of DIMS) {
    const values = [...state.filters[dim.key]];
    if (values.length) groups.push({ key: dim.key, label: dim.label, values });
  }
  if (state.periodMonth != null) groups.push({ key: "mes", label: "Mês", values: [MONTHS[state.periodMonth]] });
  if (state.sku.size) {
    const values = [...state.sku].map((sku) => {
      const desc = state.skuDesc.get(sku);
      return desc ? `${sku} · ${desc}` : sku;
    });
    groups.push({ key: "sku", label: "ISBN", values });
  }
  if (state.novos) groups.push({ key: "novos", label: "Novos na base", values: [`desde ${monthKeyLabel(state.newSince)}`] });
  if (state.paradas) groups.push({ key: "paradas", label: "Lojas paradas", values: ["zeraram neste período"] });
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

function storeActivity(rows) {
  const map = new Map();
  for (const r of rows) {
    const id = storeId(r);
    let cur = map.get(id);
    if (!cur) {
      cur = { id, key: r.loja, grupo: r.grupo, vend: r.vend, fat: 0, vol: 0, lastKey: r.key };
      map.set(id, cur);
    }
    cur.fat += r.fat;
    cur.vol += r.vol;
    if (r.key >= cur.lastKey) {
      cur.lastKey = r.key;
      cur.key = r.loja;
      cur.grupo = r.grupo;
      cur.vend = r.vend;
    }
  }
  return map;
}

function stoppedStores(curRows, prevRows) {
  const cur = storeActivity(curRows);
  const prev = storeActivity(prevRows);
  const list = [];
  let fat = 0;
  let hadPrev = false;
  for (const row of prev.values()) {
    if (!(row.fat > 0 || row.vol > 0)) continue;
    hadPrev = true;
    const now = cur.get(row.id);
    if (now && (now.fat > 0 || now.vol > 0)) continue;
    list.push(row);
    fat += row.fat;
  }
  return { n: list.length, fat, hadPrev, list };
}

function newStoresInPeriod(rows) {
  const ids = new Set();
  let fat = 0;
  for (const r of rows) {
    const id = storeId(r);
    if (!state.newStoreIds.has(id)) continue;
    if (!ids.has(id)) ids.add(id);
    fat += r.fat;
  }
  return { n: ids.size, fat };
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
  if (document.body.dataset.view === "in") {
    if (typeof renderSellInSideFilters === "function") renderSellInSideFilters();
    else box.hidden = true;
    return;
  }
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
  for (const sku of state.sku) {
    const desc = state.skuDesc.get(sku);
    chips.push({
      kind: "sku",
      value: sku,
      label: desc ? `ISBN: ${sku} · ${desc}` : `ISBN: ${sku}`
    });
  }
  if (state.novos) {
    chips.push({ kind: "novos", label: `Novos na base: desde ${monthKeyLabel(state.newSince)}` });
  }
  if (state.paradas) {
    chips.push({ kind: "paradas", label: "Lojas paradas" });
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
  } else if (chip.kind === "sku") {
    if (chip.value) {
      state.sku.delete(chip.value);
      state.skuDesc.delete(chip.value);
    } else {
      state.sku.clear();
      state.skuDesc.clear();
    }
  } else if (chip.kind === "novos") {
    state.novos = false;
  } else if (chip.kind === "paradas") {
    state.paradas = false;
  } else if (chip.kind === "dim" && state.filters[chip.dim]) {
    state.filters[chip.dim].delete(chip.value);
    if (chip.dim === "grupo" && state.itemGrupo === chip.value) {
      state.itemGrupo = "";
      state.itemLoja = "";
    }
    if (chip.dim === "loja") {
      if (state.itemLoja === chip.value) state.itemLoja = "";
      if (state.drawerLoja === chip.value) state.drawerLoja = null;
    }
    if (chip.dim === "categoria" && state.itemCategoria === chip.value) state.itemCategoria = "";
  }
  pruneIncompatibleFilters();
  renderAll();
}

function clearDimFilter(dimKey) {
  if (dimKey === "mes") {
    state.periodMonth = null;
  } else if (dimKey === "sku") {
    state.sku.clear();
    state.skuDesc.clear();
  } else if (dimKey === "novos") {
    state.novos = false;
  } else if (dimKey === "paradas") {
    state.paradas = false;
  } else if (state.filters[dimKey]) {
    state.filters[dimKey].clear();
    if (dimKey === "grupo") {
      state.itemGrupo = "";
      state.itemLoja = "";
    }
    if (dimKey === "loja") {
      state.itemLoja = "";
      state.drawerLoja = null;
    }
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

function fitKpiValue(el) {
  if (!el) return;
  el.style.fontSize = "";
  const card = el.closest(".kpi");
  if (!card) return;
  const styles = getComputedStyle(card);
  const pad = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
  const max = Math.max(40, card.clientWidth - pad);
  let size = parseFloat(getComputedStyle(el).fontSize) || 24;
  const min = 13;
  while (size > min && el.scrollWidth > max) {
    size -= 0.5;
    el.style.fontSize = `${size}px`;
  }
}

function renderKpis(curRows, prevRows, stopped, novos) {
  const cur = sumRows(curRows);
  const prev = sumRows(prevRows);
  const win = windowFor(state.analysisYear);
  const range = win.kind === "month"
    ? `${MONTHS[win.m0]}/${win.y}`
    : `jan–${MONTHS_SHORT[win.m1]}/${win.y}`;

  $("kpiRevenueLabel").textContent = `Faturamento · ${range}`;
  $("kpiRevenue").textContent = moneyFmt.format(cur.fat);
  fitKpiValue($("kpiRevenue"));
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

  const card = $("kpiStoppedCard");
  card.classList.remove("is-down", "is-up", "is-flat");
  card.disabled = false;
  card.setAttribute("aria-disabled", stopped.n ? "false" : "true");
  card.setAttribute("aria-pressed", state.paradas ? "true" : "false");
  if (!stopped.hadPrev) {
    $("kpiStopped").textContent = "—";
    $("kpiStoppedSub").textContent = "Sem base no ano anterior";
    card.classList.add("is-flat");
    card.title = "Não há venda no mesmo intervalo do ano anterior";
  } else if (!stopped.n) {
    $("kpiStopped").textContent = "0";
    $("kpiStoppedSub").textContent = "Nenhuma zerou no período";
    card.classList.add("is-up");
    card.title = "Toda loja com venda no ano anterior seguiu vendendo";
  } else {
    $("kpiStopped").textContent = numFmt.format(stopped.n);
    $("kpiStoppedSub").textContent = `${moneyFmt.format(stopped.fat)} no ano anterior`;
    card.classList.add("is-down");
    card.title = "Lojas com venda no ano anterior e zero agora. Clique para listar.";
  }

  const novosCard = $("kpiNovosCard");
  if (novosCard) {
    novosCard.disabled = false;
    novosCard.setAttribute("aria-disabled", novos.n ? "false" : "true");
    novosCard.setAttribute("aria-pressed", state.novos ? "true" : "false");
    $("kpiNovos").textContent = numFmt.format(novos.n);
    if (!novos.n) {
      $("kpiNovosSub").textContent = "Nenhuma loja nova no recorte";
      novosCard.title = "Nenhuma loja com primeira venda nos últimos 12 meses da base";
    } else {
      const since = state.newSince != null ? `desde ${monthKeyLabel(state.newSince)}` : "últimos 12 meses";
      $("kpiNovosSub").textContent = `${moneyFmt.format(novos.fat)} · ${since}`;
      novosCard.title = "Lojas com primeira venda nos últimos 12 meses da base. Clique para filtrar.";
    }
  }
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

function renderRankings(curRows, prevRows, stopped) {
  const prevGrupo = new Map(aggregateBy(prevRows, "grupo").map((a) => [a.key, a]));
  const prevLoja = new Map(aggregateBy(prevRows, "loja").map((a) => [a.key, a]));
  let grupos = aggregateBy(curRows, "grupo").map((a) => {
    const prev = prevGrupo.get(a.key);
    return {
      ...a,
      lojasN: a.lojas.size,
      pct: pctChange(a.fat, prev?.fat || 0),
      pctVol: pctChange(a.vol, prev?.vol || 0)
    };
  });
  let lojas = state.paradas
    ? stopped.list.map((a) => ({
        key: a.key,
        grupo: a.grupo,
        vend: a.vend,
        fat: 0,
        fatPrev: a.fat,
        pct: a.fat ? -1 : null
      }))
    : aggregateBy(curRows, "loja").map((a) => {
        const prev = prevLoja.get(a.key);
        return {
          ...a,
          fatPrev: prev?.fat || 0,
          pct: pctChange(a.fat, prev?.fat || 0),
          pctVol: pctChange(a.vol, prev?.vol || 0)
        };
      });

  if (state.paradas && (state.sortLoja.key === "vol" || state.sortLoja.key === "pctVol" || state.sortLoja.key === "fat")) {
    state.sortLoja = { key: "fatPrev", dir: state.sortLoja.key === "fat" ? state.sortLoja.dir : "desc" };
  } else if (!state.paradas && state.sortLoja.key === "fatPrev") {
    state.sortLoja = { key: "fat", dir: state.sortLoja.dir };
  }

  const sortVal = (row, key) => {
    if (key === "name") return row.key;
    if (key === "lojas") return row.lojasN;
    if (key === "vol") return row.vol;
    if (key === "pct") return row.pct ?? -Infinity;
    if (key === "pctVol") return row.pctVol ?? -Infinity;
    if (key === "fatPrev") return row.fatPrev ?? 0;
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
  const lojaHead = document.querySelector("#lojaCard thead tr");
  if (lojaHead) {
    lojaHead.innerHTML = state.paradas
      ? `<th class="col-pos">#</th>
         <th><button type="button" data-sort-loja="name">Loja</button></th>
         <th>Grupo</th>
         <th class="col-vend">Vendedor</th>
         <th class="num"><button type="button" data-sort-loja="fat">Fat. ano atual</button></th>
         <th class="num"><button type="button" data-sort-loja="fatPrev">Fat. ano anterior</button></th>
         <th class="num"><button type="button" data-sort-loja="pct">Var. fat.</button></th>`
      : `<th class="col-pos">#</th>
         <th><button type="button" data-sort-loja="name">Loja</button></th>
         <th>Grupo</th>
         <th class="col-vend">Vendedor</th>
         <th class="num"><button type="button" data-sort-loja="fat">Faturamento</button></th>
         <th class="num"><button type="button" data-sort-loja="pct">Var. fat.</button></th>
         <th class="num"><button type="button" data-sort-loja="vol">Volume</button></th>
         <th class="num"><button type="button" data-sort-loja="pctVol">Var. vol.</button></th>`;
  }
  $("lojaCard")?.classList.toggle("is-paradas", state.paradas);
  const paradasLabel = lojas.length === 1
    ? "1 loja parada"
    : `${numFmt.format(lojas.length)} lojas paradas`;
  $("lojaCount").textContent = state.paradas
    ? `${paradasLabel} · ano atual × ano anterior${scope ? ` · ${scope}` : ""}`
    : scope
      ? `${numFmt.format(lojas.length)} lojas · ${scope}`
      : `${numFmt.format(lojas.length)} lojas no período`;
  const lojasShown = state.paradas ? lojas : lojas.slice(0, 50);
  state.menuOptions.pickGrupo = grupos.slice(0, 40).map((g) => g.key);
  state.menuOptions.pickLoja = lojasShown.map((l) => l.key);
  charts.grupoTips = grupos.slice(0, 40);
  $("grupoBody").innerHTML = charts.grupoTips.map((g, i) => `
    <tr data-pick-grupo="${i}" data-grupo-tip="${i}">
      <td class="col-pos">${i + 1}</td>
      <td><button type="button" class="linkish" data-pick-grupo="${i}">${esc(g.key)}</button></td>
      <td class="num">${numFmt.format(g.lojasN)}</td>
      <td class="num">${moneyFmt.format(g.fat)}</td>
      <td class="num ${g.pct != null && g.pct < 0 ? "is-neg" : "is-pos"}">${g.pct == null ? "—" : pctFmt.format(g.pct)}</td>
      <td class="num">${numFmt.format(g.vol)}</td>
      <td class="num ${g.pctVol != null && g.pctVol < 0 ? "is-neg" : "is-pos"}">${g.pctVol == null ? "—" : pctFmt.format(g.pctVol)}</td>
    </tr>`).join("") || `<tr><td colspan="7" class="empty-row">Nenhum grupo neste recorte.</td></tr>`;
  $("lojaBody").innerHTML = lojasShown.map((l, i) => {
    const focus = (state.drawerLoja === l.key || (state.filters.loja.size === 1 && state.filters.loja.has(l.key))) ? " is-focus" : "";
    return state.paradas
      ? `<tr class="${focus.trim()}" data-pick-loja="${i}">
      <td class="col-pos">${i + 1}</td>
      <td><button type="button" class="linkish" data-pick-loja="${i}">${esc(l.key)}</button></td>
      <td>${esc(l.grupo)}</td>
      <td class="col-vend">${esc(l.vend)}</td>
      <td class="num">${moneyFmt.format(l.fat)}</td>
      <td class="num">${moneyFmt.format(l.fatPrev)}</td>
      <td class="num ${l.pct != null && l.pct < 0 ? "is-neg" : "is-pos"}">${l.pct == null ? "—" : pctFmt.format(l.pct)}</td>
    </tr>`
      : `<tr class="${focus.trim()}" data-pick-loja="${i}">
      <td class="col-pos">${i + 1}</td>
      <td><button type="button" class="linkish" data-pick-loja="${i}">${esc(l.key)}</button></td>
      <td>${esc(l.grupo)}</td>
      <td class="col-vend">${esc(l.vend)}</td>
      <td class="num">${moneyFmt.format(l.fat)}</td>
      <td class="num ${l.pct != null && l.pct < 0 ? "is-neg" : "is-pos"}">${l.pct == null ? "—" : pctFmt.format(l.pct)}</td>
      <td class="num">${numFmt.format(l.vol)}</td>
      <td class="num ${l.pctVol != null && l.pctVol < 0 ? "is-neg" : "is-pos"}">${l.pctVol == null ? "—" : pctFmt.format(l.pctVol)}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="${state.paradas ? 7 : 8}" class="empty-row">${state.paradas ? "Nenhuma loja parada neste recorte." : "Nenhuma loja neste recorte."}</td></tr>`;
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

function hitsFilter(values, filter) {
  if (!filter || !filter.size) return true;
  for (const v of filter) if (values.has(v)) return true;
  return false;
}

function buildLookups(rows) {
  const books = new Map();
  const stores = new Map();
  for (const r of rows) {
    let book = books.get(r.sku);
    if (!book) {
      book = {
        sku: r.sku,
        desc: r.desc || "",
        descNorm: norm(r.desc || ""),
        cat: r.cat || "",
        digits: digitsOf(r.sku),
        lojas: new Set(),
        ids: new Set(),
        vends: new Set(),
        grupos: new Set(),
        ufs: new Set(),
        cats: new Set()
      };
      books.set(r.sku, book);
    } else if (!book.desc && r.desc) {
      book.desc = r.desc;
      book.descNorm = norm(r.desc);
    }
    book.lojas.add(r.loja);
    book.ids.add(storeId(r));
    book.vends.add(r.vend);
    book.grupos.add(r.grupo);
    book.ufs.add(r.uf);
    book.cats.add(r.cat);

    let store = stores.get(r.loja);
    if (!store) {
      const cnpjDigits = digitsOf(r.cnpj || r.loja);
      store = { id: storeId(r), loja: r.loja, grupo: r.grupo, vend: r.vend, cnpjDigits, lojaNorm: norm(r.loja), vends: new Set(), grupos: new Set(), ufs: new Set(), cats: new Set(), skus: new Set() };
      stores.set(r.loja, store);
    }
    store.vends.add(r.vend);
    store.grupos.add(r.grupo);
    store.ufs.add(r.uf);
    store.cats.add(r.cat);
    store.skus.add(r.sku);
    if (r.cnpj) store.cnpjDigits = digitsOf(r.cnpj);
  }
  state.books = [...books.values()];
  state.stores = [...stores.values()];
}

function storeInScope(store) {
  const f = state.filters;
  if (!hitsFilter(store.vends, f.vendedor)) return false;
  if (!hitsFilter(store.grupos, f.grupo)) return false;
  if (!hitsFilter(store.ufs, f.uf)) return false;
  if (!hitsFilter(store.cats, f.categoria)) return false;
  if (state.sku.size) {
    let ok = false;
    for (const sku of state.sku) {
      if (store.skus.has(sku)) { ok = true; break; }
    }
    if (!ok) return false;
  }
  if (state.novos && !state.newStoreIds.has(store.id)) return false;
  return true;
}

function bookInScope(book) {
  const f = state.filters;
  if (!hitsFilter(book.vends, f.vendedor)) return false;
  if (!hitsFilter(book.grupos, f.grupo)) return false;
  if (!hitsFilter(book.lojas, f.loja)) return false;
  if (!hitsFilter(book.ufs, f.uf)) return false;
  if (!hitsFilter(book.cats, f.categoria)) return false;
  if (state.novos) {
    let known = false;
    for (const id of book.ids) if (state.newStoreIds.has(id)) { known = true; break; }
    if (!known) return false;
  }
  return true;
}

function renderStoreSearch() {
  const box = $("searchHit");
  const input = $("q");
  const q = state.search.trim();
  if (!q || !state.meta) { box.hidden = true; box.innerHTML = ""; input.setAttribute("aria-expanded", "false"); return; }
  const nq = norm(q);
  const qDigits = digitsOf(q);
  const digitQuery = qDigits.length >= 4;
  const textQuery = /[a-z]/.test(nq);
  const hits = [];
  for (const store of state.stores) {
    if (!storeInScope(store)) continue;
    const nameHit = textQuery && store.lojaNorm.includes(nq);
    const cnpjHit = digitQuery && store.cnpjDigits.includes(qDigits);
    if (!nameHit && !cnpjHit) continue;
    const rank = cnpjHit && store.cnpjDigits === qDigits ? 0 : nameHit && store.lojaNorm.startsWith(nq) ? 1 : cnpjHit && store.cnpjDigits.startsWith(qDigits) ? 2 : 3;
    hits.push({ store, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || a.store.loja.localeCompare(b.store.loja, "pt-BR"));
  const top = hits.slice(0, 8).map((h) => h.store);
  box.hidden = false;
  input.setAttribute("aria-expanded", "true");
  state.menuOptions.searchLoja = top.map((r) => r.loja);
  box.innerHTML = top.length
    ? top.map((r, i) => `<button type="button" data-search-loja="${i}"><b>${esc(r.loja)}</b><small>${esc(r.grupo)} · ${esc(r.vend)}</small></button>`).join("")
    : `<p class="search-more">Nenhuma loja ou CNPJ para “${esc(q)}”.</p>`;
}

function renderIsbnSearch() {
  const box = $("isbnHit");
  const input = $("qIsbn");
  if (!box || !input) return;
  const q = state.isbnQuery.trim();
  const qDigits = digitsOf(q);
  if (!q || !state.meta) { box.hidden = true; box.innerHTML = ""; input.setAttribute("aria-expanded", "false"); return; }
  if (qDigits.length < 4) {
    box.hidden = false;
    input.setAttribute("aria-expanded", "true");
    state.menuOptions.searchIsbn = [];
    box.innerHTML = `<p class="search-more">Digite ao menos 4 números do ISBN.</p>`;
    return;
  }
  const hits = [];
  for (const book of state.books) {
    if (!book.digits.includes(qDigits) || !bookInScope(book)) continue;
    const exact = book.digits === qDigits ? 0 : book.digits.startsWith(qDigits) ? 1 : 2;
    hits.push({ book, exact });
  }
  hits.sort((a, b) => a.exact - b.exact || String(a.book.desc || "").localeCompare(String(b.book.desc || ""), "pt-BR"));
  const top = hits.slice(0, 8).map((h) => h.book);
  box.hidden = false;
  input.setAttribute("aria-expanded", "true");
  state.menuOptions.searchIsbn = top;
  const picked = state.sku.size;
  box.innerHTML = top.length
    ? `${top.map((r, i) => {
        const on = state.sku.has(r.sku);
        return `<button type="button" class="${on ? "is-on" : ""}" data-search-isbn="${i}" aria-pressed="${on}"><b>${esc(r.desc || "Sem título")}</b><small>ISBN ${esc(r.sku)}${r.cat ? ` · ${esc(r.cat)}` : ""}${on ? " · selecionado" : ""}</small></button>`;
      }).join("")}${picked ? `<p class="search-more">${picked === 1 ? "1 título selecionado" : `${picked} títulos selecionados`} · clique para marcar/desmarcar</p>` : `<p class="search-more">Clique para selecionar um ou mais ISBNs</p>`}`
    : `<p class="search-more">Nenhum ISBN para “${esc(q)}”.</p>`;
}

function renderTitleSearch() {
  const box = $("titleHit");
  const input = $("qTitle");
  if (!box || !input) return;
  const q = state.titleQuery.trim();
  if (!q || !state.meta) { box.hidden = true; box.innerHTML = ""; input.setAttribute("aria-expanded", "false"); return; }
  const nq = norm(q);
  if (nq.length < 2) {
    box.hidden = false;
    input.setAttribute("aria-expanded", "true");
    state.menuOptions.searchTitle = [];
    box.innerHTML = `<p class="search-more">Digite ao menos 2 letras do título.</p>`;
    return;
  }
  const hits = [];
  for (const book of state.books) {
    if (!book.descNorm || !bookInScope(book)) continue;
    if (!book.descNorm.includes(nq)) continue;
    const exact = book.descNorm === nq ? 0 : book.descNorm.startsWith(nq) ? 1 : 2;
    hits.push({ book, exact });
  }
  hits.sort((a, b) => a.exact - b.exact || String(a.book.desc || "").localeCompare(String(b.book.desc || ""), "pt-BR"));
  const top = hits.slice(0, 8).map((h) => h.book);
  box.hidden = false;
  input.setAttribute("aria-expanded", "true");
  state.menuOptions.searchTitle = top;
  const picked = state.sku.size;
  box.innerHTML = top.length
    ? `${top.map((r, i) => {
        const on = state.sku.has(r.sku);
        return `<button type="button" class="${on ? "is-on" : ""}" data-search-title="${i}" aria-pressed="${on}"><b>${esc(r.desc || "Sem título")}</b><small>ISBN ${esc(r.sku)}${r.cat ? ` · ${esc(r.cat)}` : ""}${on ? " · selecionado" : ""}</small></button>`;
      }).join("")}${picked ? `<p class="search-more">${picked === 1 ? "1 título selecionado" : `${picked} títulos selecionados`} · clique para marcar/desmarcar</p>` : `<p class="search-more">Clique para selecionar um ou mais títulos</p>`}`
    : `<p class="search-more">Nenhum título para “${esc(q)}”.</p>`;
}

function renderSearch() {
  renderStoreSearch();
  renderIsbnSearch();
  renderTitleSearch();
}

function toggleSku(book, { keepSearch = true, focusId = "" } = {}) {
  if (!book?.sku) return;
  if (state.sku.has(book.sku)) {
    state.sku.delete(book.sku);
    state.skuDesc.delete(book.sku);
  } else {
    state.sku.add(book.sku);
    state.skuDesc.set(book.sku, book.desc || "");
  }
  if (!keepSearch) {
    state.isbnQuery = "";
    state.titleQuery = "";
    if ($("qIsbn")) $("qIsbn").value = "";
    if ($("qTitle")) $("qTitle").value = "";
  }
  pruneIncompatibleFilters();
  renderAll();
  if (keepSearch && focusId) {
    const input = $(focusId);
    if (input) {
      input.focus();
      const val = input.value;
      input.setSelectionRange(val.length, val.length);
    }
  }
}

function applyIsbn(book, focusId = "") {
  toggleSku(book, { keepSearch: true, focusId });
}

function applyLoja(loja, openDrawer = true) {
  if (!loja) return;
  const active = state.filters.loja.size === 1 && state.filters.loja.has(loja);
  if (active) {
    state.filters.loja.clear();
    if (state.itemLoja === loja) state.itemLoja = "";
    state.drawerLoja = null;
  } else {
    state.filters.loja.clear();
    state.filters.loja.add(loja);
    state.itemLoja = loja;
    if (openDrawer) state.drawerLoja = loja;
  }
  state.search = "";
  $("q").value = "";
  pruneIncompatibleFilters();
  renderAll();
}

function closeLojaDrawer() {
  if (!state.drawerLoja) return;
  state.drawerLoja = null;
  renderAll();
}

function storeProfile(loja) {
  const rows = state.rows.filter((r) => r.loja === loja);
  if (!rows.length) return null;
  let best = rows[0];
  const cnpjCount = new Map();
  for (const r of rows) {
    if (r.key >= best.key) best = r;
    if (r.cnpj) cnpjCount.set(r.cnpj, (cnpjCount.get(r.cnpj) || 0) + 1);
  }
  let cnpj = best.cnpj || "";
  let cnpjN = 0;
  for (const [value, n] of cnpjCount) {
    if (n > cnpjN) { cnpj = value; cnpjN = n; }
  }
  return {
    loja: best.loja,
    grupo: best.grupo,
    vend: best.vend,
    uf: best.uf,
    cidade: best.cidade || "",
    cnpj
  };
}

function drawerScopedRows(loja) {
  return state.rows.filter((r) => {
    if (r.loja !== loja) return false;
    if (state.novos && !state.newStoreIds.has(storeId(r))) return false;
    if (state.sku.size && !state.sku.has(r.sku)) return false;
    for (const dim of DIMS) {
      if (dim.key === "loja") continue;
      const set = state.filters[dim.key];
      if (set.size && !set.has(r[dim.field])) return false;
    }
    return true;
  });
}

function monthSeriesFromRows(rows, year) {
  const series = Array(12).fill(0);
  const vols = Array(12).fill(0);
  for (const r of rows) {
    if (r.y !== year) continue;
    series[r.m] += r.fat;
    vols[r.m] += r.vol;
  }
  return { fat: series, vol: vols };
}

function drawerScopeNote() {
  const parts = [];
  if (state.sku.size === 1) {
    const sku = [...state.sku][0];
    parts.push(state.skuDesc.get(sku) || `ISBN ${sku}`);
  } else if (state.sku.size > 1) {
    parts.push(`${state.sku.size} títulos`);
  }
  for (const dim of DIMS) {
    if (dim.key === "loja") continue;
    const values = [...state.filters[dim.key]];
    if (!values.length) continue;
    parts.push(values.length === 1 ? `${dim.label}: ${values[0]}` : `${dim.label}: ${values.length}`);
  }
  if (state.novos) parts.push(`Novos desde ${monthKeyLabel(state.newSince)}`);
  if (!parts.length) return "Sell-out da loja no período.";
  if (state.sku.size) {
    const label = state.sku.size === 1 ? "Evolução do título nesta loja" : "Evolução dos títulos nesta loja";
    return `${label}${parts.length > 1 ? ` · ${parts.slice(1).join(" · ")}` : ""}.`;
  }
  return `Sell-out da loja no recorte · ${parts.join(" · ")}.`;
}

function renderDrawer() {
  const drawer = $("drawer");
  if (!drawer) return;
  if (document.body.dataset.view === "in" || !state.drawerLoja || !state.meta) {
    drawer.classList.remove("is-in");
    drawer.setAttribute("aria-hidden", "true");
    return;
  }
  const profile = storeProfile(state.drawerLoja);
  if (!profile) {
    state.drawerLoja = null;
    drawer.classList.remove("is-in");
    drawer.setAttribute("aria-hidden", "true");
    return;
  }
  const scoped = drawerScopedRows(profile.loja);
  const year = state.analysisYear;
  const prev = year - 1;
  const win = windowFor(year);
  const curSeries = monthSeriesFromRows(scoped, year);
  const prevSeries = monthSeriesFromRows(scoped, prev);
  let fat = 0, vol = 0, fatPrev = 0, volPrev = 0;
  for (let m = win.m0; m <= win.m1; m++) {
    fat += curSeries.fat[m] || 0;
    vol += curSeries.vol[m] || 0;
    fatPrev += prevSeries.fat[m] || 0;
    volPrev += prevSeries.vol[m] || 0;
  }
  const pct = pctChange(fat, fatPrev);
  const pctVol = pctChange(vol, volPrev);
  const revClass = pct == null ? "" : pct > 0.005 ? " is-up" : pct < -0.005 ? " is-down" : "";
  const max = Math.max(1, ...curSeries.fat, ...prevSeries.fat);
  const points = (arr, stroke) => {
    const cmds = arr.map((value, index) => {
      const x = (index / 11) * 360;
      const y = 68 - (Math.max(0, value) / max) * 60;
      return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");
    return `<path d="${cmds}" stroke="${stroke}"/>`;
  };
  const lastMonth = state.meta.lastMonth[year] ?? 11;
  const rows = MONTHS_SHORT.map((label, index) => {
    const a = curSeries.fat[index] || 0;
    const b = prevSeries.fat[index] || 0;
    const mPct = pctChange(a, b);
    const muted = index > lastMonth ? ` style="color:#b0b4be"` : "";
    return `<tr${muted}><td>${label}</td><td>${moneyFmt.format(b)}</td><td>${moneyFmt.format(a)}</td><td>${mPct == null ? "—" : pctFmt.format(mPct)}</td></tr>`;
  }).join("");
  const badges = [];
  if (pct != null && pct > 0.005) badges.push(`<span class="pill up">cresceu</span>`);
  else if (pct != null && pct < -0.005) badges.push(`<span class="pill down">caiu</span>`);
  else badges.push(`<span class="pill">estável</span>`);
  const tags = [profile.grupo, profile.vend, profile.uf, profile.cidade].filter(Boolean);
  let bookBlock = "";
  if (state.sku.size === 1) {
    const sku = [...state.sku][0];
    bookBlock = `<div class="book-callout">
        <span>Título filtrado</span>
        <b>${esc(state.skuDesc.get(sku) || "Sem título")}</b>
        <p>ISBN ${esc(sku)}</p>
      </div>`;
  } else if (state.sku.size > 1) {
    const list = [...state.sku].slice(0, 4).map((sku) => {
      const desc = state.skuDesc.get(sku) || "Sem título";
      return `<li><b>${esc(desc)}</b><small>ISBN ${esc(sku)}</small></li>`;
    }).join("");
    const more = state.sku.size > 4 ? `<p>+${state.sku.size - 4} títulos</p>` : "";
    bookBlock = `<div class="book-callout">
        <span>${state.sku.size} títulos filtrados</span>
        <ul class="book-list">${list}</ul>
        ${more}
      </div>`;
  }
  const fatLabel = state.sku.size
    ? `Faturamento do${state.sku.size > 1 ? "s títulos" : " título"} · ${periodRangeLabel(win)}`
    : `Faturamento · ${periodRangeLabel(win)}`;
  const volLabel = state.sku.size
    ? `Volume do${state.sku.size > 1 ? "s títulos" : " título"} · ${numFmt.format(vol)} un`
    : `Volume · ${numFmt.format(vol)} un`;
  $("drawerBody").innerHTML = `
    <div class="drawer-top">
      <h3>${esc(profile.loja)}</h3>
      <button type="button" class="x" id="closeDrawer" aria-label="Fechar">×</button>
    </div>
    <div class="meta-grid">
      ${tags.map((t) => `<span>${esc(t)}</span>`).join("")}
      <span class="cnpj">CNPJ ${esc(formatCnpj(profile.cnpj))}</span>
    </div>
    ${bookBlock}
    <div class="rev-callout${revClass}">
      <span>${esc(fatLabel)}</span>
      <b>${moneyFmtDec.format(fat)}</b>
      <p>${prev}: ${moneyFmtDec.format(fatPrev)} · ${pct == null ? "—" : pctFmt.format(pct)}</p>
    </div>
    <div class="vol-callout">
      <span>${esc(volLabel)}</span>
      <p>${prev}: ${numFmt.format(volPrev)} un · ${pctVol == null ? "—" : pctFmt.format(pctVol)}</p>
    </div>
    <div class="badges">${badges.join("")}</div>
    <svg class="spark" viewBox="0 0 360 72" aria-hidden="true">${points(prevSeries.fat, "#7d92ab")}${points(curSeries.fat, "#b5191a")}</svg>
    <table class="month-table">
      <thead><tr><th>Mês</th><th>${prev}</th><th>${year}</th><th>Var.</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="cmeta" style="margin-top:10px">${esc(drawerScopeNote())}</p>`;
  drawer.classList.add("is-in");
  drawer.setAttribute("aria-hidden", "false");
}

function renderAll() {
  if (!state.meta) return;
  pruneIncompatibleFilters();
  const base = filteredRows();
  const win = windowFor(state.analysisYear);
  const prevWin = { ...win, y: state.analysisYear - 1 };
  const curRows = base.filter((r) => inWindow(r, win));
  const prevRows = base.filter((r) => inWindow(r, prevWin));
  const stopped = stoppedStores(curRows, prevRows);
  if (state.paradas && !stopped.n) state.paradas = false;
  const novosBase = filteredRows("novos").filter((r) => inWindow(r, win));
  const novos = newStoresInPeriod(novosBase);
  if (state.novos && !novos.n) state.novos = false;

  if (document.body.dataset.view !== "in") {
    $("sideBase").textContent = `${state.fileName || "Base"} · por mês`;
  }
  renderYearSwitch();
  renderFilterBar();
  renderChips();
  renderSideFilters();
  renderKpis(curRows, prevRows, stopped, novos);
  renderTrend(base);
  renderDonut(curRows);
  renderUfMap(curRows, prevRows);
  renderItems(curRows);
  renderRankings(curRows, prevRows, stopped);
  renderDrawer();
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
    buildLookups(state.rows);
    buildNewStores(state.rows, parsed.meta.maxKey);
    state.analysisYear = parsed.analysisYear;
    state.fileName = fileName || "sell-out.csv";
    state.menuOptions = {};
    state.filters = { vendedor: new Set(), grupo: new Set(), loja: new Set(), uf: new Set(), categoria: new Set() };
    state.periodMonth = null;
    state.sku = new Set();
    state.skuDesc = new Map();
    state.novos = false;
    state.paradas = false;
    state.isbnQuery = "";
    state.titleQuery = "";
    state.itemGrupo = "";
    state.itemLoja = "";
    state.itemCategoria = "";
    state.drawerLoja = null;
    $("empty").hidden = true;
    $("dash").hidden = false;
    $("q").disabled = false;
    $("qIsbn").disabled = false;
    $("qIsbn").value = "";
    if ($("qTitle")) {
      $("qTitle").disabled = false;
      $("qTitle").value = "";
    }
    $("fileLabel").textContent = "Trocar CSV";
    $("fileMeta").textContent = state.fileName;
    $("error").hidden = true;
    if (typeof showDashView === "function") showDashView("out", true);
    renderAll();
  } catch (err) {
    $("error").hidden = false;
    $("error").textContent = err.message || "Não foi possível ler o arquivo.";
  } finally {
    $("loading").hidden = true;
  }
}

function logSellerAccess(vendedor) {
  if (!ACCESS_LOG_URL || !vendedor) return;
  const url = `${ACCESS_LOG_URL}${ACCESS_LOG_URL.includes("?") ? "&" : "?"}vendedor=${encodeURIComponent(vendedor)}&t=${Date.now()}`;
  try {
    const img = new Image();
    img.src = url;
  } catch (err) {
    // ignore
  }
  fetch(url, { method: "GET", mode: "no-cors", keepalive: true }).catch(() => {});
}

function renderSellerGateOptions() {
  const list = $("sellerGateList");
  if (!list) return;
  list.innerHTML = SELLERS.map((name) => `
    <button type="button" class="seller-gate-option${state.sellerPick === name ? " is-selected" : ""}" data-seller="${esc(name)}" role="option" aria-selected="${state.sellerPick === name ? "true" : "false"}">${esc(name)}</button>
  `).join("");
  const btn = $("btnSellerContinue");
  if (btn) btn.disabled = !state.sellerPick;
}

function showSellerGate() {
  state.sellerPick = SELLERS.includes(state.seller) ? state.seller : "";
  $("sellerGate").hidden = false;
  $("appShell").hidden = true;
  renderSellerGateOptions();
}

function enterApp(vendedor, log) {
  if (!SELLERS.includes(vendedor)) return;
  state.seller = vendedor;
  state.sellerPick = vendedor;
  try {
    sessionStorage.setItem(SELLER_STORAGE_KEY, vendedor);
  } catch (err) {
    // ignore storage errors
  }
  $("sellerNameLabel").textContent = vendedor;
  $("sellerGate").hidden = true;
  $("appShell").hidden = false;
  if (log) logSellerAccess(vendedor);
}

function initSellerGate() {
  let saved = "";
  try {
    saved = sessionStorage.getItem(SELLER_STORAGE_KEY) || "";
  } catch (err) {
    saved = "";
  }
  $("sellerGateList").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-seller]");
    if (!btn) return;
    state.sellerPick = btn.getAttribute("data-seller") || "";
    renderSellerGateOptions();
  });
  $("btnSellerContinue").addEventListener("click", () => {
    if (!state.sellerPick) return;
    enterApp(state.sellerPick, true);
  });
  $("btnChangeSeller").addEventListener("click", () => showSellerGate());
  if (saved && SELLERS.includes(saved)) enterApp(saved, false);
  else showSellerGate();
}

function readFile(file) {
  if (!state.seller) return;
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
  if (dim === "loja" && !on) {
    if (state.itemLoja === value) state.itemLoja = "";
    if (state.drawerLoja === value) state.drawerLoja = null;
  }
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
  state.drawerLoja = null;
  state.search = "";
  state.isbnQuery = "";
  state.titleQuery = "";
  state.sku = new Set();
  state.skuDesc = new Map();
  state.novos = false;
  state.paradas = false;
  $("q").value = "";
  $("qIsbn").value = "";
  if ($("qTitle")) $("qTitle").value = "";
  renderAll();
}

function wire() {
  initSellerGate();
  $("btnFile").addEventListener("click", () => {
    const input = document.body.dataset.view === "in" ? $("fileIn") : $("file");
    input?.click();
  });
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
      if (typeof showDashView === "function") showDashView("out", true);
      document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("is-active", b === goto));
      const target = $(goto.getAttribute("data-goto"));
      requestAnimationFrame(() => target?.scrollIntoView({ behavior: "smooth", block: "start" }));
      return;
    }

    const stoppedBtn = t.closest("#kpiStoppedCard");
    if (stoppedBtn) {
      if (stoppedBtn.getAttribute("aria-disabled") === "true") return;
      state.paradas = !state.paradas;
      if (state.paradas) state.novos = false;
      renderAll();
      if (state.paradas) $("lojaCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const novosCard = t.closest("#kpiNovosCard");
    if (novosCard) {
      if (novosCard.getAttribute("aria-disabled") === "true") return;
      state.novos = !state.novos;
      if (state.novos) state.paradas = false;
      pruneIncompatibleFilters();
      renderAll();
      if (state.novos) $("lojaCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
      const key = sideClearDim.getAttribute("data-side-clear-dim");
      if (document.body.dataset.view === "in") {
        if (typeof postSellInClear === "function") postSellInClear(key);
        return;
      }
      clearDimFilter(key);
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
      if (l) applyLoja(l, true);
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

    const searchIsbn = t.closest("[data-search-isbn]");
    if (searchIsbn) {
      e.preventDefault();
      applyIsbn(state.menuOptions.searchIsbn?.[Number(searchIsbn.getAttribute("data-search-isbn"))], "qIsbn");
      return;
    }

    const searchTitle = t.closest("[data-search-title]");
    if (searchTitle) {
      e.preventDefault();
      applyIsbn(state.menuOptions.searchTitle?.[Number(searchTitle.getAttribute("data-search-title"))], "qTitle");
      return;
    }

    const searchLoja = t.closest("[data-search-loja]");
    if (searchLoja) {
      applyLoja(state.menuOptions.searchLoja?.[Number(searchLoja.getAttribute("data-search-loja"))]);
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
  $("btnSideClear").addEventListener("click", () => {
    if (document.body.dataset.view === "in") {
      if (typeof postSellInClear === "function") postSellInClear();
      return;
    }
    clearFilters();
  });
  $("btnSideClearAll")?.addEventListener("click", () => {
    if (document.body.dataset.view === "in") {
      if (typeof postSellInClear === "function") postSellInClear();
      return;
    }
    clearFilters();
  });

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
    renderStoreSearch();
  });
  $("q").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      state.search = "";
      $("q").value = "";
      renderStoreSearch();
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    applyLoja(state.menuOptions.searchLoja?.[0]);
  });
  $("qIsbn").addEventListener("input", (e) => {
    state.isbnQuery = e.target.value;
    renderIsbnSearch();
  });
  $("qIsbn").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      state.isbnQuery = "";
      $("qIsbn").value = "";
      renderIsbnSearch();
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    applyIsbn(state.menuOptions.searchIsbn?.[0], "qIsbn");
  });
  $("qTitle")?.addEventListener("input", (e) => {
    state.titleQuery = e.target.value;
    renderTitleSearch();
  });
  $("qTitle")?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      state.titleQuery = "";
      $("qTitle").value = "";
      renderTitleSearch();
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    applyIsbn(state.menuOptions.searchTitle?.[0], "qTitle");
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

  $("drawer")?.addEventListener("click", (e) => {
    if (e.target.closest("#closeDrawer")) closeLojaDrawer();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (state.openMenu) {
      state.openMenu = null;
      renderFilterBar();
      return;
    }
    if (state.drawerLoja) closeLojaDrawer();
  });

  window.addEventListener("resize", () => {
    if (state.meta) renderAll();
  });
}

wire();
