/* NATM 내공단면 산정 뷰어 — 프런트엔드
   엔진은 서버(04_engine/section_engine.py) 단일 구현. 여기서는 그리기와 상호작용만 한다. */
'use strict';

const $ = (id) => document.getElementById(id);
const PKEYS = ['lane_L', 'shoulder_L', 'lane_R', 'shoulder_R', 'H', 'ha', 'hb',
  'duct_LW', 'duct_LH', 'duct_RW', 'duct_RH', 'walk_w', 'walk_h', 'jetfan_d',
  'lining_t', 'shot_t', 'overbreak'];
const PRAW = ['jet_gap_ratio', 'theta3'];   // mm 환산하지 않는 값(비율·각도)

let SEC = null;          // 현재 단면
let ROWS = [];           // 스윕 결과
let LEG = [];            // 원본 60행
let CUR = -1;            // 현재 선택 행
let BEST = -1;
const view = { s: 1, ox: 0, oy: 0, fit: true };

/* ---------------------------------------------------------------- 입력 수집 */
function params() {
  const P = {};
  PKEYS.forEach(k => { P[k] = (parseFloat($('p_' + k).value) || 0) * 1000; });
  PRAW.forEach(k => { P[k] = parseFloat($('p_' + k).value) || 0; });
  return P;
}
function query() {
  return {
    cc: parseFloat($('cc').value) * 1000,
    s: parseFloat($('s').value),
    EL1: parseFloat($('el').value) * 1000,
    theta: parseFloat($('th').value),
    tol: parseFloat($('tol').value) || 0,
    grid: 5,
    flat_min: parseFloat($('flat_min').value),
    margin_min: parseFloat($('margin_min').value),
    params: Object.assign(params(), { five_center: $('ck_five').checked ? 1 : 0 }),
    show_walk: $('ck_walk').checked,
    show_jet: $('ck_jet').checked,
    bind_walk: $('bd_walk').checked,
    bind_jet: $('bd_jet').checked
  };
}
function sweepDef() {
  const f = (a) => [parseFloat($(a[0]).value), parseFloat($(a[1]).value), parseFloat($(a[2]).value)];
  return {
    cc: f(['sw_cc0', 'sw_cc1', 'sw_cc2']), s: f(['sw_s0', 'sw_s1', 'sw_s2']),
    EL1: f(['sw_el0', 'sw_el1', 'sw_el2']), theta: f(['sw_th0', 'sw_th1', 'sw_th2'])
  };
}
function nCombo() {
  const sw = sweepDef(); let n = 1;
  for (const k of ['cc', 's', 'EL1', 'theta']) {
    const [a, b, st] = sw[k];
    n *= st ? Math.round(Math.abs(b - a) / Math.abs(st)) + 1 : 1;
  }
  return n;
}

/* ---------------------------------------------------------------- 서버 호출 */
async function post(url, body) {
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}

let pending = false;
async function refresh() {
  if (pending) return; pending = true;
  try {
    const d = await post('/api/section', query());
    if (d.error) { console.error(d.trace || d.error); return; }
    SEC = d; drawCards(); draw();
    const nt = (d.in && d.in.note) || '';
    const el = $('fiveNote');
    if (nt) { el.innerHTML = '<b style="color:#fbbf24">' + nt + '</b>'; }
    else if (d.in && d.in.five) { el.innerHTML = '<b style="color:#4ade80">5심원 성립</b> — θ3 = ' + d.in.theta3 + '°'; }
  } finally { pending = false; }
}

async function runSweep() {
  const btn = $('btnSweep'); btn.disabled = true; btn.textContent = '계산 중…';
  const q = query(); q.sweep = sweepDef();
  const d = await post('/api/sweep', q);
  btn.disabled = false; btn.textContent = '스윕 실행';
  if (d.error) { alert(d.error); return; }
  ROWS = d.rows;
  BEST = -1;
  ROWS.forEach((r, i) => {
    if (r.j === 'OK' && (BEST < 0 || r.area_m2 < ROWS[BEST].area_m2)) BEST = i;
  });
  fillTable(); drawScatter(); buildThumbs();
  $('swInfo').innerHTML = '실행 조합 <b>' + d.n + '</b> (' + d.shape.join(' × ') + ') · 판정 OK <b>'
    + ROWS.filter(r => r.j === 'OK').length + '</b>';
}

/* ---------------------------------------------------------------- 요약 카드 */
function drawCards() {
  const s = SEC, j = s.judge;
  const c = (t, v, u, cls) => '<div class="card"><div class="t">' + t + '</div><div class="v ' +
    (cls || '') + '">' + v + '<span class="u">' + (u || '') + '</span></div></div>';
  $('cards').innerHTML =
    c('R1', s.R1.toFixed(0), 'mm') +
    c('R2 (좌)', s.R2.toFixed(0), 'mm') +
    c("R2' (우)", s.R2p.toFixed(0), 'mm') +
    c('내공 폭 × 높이', s.width.toFixed(0) + '×' + s.height.toFixed(0), 'mm') +
    c('내공단면적', s.area_m2.toFixed(2), '㎡') +
    c('굴착단면적', s.exc_m2.toFixed(2), '㎡') +
    c('편평률', s.flat.toFixed(4), '', j.flat === 'OK' ? 'ok' : 'ng') +
    c('시설한계 여유', s.margin.toFixed(1), 'mm', j.margin === 'OK' ? 'ok' : 'ng');
}

/* ---------------------------------------------------------------- 메인 캔버스 */
function fitView(cv, pts, pad) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = cv.width - pad * 2, h = cv.height - pad * 2;
  const s = Math.min(w / (x1 - x0 || 1), h / (y1 - y0 || 1));
  return { s, ox: cv.width / 2 - (x0 + x1) / 2 * s, oy: cv.height / 2 + (y0 + y1) / 2 * s };
}

function draw() {
  const cv = $('cv'), ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!SEC) return;

  if (view.fit) {
    const all = SEC.poly.concat(SEC.clr, ...(SEC.layers || []).map(L => L.poly));
    const f = fitView(cv, all, 60 * dpr);
    view.s = f.s; view.ox = f.ox; view.oy = f.oy; view.fit = false;
  }
  const S = view.s, OX = view.ox, OY = view.oy;
  const X = (x) => OX + x * S, Y = (y) => OY - y * S;

  // 격자 (1m)
  ctx.strokeStyle = '#1a2028'; ctx.lineWidth = 1;
  const g = 1000;
  for (let x = -10000; x <= 10000; x += g) { ctx.beginPath(); ctx.moveTo(X(x), 0); ctx.lineTo(X(x), cv.height); ctx.stroke(); }
  for (let y = -2000; y <= 10000; y += g) { ctx.beginPath(); ctx.moveTo(0, Y(y)); ctx.lineTo(cv.width, Y(y)); ctx.stroke(); }
  // 축
  ctx.strokeStyle = '#2c3642';
  ctx.beginPath(); ctx.moveTo(X(0), 0); ctx.lineTo(X(0), cv.height); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(cv.width, Y(0)); ctx.stroke();

  const poly = (pts, close) => {
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
    if (close) ctx.closePath();
  };

  // 라이닝·숏크리트·굴착선 (바깥→안쪽 순서로)
  if ($('ck_layers').checked) (SEC.layers || []).slice().reverse().forEach(L => {
    poly(L.poly, true);
    ctx.strokeStyle = { lining: '#94a3b8', shotcrete: '#64748b', overbreak: '#ef4444' }[L.name] || '#64748b';
    ctx.lineWidth = (L.name === 'overbreak' ? 1.6 : 1.2) * dpr;
    if (L.name === 'overbreak') ctx.setLineDash([7 * dpr, 4 * dpr]);
    ctx.stroke(); ctx.setLineDash([]);
  });

  // 라이닝 내공
  poly(SEC.poly, true);
  ctx.fillStyle = 'rgba(77,163,255,.07)'; ctx.fill();
  ctx.strokeStyle = '#e8eaed'; ctx.lineWidth = 2.2 * dpr; ctx.stroke();

  // 구간별 색 구분 (R1 / R2 / R2')
  const seg = (a, b, col) => {
    ctx.beginPath();
    for (let i = a; i <= b && i < SEC.poly.length; i++) {
      const p = SEC.poly[i]; i === a ? ctx.moveTo(X(p[0]), Y(p[1])) : ctx.lineTo(X(p[0]), Y(p[1]));
    }
    ctx.strokeStyle = col; ctx.lineWidth = 3.2 * dpr; ctx.stroke();
  };
  seg(0, 96, '#7cc4ff');                       // R1 상부호
  seg(97, 97 + 48, '#f472b6');                 // R2' 우측
  seg(97 + 49, SEC.poly.length - 1, '#facc15'); // R2 좌측

  // 시설한계
  if ($('ck_clr').checked) {
    poly(SEC.clr_off, true);
    ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 1 * dpr; ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.stroke();
    ctx.setLineDash([]);
    poly(SEC.clr, true);
    ctx.fillStyle = 'rgba(74,222,128,.10)'; ctx.fill();
    ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 1.6 * dpr; ctx.stroke();
  }
  // 공동구
  if ($('ck_duct').checked) SEC.ducts.forEach(d => {
    poly(d.pts, true);
    ctx.fillStyle = 'rgba(251,191,36,.18)'; ctx.fill();
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.4 * dpr; ctx.stroke();
  });
  // 부대공 (참고 표시)
  (SEC.extras || []).forEach(e => {
    if (e.binding) { ctx.setLineDash([]); ctx.strokeStyle = '#c4b5fd'; ctx.lineWidth = 2 * dpr; }
    else { ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 1.3 * dpr; }
    if (e.kind === 'jetfan') {
      ctx.beginPath(); ctx.arc(X(e.c[0]), Y(e.c[1]), e.r * S, 0, Math.PI * 2); ctx.stroke();
    } else { poly(e.pts, true); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = '#a78bfa'; ctx.font = (11 * dpr) + 'px Malgun Gothic';
    const a = e.kind === 'jetfan' ? [e.c[0], e.c[1] + e.r] : e.pts[3];
    ctx.textAlign = 'center';
    ctx.fillText(e.label + (e.binding ? ' [제약]' : ' ※표시만'), X(a[0]), Y(a[1]) - 6 * dpr);
  });

  // 중심점 · 스프링잉 · 반지름선
  if ($('ck_geo').checked) {
    const dot = (p, col, lb) => {
      ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 3.5 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
      if (lb) {
        ctx.font = (11 * dpr) + 'px Malgun Gothic'; ctx.fillStyle = col; ctx.textAlign = 'left';
        ctx.fillText(lb, X(p[0]) + 6 * dpr, Y(p[1]) - 5 * dpr);
      }
    };
    const ray = (a, b, col) => {
      ctx.beginPath(); ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1]));
      ctx.strokeStyle = col; ctx.lineWidth = 1 * dpr; ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.stroke(); ctx.setLineDash([]);
    };
    ray(SEC.O1, SEC.SR, '#7cc4ff'); ray(SEC.O1, SEC.SL, '#7cc4ff');
    ray(SEC.O2R, SEC.BR, '#f472b6'); ray(SEC.O2L, SEC.BL, '#facc15');
    dot(SEC.O1, '#7cc4ff', 'O1 (R1=' + SEC.R1.toFixed(0) + ')');
    dot(SEC.O2R, '#f472b6', "O2' (R2'=" + SEC.R2p.toFixed(0) + ')');
    dot(SEC.O2L, '#facc15', 'O2 (R2=' + SEC.R2.toFixed(0) + ')');
    dot(SEC.SR, '#e8eaed', '스프링잉 R'); dot(SEC.SL, '#e8eaed', '스프링잉 L');
  }

  // 치수
  if ($('ck_dim').checked) {
    ctx.font = (12 * dpr) + 'px Malgun Gothic'; ctx.textAlign = 'center';
    const ys = SEC.poly.map(p => p[1]), xs = SEC.poly.map(p => p[0]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y1 = Math.max(...ys);
    const dimLine = (ax, ay, bx, by, txt, col) => {
      ctx.strokeStyle = col; ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.moveTo(X(ax), Y(ay)); ctx.lineTo(X(bx), Y(by)); ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillText(txt, (X(ax) + X(bx)) / 2, (Y(ay) + Y(by)) / 2 - 6 * dpr);
    };
    dimLine(x0, -700, x1, -700, '내공 폭 ' + SEC.width.toFixed(0), '#9aa4b2');
    ctx.save(); ctx.translate(X(x1) + 34 * dpr, (Y(0) + Y(y1)) / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#9aa4b2'; ctx.fillText('내공 높이 ' + SEC.height.toFixed(0), 0, 0); ctx.restore();
    ctx.strokeStyle = '#9aa4b2';
    ctx.beginPath(); ctx.moveTo(X(x1) + 22 * dpr, Y(0)); ctx.lineTo(X(x1) + 22 * dpr, Y(y1)); ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillStyle = '#4ade80';
    ctx.fillText('시설한계 ' + $('p_H').value + 'm · 여유 ' + SEC.margin.toFixed(1) + 'mm',
      X(0) + 8 * dpr, Y(parseFloat($('p_H').value) * 1000) - 8 * dpr);
  }
}

/* ---------------------------------------------------------------- 스윕 표/산점도 */
function fillTable() {
  const tb = $('tbl').querySelector('tbody');
  const idx = ROWS.map((r, i) => i).sort((a, b) => ROWS[a].area_m2 - ROWS[b].area_m2);
  tb.innerHTML = idx.map(i => {
    const r = ROWS[i];
    return '<tr data-i="' + i + '" class="' + (i === CUR ? 'cur' : '') + (i === BEST ? ' best' : '') + '">' +
      '<td>' + (i + 1) + '</td><td>' + r.cc.toFixed(2) + '</td><td>' + r.s + '</td><td>' + r.EL1.toFixed(2) +
      '</td><td>' + r.theta + '</td><td>' + r.R1.toFixed(0) + '</td><td>' + r.R2.toFixed(0) +
      '</td><td>' + r.R2p.toFixed(0) + '</td><td>' + r.area_m2.toFixed(2) + '</td><td>' + r.flat.toFixed(4) +
      '</td><td>' + r.margin.toFixed(0) + '</td><td class="' + (r.j === 'OK' ? 'ok' : 'ng') + '">' + r.j + '</td></tr>';
  }).join('');
  tb.querySelectorAll('tr').forEach(tr => tr.onclick = () => applyRow(+tr.dataset.i));
}

function applyRow(i) {
  const r = ROWS[i]; CUR = i;
  $('cc').value = r.cc; $('s').value = r.s; $('el').value = r.EL1; $('th').value = r.theta;
  syncLabels(); view.fit = true; refresh(); fillTable(); drawScatter();
}

function drawScatter() {
  const cv = $('sc'), ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!ROWS.length) {
    ctx.fillStyle = '#5b6674'; ctx.font = (12 * dpr) + 'px Malgun Gothic'; ctx.textAlign = 'center';
    ctx.fillText('스윕 실행을 누르면 대안이 여기 표시된다', cv.width / 2, cv.height / 2);
    return;
  }
  const pad = 34 * dpr;
  const ax = ROWS.map(r => r.area_m2), fl = ROWS.map(r => r.flat);
  const x0 = Math.min(...ax), x1 = Math.max(...ax), y0 = Math.min(...fl), y1 = Math.max(...fl);
  const X = (v) => pad + (v - x0) / (x1 - x0 || 1) * (cv.width - pad * 1.4);
  const Y = (v) => cv.height - pad + 6 * dpr - (v - y0) / (y1 - y0 || 1) * (cv.height - pad * 1.5);
  ctx.strokeStyle = '#1e242c'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, 6 * dpr); ctx.lineTo(pad, cv.height - pad + 6 * dpr);
  ctx.lineTo(cv.width - 6 * dpr, cv.height - pad + 6 * dpr); ctx.stroke();
  ctx.fillStyle = '#7d8794'; ctx.font = (10 * dpr) + 'px Malgun Gothic';
  ctx.textAlign = 'center'; ctx.fillText('내공단면적 ㎡ (작을수록 경제적) →', cv.width / 2, cv.height - 6 * dpr);
  ctx.save(); ctx.translate(11 * dpr, cv.height / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('편평률 (클수록 안전) →', 0, 0); ctx.restore();
  ctx.textAlign = 'left'; ctx.fillText(x0.toFixed(1), pad, cv.height - pad + 18 * dpr);
  ctx.textAlign = 'right'; ctx.fillText(x1.toFixed(1), cv.width - 8 * dpr, cv.height - pad + 18 * dpr);
  ROWS.forEach((r, i) => {
    ctx.beginPath(); ctx.arc(X(r.area_m2), Y(r.flat), (i === CUR || i === BEST ? 4.5 : 2.4) * dpr, 0, Math.PI * 2);
    ctx.fillStyle = i === CUR ? '#fbbf24' : i === BEST ? '#f472b6' : (r.j === 'OK' ? '#4ade80' : '#4a5765');
    ctx.fill();
  });
}

/* ---------------------------------------------------------------- 대안 형상 비교 */
async function buildThumbs() {
  const host = $('thumbs'); host.innerHTML = '';
  const top = ROWS.map((r, i) => [r, i]).filter(([r]) => r.j === 'OK')
    .sort((a, b) => a[0].area_m2 - b[0].area_m2).slice(0, 12);
  for (const [r, i] of top) {
    const q = query(); q.cc = r.cc * 1000; q.s = r.s; q.EL1 = r.EL1 * 1000; q.theta = r.theta;
    const d = await post('/api/section', q);
    const div = document.createElement('div'); div.className = 'th';
    div.innerHTML = '<canvas></canvas><div class="lb"><b>' + r.area_m2.toFixed(2) + '㎡</b> 편평 ' +
      r.flat.toFixed(3) + '<br>cc' + r.cc.toFixed(2) + ' s' + (r.s > 0 ? '+' : '') + r.s +
      ' EL' + r.EL1.toFixed(2) + ' θ' + r.theta + '</div>';
    div.onclick = () => { document.querySelector('.tab[data-t=pareto]').click(); applyRow(i); };
    host.appendChild(div);
    const cv = div.querySelector('canvas');
    const dpr = window.devicePixelRatio || 1;
    cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
    const c = cv.getContext('2d');
    const f = fitView(cv, d.poly, 6 * dpr);
    const X = (x) => f.ox + x * f.s, Y = (y) => f.oy - y * f.s;
    c.beginPath(); d.poly.forEach((p, k) => k ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])));
    c.closePath(); c.fillStyle = 'rgba(77,163,255,.10)'; c.fill();
    c.strokeStyle = '#7cc4ff'; c.lineWidth = 1.4 * dpr; c.stroke();
    c.beginPath(); d.clr.forEach((p, k) => k ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])));
    c.closePath(); c.strokeStyle = '#4ade80'; c.lineWidth = 1 * dpr; c.stroke();
  }
}

/* ---------------------------------------------------------------- 원본 60행 */
async function loadLegacy() {
  const d = await (await fetch('/api/legacy')).json();
  LEG = d.rows || [];
  $('prj').textContent = (d.input4 && d.input4.project ? d.input4.project + ' / ' + d.input4.tunnel + ' ' + d.input4.section : '');
  $('tblLeg').querySelector('tbody').innerHTML = LEG.map((r, i) =>
    '<tr><td>' + (i + 1) + '</td><td>' + r.road_center_m + '</td><td>' + r.superelev_pct +
    '</td><td>' + (+r.center_h_m).toFixed(2) + '</td><td>' + r.center_ang_deg + '</td><td>' +
    (+r.R1).toFixed(0) + '</td><td>' + (+r.R2).toFixed(0) + '</td><td>' + (+r.R2p).toFixed(0) +
    '</td><td>' + (r.area / 1e6).toFixed(2) + '</td><td>' + (+r.flatness).toFixed(4) +
    '</td><td class="' + (r.judge_flatness === 'OK' ? 'ok' : 'ng') + '">' + r.judge_flatness + '</td></tr>').join('');
}

/* ---------------------------------------------------------------- 이벤트 */
function syncLabels() {
  $('v_cc').textContent = (+$('cc').value).toFixed(2);
  $('v_s').textContent = $('s').value;
  $('v_el').textContent = (+$('el').value).toFixed(2);
  $('v_th').textContent = $('th').value;
}

['cc', 's', 'el', 'th'].forEach(id => $(id).addEventListener('input', () => {
  syncLabels(); CUR = -1; refresh();
}));
PKEYS.forEach(k => $('p_' + k).addEventListener('change', () => { view.fit = true; refresh(); }));
['tol', 'flat_min', 'margin_min'].forEach(id => $(id).addEventListener('change', refresh));
['ck_clr', 'ck_duct', 'ck_geo', 'ck_dim'].forEach(id => $(id).addEventListener('change', draw));
['ck_walk', 'ck_jet', 'bd_walk', 'bd_jet', 'ck_five'].forEach(id => $(id).addEventListener('change', () => { view.fit = true; refresh(); }));
$('ck_layers').addEventListener('change', () => { view.fit = true; draw(); });
PRAW.forEach(k => $('p_' + k).addEventListener('change', refresh));
['sw_cc0', 'sw_cc1', 'sw_cc2', 'sw_s0', 'sw_s1', 'sw_s2', 'sw_el0', 'sw_el1', 'sw_el2', 'sw_th0', 'sw_th1', 'sw_th2']
  .forEach(id => $(id).addEventListener('input', () => {
    $('swInfo').innerHTML = '선언 조합 = <b>' + nCombo() + '</b>';
  }));
$('btnSweep').onclick = runSweep;
async function exportAs(kind, btn, label) {
  const b = $(btn); const t = b.textContent; b.disabled = true; b.textContent = '…';
  const q = query(); if (kind === 'csv') q.rows = ROWS;
  const d = await post('/api/export', { ...q, kind });
  b.disabled = false; b.textContent = t;
  if (d.error) { alert(d.error); return; }
  const a = document.createElement('a'); a.href = d.url; a.download = d.file;
  document.body.appendChild(a); a.click(); a.remove();
}
$('btnHelp').onclick = () => window.open('/docs/사용자_설명서.html', '_blank');
$('btnDxf').onclick = () => exportAs('dxf', 'btnDxf');
$('btnJson').onclick = () => exportAs('json', 'btnJson');
$('btnCsv').onclick = () => exportAs('csv', 'btnCsv');
$('btnReport').onclick = async () => {
  const b = $('btnReport'); b.disabled = true; b.textContent = '생성 중…';
  const q = query(); q.rows = ROWS.length ? ROWS : null;
  const d = await post('/api/report', q);
  b.disabled = false; b.textContent = '검토보고서';
  if (d.error) { alert(d.error); return; }
  window.open('/report/latest', '_blank');
};
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('on'));
  document.querySelectorAll('.pane').forEach(x => x.classList.remove('on'));
  t.classList.add('on'); $('pane-' + t.dataset.t).classList.add('on');
  if (t.dataset.t === 'pareto') drawScatter();
});

/* 팬/줌 */
(() => {
  const cv = $('cv'); let drag = null;
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const mx = (e.clientX - r.left) * dpr, my = (e.clientY - r.top) * dpr;
    view.ox = mx - (mx - view.ox) * k; view.oy = my - (my - view.oy) * k; view.s *= k; draw();
  }, { passive: false });
  cv.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy }; });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dpr = window.devicePixelRatio || 1;
    view.ox = drag.ox + (e.clientX - drag.x) * dpr; view.oy = drag.oy + (e.clientY - drag.y) * dpr; draw();
  });
  window.addEventListener('mouseup', () => { drag = null; });
  cv.addEventListener('dblclick', () => { view.fit = true; draw(); });
  window.addEventListener('resize', () => { view.fit = true; draw(); drawScatter(); });
})();

/* QA 훅 — ?autosweep=1&tab=pareto|grid|legacy&jet=1  (헤드리스 캡처용) */
async function boot() {
  const u = new URLSearchParams(location.search);
  if (u.get('jet') === '1') $('ck_jet').checked = true;
  if (u.get('bindjet') === '1') { $('ck_jet').checked = true; $('bd_jet').checked = true; }
  if (u.get('bindwalk') === '1') { $('ck_walk').checked = true; $('bd_walk').checked = true; }
  ['cc', 's', 'el', 'th'].forEach(k => { if (u.has(k)) $(k).value = u.get(k); });
  syncLabels();
  await loadLegacy();
  await refresh();
  drawScatter();
  if (u.get('autosweep') === '1') {
    await runSweep();
    if (u.get('best') === '1' && BEST >= 0) applyRow(BEST);
  }
  const t = u.get('tab');
  if (t) { const b = document.querySelector('.tab[data-t=' + t + ']'); if (b) b.click(); }
  document.body.dataset.ready = '1';
}
boot();
