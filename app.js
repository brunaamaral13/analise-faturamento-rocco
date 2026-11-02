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
const DEFAULT_CSV = "SELL-OUT ACUMULADO ROCCO.csv";

const state = {
  rows: [],
  meta: null,
  fileName: "",
  filters: { vendedor: new Set(), grupo: new Set(), loja: new Set(), uf: new Set(), categoria: new Set() },
  analysisYear: null,
  periodMonth: null,
  donutDim: "grupo",
  search: "",
  openMenu: null,
  options: null,
  itemGrupo: "",
  itemLoja: "",
  itemMetric: "fat",
  sortGrupo: { key: "fat", dir: "desc" },
  sortLoja: { key: "fat", dir: "desc" }
};

const charts = { colorOf: new Map() };
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

function buildOptions(rows) {
  const opts = {};
  for (const dim of DIMS) {
    const map = new Map();
    for (const r of rows) {
      const v = r[dim.field];
      map.set(v, (map.get(v) || 0) + r.fat);
    }
    opts[dim.key] = [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
  }
  return opts;
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
    if (values.length) groups.push({ label: dim.label, values });
  }
  if (state.periodMonth != null) groups.push({ label: "Mês", values: [MONTHS[state.periodMonth]] });
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

function topItems(rows, limit = 30) {
  const map = new Map();
  for (const r of rows) {
    const cur = map.get(r.sku) || { sku: r.sku, desc: r.desc, cat: r.cat, fat: 0, vol: 0 };
    cur.fat += r.fat;
    cur.vol += r.vol;
    if (!cur.desc && r.desc) cur.desc = r.desc;
    if (!cur.cat && r.cat) cur.cat = r.cat;
    map.set(r.sku, cur);
  }
  const metric = state.itemMetric === "vol" ? "vol" : "fat";
  return [...map.values()].sort((a, b) => b[metric] - a[metric] || a.desc.localeCompare(b.desc, "pt-BR")).slice(0, limit);
}

function colorOf(key) {
  if (!charts.colorOf.has(key)) charts.colorOf.set(key, SLICE_COLORS[charts.colorOf.size % SLICE_COLORS.length]);
  return charts.colorOf.get(key);
}

function renderSideFilters() {
  const box = $("sideFilters");
  const list = $("sideFilterList");
  if (!state.meta) {
    box.hidden = true;
    return;
  }
  const groups = activeFilterGroups();
  box.hidden = false;
  if (!groups.length) {
    list.innerHTML = `<li class="is-empty">Nenhum recorte ativo</li>`;
    return;
  }
  list.innerHTML = groups.map((g) => `<li><b>${esc(g.label)}:</b> ${esc(g.values.join(", "))}</li>`).join("");
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
  bar.innerHTML = DIMS.map((dim) => {
    const set = state.filters[dim.key];
    const label = set.size === 0 ? "Todos" : set.size === 1 ? [...set][0] : `${set.size} selecionados`;
    const open = state.openMenu === dim.key;
    const opts = (state.options?.[dim.key] || []).slice(0, 80);
    return `
      <div class="menu ${open ? "is-on" : ""}" data-menu="${dim.key}">
        <button type="button" class="menu-btn" data-open="${dim.key}">
          <span class="menu-k">${esc(dim.label)}</span>
          <span class="menu-v" title="${esc(label)}">${esc(label)}</span>
        </button>
        <div class="menu-panel" ${open ? "" : "hidden"}>
          <div class="menu-actions">
            <button type="button" data-clear-dim="${dim.key}">Limpar</button>
          </div>
          <div class="menu-list">
            ${opts.map(([value, fat]) => {
              const on = set.has(value);
              return `<label class="menu-item"><input type="checkbox" data-dim="${dim.key}" value="${esc(value)}" ${on ? "checked" : ""}><span title="${esc(value)}">${esc(value)}</span><small>${moneyFmt.format(fat)}</small></label>`;
            }).join("")}
          </div>
        </div>
      </div>`;
  }).join("");
  $("btnClear").hidden = !hasActiveFilters();
}

function renderChips() {
  const el = $("chips");
  const groups = activeFilterGroups();
  if (!groups.length) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.innerHTML = groups.flatMap((g) =>
    g.values.map((v) => `<button type="button" class="chip" data-chip-dim="${esc(g.label)}" data-chip-val="${esc(v)}">${esc(g.label)}: ${esc(v)} <span aria-hidden="true">×</span></button>`)
  ).join("");
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
  const pad = { t: 18, r: 16, b: 36, l: 54 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const max = Math.max(...series.flatMap((s) => s.values), 1);
  ctx.strokeStyle = "#e6e8f0";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (plotH * i) / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
  }
  series.forEach((s) => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.emphasis ? 2.8 : 1.6;
    ctx.globalAlpha = s.emphasis ? 1 : 0.55;
    ctx.beginPath();
    s.values.forEach((v, i) => {
      const x = pad.l + (plotW * i) / Math.max(s.values.length - 1, 1);
      const y = pad.t + plotH - (v / max) * plotH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    if (s.emphasis) {
      s.values.forEach((v, i) => {
        const x = pad.l + (plotW * i) / Math.max(s.values.length - 1, 1);
        const y = pad.t + plotH - (v / max) * plotH;
        const selected = state.periodMonth === i;
        ctx.fillStyle = selected ? "#1c2230" : s.color;
        ctx.beginPath(); ctx.arc(x, y, selected ? 5 : 3.2, 0, Math.PI * 2); ctx.fill();
      });
    }
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#667085";
  ctx.font = "12px Outfit, sans-serif";
  ctx.textAlign = "center";
  MONTHS_SHORT.forEach((m, i) => {
    const x = pad.l + (plotW * i) / 11;
    ctx.fillText(m, x, h - 12);
  });
  canvas._trendHit = { pad, plotW, plotH, n: 12 };
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
  for (const s of slices) {
    const ang = total ? (s.value / total) * Math.PI * 2 : 0;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * ri, cy + Math.sin(a) * ri);
    ctx.arc(cx, cy, r, a, a + ang);
    ctx.arc(cx, cy, ri, a + ang, a, true);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    a += ang;
  }
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
    const values = Array(12).fill(0);
    for (const r of rows) if (r.y === y) values[r.m] += r.fat;
    return { year: y, color: y === state.analysisYear ? "#b5191a" : "#9aa3b5", values, emphasis: y === state.analysisYear };
  });
  drawTrend($("trend"), series);
  $("chartSub").textContent = `Comparativo ${years.join(" · ")}`;
  $("chartSummary").textContent = `Evolução mensal de faturamento para ${years.join(", ")}.`;
}

function renderDonut(rows) {
  const field = DIMS.find((d) => d.key === state.donutDim)?.field || "grupo";
  const agg = aggregateBy(rows, field).sort((a, b) => b.fat - a.fat);
  const total = agg.reduce((s, a) => s + a.fat, 0) || 1;
  const head = agg.slice(0, 8);
  const rest = agg.slice(8).reduce((s, a) => s + a.fat, 0);
  const slices = head.map((a) => ({ key: a.key, value: a.fat, color: colorOf(a.key) }));
  if (rest > 0) slices.push({ key: "Outros", value: rest, color: "#c5cad6" });
  drawDonut($("donut"), slices, total);
  $("donutTotal").textContent = moneyFmt.format(total);
  $("donutCaption").textContent = DIMS.find((d) => d.key === state.donutDim)?.label || "";
  $("donutLegend").innerHTML = slices.map((s) =>
    `<button type="button" class="slice" data-slice-dim="${state.donutDim}" data-slice-val="${esc(s.key)}" ${s.key === "Outros" ? "disabled" : ""}>
      <i style="background:${s.color}"></i>
      <span>${esc(s.key)}</span>
      <b>${((s.value / total) * 100).toFixed(1)}%</b>
    </button>`
  ).join("");
}

function fillItemFilters(baseRows) {
  const grupos = [...new Set(baseRows.map((r) => r.grupo))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const lojas = [...new Set(
    baseRows
      .filter((r) => !state.itemGrupo || r.grupo === state.itemGrupo)
      .map((r) => r.loja)
  )].sort((a, b) => a.localeCompare(b, "pt-BR"));

  const gSel = $("itemGrupo");
  const lSel = $("itemLoja");
  const gVal = state.itemGrupo;
  const lVal = state.itemLoja;
  gSel.innerHTML = `<option value="">Todos os grupos</option>` + grupos.map((g) => `<option value="${esc(g)}" ${g === gVal ? "selected" : ""}>${esc(g)}</option>`).join("");
  lSel.innerHTML = `<option value="">Todas as lojas</option>` + lojas.map((l) => `<option value="${esc(l)}" ${l === lVal ? "selected" : ""}>${esc(l)}</option>`).join("");
  if (lVal && !lojas.includes(lVal)) {
    state.itemLoja = "";
    lSel.value = "";
  }
}

function renderItems(baseRows) {
  fillItemFilters(baseRows);
  let rows = baseRows;
  if (state.itemGrupo) rows = rows.filter((r) => r.grupo === state.itemGrupo);
  if (state.itemLoja) rows = rows.filter((r) => r.loja === state.itemLoja);
  const items = topItems(rows, 40);
  const total = items.reduce((s, i) => s + i.fat, 0) || 1;
  const scope = [state.itemGrupo, state.itemLoja].filter(Boolean).join(" · ") || "recorte geral";
  $("itemsSub").textContent = `Top títulos por ${state.itemMetric === "vol" ? "volume" : "faturamento"} · ${scope}`;
  $("itemsBody").innerHTML = items.length
    ? items.map((it, i) => `
      <tr>
        <td class="col-pos">${i + 1}</td>
        <td class="mono">${esc(it.sku)}</td>
        <td><b>${esc(it.desc || "—")}</b></td>
        <td>${esc(it.cat || "—")}</td>
        <td class="num">${numFmt.format(it.vol)}</td>
        <td class="num">${moneyFmt.format(it.fat)}</td>
        <td class="num">${((it.fat / total) * 100).toFixed(1)}%</td>
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

  $("grupoCount").textContent = `${numFmt.format(grupos.length)} grupos no período`;
  $("lojaCount").textContent = `${numFmt.format(lojas.length)} lojas no período`;
  $("grupoBody").innerHTML = grupos.slice(0, 40).map((g, i) => `
    <tr data-pick-grupo="${esc(g.key)}">
      <td class="col-pos">${i + 1}</td>
      <td><button type="button" class="linkish" data-pick-grupo="${esc(g.key)}">${esc(g.key)}</button></td>
      <td class="num">${numFmt.format(g.lojasN)}</td>
      <td class="num">${moneyFmt.format(g.fat)}</td>
      <td class="num ${g.pct != null && g.pct < 0 ? "is-neg" : "is-pos"}">${g.pct == null ? "—" : pctFmt.format(g.pct)}</td>
    </tr>`).join("");
  $("lojaBody").innerHTML = lojas.slice(0, 50).map((l, i) => `
    <tr>
      <td class="col-pos">${i + 1}</td>
      <td><button type="button" class="linkish" data-pick-loja="${esc(l.key)}">${esc(l.key)}</button></td>
      <td>${esc(l.grupo)}</td>
      <td class="col-vend">${esc(l.vend)}</td>
      <td class="num">${moneyFmt.format(l.fat)}</td>
      <td class="num ${l.pct != null && l.pct < 0 ? "is-neg" : "is-pos"}">${l.pct == null ? "—" : pctFmt.format(l.pct)}</td>
    </tr>`).join("");
}

function renderSearch() {
  const box = $("searchHit");
  const q = state.search.trim();
  if (!q || !state.meta) { box.hidden = true; box.innerHTML = ""; $("q").setAttribute("aria-expanded", "false"); return; }
  const nq = norm(q);
  const hits = [];
  const seen = new Set();
  for (const r of state.rows) {
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
  box.innerHTML = hits.length
    ? hits.map((r) => `<button type="button" data-search-loja="${esc(r.loja)}"><b>${esc(r.loja)}</b><small>${esc(r.grupo)} · ${esc(r.vend)}</small></button>`).join("")
    : `<p class="search-more">Nenhum resultado para “${esc(q)}”.</p>`;
}

function renderAll() {
  if (!state.meta) return;
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
    state.options = buildOptions(parsed.rows);
    state.filters = { vendedor: new Set(), grupo: new Set(), loja: new Set(), uf: new Set(), categoria: new Set() };
    state.periodMonth = null;
    state.itemGrupo = "";
    state.itemLoja = "";
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
  const set = state.filters[dim];
  if (on) set.add(value); else set.delete(value);
  state.openMenu = null;
  renderAll();
}

function clearFilters() {
  for (const dim of DIMS) state.filters[dim.key].clear();
  state.periodMonth = null;
  state.itemGrupo = "";
  state.itemLoja = "";
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
      state.filters[clearDim.getAttribute("data-clear-dim")].clear();
      renderAll();
      return;
    }

    if (t.matches('input[type="checkbox"][data-dim]')) {
      toggleFilter(t.getAttribute("data-dim"), t.value, t.checked);
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
      const val = slice.getAttribute("data-slice-val");
      if (dim && val && state.filters[dim]) {
        state.filters[dim].clear();
        state.filters[dim].add(val);
        renderAll();
      }
      return;
    }

    const metric = t.closest("#itemMetric [data-metric]");
    if (metric) {
      state.itemMetric = metric.getAttribute("data-metric");
      document.querySelectorAll("#itemMetric [data-metric]").forEach((b) => b.setAttribute("aria-pressed", String(b === metric)));
      renderAll();
      return;
    }

    const pickGrupo = t.closest("[data-pick-grupo]");
    if (pickGrupo) {
      const g = pickGrupo.getAttribute("data-pick-grupo");
      state.filters.grupo.clear();
      state.filters.grupo.add(g);
      state.itemGrupo = g;
      state.itemLoja = "";
      renderAll();
      $("sec-itens").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const pickLoja = t.closest("[data-pick-loja]");
    if (pickLoja) {
      const l = pickLoja.getAttribute("data-pick-loja");
      state.filters.loja.clear();
      state.filters.loja.add(l);
      state.itemLoja = l;
      renderAll();
      $("sec-itens").scrollIntoView({ behavior: "smooth", block: "start" });
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
      const l = searchLoja.getAttribute("data-search-loja");
      state.filters.loja.clear();
      state.filters.loja.add(l);
      state.itemLoja = l;
      state.search = "";
      $("q").value = "";
      renderAll();
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
  $("itemGrupo").addEventListener("change", (e) => {
    state.itemGrupo = e.target.value;
    state.itemLoja = "";
    renderAll();
  });
  $("itemLoja").addEventListener("change", (e) => {
    state.itemLoja = e.target.value;
    renderAll();
  });
  $("q").addEventListener("input", (e) => {
    state.search = e.target.value;
    renderSearch();
  });

  $("trend").addEventListener("click", (e) => {
    const hit = $("trend")._trendHit;
    if (!hit || !state.meta) return;
    const rect = $("trend").getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < hit.pad.l || x > hit.pad.l + hit.plotW) return;
    const i = Math.round(((x - hit.pad.l) / hit.plotW) * 11);
    state.periodMonth = state.periodMonth === i ? null : i;
    renderAll();
  });

  window.addEventListener("resize", () => {
    if (state.meta) renderAll();
  });
}

async function tryAutoload() {
  try {
    const res = await fetch(DEFAULT_CSV);
    if (!res.ok) return;
    $("loading").hidden = false;
    $("loadingText").textContent = "Carregando base local…";
    const buf = await res.arrayBuffer();
    const text = new TextDecoder("windows-1252").decode(buf);
    await ingestText(text, DEFAULT_CSV);
  } catch {
    /* file picker fallback */
  }
}

wire();
tryAutoload();
