// app.js — 화면·갤러리·평행좌표·필터·내보내기 (엔진은 engine.js, 데이터는 data.js)
// v0.3.1: 평행좌표 브러시 필터 · 파레토 표시 · CSV/JSON/PNG 내보내기 · 퍼머링크 · 범례/스케일바/북
"use strict";

const $ = (id) => document.getElementById(id);
const DEFAULT_SEEDS = [59, 59, 45, 0, 0, 0, 0, 0, 0, 0, 0]; // dyn 저장 당시 슬라이더 값
const state = {
  seeds: DEFAULT_SEEDS.slice(),
  result: null,
  gallery: [],   // {id, seeds, result, pareto}
  selected: -1,
  sortKey: "cost",
  view: null,    // null = 자동 Fit / {scale, tx, ty} = 사용자 줌·팬 상태 (장치px 기준)
  brushes: {},   // axisKey -> {lo, hi} (축 값 도메인)
  paretoOnly: false,
  showLegend: true,
};

function opts() {
  return {
    gridN: parseInt($("gridN").value, 10),
    clearance: parseFloat($("clearance").value) * 1000,
    costRate: parseFloat($("costRate").value),
  };
}

// ---------- 좌표 변환 ----------
function makeView(canvas, boundary, pad) {
  const xs = boundary.map((p) => p[0]), ys = boundary.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const s = Math.min((canvas.width - 2 * pad) / (maxX - minX), (canvas.height - 2 * pad) / (maxY - minY));
  return {
    x: (wx) => pad + (wx - minX) * s,
    y: (wy) => canvas.height - pad - (wy - minY) * s, // Y 위가 북쪽
    s,
  };
}

// ---------- 메인 캔버스: Fit + 줌·팬 ----------
// Fit = 대지경계 ∪ 배치 박스 ∪ 출입을 화면에 맞추는 변환 계산 (장치px 기준)
function computeFit(canvas) {
  const pts = SITE_DATA.boundary.slice();
  SITE_DATA.entries.forEach((e) => pts.push([e.cx - e.r, e.cy - e.r], [e.cx + e.r, e.cy + e.r]));
  if (state.result) {
    state.result.placed.forEach((p) =>
      pts.push([p.cx - p.w / 2, p.cy - p.h / 2], [p.cx + p.w / 2, p.cy + p.h / 2]));
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const dpr = window.devicePixelRatio || 1;
  const pad = 30 * dpr;
  const dx = maxX - minX || 1, dy = maxY - minY || 1;
  const scale = Math.min((canvas.width - 2 * pad) / dx, (canvas.height - 2 * pad) / dy);
  // 변환: sx = tx + wx*scale · sy = ty - wy*scale (y 위가 북쪽)
  return {
    scale,
    tx: (canvas.width - dx * scale) / 2 - minX * scale,
    ty: (canvas.height - dy * scale) / 2 + maxY * scale,
  };
}

function mainView(canvas) {
  if (!state.view) state.view = computeFit(canvas);
  const v = state.view;
  return { x: (wx) => v.tx + wx * v.scale, y: (wy) => v.ty - wy * v.scale, s: v.scale };
}

// 스케일바: 화면상 60~160 장치px에 들어오는 1·2·5 계열 길이(m)를 고른다
function niceScaleLength(scale, dpr) {
  const targetPx = 110 * dpr;
  const raw = targetPx / scale / 1000;            // m
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) {
    if (raw <= m * exp) return m * exp;
  }
  return 10 * exp;
}

function drawScaleBar(ctx, canvas, v, dpr) {
  const lenM = niceScaleLength(v.s, dpr);
  const px = lenM * 1000 * v.s;
  const x0 = 16 * dpr, y0 = canvas.height - 18 * dpr;
  ctx.strokeStyle = "#333"; ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.moveTo(x0, y0 - 5 * dpr); ctx.lineTo(x0, y0); ctx.lineTo(x0 + px, y0); ctx.lineTo(x0 + px, y0 - 5 * dpr);
  ctx.stroke();
  ctx.fillStyle = "#333"; ctx.font = `${11 * dpr}px sans-serif`; ctx.textAlign = "center";
  ctx.fillText(`${lenM.toLocaleString()} m`, x0 + px / 2, y0 - 8 * dpr);
  ctx.textAlign = "start";
}

function drawNorth(ctx, canvas, dpr) {
  // 좌상단은 캔버스가 낮을 때 범례가 올라와 덮고, 우상단 맨 위는 범례/Fit 버튼이 덮는다
  // (둘 다 헤드리스 캡처에서 실제로 확인) → 우상단 '툴바 아래'로 내린다
  const x = canvas.width - 26 * dpr, y = 56 * dpr, r = 12 * dpr;
  ctx.strokeStyle = "#333"; ctx.fillStyle = "#333"; ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x - r * 0.45, y + r * 0.6); ctx.lineTo(x, y + r * 0.25);
  ctx.lineTo(x + r * 0.45, y + r * 0.6); ctx.closePath(); ctx.fill();
  ctx.font = `bold ${10 * dpr}px sans-serif`; ctx.textAlign = "center";
  ctx.fillText("N", x, y + r + 10 * dpr);
  ctx.textAlign = "start";
}

// 범례는 좌하단에 붙지만, 캔버스가 낮으면 위로 넘쳐 헤더까지 밀고 올라간다(v0.3.1 수정).
// 순서: 보통 크기 → 안 들어가면 축약(글자·행간 축소) → 그래도 안 들어가면 그리지 않는다.
// 반환값 = 실제로 그렸는지 (북 화살표 배치가 이걸 본다)
function drawLegend(ctx, canvas, dpr) {
  const rows = SITE_DATA.placeOrder.map((i) => SITE_DATA.boxes[i]);
  const avail = canvas.height - 46 * dpr;              // 스케일바(하단)와 여백을 뺀 높이
  let fs = 10.5, lh0 = 14, padY0 = 7;
  let h = rows.length * lh0 * dpr + padY0 * 2 * dpr;
  if (h > avail) { fs = 9; lh0 = 11.5; padY0 = 5; h = rows.length * lh0 * dpr + padY0 * 2 * dpr; }
  if (h > avail) return false;                          // 축약해도 안 들어가면 포기 (겹치는 것보다 낫다)
  const lh = lh0 * dpr, padX = 8 * dpr, padY = padY0 * dpr;
  ctx.font = `${fs * dpr}px sans-serif`;
  const w = Math.max(...rows.map((b) => ctx.measureText(`[${b.label}] ${b.name}`).width)) + 22 * dpr + padX * 2;
  const x0 = 16 * dpr, y0 = canvas.height - 34 * dpr - h;
  ctx.fillStyle = "rgba(255,255,255,0.88)"; ctx.strokeStyle = "#c8d0c8"; ctx.lineWidth = 1 * dpr;
  ctx.fillRect(x0, y0, w, h); ctx.strokeRect(x0, y0, w, h);
  rows.forEach((b, i) => {
    const y = y0 + padY + i * lh;
    ctx.fillStyle = b.color; ctx.fillRect(x0 + padX, y + 2 * dpr, 9 * dpr, 9 * dpr);
    ctx.strokeStyle = "#0004"; ctx.strokeRect(x0 + padX, y + 2 * dpr, 9 * dpr, 9 * dpr);
    ctx.fillStyle = "#222"; ctx.textBaseline = "top";
    ctx.fillText(`[${b.label}] ${b.name}`, x0 + padX + 14 * dpr, y + 1 * dpr);
  });
  ctx.textBaseline = "alphabetic";
  return true;
}

function drawMain() {
  const canvas = $("plan");
  const wrap = $("planWrap");
  const dpr = window.devicePixelRatio || 1;
  const cssW = wrap.clientWidth, cssH = wrap.clientHeight;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // PNG 내보내기에서 배경이 투명해지지 않도록 흰 배경을 깐다
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const v = mainView(canvas);
  const r = state.result;

  // 대지경계
  ctx.beginPath();
  SITE_DATA.boundary.forEach((p, i) => (i ? ctx.lineTo(v.x(p[0]), v.y(p[1])) : ctx.moveTo(v.x(p[0]), v.y(p[1]))));
  ctx.closePath();
  ctx.fillStyle = "#f4f7f4"; ctx.fill();
  ctx.strokeStyle = "#2a6f2a"; ctx.lineWidth = 2 * dpr; ctx.stroke();

  // 출입
  SITE_DATA.entries.forEach((e) => {
    ctx.beginPath();
    ctx.arc(v.x(e.cx), v.y(e.cy), Math.max(4 * dpr, e.r * v.s), 0, Math.PI * 2);
    ctx.strokeStyle = "#c22"; ctx.lineWidth = 2 * dpr; ctx.stroke();
    ctx.fillStyle = "#c22"; ctx.font = `${11 * dpr}px sans-serif`;
    ctx.fillText("출입", v.x(e.cx) + 6 * dpr, v.y(e.cy) - 6 * dpr);
  });

  // 참조점 (dyn cache#3 — 용도 미확정, 참고 표시)
  SITE_DATA.refPoints.forEach((p) => {
    ctx.beginPath();
    ctx.arc(v.x(p[0]), v.y(p[1]), 3 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = "#9b7bd4"; ctx.fill();
  });

  if (r) {
    // 연결선 (박스 아래 깔리지 않게 먼저 그림 → 박스 → 길이 라벨 순)
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    r.links.forEach((l) => {
      ctx.beginPath();
      ctx.moveTo(v.x(l.from.cx), v.y(l.from.cy));
      ctx.lineTo(v.x(l.to.cx), v.y(l.to.cy));
      ctx.strokeStyle = "#555"; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
    });
    ctx.setLineDash([]);

    // 배치 박스
    r.placed.forEach((p) => {
      const x = v.x(p.cx - p.w / 2), y = v.y(p.cy + p.h / 2);
      const w = p.w * v.s, h = p.h * v.s;
      ctx.fillStyle = p.color + "cc"; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#222"; ctx.lineWidth = 1 * dpr; ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = "#111"; ctx.font = `bold ${12 * dpr}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(p.label, v.x(p.cx), v.y(p.cy));
      ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
    });

    // 연결 길이 라벨
    ctx.font = `${10 * dpr}px sans-serif`; ctx.fillStyle = "#333";
    r.links.forEach((l) => {
      ctx.fillText(`${l.lenM.toFixed(0)}m`, (v.x(l.from.cx) + v.x(l.to.cx)) / 2 + 3 * dpr,
        (v.y(l.from.cy) + v.y(l.to.cy)) / 2 - 3 * dpr);
    });
  }

  // 도면 보조 표기 (v0.3 신설 · v0.3.1 낮은 창 겹침 수정)
  if (state.showLegend) drawLegend(ctx, canvas, dpr);
  drawScaleBar(ctx, canvas, v, dpr);
  drawNorth(ctx, canvas, dpr);
}

function drawThumb(canvas, result) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const v = makeView(canvas, SITE_DATA.boundary, 6);
  ctx.beginPath();
  SITE_DATA.boundary.forEach((p, i) => (i ? ctx.lineTo(v.x(p[0]), v.y(p[1])) : ctx.moveTo(v.x(p[0]), v.y(p[1]))));
  ctx.closePath();
  ctx.fillStyle = "#f6f8f6"; ctx.fill();
  ctx.strokeStyle = "#7a9"; ctx.stroke();
  result.placed.forEach((p) => {
    ctx.fillStyle = p.color;
    ctx.fillRect(v.x(p.cx - p.w / 2), v.y(p.cy + p.h / 2), p.w * v.s, p.h * v.s);
  });
}

// ---------- 실행 ----------
function readSeeds() {
  return state.seeds.map((_, i) => {
    const v = parseInt($(`seed${i}`).value, 10);
    return Number.isFinite(v) ? v : state.seeds[i]; // 값이 비면 직전 시드 유지 (조용한 0 방지)
  });
}

function setSeedsUI(seeds) {
  seeds.forEach((s, i) => { $(`seed${i}`).value = s; $(`seedv${i}`).textContent = s; });
  state.seeds = seeds.slice();
}

function runOnce() {
  state.seeds = readSeeds();
  state.result = runPlacement(SITE_DATA, state.seeds, opts());
  if (state.selected !== -1) {          // 수동 변경 시 갤러리 선택 해제
    state.selected = -1;
    renderGallery();
    drawParallel();
  }
  updateOutputs();
  drawMain();
  writeHash();
}

function updateOutputs() {
  const r = state.result;
  if (!r) return;
  $("outCount").textContent = `${r.count} / ${SITE_DATA.boxes.length}`;
  $("outLength").textContent = `${r.lengthM.toLocaleString()} m`;
  $("outCost").textContent = r.cost.toLocaleString();
  $("outFailed").textContent = r.failed.length ? `미배치: ${r.failed.join(", ")}` : "전체 배치 성공";
  $("outFailed").className = r.failed.length ? "warn" : "ok";
}

// ---------- 갤러리 ----------
// 파레토(비지배해): Count 최대 · cost 최소 기준. 같은 값끼리는 서로 지배하지 않는다.
function markPareto(alts) {
  alts.forEach((a) => {
    a.pareto = !alts.some((b) => b !== a &&
      b.result.count >= a.result.count && b.result.cost <= a.result.cost &&
      (b.result.count > a.result.count || b.result.cost < a.result.cost));
  });
}

function generateGallery() {
  const n = Math.max(1, Math.min(200, parseInt($("altCount").value, 10) || 30));
  const o = opts();
  const master = mulberry32(Date.now() % 2147483647);
  state.gallery = [];
  for (let i = 0; i < n; i++) {
    const seeds = state.seeds.map(() => Math.floor(master() * 101));
    state.gallery.push({ id: i + 1, seeds, result: runPlacement(SITE_DATA, seeds, o) });
  }
  markPareto(state.gallery);
  state.selected = -1;
  state.brushes = {};
  renderGallery();
  drawParallel();
}

// 축 정의는 평행좌표와 필터가 공유한다 (키가 브러시의 식별자)
function axisDefs() {
  const costs = state.gallery.map((a) => a.result.cost);
  const axes = state.seeds.map((_, i) => ({
    key: `s${i}`,
    label: `${SITE_DATA.boxes[SITE_DATA.placeOrder[i]].label}`,
    get: (a) => a.seeds[i], min: 0, max: 100, fmt: (v) => Math.round(v),
  }));
  axes.push({ key: "count", label: "Count", get: (a) => a.result.count, min: 0, max: SITE_DATA.boxes.length, fmt: (v) => v.toFixed(0) });
  axes.push({
    key: "cost", label: "L&C", get: (a) => a.result.cost,
    min: costs.length ? Math.min(...costs) : 0, max: costs.length ? Math.max(...costs) : 1,
    fmt: (v) => Math.round(v).toLocaleString(),
  });
  return axes;
}

function passesBrushes(alt, axes) {
  return axes.every((axis) => {
    const b = state.brushes[axis.key];
    if (!b) return true;
    const v = axis.get(alt);
    return v >= b.lo && v <= b.hi;
  });
}

function visibleGallery() {
  const axes = axisDefs();
  let g = state.gallery.filter((a) => passesBrushes(a, axes));
  if (state.paretoOnly) g = g.filter((a) => a.pareto);
  return g;
}

function sortGallery(g) {
  const s = g.slice();
  if (state.sortKey === "cost") s.sort((a, b) => (b.result.count - a.result.count) || (a.result.cost - b.result.cost));
  else if (state.sortKey === "count") s.sort((a, b) => b.result.count - a.result.count);
  else if (state.sortKey === "length") s.sort((a, b) => (b.result.count - a.result.count) || (a.result.lengthM - b.result.lengthM));
  return s;
}

function renderGallery() {
  const wrap = $("gallery");
  wrap.innerHTML = "";
  const vis = sortGallery(visibleGallery());
  const nBrush = Object.keys(state.brushes).length;
  $("filterCount").textContent = state.gallery.length
    ? `${vis.length} / ${state.gallery.length}` + (nBrush ? ` (축 필터 ${nBrush})` : "")
    : "–";
  if (!vis.length && state.gallery.length) {
    const msg = document.createElement("div");
    msg.className = "meta";
    msg.style.cssText = "padding:12px; color:#a22; font-size:12px";
    msg.textContent = "조건에 맞는 대안이 없습니다 — 필터를 풀어보세요.";
    wrap.appendChild(msg);
    return;
  }
  vis.forEach((alt) => {
    const card = document.createElement("div");
    card.className = "card" + (alt.id === state.selected ? " sel" : "") + (alt.pareto ? " pareto" : "");
    const cv = document.createElement("canvas");
    cv.width = 150; cv.height = 130;
    card.appendChild(cv);
    const meta = document.createElement("div");
    meta.className = "meta";
    const full = alt.result.count === SITE_DATA.boxes.length;
    meta.innerHTML = `<b>#${alt.id}</b>${alt.pareto ? " ★" : ""} Count ${alt.result.count}${full ? "" : " ⚠"}<br>` +
      `L&C ${alt.result.cost.toLocaleString()}`;
    card.appendChild(meta);
    card.onclick = () => {
      state.selected = alt.id;
      setSeedsUI(alt.seeds);
      state.result = alt.result;
      updateOutputs();
      drawMain();
      renderGallery();
      drawParallel();
      writeHash();
    };
    wrap.appendChild(card);
    drawThumb(cv, alt.result);
  });
}

// ---------- 평행좌표 (GD Outcome UI 재현) + 브러시 필터 ----------
const PC = { padL: 20, padR: 30, padT: 24, padB: 8 };

function pcGeom(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const padL = PC.padL * dpr, padR = PC.padR * dpr, padT = PC.padT * dpr, padB = PC.padB * dpr;
  const axes = axisDefs();
  const W = canvas.width - padL - padR, H = canvas.height - padT - padB;
  return {
    dpr, axes, padT, H,
    ax: (i) => padL + (W * i) / (axes.length - 1),
    ay: (axis, val) => {
      const t = axis.max === axis.min ? 0.5 : (val - axis.min) / (axis.max - axis.min);
      return padT + H * (1 - t);
    },
    val: (axis, y) => {
      const t = 1 - (y - padT) / H;
      return axis.min + (axis.max - axis.min) * Math.min(1, Math.max(0, t));
    },
  };
}

function drawParallel() {
  const canvas = $("pcplot");
  const wrap = $("pcWrap");
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(wrap.clientWidth * dpr), h = Math.round(wrap.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!state.gallery.length) {
    ctx.fillStyle = "#999"; ctx.font = `${12 * dpr}px sans-serif`;
    ctx.fillText("대안을 생성하면 평행좌표가 표시됩니다", 10 * dpr, 20 * dpr);
    return;
  }
  const g = pcGeom(canvas);
  const visible = new Set(visibleGallery().map((a) => a.id));

  // 축
  ctx.strokeStyle = "#ccc"; ctx.lineWidth = 1 * dpr;
  ctx.fillStyle = "#555"; ctx.font = `${10 * dpr}px sans-serif`; ctx.textAlign = "center";
  g.axes.forEach((axis, i) => {
    ctx.beginPath(); ctx.moveTo(g.ax(i), g.padT); ctx.lineTo(g.ax(i), g.padT + g.H); ctx.stroke();
    ctx.fillStyle = state.brushes[axis.key] ? "#c60" : "#555";
    ctx.fillText(axis.label, g.ax(i), g.padT - 8 * dpr);
  });
  ctx.textAlign = "start";

  // 선 — 걸러진 것은 흐리게, 남은 것은 진하게, 선택은 빨강, 파레토는 노랑 강조
  const draw = (alt) => {
    const sel = alt.id === state.selected;
    const on = visible.has(alt.id);
    ctx.strokeStyle = sel ? "#d33" : !on ? "rgba(170,175,185,0.18)"
      : alt.pareto ? "rgba(201,138,0,0.85)" : "rgba(60,120,200,0.38)";
    ctx.lineWidth = (sel ? 2.5 : alt.pareto && on ? 1.6 : 1) * dpr;
    ctx.beginPath();
    g.axes.forEach((axis, i) => {
      const y = g.ay(axis, axis.get(alt));
      if (i) ctx.lineTo(g.ax(i), y); else ctx.moveTo(g.ax(i), y);
    });
    ctx.stroke();
  };
  state.gallery.filter((a) => !visible.has(a.id)).forEach(draw);
  state.gallery.filter((a) => visible.has(a.id) && !a.pareto).forEach(draw);
  state.gallery.filter((a) => visible.has(a.id) && a.pareto).forEach(draw);
  const selAlt = state.gallery.find((a) => a.id === state.selected);
  if (selAlt) draw(selAlt);

  // 브러시 구간 표시
  g.axes.forEach((axis, i) => {
    const b = state.brushes[axis.key];
    if (!b) return;
    const y1 = g.ay(axis, b.hi), y2 = g.ay(axis, b.lo);
    ctx.fillStyle = "rgba(255,170,0,0.18)";
    ctx.fillRect(g.ax(i) - 6 * g.dpr, y1, 12 * g.dpr, y2 - y1);
    ctx.strokeStyle = "#c60"; ctx.lineWidth = 1.5 * g.dpr;
    ctx.strokeRect(g.ax(i) - 6 * g.dpr, y1, 12 * g.dpr, y2 - y1);
    ctx.fillStyle = "#a50"; ctx.font = `${9.5 * g.dpr}px sans-serif`; ctx.textAlign = "center";
    ctx.fillText(`${axis.fmt(b.lo)}~${axis.fmt(b.hi)}`, g.ax(i), y2 + 10 * g.dpr);
    ctx.textAlign = "start";
  });
}

function bindBrush() {
  const canvas = $("pcplot");
  let drag = null; // {axisIdx, y0, y1}
  const posOf = (e) => {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (!state.gallery.length) return;
    const g = pcGeom(canvas);
    const p = posOf(e);
    let best = -1, bestD = 14 * g.dpr;
    g.axes.forEach((_, i) => {
      const d = Math.abs(g.ax(i) - p.x);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best < 0) return;
    drag = { axisIdx: best, y0: p.y, y1: p.y };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const g = pcGeom(canvas);
    drag.y1 = posOf(e).y;
    const axis = g.axes[drag.axisIdx];
    const a = g.val(axis, drag.y0), b = g.val(axis, drag.y1);
    state.brushes[axis.key] = { lo: Math.min(a, b), hi: Math.max(a, b) };
    drawParallel();
  });
  const end = (e) => {
    if (!drag) return;
    const g = pcGeom(canvas);
    const axis = g.axes[drag.axisIdx];
    if (Math.abs(drag.y1 - drag.y0) < 5 * g.dpr) delete state.brushes[axis.key]; // 클릭 = 해제
    drag = null;
    if (e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    renderGallery();
    drawParallel();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
}

// ---------- 내보내기 ----------
function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function note(msg) {
  const el = $("exportMsg");
  el.textContent = msg;
  el.style.color = "#2a6f2a";
}

function exportCsv() {
  const vis = sortGallery(visibleGallery());
  if (!vis.length) { note("내보낼 대안이 없습니다 — 먼저 대안을 생성하세요."); return; }
  // ★라벨 "9,10,11"에 쉼표가 들어 있다 — 모든 헤더 셀을 따옴표로 감싸지 않으면 열이 쪼개진다
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const head = ["id", ...state.seeds.map((_, i) => `seed_${SITE_DATA.boxes[SITE_DATA.placeOrder[i]].label}`),
    "count", "length_m", "cost", "pareto", "failed"].map(q);
  const rows = vis.map((a) => [a.id, ...a.seeds, a.result.count, a.result.lengthM, a.result.cost,
    a.pareto ? 1 : 0, q(a.result.failed.join(" "))].join(","));
  // Excel(ko-KR)이 UTF-8을 옳게 읽도록 BOM + CRLF
  const csv = "﻿" + [head.join(","), ...rows].join("\r\n") + "\r\n";
  download("wtp_alternatives.csv", new Blob([csv], { type: "text/csv;charset=utf-8" }));
  note(`CSV ${vis.length}행 저장 — 시드·Count·Length·Cost·파레토.`);
}

function exportJson() {
  const r = state.result;
  if (!r) { note("먼저 배치를 실행하세요."); return; }
  const payload = {
    source: SITE_DATA._source,
    units: "mm",
    exported_from: "WTP Layout Workbench v0.3.1",
    alternative_id: state.selected > 0 ? state.selected : null,
    seeds: r.seeds,
    params: { gridN: r.opts.gridN, clearance_mm: r.opts.clearance, cost_rate: r.opts.costRate },
    metrics: { count: r.count, length_m: r.lengthM, cost: r.cost, failed: r.failed },
    placements: r.placed.map((p) => ({ label: p.label, name: p.name, cx: p.cx, cy: p.cy, w: p.w, h: p.h })),
    links: r.links.map((l) => ({ from: l.a, to: l.b, length_m: Math.round(l.lenM * 10) / 10 })),
    caveats: ["Dynamo 실행값 대조 미실시", "비용 단가 미검증", "후보점 그리드는 bbox 근사"],
  };
  download(`wtp_alternative_${state.selected > 0 ? state.selected : "current"}.json`,
    new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" }));
  note(`JSON 저장 — 박스 ${r.placed.length}개 중심좌표(mm) 포함.`);
}

function exportPng() {
  const canvas = $("plan");
  canvas.toBlob((b) => {
    download("wtp_layout.png", b);
    note(`PNG 저장 — ${canvas.width}×${canvas.height}px (현재 화면 그대로).`);
  }, "image/png");
}

// ---------- 퍼머링크 ----------
function writeHash() {
  const o = opts();
  const h = `s=${state.seeds.join(".")}&g=${o.gridN}&c=${o.clearance / 1000}&r=${o.costRate}`;
  history.replaceState(null, "", `#${h}`);
}

function readHash() {
  const h = location.hash.replace(/^#/, "");
  if (!h) return false;
  const q = {};
  h.split("&").forEach((kv) => { const [k, v] = kv.split("="); if (k) q[k] = v; });
  let used = false;
  if (q.s) {
    const seeds = q.s.split(".").map((x) => parseInt(x, 10));
    if (seeds.length === DEFAULT_SEEDS.length && seeds.every((x) => Number.isFinite(x))) {
      state.seeds = seeds; used = true;
    }
  }
  if (q.g && Number.isFinite(+q.g)) { $("gridN").value = +q.g; used = true; }
  if (q.c && Number.isFinite(+q.c)) { $("clearance").value = +q.c; used = true; }
  if (q.r && Number.isFinite(+q.r)) { $("costRate").value = +q.r; used = true; }
  return used;
}

function copyLink() {
  writeHash();
  const url = location.href;
  const done = () => note("퍼머링크 복사됨 — 같은 링크는 항상 같은 배치를 낸다.");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done, () => note(`복사 실패 — 주소창의 URL을 그대로 쓰세요: ${url}`));
  } else {
    note(`이 브라우저에서는 자동 복사가 막혀 있습니다. 주소창 URL을 그대로 쓰세요.`);
  }
}

// ---------- 초기화 ----------
function buildSliders() {
  const wrap = $("sliders");
  SITE_DATA.placeOrder.forEach((boxIdx, k) => {
    const box = SITE_DATA.boxes[boxIdx];
    const row = document.createElement("div");
    row.className = "srow";
    row.innerHTML =
      `<span class="chip" style="background:${box.color}"></span>` +
      `<label title="${box.name}">[${box.label}] ${box.name.length > 22 ? box.name.slice(0, 22) + "…" : box.name}</label>` +
      `<input type="range" id="seed${k}" min="0" max="100" step="1" value="${state.seeds[k]}">` +
      `<span class="val" id="seedv${k}">${state.seeds[k]}</span>`;
    wrap.appendChild(row);
    row.querySelector("input").addEventListener("input", (e) => {
      $(`seedv${k}`).textContent = e.target.value;
      runOnce();
    });
  });
}

// ---------- 줌·팬·Fit ----------
function bindViewControls() {
  const canvas = $("plan");
  const dpr = () => window.devicePixelRatio || 1;
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (!state.view) state.view = computeFit(canvas);
    const v = state.view;
    const px = e.offsetX * dpr(), py = e.offsetY * dpr();
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    v.tx = px - (px - v.tx) * f;
    v.ty = py - (py - v.ty) * f;
    v.scale *= f;
    drawMain();
  }, { passive: false });
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY };
    canvas.classList.add("panning");
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!state.view) state.view = computeFit(canvas);
    state.view.tx += (e.clientX - drag.x) * dpr();
    state.view.ty += (e.clientY - drag.y) * dpr();
    drag = { x: e.clientX, y: e.clientY };
    drawMain();
  });
  const endDrag = (e) => {
    drag = null;
    canvas.classList.remove("panning");
    if (e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  $("btnFit").onclick = () => { state.view = null; drawMain(); };
  $("btnLegend").onclick = () => { state.showLegend = !state.showLegend; drawMain(); };
}

window.addEventListener("resize", () => { state.view = null; drawMain(); drawParallel(); });

document.addEventListener("DOMContentLoaded", () => {
  const fromLink = readHash();
  buildSliders();
  bindViewControls();
  bindBrush();
  $("btnRun").onclick = runOnce;
  $("btnGen").onclick = generateGallery;
  $("btnReset").onclick = () => { setSeedsUI(DEFAULT_SEEDS); runOnce(); };
  $("sortKey").onchange = (e) => { state.sortKey = e.target.value; renderGallery(); };
  $("paretoOnly").onchange = (e) => { state.paretoOnly = e.target.checked; renderGallery(); drawParallel(); };
  $("btnClearBrush").onclick = () => { state.brushes = {}; renderGallery(); drawParallel(); };
  $("btnCsv").onclick = exportCsv;
  $("btnJson").onclick = exportJson;
  $("btnPng").onclick = exportPng;
  $("btnLink").onclick = copyLink;
  ["gridN", "clearance", "costRate"].forEach((id) => $(id).addEventListener("change", runOnce));
  runOnce();
  if (fromLink) note("퍼머링크의 시드·파라미터로 복원했습니다.");
});
