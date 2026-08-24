// app.js — 화면·갤러리·평행좌표·필터·내보내기·자동개선 (엔진 engine.js, 계통 network.js, 채점 score.js, 추론 reason.js)
// v0.4: 입력 UV 전환 · 계통 v2 연결망 · 목표 O1~O4 + 제약 C1~C6 · 총점 회계 · 추론 패널 · 로컬 탐색
"use strict";

const $ = (id) => document.getElementById(id);
const DEFAULT_SEEDS = [59, 59, 45, 0, 0, 0, 0, 0, 0, 0, 0]; // dyn 저장 당시 슬라이더 값
const NB = 11;

const state = {
  mode: "seed",
  seeds: DEFAULT_SEEDS.slice(),
  uvs: null,          // [{u,v,rot}] × 11 (placeOrder 순서)
  result: null,
  ev: null,
  score: null,
  baseEv: null,       // 기준안(dyn 시드) 평가 — 지수의 분모
  gallery: [],        // {id, mode, seeds|uvs, result, ev, score, pareto}
  selected: -1,
  sortKey: "total",
  view: null,         // null = 자동 Fit / {scale, tx, ty}
  brushes: {},
  paretoOnly: false,
  hideDisq: true,
  showInputAxes: false,
  showLegend: true,
  overlay: true,      // 계통색·증설사각형·동선·교차 표시
  opt: null,
  optTimer: null,
};

// ---------- 설정 읽기 ----------
function num(id, dflt) { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : dflt; }

function netOf() {
  return $("netSel").value === "dyn"
    ? { links: dynNetwork(SITE_DATA), systems: WTP_SYSTEMS, access: [], mainline: [], hazard: [] }
    : { links: WTP_NETWORK, systems: WTP_SYSTEMS, access: WTP_ACCESS, mainline: WTP_MAINLINE, hazard: WTP_HAZARD };
}

function opts() {
  return {
    gridN: Math.round(num("gridN", 51)),
    clearance: num("clearance", 10) * 1000,
    costRate: num("costRate", 1),
    allowRotate: $("allowRot").checked,
  };
}

function evalOpts() {
  const hz = $("hazMin").value.trim();
  return {
    clearance: num("clearance", 10) * 1000,
    measure: $("measure").value,
    expGridN: Math.round(num("expGridN", 64)),
    hazardMinM: hz === "" ? null : parseFloat(hz),
  };
}

function weightsOf() {
  return { o1: num("wO1", 45), o2: num("wO2", 15), o3: num("wO3", 20), o4: num("wO4", 20) };
}
function penaltyOf() {
  return { reverse: num("pRev", 3), hazard: num("pHaz", 5) };
}

// ---------- 평가 파이프라인 ----------
// 기준안 = dyn 저장 시드의 배치. 설정이 바뀌면 분모도 같이 바뀌어야 하므로 매번 다시 잰다.
function refreshBaseline() {
  const base = runPlacement(SITE_DATA, DEFAULT_SEEDS, opts());
  state.baseEv = evaluate(SITE_DATA, netOf(), base, evalOpts());
}

function scoreOf(ev) {
  return scoreLayout(ev, state.baseEv, weightsOf(), penaltyOf(), NB);
}

function evalSeeds(seeds) {
  const result = runPlacement(SITE_DATA, seeds, opts());
  const ev = evaluate(SITE_DATA, netOf(), result, evalOpts());
  return { result, ev, score: scoreOf(ev) };
}

function evalUv(uvs) {
  const result = runPlacementUV(SITE_DATA, uvs, opts());
  const ev = evaluate(SITE_DATA, netOf(), result, evalOpts());
  return { result, ev, score: scoreOf(ev) };
}

function evalCurrent() {
  return state.mode === "uv" ? evalUv(state.uvs) : evalSeeds(state.seeds);
}

// ---------- 좌표 변환 ----------
function makeView(canvas, boundary, pad) {
  const xs = boundary.map((p) => p[0]), ys = boundary.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const s = Math.min((canvas.width - 2 * pad) / (maxX - minX), (canvas.height - 2 * pad) / (maxY - minY));
  return { x: (wx) => pad + (wx - minX) * s, y: (wy) => canvas.height - pad - (wy - minY) * s, s };
}

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

function niceScaleLength(scale, dpr) {
  const targetPx = 110 * dpr;
  const raw = targetPx / scale / 1000;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (raw <= m * exp) return m * exp;
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
  const x = canvas.width - 26 * dpr, y = 56 * dpr, r = 12 * dpr;
  ctx.strokeStyle = "#333"; ctx.fillStyle = "#333"; ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x - r * 0.45, y + r * 0.6); ctx.lineTo(x, y + r * 0.25);
  ctx.lineTo(x + r * 0.45, y + r * 0.6); ctx.closePath(); ctx.fill();
  ctx.font = `bold ${10 * dpr}px sans-serif`; ctx.textAlign = "center";
  ctx.fillText("N", x, y + r + 10 * dpr);
  ctx.textAlign = "start";
}

// 범례 — 시설 + (오버레이 켜져 있으면) 계통. 낮은 캔버스에서 넘치면 축약 → 생략.
function drawLegend(ctx, canvas, dpr) {
  const rows = SITE_DATA.placeOrder.map((i) => {
    const b = SITE_DATA.boxes[i];
    return { color: b.color, text: `[${b.label}] ${b.name}` };
  });
  if (state.overlay) {
    Object.keys(WTP_SYSTEMS).forEach((k) => {
      const s = WTP_SYSTEMS[k];
      rows.push({ color: s.color, text: `${s.name} ×${s.weight}`, line: true });
    });
  }
  const avail = canvas.height - 46 * dpr;
  let fs = 10.5, lh0 = 14, padY0 = 7;
  let h = rows.length * lh0 * dpr + padY0 * 2 * dpr;
  if (h > avail) { fs = 9; lh0 = 11.5; padY0 = 5; h = rows.length * lh0 * dpr + padY0 * 2 * dpr; }
  if (h > avail) { fs = 8; lh0 = 10; padY0 = 4; h = rows.length * lh0 * dpr + padY0 * 2 * dpr; }
  if (h > avail) return false;
  const lh = lh0 * dpr, padX = 8 * dpr, padY = padY0 * dpr;
  ctx.font = `${fs * dpr}px sans-serif`;
  const w = Math.max(...rows.map((b) => ctx.measureText(b.text).width)) + 22 * dpr + padX * 2;
  const x0 = 16 * dpr, y0 = canvas.height - 34 * dpr - h;
  ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.strokeStyle = "#c8d0c8"; ctx.lineWidth = 1 * dpr;
  ctx.fillRect(x0, y0, w, h); ctx.strokeRect(x0, y0, w, h);
  rows.forEach((b, i) => {
    const y = y0 + padY + i * lh;
    if (b.line) {
      ctx.strokeStyle = b.color; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.moveTo(x0 + padX, y + 6 * dpr); ctx.lineTo(x0 + padX + 9 * dpr, y + 6 * dpr); ctx.stroke();
    } else {
      ctx.fillStyle = b.color; ctx.fillRect(x0 + padX, y + 2 * dpr, 9 * dpr, 9 * dpr);
      ctx.strokeStyle = "#0004"; ctx.lineWidth = 1 * dpr; ctx.strokeRect(x0 + padX, y + 2 * dpr, 9 * dpr, 9 * dpr);
    }
    ctx.fillStyle = "#222"; ctx.textBaseline = "top";
    ctx.fillText(b.text, x0 + padX + 14 * dpr, y + 1 * dpr);
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
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const v = mainView(canvas);
  const r = state.result, ev = state.ev;

  // 대지경계
  ctx.beginPath();
  SITE_DATA.boundary.forEach((p, i) => (i ? ctx.lineTo(v.x(p[0]), v.y(p[1])) : ctx.moveTo(v.x(p[0]), v.y(p[1]))));
  ctx.closePath();
  ctx.fillStyle = "#f4f7f4"; ctx.fill();
  ctx.strokeStyle = "#2a6f2a"; ctx.lineWidth = 2 * dpr; ctx.stroke();

  // 증설 여지 (O3) — 박스보다 아래에 깐다
  if (ev && state.overlay && ev.exp && ev.exp.rect) {
    const R = ev.exp.rect;
    ctx.save();
    ctx.setLineDash([9 * dpr, 6 * dpr]);
    ctx.strokeStyle = "#0a8"; ctx.lineWidth = 2 * dpr;
    ctx.fillStyle = "rgba(0,170,136,0.09)";
    const x = v.x(R.x0), y = v.y(R.y1), w = (R.x1 - R.x0) * v.s, h = (R.y1 - R.y0) * v.s;
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = "#077"; ctx.font = `${10.5 * dpr}px sans-serif`;
    ctx.fillText(`증설 여지 ${ev.exp.wM.toLocaleString()}×${ev.exp.hM.toLocaleString()}m`, x + 4 * dpr, y + 13 * dpr);
    ctx.restore();
  }

  // 출입
  SITE_DATA.entries.forEach((e) => {
    ctx.beginPath();
    ctx.arc(v.x(e.cx), v.y(e.cy), Math.max(4 * dpr, e.r * v.s), 0, Math.PI * 2);
    ctx.strokeStyle = "#c22"; ctx.lineWidth = 2 * dpr; ctx.stroke();
    ctx.fillStyle = "#c22"; ctx.font = `${11 * dpr}px sans-serif`;
    ctx.fillText("출입", v.x(e.cx) + 6 * dpr, v.y(e.cy) - 6 * dpr);
  });

  SITE_DATA.refPoints.forEach((p) => {
    ctx.beginPath(); ctx.arc(v.x(p[0]), v.y(p[1]), 3 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = "#9b7bd4"; ctx.fill();
  });

  if (r && ev) {
    // 동선 (O4)
    if (state.overlay) {
      ev.access.forEach((a) => {
        if (a.missing) return;
        ctx.save();
        ctx.setLineDash([2 * dpr, 5 * dpr]);
        ctx.strokeStyle = a.pierced.length ? "#d33" : "#e08b00";
        ctx.lineWidth = 3.5 * dpr; ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(v.x(a.from.cx), v.y(a.from.cy)); ctx.lineTo(v.x(a.entry.cx), v.y(a.entry.cy));
        ctx.stroke(); ctx.restore();
      });
    }

    // 관로 — 계통색·계통별 파선
    ev.links.forEach((l) => {
      if (l.missing) return;
      const sys = (netOf().systems)[l.system] || { color: "#555", dash: [6, 4] };
      ctx.save();
      ctx.setLineDash((state.overlay ? sys.dash : [6, 4]).map((d) => d * dpr));
      ctx.strokeStyle = state.overlay ? sys.color : "#555";
      ctx.lineWidth = (state.overlay ? 1 + 1.6 * (l.weight || 1) : 1.5) * dpr;
      ctx.beginPath();
      ctx.moveTo(v.x(l.from.cx), v.y(l.from.cy)); ctx.lineTo(v.x(l.to.cx), v.y(l.to.cy));
      ctx.stroke(); ctx.restore();
    });

    // 교차 표시 (O2)
    if (state.overlay && ev.crossings.length) {
      const live = ev.links.filter((l) => !l.missing);
      const byId = {}; live.forEach((l) => { byId[l.id] = l; });
      ev.crossings.forEach((c) => {
        const A = byId[c.a], B = byId[c.b];
        if (!A || !B) return;
        const P = segCross([A.from.cx, A.from.cy], [A.to.cx, A.to.cy], [B.from.cx, B.from.cy], [B.to.cx, B.to.cy]);
        if (!P) return;
        const x = v.x(P[0]), y = v.y(P[1]), s = 6 * dpr;
        ctx.strokeStyle = "#d33"; ctx.lineWidth = 2.4 * dpr;
        ctx.beginPath();
        ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
        ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s);
        ctx.stroke();
      });
    }

    // 배치 박스
    r.placed.forEach((p) => {
      const x = v.x(p.cx - p.w / 2), y = v.y(p.cy + p.h / 2);
      const w = p.w * v.s, h = p.h * v.s;
      ctx.fillStyle = p.color + "cc"; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#222"; ctx.lineWidth = 1 * dpr; ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = "#111"; ctx.font = `bold ${12 * dpr}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(p.label + (p.rot ? "↻" : ""), v.x(p.cx), v.y(p.cy));
      ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
    });

    // 관로 길이 라벨
    ctx.font = `${10 * dpr}px sans-serif`; ctx.fillStyle = "#333";
    ev.links.forEach((l) => {
      if (l.missing) return;
      ctx.fillText(`${l.lenM.toFixed(0)}m`, (v.x(l.from.cx) + v.x(l.to.cx)) / 2 + 3 * dpr,
        (v.y(l.from.cy) + v.y(l.to.cy)) / 2 - 3 * dpr);
    });
  }

  if (state.showLegend) drawLegend(ctx, canvas, dpr);
  drawScaleBar(ctx, canvas, v, dpr);
  drawNorth(ctx, canvas, dpr);
}

// 두 선분의 교점 (교차하지 않으면 null) — 화면의 ✕ 표시용
function segCross(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (d === 0) return null;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
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

// ---------- 입력 UI ----------
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

// ★UV의 진실 원천은 state.uvs 하나다. DOM에서 되읽지 않는다.
//   되읽던 판(v0.4 개발 중)에서는 표시용 2자리 반올림 + range step 스냅이 값 자체를 오염시켜,
//   "최고안 적용" 결과가 자동개선 로그의 최고 총점과 달랐다(172.7 → 171.3, 헤드리스 캡처에서 실검출).
function setUvUI(uvs) {
  state.uvs = uvs.map((g) => ({ u: g.u, v: g.v, rot: g.rot ? 1 : 0 }));
  syncUvDom();
}

// state → DOM 표시만 갱신 (표시는 3자리로 자르되 state는 건드리지 않는다)
function syncUvDom() {
  state.uvs.forEach((g, i) => {
    if (!$(`u${i}`)) return;
    $(`u${i}`).value = g.u; $(`un${i}`).value = Math.round(g.u * 1000) / 1000;
    $(`v${i}`).value = g.v; $(`vn${i}`).value = Math.round(g.v * 1000) / 1000;
    $(`rot${i}`).checked = !!g.rot;
  });
}

function setUvAt(k, u, v, rot) {
  const g = state.uvs[k];
  if (u !== null && Number.isFinite(u)) g.u = Math.min(1, Math.max(0, u));
  if (v !== null && Number.isFinite(v)) g.v = Math.min(1, Math.max(0, v));
  if (rot !== undefined) g.rot = rot ? 1 : 0;
}

function buildSliders() {
  const wrap = $("sliders");
  wrap.innerHTML = "";
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

function buildUvInputs() {
  const wrap = $("uvinputs");
  wrap.innerHTML = "";
  SITE_DATA.placeOrder.forEach((boxIdx, k) => {
    const box = SITE_DATA.boxes[boxIdx];
    const g = state.uvs[k];
    const nm = box.name.length > 20 ? box.name.slice(0, 20) + "…" : box.name;
    const d = document.createElement("div");
    d.className = "uvbox";
    d.innerHTML =
      `<div class="uvhead"><span class="chip" style="background:${box.color}"></span>` +
      `<span class="nm" title="${box.name}">[${box.label}] ${nm}</span>` +
      `<label class="rot" title="90° 회전 (가로·세로 맞바꿈)"><input type="checkbox" id="rot${k}" ${g.rot ? "checked" : ""}>90°</label></div>` +
      `<div class="uvline"><span class="k">u</span><input type="range" id="u${k}" min="0" max="1" step="0.01" value="${g.u}">` +
      `<input type="number" id="un${k}" min="0" max="1" step="0.01" value="${Math.round(g.u * 1000) / 1000}"></div>` +
      `<div class="uvline"><span class="k">v</span><input type="range" id="v${k}" min="0" max="1" step="0.01" value="${g.v}">` +
      `<input type="number" id="vn${k}" min="0" max="1" step="0.01" value="${Math.round(g.v * 1000) / 1000}"></div>`;
    wrap.appendChild(d);
    const edit = (which, id) => {
      const val = parseFloat($(id).value);
      if (!Number.isFinite(val)) return;
      setUvAt(k, which === "u" ? val : null, which === "v" ? val : null);
      syncUvDom();
      runOnce();
    };
    $(`u${k}`).addEventListener("input", () => edit("u", `u${k}`));
    $(`v${k}`).addEventListener("input", () => edit("v", `v${k}`));
    $(`un${k}`).addEventListener("change", () => edit("u", `un${k}`));
    $(`vn${k}`).addEventListener("change", () => edit("v", `vn${k}`));
    $(`rot${k}`).addEventListener("change", () => { setUvAt(k, null, null, $(`rot${k}`).checked); runOnce(); });
  });
}

function applyMode() {
  const uv = state.mode === "uv";
  $("sliders").style.display = uv ? "none" : "";
  $("uvinputs").style.display = uv ? "" : "none";
  $("inTitle").textContent = uv ? "배치 UV (박스별 u·v + 90°) — 평면에서 박스를 끌어도 된다" : "배치 시드 (Dynamo 슬라이더 11개 재현)";
  $("btnOpt").disabled = !uv;
  $("btnOptBest").disabled = true;
  $("plan").classList.toggle("movebox", uv);
}

// ---------- 실행 ----------
function runOnce(keepSelection) {
  if (state.mode !== "uv") state.seeds = readSeeds();   // UV는 state.uvs가 진실 원천 (DOM 되읽기 없음)
  refreshBaseline();
  const e = evalCurrent();
  state.result = e.result; state.ev = e.ev; state.score = e.score;
  if (!keepSelection && state.selected !== -1) {
    state.selected = -1;
    renderGallery(); drawParallel();
  }
  updateOutputs();
  drawMain();
  renderReason();
  writeHash();
}

function updateOutputs() {
  const ev = state.ev, sc = state.score;
  if (!ev) return;
  const f = (n, d) => (n === null || !isFinite(n) ? "–" : Number(n.toFixed(d === undefined ? 0 : d)).toLocaleString());
  $("outTotal").textContent = sc.disq ? "실격" : f(sc.total, 1);
  $("outTotal").className = "big" + (sc.disq ? " disq" : "");
  $("outTotalCap").textContent = sc.disq ? sc.disq.reason : (sc.total >= 100 ? "기준안 이상" : "기준안 미만");
  $("outO1").textContent = `${f(ev.o1)} (${f(sc.items[0].index, 1)})`;
  $("outO2").textContent = `${ev.crossings.length}건 / 가중 ${ev.o2} (${f(sc.items[1].index, 1)})`;
  $("outO3").textContent = `${f(ev.o3)} m² (${f(sc.items[2].index, 1)})`;
  $("outO4").textContent = `${f(ev.o4)} m (${f(sc.items[3].index, 1)})`;
  $("outCount").textContent = `${ev.count} / ${NB}`;
  $("outRaw").textContent = `${f(ev.rawLengthM)} m`;
  $("outFailed").textContent = ev.failed.length ? `미배치: ${ev.failed.join(", ")}` : "전체 배치 성공";
  $("outFailed").className = ev.failed.length ? "warn" : "ok";
}

// ---------- 추론 패널 ----------
function renderReason() {
  const host = $("reason");
  if (!state.ev) { host.innerHTML = ""; return; }
  const secs = explain({
    data: SITE_DATA, net: netOf(), result: state.result, ev: state.ev, score: state.score,
    gallery: state.gallery, selectedId: state.selected,
  });
  state.reasonSections = secs;
  host.innerHTML = secs.map((s, i) => {
    let body = "";
    if (s.kind === "table") {
      body = `<table><thead><tr>${s.head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>` +
        s.rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") +
        `</tbody></table>` + (s.note ? `<p class="${s.bad ? "bad" : "dim"}">${s.note}</p>` : "");
    } else {
      body = s.lines.map((l) => `<p>${l}</p>`).join("");
    }
    const open = i < 3 ? " open" : "";
    return `<details class="sec${s.bad ? " bad" : ""}"${open}><summary>${s.title}</summary><div class="body">${body}</div></details>`;
  }).join("");
}

// ---------- 갤러리 ----------
function randSeeds(rnd) { return Array.from({ length: NB }, () => Math.floor(rnd() * 101)); }
function randUv(rnd, allowRot) {
  return Array.from({ length: NB }, () => ({ u: rnd(), v: rnd(), rot: allowRot && rnd() < 0.4 ? 1 : 0 }));
}

function generateGallery() {
  const n = Math.max(1, Math.min(200, Math.round(num("altCount", 30))));
  const rnd = mulberry32(Math.round(num("searchSeed", 1)) + 12345);
  const allowRot = $("allowRot").checked;
  refreshBaseline();
  state.gallery = [];
  for (let i = 0; i < n; i++) {
    if (state.mode === "uv") {
      const uvs = randUv(rnd, allowRot);
      const e = evalUv(uvs);
      state.gallery.push({ id: i + 1, mode: "uv", uvs, result: e.result, ev: e.ev, score: e.score });
    } else {
      const seeds = randSeeds(rnd);
      const e = evalSeeds(seeds);
      state.gallery.push({ id: i + 1, mode: "seed", seeds, result: e.result, ev: e.ev, score: e.score });
    }
  }
  markPareto4(state.gallery);
  state.selected = -1;
  state.brushes = {};
  renderGallery();
  drawParallel();
  renderReason();
}

// 축 정의 — 평행좌표와 브러시 필터가 공유한다
function axisDefs() {
  const G = state.gallery;
  const axes = [];
  if (state.showInputAxes && G.length) {
    if (state.mode === "uv") {
      for (let i = 0; i < NB; i++) {
        const lb = SITE_DATA.boxes[SITE_DATA.placeOrder[i]].label;
        axes.push({ key: `u${i}`, label: `${lb}u`, get: (a) => (a.uvs ? a.uvs[i].u : 0), min: 0, max: 1, fmt: (v) => v.toFixed(2) });
        axes.push({ key: `v${i}`, label: `${lb}v`, get: (a) => (a.uvs ? a.uvs[i].v : 0), min: 0, max: 1, fmt: (v) => v.toFixed(2) });
      }
    } else {
      for (let i = 0; i < NB; i++) {
        const lb = SITE_DATA.boxes[SITE_DATA.placeOrder[i]].label;
        axes.push({ key: `s${i}`, label: lb, get: (a) => (a.seeds ? a.seeds[i] : 0), min: 0, max: 100, fmt: (v) => Math.round(v) });
      }
    }
  }
  const span = (get, dflt) => {
    const vs = G.map(get).filter((v) => isFinite(v));
    return vs.length ? { min: Math.min(...vs), max: Math.max(...vs) } : dflt;
  };
  axes.push({ key: "count", label: "Count", get: (a) => a.ev.count, min: 0, max: NB, fmt: (v) => v.toFixed(0) });
  [["o1", "O1"], ["o2", "O2"], ["o3", "O3"], ["o4", "O4"]].forEach(([k, lb]) => {
    const s = span((a) => a.ev[k], { min: 0, max: 1 });
    axes.push({ key: k, label: lb, get: (a) => a.ev[k], min: s.min, max: s.max, fmt: (v) => Math.round(v).toLocaleString() });
  });
  const st = span((a) => (a.score.total === null ? NaN : a.score.total), { min: 0, max: 100 });
  axes.push({ key: "total", label: "총점", get: (a) => (a.score.total === null ? st.min : a.score.total), min: st.min, max: st.max, fmt: (v) => v.toFixed(1) });
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
  if (state.hideDisq) g = g.filter((a) => a.score.total !== null);
  if (state.paretoOnly) g = g.filter((a) => a.pareto);
  return g;
}

function sortGallery(g) {
  const s = g.slice();
  const T = (a) => (a.score.total === null ? -1e9 : a.score.total);
  if (state.sortKey === "total") s.sort((a, b) => T(b) - T(a));
  else if (state.sortKey === "o1") s.sort((a, b) => a.ev.o1 - b.ev.o1);
  else if (state.sortKey === "o3") s.sort((a, b) => b.ev.o3 - a.ev.o3);
  else if (state.sortKey === "o4") s.sort((a, b) => a.ev.o4 - b.ev.o4);
  else if (state.sortKey === "count") s.sort((a, b) => b.ev.count - a.ev.count);
  return s;
}

function selectAlt(alt) {
  state.selected = alt.id;
  if (alt.mode === "uv") { state.mode = "uv"; syncModeRadios(); applyMode(); setUvUI(alt.uvs); }
  else { state.mode = "seed"; syncModeRadios(); applyMode(); setSeedsUI(alt.seeds); }
  state.result = alt.result; state.ev = alt.ev; state.score = alt.score;
  updateOutputs(); drawMain(); renderGallery(); drawParallel(); renderReason(); writeHash();
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
    const disq = alt.score.total === null;
    const card = document.createElement("div");
    card.className = "card" + (alt.id === state.selected ? " sel" : "") + (alt.pareto ? " pareto" : "") + (disq ? " disq" : "");
    const cv = document.createElement("canvas");
    cv.width = 150; cv.height = 130;
    card.appendChild(cv);
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `<b>#${alt.id}</b>${alt.pareto ? " ★" : ""} ` +
      (disq ? `<span style="color:#a22">실격 ${alt.ev.count}/${NB}</span>` : `총점 <b>${alt.score.total.toFixed(1)}</b>`) +
      `<br>O1 ${Math.round(alt.ev.o1).toLocaleString()} · 교차 ${alt.ev.crossings.length}`;
    card.appendChild(meta);
    card.onclick = () => selectAlt(alt);
    wrap.appendChild(card);
    drawThumb(cv, alt.result);
  });
}

// ---------- 평행좌표 ----------
const PC = { padL: 24, padR: 30, padT: 24, padB: 8 };

function pcGeom(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const padL = PC.padL * dpr, padR = PC.padR * dpr, padT = PC.padT * dpr, padB = PC.padB * dpr;
  const axes = axisDefs();
  const W = canvas.width - padL - padR, H = canvas.height - padT - padB;
  return {
    dpr, axes, padT, H,
    ax: (i) => (axes.length < 2 ? padL : padL + (W * i) / (axes.length - 1)),
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

  ctx.strokeStyle = "#ccc"; ctx.lineWidth = 1 * dpr;
  ctx.font = `${10 * dpr}px sans-serif`; ctx.textAlign = "center";
  g.axes.forEach((axis, i) => {
    ctx.strokeStyle = "#ccc";
    ctx.beginPath(); ctx.moveTo(g.ax(i), g.padT); ctx.lineTo(g.ax(i), g.padT + g.H); ctx.stroke();
    ctx.fillStyle = state.brushes[axis.key] ? "#c60" : "#555";
    ctx.fillText(axis.label, g.ax(i), g.padT - 8 * dpr);
  });
  ctx.textAlign = "start";

  const draw = (alt) => {
    const sel = alt.id === state.selected;
    const on = visible.has(alt.id);
    ctx.strokeStyle = sel ? "#d33" : !on ? "rgba(170,175,185,0.16)"
      : alt.pareto ? "rgba(201,138,0,0.85)" : "rgba(60,120,200,0.36)";
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
  let drag = null;
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
    if (Math.abs(drag.y1 - drag.y0) < 5 * g.dpr) delete state.brushes[axis.key];
    drag = null;
    if (e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    renderGallery(); drawParallel(); renderReason();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
}

// ---------- 자동 개선 ----------
function logOpt(html, cls) {
  const box = $("optlog");
  const div = document.createElement("div");
  div.className = cls || "";
  div.innerHTML = html;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function startOptimizer() {
  if (state.mode !== "uv") return;
  stopOptimizer();
  refreshBaseline();
  const labels = SITE_DATA.placeOrder.map((i) => `[${SITE_DATA.boxes[i].label}]`);
  const maxIter = Math.max(20, Math.round(num("optIters", 400)));
  state.opt = makeOptimizer({
    uvs: state.uvs, evalUv, labels, maxIter,
    step0: num("optStep", 0.14),
    seed: Math.round(num("searchSeed", 1)) + 777,
    allowRotate: $("allowRot").checked,
  });
  $("optlog").innerHTML = "";
  const t0 = state.opt.cur.score.total;
  logOpt(`<span class="hd">시작 총점 <b>${t0 === null ? "실격" : t0.toFixed(1)}</b> · 반복 ${maxIter}회 · 보폭 ${num("optStep", 0.14)}</span>`);
  $("btnOpt").disabled = true; $("btnOptStop").disabled = false;
  state.optTimer = setInterval(() => {
    const fresh = state.opt.tick(6);   // 평가 1회 ≈4.3ms 실측 → 6건/30ms 로 맞춘다
    fresh.forEach((e) => {
      const mv = e.kind === "이동" && e.from && e.to
        ? ` (${e.from.u.toFixed(2)},${e.from.v.toFixed(2)})→(${e.to.u.toFixed(2)},${e.to.v.toFixed(2)})`
        : (e.kind === "교환" ? ` ↔ ${e.label2}` : "");
      logOpt(`<span class="acc">#${e.it} ${e.kind} ${e.label}${mv} · ${e.why} · 총점 ` +
        `${e.before === null ? "실격" : e.before.toFixed(1)}→<b>${e.after.toFixed(1)}</b> (+${e.gain.toFixed(2)})</span>`, "acc");
    });
    // 진행 중인 상태를 화면에 그대로 보여준다 — 스스로 고쳐 가는 게 보이도록
    state.result = state.opt.cur.result; state.ev = state.opt.cur.ev; state.score = state.opt.cur.score;
    updateOutputs(); drawMain();
    if (state.opt.done) {
      const b = state.opt.best.score.total;
      logOpt(`<span class="hd">끝. 시도 ${state.opt.tried} · 채택 ${state.opt.accepted} · 최고 총점 <b>${b === null ? "실격" : b.toFixed(1)}</b>` +
        ` (시작 대비 ${b === null || t0 === null ? "–" : (b - t0 >= 0 ? "+" : "") + (b - t0).toFixed(1)})<br>` +
        `언덕오르기라 전역 최적이 아니다 — 시작점을 바꿔 다시 돌려 비교하라.</span>`);
      stopOptimizer();
      $("btnOptBest").disabled = false;
      setUvUI(state.opt.bestUvs);
      runOnce();
    }
  }, 30);
}

function stopOptimizer() {
  if (state.optTimer) { clearInterval(state.optTimer); state.optTimer = null; }
  $("btnOpt").disabled = state.mode !== "uv"; $("btnOptStop").disabled = true;
  if (state.opt) $("btnOptBest").disabled = false;
}

function applyBest() {
  if (!state.opt) return;
  setUvUI(state.opt.bestUvs);
  runOnce();
}

// ---------- 내보내기 ----------
function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function note(msg) { const el = $("exportMsg"); el.textContent = msg; el.style.color = "#2a6f2a"; }

function exportCsv() {
  const vis = sortGallery(visibleGallery());
  if (!vis.length) { note("내보낼 대안이 없습니다 — 먼저 대안을 생성하세요."); return; }
  // ★라벨 "9,10,11"에 쉼표가 들어 있다 — 헤더 셀을 따옴표로 감싸지 않으면 열이 쪼개진다
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const labels = SITE_DATA.placeOrder.map((i) => SITE_DATA.boxes[i].label);
  const inputHead = state.mode === "uv"
    ? labels.flatMap((lb) => [`u_${lb}`, `v_${lb}`, `rot_${lb}`])
    : labels.map((lb) => `seed_${lb}`);
  const head = ["id", "mode", ...inputHead, "o1_weighted_len", "o2_weighted_cross", "cross_n",
    "o3_expansion_m2", "o4_access_m", "raw_len_m", "count", "min_gap_m", "reverse_n",
    "total", "pareto", "disq"].map(q);
  const rows = vis.map((a) => {
    const inp = a.mode === "uv"
      ? a.uvs.flatMap((g) => [g.u.toFixed(3), g.v.toFixed(3), g.rot])
      : a.seeds;
    return [a.id, a.mode, ...inp, a.ev.o1, a.ev.o2, a.ev.crossings.length, a.ev.o3, a.ev.o4,
      a.ev.rawLengthM, a.ev.count, a.ev.minGapM, a.ev.reverseCount,
      a.score.total === null ? "" : a.score.total, a.pareto ? 1 : 0,
      q(a.score.disq ? a.score.disq.reason : "")].join(",");
  });
  const csv = "﻿" + [head.join(","), ...rows].join("\r\n") + "\r\n";
  download("wtp_alternatives.csv", new Blob([csv], { type: "text/csv;charset=utf-8" }));
  note(`CSV ${vis.length}행 저장 — 입력 + O1~O4 + 총점 + 파레토/실격.`);
}

function exportJson() {
  const r = state.result, ev = state.ev, sc = state.score;
  if (!r) { note("먼저 배치를 실행하세요."); return; }
  const payload = {
    source: SITE_DATA._source,
    units: "mm",
    exported_from: "WTP Layout Workbench v0.4",
    alternative_id: state.selected > 0 ? state.selected : null,
    mode: state.mode,
    input: state.mode === "uv" ? { uv: r.uvs } : { seeds: r.seeds },
    params: {
      gridN: r.opts.gridN, clearance_mm: r.opts.clearance, allow_rotate: !!r.opts.allowRotate,
      cost_rate: r.opts.costRate, network: $("netSel").value, measure: ev.measure,
      exp_grid_n: evalOpts().expGridN, hazard_min_m: evalOpts().hazardMinM,
      weights: weightsOf(), penalty: penaltyOf(),
    },
    objectives: {
      o1_weighted_length: ev.o1, o2_weighted_crossings: ev.o2, o3_expansion_m2: ev.o3, o4_access_m: ev.o4,
      raw_length_m: ev.rawLengthM, main_length_m: ev.mainLengthM, by_system: ev.bySystem,
    },
    constraints: {
      count: ev.count, of: NB, failed: ev.failed, overlaps: ev.overlaps, outside: ev.outside,
      min_gap_m: ev.minGapM, reverse_links: ev.reverse, hazard: ev.hazard,
    },
    score: {
      total: sc.total, gross: sc.gross, penalties: sc.penalties, disqualified: sc.disq,
      items: sc.items.map((i) => ({ key: i.key, value: i.val, baseline: i.base, index: i.index, weight: i.weight, contribution: i.contrib })),
      baseline_note: "지수의 분모 = dyn 저장 시드 배치. 절대금액이 아니다.",
    },
    placements: r.placed.map((p) => ({ label: p.label, name: p.name, cx: p.cx, cy: p.cy, w: p.w, h: p.h, rot: p.rot || 0 })),
    links: ev.links.filter((l) => !l.missing).map((l) => ({
      id: l.id, from: l.a, to: l.b, system: l.system, weight: l.weight,
      length_m: Math.round(l.lenM * 10) / 10, weighted_m: Math.round(l.wLenM * 10) / 10,
    })),
    caveats: [
      "Dynamo 실행값 대조 미실시",
      "관로 단가 미확보 — 점수는 기준안 대비 지수이지 금액이 아니다",
      "계통 가중(본류 1.0 / 역세 0.45 / 배출수 0.40 / 반송 0.35 / 슬러지 0.30)은 미검증 가정",
      "연결망 v2의 L1·L7·L8·L12는 dyn·PPT 어디에도 없는 공정 지식 기반 추가",
      "시설 간 최소이격·안전이격 수치는 규정 원문 미대조",
      "후보점 그리드는 bbox 근사, 증설 여지는 격자 근사, 동선 우회는 근사",
    ],
  };
  download(`wtp_alternative_${state.selected > 0 ? state.selected : "current"}.json`,
    new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" }));
  note(`JSON 저장 — 박스 ${r.placed.length}개 좌표 + 목표·제약·회계까지.`);
}

function exportPng() {
  const canvas = $("plan");
  canvas.toBlob((b) => {
    download("wtp_layout.png", b);
    note(`PNG 저장 — ${canvas.width}×${canvas.height}px (현재 화면 그대로).`);
  }, "image/png");
}

function exportReport() {
  if (!state.reasonSections) { note("먼저 배치를 실행하세요."); return; }
  const strip = (s) => String(s).replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "");
  const L = [`# 정수장 시설배치 — 추론 리포트 (워크벤치 v0.4)`, "",
    `- 입력 방식: ${state.mode === "uv" ? "UV 22" : "시드 11"}`,
    `- 연결망: ${$("netSel").value === "dyn" ? "dyn 원본 8쌍" : "계통 v2 (L1~L12 + 동선 2)"}`,
    `- 길이 측정: ${state.ev.measure === "edge" ? "면-사이" : "중심간"} · 이격 ${num("clearance", 10)}m · 그리드 ${num("gridN", 51)}`,
    `- 가중 O1/O2/O3/O4 = ${[weightsOf().o1, weightsOf().o2, weightsOf().o3, weightsOf().o4].join(" / ")}`,
    ""];
  state.reasonSections.forEach((s) => {
    L.push(`## ${strip(s.title)}`, "");
    if (s.kind === "table") {
      L.push(`| ${s.head.join(" | ")} |`);
      L.push(`|${s.head.map(() => "---").join("|")}|`);
      s.rows.forEach((r) => L.push(`| ${r.map(strip).join(" | ")} |`));
      if (s.note) L.push("", `> ${strip(s.note)}`);
    } else {
      s.lines.forEach((l) => L.push(`- ${strip(l)}`));
    }
    L.push("");
  });
  L.push("---", "", "★미검증: 관로 단가 · 계통 가중 · 이격 규정 수치 · Dynamo 실행값 대조.",
    "계통 v2의 L1·L7·L8·L12는 공정 지식으로 추가한 가정이며 dyn·PPT 어디에도 없다.");
  download("wtp_reasoning_report.md", new Blob([L.join("\n")], { type: "text/markdown;charset=utf-8" }));
  note("추론 리포트 MD 저장 — 회계표·병목·제약·다음 수까지 그대로.");
}

// ---------- 퍼머링크 ----------
function writeHash() {
  const o = opts(), w = weightsOf();
  const inp = state.mode === "uv"
    // 구분자는 '-' 다. '.'을 쓰면 소수점과 구분이 안 돼 왕복이 깨진다(게이트에서 실검출).
    ? "x=" + state.uvs.map((g) => `${g.u.toFixed(3)}_${g.v.toFixed(3)}_${g.rot}`).join("-")
    : "s=" + state.seeds.join(".");
  const h = `m=${state.mode}&${inp}&g=${o.gridN}&c=${o.clearance / 1000}&r=${o.costRate}` +
    `&w=${w.o1}.${w.o2}.${w.o3}.${w.o4}&n=${$("netSel").value}&q=${$("measure").value}&rot=${o.allowRotate ? 1 : 0}`;
  history.replaceState(null, "", `#${h}`);
}

function readHash() {
  const h = location.hash.replace(/^#/, "");
  if (!h) return false;
  const q = {};
  h.split("&").forEach((kv) => { const [k, v] = kv.split("="); if (k) q[k] = v; });
  let used = false;
  if (q.m === "uv" || q.m === "seed") { state.mode = q.m; used = true; }
  if (q.s) {
    const seeds = q.s.split(".").map((x) => parseInt(x, 10));
    if (seeds.length === NB && seeds.every((x) => Number.isFinite(x))) { state.seeds = seeds; used = true; }
  }
  if (q.x) {
    const uvs = q.x.split("-").map((t) => {
      const [u, v, r] = t.split("_").map(Number);
      return { u, v, rot: r ? 1 : 0 };
    });
    if (uvs.length === NB && uvs.every((g) => Number.isFinite(g.u) && Number.isFinite(g.v))) { state.uvs = uvs; used = true; }
  }
  if (q.g && Number.isFinite(+q.g)) { $("gridN").value = +q.g; used = true; }
  if (q.c && Number.isFinite(+q.c)) { $("clearance").value = +q.c; used = true; }
  if (q.r && Number.isFinite(+q.r)) { $("costRate").value = +q.r; used = true; }
  if (q.w) {
    const w = q.w.split(".").map(Number);
    if (w.length === 4 && w.every(Number.isFinite)) {
      $("wO1").value = w[0]; $("wO2").value = w[1]; $("wO3").value = w[2]; $("wO4").value = w[3]; used = true;
    }
  }
  if (q.n === "dyn" || q.n === "v2") { $("netSel").value = q.n; used = true; }
  if (q.q === "edge" || q.q === "center") { $("measure").value = q.q; used = true; }
  if (q.rot) { $("allowRot").checked = q.rot === "1"; used = true; }
  return used;
}

function copyLink() {
  writeHash();
  const url = location.href;
  const done = () => note("퍼머링크 복사됨 — 같은 링크는 항상 같은 배치·같은 점수를 낸다.");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done, () => note(`복사 실패 — 주소창 URL을 그대로 쓰세요: ${url}`));
  } else note("이 브라우저에서는 자동 복사가 막혀 있습니다. 주소창 URL을 그대로 쓰세요.");
}

// ---------- 줌·팬·박스 끌기 ----------
function hitBox(wx, wy) {
  if (!state.result) return -1;
  const P = state.result.placed;
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    if (Math.abs(wx - p.cx) <= p.w / 2 && Math.abs(wy - p.cy) <= p.h / 2) {
      return SITE_DATA.placeOrder.indexOf(p.idx);
    }
  }
  return -1;
}

function bindViewControls() {
  const canvas = $("plan");
  const dpr = () => window.devicePixelRatio || 1;
  const toWorld = (e) => {
    if (!state.view) state.view = computeFit(canvas);
    const v = state.view;
    const px = e.offsetX * dpr(), py = e.offsetY * dpr();
    return [(px - v.tx) / v.scale, (v.ty - py) / v.scale];
  };
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

  let drag = null;      // {x,y} 팬
  let boxDrag = null;   // {k} UV 끌기
  let pending = null;
  canvas.addEventListener("pointerdown", (e) => {
    const [wx, wy] = toWorld(e);
    const k = state.mode === "uv" ? hitBox(wx, wy) : -1;
    if (k >= 0) boxDrag = { k };
    else { drag = { x: e.clientX, y: e.clientY }; canvas.classList.add("panning"); }
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (boxDrag) {
      const b = bboxOf(SITE_DATA.boundary);
      const [wx, wy] = toWorld(e);
      const u = Math.min(1, Math.max(0, (wx - b.minX) / (b.maxX - b.minX)));
      const v2 = Math.min(1, Math.max(0, (wy - b.minY) / (b.maxY - b.minY)));
      pending = { k: boxDrag.k, u, v: v2 };
      if (!pending.raf) {
        pending.raf = true;
        requestAnimationFrame(() => {
          if (!pending) return;
          setUvAt(pending.k, pending.u, pending.v);
          syncUvDom();
          pending = null;
          runOnce(true);
        });
      }
      return;
    }
    if (!drag) return;
    if (!state.view) state.view = computeFit(canvas);
    state.view.tx += (e.clientX - drag.x) * dpr();
    state.view.ty += (e.clientY - drag.y) * dpr();
    drag = { x: e.clientX, y: e.clientY };
    drawMain();
  });
  const endDrag = (e) => {
    if (boxDrag) { boxDrag = null; pending = null; runOnce(true); }
    drag = null;
    canvas.classList.remove("panning");
    if (e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  $("btnFit").onclick = () => { state.view = null; drawMain(); };
  $("btnLegend").onclick = () => { state.showLegend = !state.showLegend; drawMain(); };
  $("btnLayers").onclick = () => { state.overlay = !state.overlay; drawMain(); };
}

window.addEventListener("resize", () => { state.view = null; drawMain(); drawParallel(); });

// ---------- 초기화 ----------
function syncModeRadios() {
  $("modeSeed").checked = state.mode === "seed";
  $("modeUv").checked = state.mode === "uv";
}

function switchMode(m) {
  if (state.mode === m) return;
  stopOptimizer();
  if (m === "uv") {
    // 지금 화면의 배치를 그대로 UV로 옮겨 담는다 — 모드를 바꿔도 그림이 튀지 않게
    state.uvs = state.result ? uvFromResult(SITE_DATA, state.result) : randUv(mulberry32(1), false);
    state.mode = "uv";
    buildUvInputs();
  } else {
    state.mode = "seed";
  }
  syncModeRadios();
  applyMode();
  state.selected = -1;
  runOnce();
}

document.addEventListener("DOMContentLoaded", () => {
  const fromLink = readHash();
  if (!state.uvs) state.uvs = DEFAULT_SEEDS.map(() => ({ u: 0.5, v: 0.5, rot: 0 }));
  buildSliders();
  setSeedsUI(state.seeds);
  buildUvInputs();
  syncModeRadios();
  applyMode();
  bindViewControls();
  bindBrush();

  $("btnRun").onclick = () => runOnce();
  $("btnGen").onclick = generateGallery;
  $("btnReset").onclick = () => {
    if (state.mode === "uv") {
      const base = runPlacement(SITE_DATA, DEFAULT_SEEDS, opts());
      setUvUI(uvFromResult(SITE_DATA, base));
    } else setSeedsUI(DEFAULT_SEEDS);
    runOnce();
  };
  $("btnRandom").onclick = () => {
    const rnd = mulberry32((Math.round(num("searchSeed", 1)) * 7919 + state.gallery.length + 1) >>> 0);
    if (state.mode === "uv") setUvUI(randUv(rnd, $("allowRot").checked));
    else setSeedsUI(randSeeds(rnd));
    runOnce();
  };
  $("modeSeed").onchange = () => switchMode("seed");
  $("modeUv").onchange = () => switchMode("uv");
  $("sortKey").onchange = (e) => { state.sortKey = e.target.value; renderGallery(); };
  $("paretoOnly").onchange = (e) => { state.paretoOnly = e.target.checked; renderGallery(); drawParallel(); };
  $("hideDisq").onchange = (e) => { state.hideDisq = e.target.checked; renderGallery(); drawParallel(); };
  $("showInputAxes").onchange = (e) => { state.showInputAxes = e.target.checked; state.brushes = {}; renderGallery(); drawParallel(); };
  $("btnClearBrush").onclick = () => { state.brushes = {}; renderGallery(); drawParallel(); };
  $("btnCsv").onclick = exportCsv;
  $("btnJson").onclick = exportJson;
  $("btnPng").onclick = exportPng;
  $("btnReport").onclick = exportReport;
  $("btnLink").onclick = copyLink;
  $("btnOpt").onclick = startOptimizer;
  $("btnOptStop").onclick = () => { stopOptimizer(); logOpt('<span class="hd">사용자 정지.</span>'); };
  $("btnOptBest").onclick = applyBest;

  // 설정이 바뀌면 기준안(지수의 분모)과 갤러리 점수까지 다시 잰다
  const rescore = () => {
    refreshBaseline();
    state.gallery.forEach((a) => {
      const e = a.mode === "uv" ? evalUv(a.uvs) : evalSeeds(a.seeds);
      a.result = e.result; a.ev = e.ev; a.score = e.score;
    });
    if (state.gallery.length) markPareto4(state.gallery);
    runOnce(true);
    renderGallery(); drawParallel();
  };
  ["gridN", "clearance", "costRate", "allowRot", "netSel", "measure", "expGridN", "hazMin",
    "wO1", "wO2", "wO3", "wO4", "pRev", "pHaz"].forEach((id) => $(id).addEventListener("change", rescore));

  runOnce();
  if (fromLink) note("퍼머링크의 입력·설정으로 복원했습니다.");
});
