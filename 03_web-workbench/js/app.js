// app.js — 화면·갤러리·평행좌표 (엔진은 engine.js, 데이터는 data.js)
"use strict";

const $ = (id) => document.getElementById(id);
const state = {
  seeds: [59, 59, 45, 0, 0, 0, 0, 0, 0, 0, 0], // dyn 저장 당시 슬라이더 값
  result: null,
  gallery: [],   // {id, seeds, result}
  selected: -1,
  sortKey: "cost",
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

// ---------- 메인 캔버스 ----------
function drawMain() {
  const canvas = $("plan");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const v = makeView(canvas, SITE_DATA.boundary, 30 * dpr);
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

  if (!r) return;

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
  return state.seeds.map((_, i) => parseInt($(`seed${i}`).value, 10));
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
function generateGallery() {
  const n = Math.max(1, Math.min(200, parseInt($("altCount").value, 10) || 30));
  const o = opts();
  const master = mulberry32(Date.now() % 2147483647);
  state.gallery = [];
  for (let i = 0; i < n; i++) {
    const seeds = state.seeds.map(() => Math.floor(master() * 101));
    state.gallery.push({ id: i + 1, seeds, result: runPlacement(SITE_DATA, seeds, o) });
  }
  state.selected = -1;
  renderGallery();
  drawParallel();
}

function sortedGallery() {
  const g = state.gallery.slice();
  if (state.sortKey === "cost") g.sort((a, b) => (b.result.count - a.result.count) || (a.result.cost - b.result.cost));
  else if (state.sortKey === "count") g.sort((a, b) => b.result.count - a.result.count);
  else if (state.sortKey === "length") g.sort((a, b) => (b.result.count - a.result.count) || (a.result.lengthM - b.result.lengthM));
  return g;
}

function renderGallery() {
  const wrap = $("gallery");
  wrap.innerHTML = "";
  sortedGallery().forEach((alt) => {
    const card = document.createElement("div");
    card.className = "card" + (alt.id === state.selected ? " sel" : "");
    const cv = document.createElement("canvas");
    cv.width = 150; cv.height = 130;
    card.appendChild(cv);
    const meta = document.createElement("div");
    meta.className = "meta";
    const full = alt.result.count === SITE_DATA.boxes.length;
    meta.innerHTML = `<b>#${alt.id}</b> Count ${alt.result.count}${full ? "" : " ⚠"}<br>` +
      `L&C ${alt.result.cost.toLocaleString()}`;
    card.appendChild(meta);
    card.onclick = () => {
      state.selected = alt.id;
      alt.seeds.forEach((s, i) => { $(`seed${i}`).value = s; $(`seedv${i}`).textContent = s; });
      state.seeds = alt.seeds.slice();
      state.result = alt.result;
      updateOutputs();
      drawMain();
      renderGallery();
      drawParallel();
    };
    wrap.appendChild(card);
    drawThumb(cv, alt.result);
  });
}

// ---------- 평행좌표 (GD Outcome UI 재현) ----------
function drawParallel() {
  const canvas = $("pcplot");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!state.gallery.length) {
    ctx.fillStyle = "#999"; ctx.font = `${12 * dpr}px sans-serif`;
    ctx.fillText("대안을 생성하면 평행좌표가 표시됩니다", 10 * dpr, 20 * dpr);
    return;
  }
  const axes = state.seeds.map((_, i) => ({ key: `s${i}`, label: `${SITE_DATA.boxes[SITE_DATA.placeOrder[i]].label}`, get: (a) => a.seeds[i], min: 0, max: 100 }));
  const costs = state.gallery.map((a) => a.result.cost);
  axes.push({ key: "count", label: "Count", get: (a) => a.result.count, min: 0, max: SITE_DATA.boxes.length });
  axes.push({ key: "cost", label: "L&C", get: (a) => a.result.cost, min: Math.min(...costs), max: Math.max(...costs) });
  const padL = 20 * dpr, padR = 30 * dpr, padT = 24 * dpr, padB = 8 * dpr;
  const W = canvas.width - padL - padR, H = canvas.height - padT - padB;
  const ax = (i) => padL + (W * i) / (axes.length - 1);
  const ay = (axis, val) => {
    const t = axis.max === axis.min ? 0.5 : (val - axis.min) / (axis.max - axis.min);
    return padT + H * (1 - t);
  };
  ctx.strokeStyle = "#ccc"; ctx.lineWidth = 1 * dpr;
  ctx.fillStyle = "#555"; ctx.font = `${10 * dpr}px sans-serif`; ctx.textAlign = "center";
  axes.forEach((axis, i) => {
    ctx.beginPath(); ctx.moveTo(ax(i), padT); ctx.lineTo(ax(i), padT + H); ctx.stroke();
    ctx.fillText(axis.label, ax(i), padT - 8 * dpr);
  });
  ctx.textAlign = "start";
  state.gallery.forEach((alt) => {
    const sel = alt.id === state.selected;
    ctx.strokeStyle = sel ? "#d33" : "rgba(60,120,200,0.35)";
    ctx.lineWidth = (sel ? 2.5 : 1) * dpr;
    ctx.beginPath();
    axes.forEach((axis, i) => {
      const y = ay(axis, axis.get(alt));
      if (i) ctx.lineTo(ax(i), y); else ctx.moveTo(ax(i), y);
    });
    ctx.stroke();
  });
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

window.addEventListener("resize", () => { drawMain(); drawParallel(); });

document.addEventListener("DOMContentLoaded", () => {
  buildSliders();
  $("btnRun").onclick = runOnce;
  $("btnGen").onclick = generateGallery;
  $("btnReset").onclick = () => {
    [59, 59, 45, 0, 0, 0, 0, 0, 0, 0, 0].forEach((s, i) => { $(`seed${i}`).value = s; $(`seedv${i}`).textContent = s; });
    runOnce();
  };
  $("sortKey").onchange = (e) => { state.sortKey = e.target.value; renderGallery(); };
  ["gridN", "clearance", "costRate"].forEach((id) => $(id).addEventListener("change", runOnce));
  runOnce();
});
