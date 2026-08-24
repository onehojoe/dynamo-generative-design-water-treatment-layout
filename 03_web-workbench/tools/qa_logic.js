// 로직 회귀검사 — 브라우저 없이(최소 DOM 스텁 위에서) app.js를 실제로 실행해
// 기준안 재현 · 총점 회계 · 계통 참여 · UV 수복/결정성/연속성 · 목표 독립재계산 ·
// 파레토 · 필터 · 내보내기 · 퍼머링크 · 추론 · 자동개선을 검사한다.
// 사용: node tools/qa_logic.js   (selfcheck.py가 자동으로 호출한다)
// ※ 검사하지 못하는 것: 실제 렌더링 픽셀, 마우스 이벤트 배선, Dynamo 실행값과의 일치,
//    계통 가중·이격 규정 수치의 진위(이건 원문 대조로만 풀린다).
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.dirname(__dirname);

// ---- 최소 DOM 스텁 ----
const noopCtx = new Proxy({}, {
  get: (t, k) => {
    if (k === "measureText") return () => ({ width: 50 });
    if (k === "canvas") return { width: 800, height: 400 };
    return () => {};
  },
  set: () => true,
});
function makeEl(id) {
  return {
    id, value: "", textContent: "", innerHTML: "", checked: false,
    className: "", style: {}, width: 800, height: 400,
    clientWidth: 800, clientHeight: 400, offsetWidth: 800,
    children: [],
    getContext: () => noopCtx,
    addEventListener() {}, removeEventListener() {},
    setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {},
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(c) { this.children.push(c); return c; },
    remove() {}, click() {}, focus() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
    querySelector: () => makeEl("q"),
    toBlob: (cb) => cb({ size: 1 }),
  };
}
const els = {};
const document = {
  getElementById: (id) => (els[id] || (els[id] = makeEl(id))),
  createElement: (t) => makeEl("new-" + t),
  addEventListener: (ev, fn) => { if (ev === "DOMContentLoaded") document._ready = fn; },
  body: makeEl("body"),
};
const listeners = {};
const window = { devicePixelRatio: 1, addEventListener: (ev, fn) => { listeners[ev] = fn; } };
const captured = { hash: "" };
const ctxObj = {
  document, window, console, Math, Date, JSON, Number, Set, Map, Array, Object, String, Boolean, isNaN,
  Uint8Array, Int32Array, Float64Array, Proxy, Error,
  parseInt, parseFloat, setTimeout, clearTimeout,
  setInterval: () => 0, clearInterval: () => {}, requestAnimationFrame: (f) => f(),
  Blob: function (parts) { this.parts = parts; this.size = String(parts[0]).length; },
  URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => {} },
  history: { replaceState: (a, b, h) => { captured.hash = h; } },
  location: { hash: "", href: "http://x/" },
  navigator: {},
  module: undefined,
};
ctxObj.globalThis = ctxObj;
vm.createContext(ctxObj);

for (const f of ["js/data.js", "js/network.js", "js/engine.js", "js/score.js", "js/reason.js", "js/app.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf-8"), ctxObj, { filename: f });
}

// 파라미터 입력값 세팅 후 초기화 실행
[59, 59, 45, 0, 0, 0, 0, 0, 0, 0, 0].forEach((v, i) => { document.getElementById("seed" + i).value = String(v); });
[["gridN", "51"], ["clearance", "10"], ["costRate", "1"], ["expGridN", "64"],
 ["wO1", "45"], ["wO2", "15"], ["wO3", "20"], ["wO4", "20"], ["pRev", "3"], ["pHaz", "5"],
 ["altCount", "30"], ["searchSeed", "1"], ["optIters", "400"], ["optStep", "0.14"],
 ["netSel", "v2"], ["measure", "center"], ["hazMin", ""]].forEach(([k, v]) => { document.getElementById(k).value = v; });
document._ready();

const fails = [];
let n = 0;
const check = (name, ok, detail) => {
  n++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};
const run = (code) => vm.runInContext(code, ctxObj);
const S = run("state");
const DATA = run("SITE_DATA");
const NET = run("WTP_NETWORK");
const ACCESS = run("WTP_ACCESS");

// ── 1. 기준안 재현 (dyn 시드) ─────────────────────────────────
check("기준안 배치 = count 11 / legacy 1402m",
  S.result.count === 11 && S.result.lengthM === 1402,
  `count ${S.result.count} · ${S.result.lengthM}m`);

// ── 2. 기준안 총점 = 정확히 100 ──────────────────────────────
// 지수의 분모가 기준안 자신이므로 네 지수 모두 100 → 가중평균 100. 감점이 있으면 그만큼 깎인다.
check("기준안 총점 = 100 − 감점",
  Math.abs(S.score.gross - 100) < 0.051,
  `gross ${S.score.gross} · 감점 ${S.score.penaltySum} · 총점 ${S.score.total}`);

// ── 3. 회계 일치 — 표의 기여 합 − 감점 = 총점 ────────────────
{
  const sc = S.score;
  const sum = sc.items.reduce((a, b) => a + b.contrib, 0);
  const manual = Math.round((sum - sc.penaltySum) * 10) / 10;
  check("총점 회계 = 기여합 − 감점", sc.reconciles && (sc.disq || Math.abs(manual - sc.total) < 0.051),
    `기여합 ${sum.toFixed(1)} − 감점 ${sc.penaltySum} = ${manual} vs 총점 ${sc.total}`);
}

// ── 4. 계통 v2 = 11개 박스 전원 채점 참여 ────────────────────
{
  const inNet = new Set();
  NET.forEach((l) => { inNet.add(l.a); inNet.add(l.b); });
  ACCESS.forEach((a) => inNet.add(a.facility));
  const orphan = DATA.boxes.filter((b) => !b.label.split(",").some((f) => inNet.has(f.trim())));
  check("계통 v2 — 채점에 빠진 시설 0", orphan.length === 0,
    orphan.length ? `빠짐 [${orphan.map((b) => b.label).join("], [")}]` : `11/11 참여`);
}

// ── 5. dyn 8쌍은 [8]·[13]을 안 본다 (결함 실재 증명 = 회귀 방지) ──
{
  const inDyn = new Set();
  DATA.connections.forEach((c) => { inDyn.add(String(c[0])); inDyn.add(String(c[1])); });
  const orphan = DATA.boxes.filter((b) => !b.label.split(",").some((f) => inDyn.has(f.trim())));
  const labels = orphan.map((b) => b.label).sort().join(",");
  check("dyn 8쌍 — [8]·[13]이 채점에서 빠져 있음(확인)", labels === "13,8",
    `빠진 시설 = [${orphan.map((b) => b.label).join("], [")}]`);
}

// ── 6. [8]·[13]을 실제로 옮겨 O1 불변을 확인 (무기여의 직접 실증) ──
// ★시드를 바꿔 옮기는 방식은 쓸 수 없다 — 시드판은 후보점을 소거하며 진행해서
//   한 시설의 시드를 건드리면 뒤 시설들이 연쇄로 따라 움직인다(1차 시도에서 실측).
//   그래서 배치 결과를 직접 평행이동시켜 평가만 다시 한다.
{
  const shift = (label, dx, dy) => {
    const placed = JSON.parse(JSON.stringify(S.result.placed));
    const t = placed.find((p) => p.label === label);
    t.cx += dx; t.cy += dy;
    return { placed, failed: [] };
  };
  const evDyn = (r) => run(`evaluate(SITE_DATA, {links: dynNetwork(SITE_DATA), systems: WTP_SYSTEMS, access: [], mainline: [], hazard: []}, ${JSON.stringify(r)}, {clearance:10000, measure:'center', expGridN:64, hazardMinM:null})`);
  const evV2 = (r) => run(`evaluate(SITE_DATA, netOf(), ${JSON.stringify(r)}, evalOpts())`);
  const base = { placed: JSON.parse(JSON.stringify(S.result.placed)), failed: [] };
  let ok = true, detail = [];
  // ★기여하는 목표가 시설마다 다르다: [8]은 역세 링크(L7·L8)로 O1에, [13]은 동선(D2)으로 O4에 들어간다.
  //   dyn 8쌍에는 둘 다 없으므로 O1·O4 어느 쪽도 움직이지 않아야 한다.
  [["8", 30000, 30000, "o1"], ["13", -30000, 25000, "o4"]].forEach(([lb, dx, dy, key]) => {
    const moved = shift(lb, dx, dy);
    const d0 = evDyn(base), d1 = evDyn(moved);
    const v0 = evV2(base), v1 = evV2(moved);
    const dynFlat = d0.o1 === d1.o1 && d0.o4 === d1.o4;   // dyn: O1·O4 둘 다 불변
    const v2Moves = v1[key] !== v0[key];                   // v2: 해당 목표가 움직인다
    if (!(dynFlat && v2Moves)) ok = false;
    detail.push(`[${lb}] dyn O1 ${d0.o1}→${d1.o1}·O4 ${d0.o4}→${d1.o4}${dynFlat ? "(둘 다 불변)" : "(변함)"}` +
      ` · v2 ${key.toUpperCase()} ${v0[key]}→${Math.round(v1[key] * 10) / 10}${v2Moves ? "(변함)" : "(불변)"}`);
  });
  check("[8]·[13] — dyn 8쌍에선 무기여 / 계통 v2에선 점수를 움직인다", ok, detail.join(" | "));
}

// ── 7. UV 결정성 ─────────────────────────────────────────────
{
  const uvs = Array.from({ length: 11 }, (_, i) => ({ u: (i * 7 % 11) / 10, v: (i * 3 % 11) / 10, rot: 0 }));
  const a = run(`runPlacementUV(SITE_DATA, ${JSON.stringify(uvs)}, opts())`);
  const b = run(`runPlacementUV(SITE_DATA, ${JSON.stringify(uvs)}, opts())`);
  check("UV 결정성 — 같은 UV 2회 = 동일 배치",
    JSON.stringify(a.placed) === JSON.stringify(b.placed),
    `count ${a.count} · ${a.lengthM}m`);
}

// ── 8. UV 최근접 수복 — 미배치는 '진짜 자리가 없을 때'만 생기는가 ──────
// ★"수복이면 항상 유효해"는 거짓이다(1차 게이트에서 실검출). 고정 순서 그리디라
//   마지막 큰 시설이 앉을 자리가 0인 경우가 실제로 있다. 그래서 검사할 것은 '전부 성공'이 아니라
//   **실패가 엔진 탓이 아니라 기하학적 불가능 탓인가** 이다 — 전 격자 전수 스캔으로 대조한다.
{
  const rnd = run("mulberry32(4242)");
  const bogus = [];
  let failCases = 0, failBoxes = [];
  for (let t = 0; t < 100; t++) {
    const uvs = Array.from({ length: 11 }, () => ({ u: rnd(), v: rnd(), rot: 0 }));
    const e = run(`evalUv(${JSON.stringify(uvs)})`);
    if (e.ev.overlaps !== 0 || e.ev.outside !== 0) { bogus.push(`#${t} ovl${e.ev.overlaps}/out${e.ev.outside}`); continue; }
    if (e.ev.count === 11) continue;
    failCases++;
    e.ev.failed.forEach((lb) => {
      failBoxes.push(lb);
      // 전수 스캔: 이미 배치된 것들을 그대로 두고, 이 시설이 앉을 수 있는 격자칸이 하나라도 있는가
      const feas = run(`(function(){
        var D = SITE_DATA, box = D.boxes.filter(function(b){return b.label==='${lb}';})[0];
        var G = buildGrid(D.boundary, opts().gridN), placed = ${JSON.stringify(e.result.placed)}, c = 0;
        for (var i=0;i<G.n;i++) for (var j=0;j<G.n;j++) {
          if (!G.inside[i*G.n+j]) continue;
          var cx = G.minX + G.dx*i, cy = G.minY + G.dy*j;
          if (!rectInsideBoundary(cx, cy, box.w, box.h, D.boundary)) continue;
          var hit = false;
          for (var k=0;k<placed.length;k++) if (rectsOverlap({cx:cx,cy:cy,w:box.w,h:box.h}, placed[k], opts().clearance)) { hit = true; break; }
          if (!hit) c++;
        }
        return c;
      })()`);
      if (feas > 0) bogus.push(`#${t} [${lb}] 앉을 자리 ${feas}개가 있는데도 미배치`);
    });
  }
  check("UV — C2 겹침 0 · C3 이탈 0 (100건)", !bogus.some((b) => b.indexOf("ovl") >= 0), bogus.filter((b) => b.indexOf("ovl") >= 0).join(" · ") || "100/100");
  check("UV — 미배치는 전수 스캔 '가능한 자리 0'일 때만 발생",
    bogus.filter((b) => b.indexOf("앉을 자리") >= 0).length === 0,
    `미배치 ${failCases}/100건 (전부 [${Array.from(new Set(failBoxes)).join("], [")}]) — 전부 진짜 불가능`);
}

// ── 9. 연속성 — UV 한 칸이 시드 ±1보다 덜 흔들린다 (전환 근거의 수치 증명) ──
{
  const base = run("runPlacement(SITE_DATA, [59,59,45,0,0,0,0,0,0,0,0], opts())");
  const uv0 = run(`uvFromResult(SITE_DATA, ${JSON.stringify({ placed: base.placed })})`);
  const t0uv = run(`evalUv(${JSON.stringify(uv0)})`).score.total;
  let sumUv = 0, cu = 0;
  for (let k = 0; k < 11; k++) {
    const p = JSON.parse(JSON.stringify(uv0));
    p[k].u = Math.min(1, p[k].u + 0.02);
    const t = run(`evalUv(${JSON.stringify(p)})`).score.total;
    if (t !== null && t0uv !== null) { sumUv += Math.abs(t - t0uv); cu++; }
  }
  const seeds0 = [59, 59, 45, 0, 0, 0, 0, 0, 0, 0, 0];
  const t0s = run(`evalSeeds(${JSON.stringify(seeds0)})`).score.total;
  let sumS = 0, cs = 0;
  for (let k = 0; k < 11; k++) {
    const p = seeds0.slice(); p[k] = p[k] + 1;
    const t = run(`evalSeeds(${JSON.stringify(p)})`).score.total;
    if (t !== null && t0s !== null) { sumS += Math.abs(t - t0s); cs++; }
  }
  const mu = cu ? sumUv / cu : 0, ms = cs ? sumS / cs : 0;
  check("연속성 — UV 1칸 변화 < 시드 ±1 변화", mu < ms,
    `평균 |Δ총점|  UV ${mu.toFixed(2)} · 시드 ${ms.toFixed(2)} (${(ms / (mu || 1e-9)).toFixed(1)}배)`);
}

// ── 10. uvFromResult 왕복 — 시드 배치를 UV로 옮겨도 같은 자리 ──
{
  const base = run("runPlacement(SITE_DATA, [59,59,45,0,0,0,0,0,0,0,0], opts())");
  const uv = run(`uvFromResult(SITE_DATA, ${JSON.stringify({ placed: base.placed })})`);
  const re = run(`runPlacementUV(SITE_DATA, ${JSON.stringify(uv)}, opts())`);
  const same = base.placed.length === re.placed.length && base.placed.every((p, i) => {
    const q = re.placed.find((x) => x.idx === p.idx);
    return q && Math.abs(q.cx - p.cx) < 1 && Math.abs(q.cy - p.cy) < 1;
  });
  check("모드 전환 왕복 — 시드 배치 → UV → 같은 자리", same,
    `${base.placed.length}개 중 일치 ${base.placed.filter((p) => {
      const q = re.placed.find((x) => x.idx === p.idx);
      return q && Math.abs(q.cx - p.cx) < 1 && Math.abs(q.cy - p.cy) < 1;
    }).length}`);
}

// ── 11. O3 최대 빈 사각형 — 독립 알고리즘 대조 ────────────────
{
  const N = 24, margin = 10000;
  const r = run(`largestEmptyRect(SITE_DATA.boundary, state.result.placed, ${margin}, ${N})`);
  // 같은 규칙으로 free 격자를 다시 만들고, 다른 알고리즘(행쌍 스캔)으로 최대 사각형을 구한다
  const B = run("bboxOf(SITE_DATA.boundary)");
  const dx = (B.maxX - B.minX) / N, dy = (B.maxY - B.minY) / N;
  const placed = S.result.placed;
  const free = [];
  for (let i = 0; i < N; i++) {
    free.push([]);
    for (let j = 0; j < N; j++) {
      const x = B.minX + dx * (i + 0.5), y = B.minY + dy * (j + 0.5);
      const inside = run(`pointInPoly(${x}, ${y}, SITE_DATA.boundary)`);
      const hit = placed.some((p) => Math.abs(x - p.cx) <= p.w / 2 + margin && Math.abs(y - p.cy) <= p.h / 2 + margin);
      free[i].push(inside && !hit ? 1 : 0);
    }
  }
  let bestCells = 0;
  for (let j0 = 0; j0 < N; j0++) {
    const colOk = new Array(N).fill(1);
    for (let j1 = j0; j1 < N; j1++) {
      for (let i = 0; i < N; i++) if (!free[i][j1]) colOk[i] = 0;
      let run_ = 0;
      for (let i = 0; i < N; i++) {
        run_ = colOk[i] ? run_ + 1 : 0;
        const cells = run_ * (j1 - j0 + 1);
        if (cells > bestCells) bestCells = cells;
      }
    }
  }
  const indepArea = Math.round((bestCells * dx * dy) / 1e6);
  check("O3 최대 빈 사각형 = 독립 알고리즘과 일치",
    Math.abs(indepArea - r.areaM2) <= Math.max(2, indepArea * 0.02),
    `엔진 ${r.areaM2.toLocaleString()} m² (${r.wM}×${r.hM}) vs 독립 ${indepArea.toLocaleString()} m²`);
}

// ── 12. O2 교차 — 독립 재계산 ────────────────────────────────
{
  const ev = S.ev;
  const live = ev.links.filter((l) => !l.missing);
  let cnt = 0;
  const seg = (p, q, r, s) => run(`segIntersect([${p}],[${q}],[${r}],[${s}])`);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const A = live[i], B = live[j];
      if (A.from.idx === B.from.idx || A.from.idx === B.to.idx || A.to.idx === B.from.idx || A.to.idx === B.to.idx) continue;
      if (seg([A.from.cx, A.from.cy], [A.to.cx, A.to.cy], [B.from.cx, B.from.cy], [B.to.cx, B.to.cy])) cnt++;
    }
  }
  check("O2 교차 건수 = 독립 재계산", cnt === ev.crossings.length, `엔진 ${ev.crossings.length} vs 독립 ${cnt}`);
}

// ── 13. 대안 생성 + 4목표 파레토 = 독립 재계산 ───────────────
document.getElementById("altCount").value = "40";
run("generateGallery()");
{
  const g = S.gallery;
  const liveA = g.filter((a) => a.score.total !== null);
  const dom = (b, a) => {
    const K = [["o1", "min"], ["o2", "min"], ["o3", "max"], ["o4", "min"]];
    const ge = K.every(([k, d]) => (d === "min" ? b.ev[k] <= a.ev[k] : b.ev[k] >= a.ev[k]));
    const gt = K.some(([k, d]) => (d === "min" ? b.ev[k] < a.ev[k] : b.ev[k] > a.ev[k]));
    return ge && gt;
  };
  const indep = liveA.filter((a) => !liveA.some((b) => b !== a && dom(b, a)));
  const marked = g.filter((a) => a.pareto);
  check("대안 40건 생성", g.length === 40, `${g.length}건 · 유효 ${liveA.length} · 실격 ${g.length - liveA.length}`);
  check("4목표 파레토 = 독립 재계산",
    marked.length === indep.length && marked.every((a) => indep.includes(a)),
    `파레토 ${marked.length}건`);
}

// ── 14. 브러시 필터 (Count 최대 구간) ────────────────────────
{
  const g = S.gallery;
  const maxC = Math.max(...g.map((a) => a.ev.count));
  S.brushes = { count: { lo: maxC - 0.5, hi: maxC + 0.5 } };
  S.hideDisq = false;
  const vis = run("visibleGallery()");
  const expect = g.filter((a) => a.ev.count === maxC);
  check("브러시(Count 최대) 필터 결과 일치",
    vis.length === expect.length && vis.every((a) => expect.includes(a)),
    `${vis.length}건 (전체 ${g.length}, Count=${maxC})`);
  S.brushes = { count: { lo: 999, hi: 1000 } };
  const vis3 = run("visibleGallery()");
  run("renderGallery()");
  check("불가능 구간 → 0건 + 에러 없음", vis3.length === 0, `${vis3.length}건`);
  S.brushes = {};
  S.hideDisq = true;
  run("renderGallery(); drawParallel();");
}

// ── 15. CSV — 열 수 일치 · 라벨 쉼표 보존 · BOM ──────────────
let csvText = null;
const origBlob = ctxObj.Blob;
{
  ctxObj.Blob = function (parts) { csvText = String(parts[0]); this.size = csvText.length; };
  run("exportCsv()");
  const lines = csvText.trim().split("\r\n");
  const splitCsv = (line) => {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur); return out;
  };
  const headCols = splitCsv(lines[0]).length;
  const rowCols = lines.slice(1).map((l) => splitCsv(l).length);
  check("CSV 모든 행의 열 수 = 헤더", rowCols.every((c) => c === headCols),
    `헤더 ${headCols} · 행 ${Array.from(new Set(rowCols)).join("/")}`);
  check("CSV 헤더에 라벨 9,10,11이 한 칸으로 보존",
    splitCsv(lines[0]).includes("seed_9,10,11"), splitCsv(lines[0]).slice(0, 4).join(" | "));
  check("CSV BOM 선두", csvText.charCodeAt(0) === 0xFEFF, `0x${csvText.charCodeAt(0).toString(16)}`);
}

// ── 16. JSON — 좌표·목표·제약·경고 ──────────────────────────
{
  let jsonText = null;
  ctxObj.Blob = function (parts) { jsonText = String(parts[0]); this.size = jsonText.length; };
  run("exportJson()");
  const p = JSON.parse(jsonText);
  check("JSON placements = 배치 박스 수", p.placements.length === S.ev.count, `${p.placements.length}건`);
  check("JSON 목표·제약·회계·경고 포함",
    p.objectives && p.constraints && p.score && p.score.items.length === 4 && p.caveats.length >= 6,
    `objectives ✓ constraints ✓ items ${p.score.items.length} caveats ${p.caveats.length}`);
  // 회계가 JSON 안에서도 맞는가
  const sum = p.score.items.reduce((a, b) => a + b.contribution, 0);
  const pen = (p.score.penalties || []).reduce((a, b) => a + b.points, 0);
  check("JSON 안의 회계도 일치",
    p.score.total === null || Math.abs((sum - pen) - p.score.total) < 0.051,
    `${sum.toFixed(1)} − ${pen} = ${(sum - pen).toFixed(1)} vs ${p.score.total}`);
}

// ── 17. 추론 리포트 MD ──────────────────────────────────────
{
  let md = null;
  ctxObj.Blob = function (parts) { md = String(parts[0]); this.size = md.length; };
  run("exportReport()");
  check("추론 리포트 MD 생성", md && md.indexOf("# 정수장 시설배치") === 0 && md.length > 800,
    `${md ? md.length : 0}자`);
  check("리포트에 HTML 태그가 남지 않음", md && !/<[a-z/][^>]*>/i.test(md),
    md ? (md.match(/<[a-z/][^>]*>/i) || ["없음"])[0] : "–");
  ctxObj.Blob = origBlob;
}

// ── 18. 추론 섹션 — 9개 · 회계표 합계 일치 ───────────────────
{
  const secs = run("explain({data:SITE_DATA, net:netOf(), result:state.result, ev:state.ev, score:state.score, gallery:state.gallery, selectedId:state.selected})");
  check("추론 섹션 9개 생성", secs.length === 9, `${secs.length}개: ${secs.map((s) => s.id).join(",")}`);
  const acct = secs[0];
  check("추론 회계표 = 목표 4행 + 총점행(+감점행)", acct.kind === "table" && acct.rows.length >= 5,
    `${acct.rows.length}행`);
  check("추론 회계표가 불일치를 표시하지 않음", !acct.bad, acct.note);
}

// ── 19. 자동 개선 — 총점 단조 증가 · 로그가 실제 개선분 ──────
{
  run("state.mode='uv'");
  run("state.uvs = uvFromResult(SITE_DATA, runPlacement(SITE_DATA,[59,59,45,0,0,0,0,0,0,0,0],opts()))");
  const opt = run(`makeOptimizer({uvs: state.uvs, evalUv: evalUv, labels: SITE_DATA.placeOrder.map(i=>'['+SITE_DATA.boxes[i].label+']'), maxIter: 120, step0: 0.14, seed: 7, allowRotate: false})`);
  const t0 = opt.cur.score.total;
  while (!opt.done) opt.tick(20);
  const t1 = opt.best.score.total;
  check("자동 개선 — 최고 총점 ≥ 시작 총점", t1 !== null && t0 !== null && t1 >= t0 - 1e-9,
    `${t0.toFixed(1)} → ${t1.toFixed(1)} (시도 ${opt.tried} · 채택 ${opt.accepted})`);
  const monotone = opt.log.every((e, i) => e.gain > 0 && e.after > e.before &&
    (i === 0 || e.before >= opt.log[i - 1].after - 1e-9));
  check("자동 개선 로그 = 채택분만 · 총점 단조", monotone, `로그 ${opt.log.length}건`);
  const best2 = run(`evalUv(${JSON.stringify(opt.bestUvs)})`);
  check("자동 개선 최고안 재현 = 같은 총점",
    best2.score.total !== null && Math.abs(best2.score.total - t1) < 0.051,
    `재현 ${best2.score.total} vs 기록 ${t1}`);

  // ★UI 경로까지 검사한다 — setUvUI → runOnce 를 거친 화면 총점이 로그의 최고 총점과 같은가.
  //   개발 중 이 경로가 표시용 반올림·range step 스냅 때문에 172.7 → 171.3 으로 어긋났다(헤드리스 캡처에서 실검출).
  run(`state.opt = ${JSON.stringify({ bestUvs: opt.bestUvs })}`);
  run("setUvUI(state.opt.bestUvs); runOnce()");
  check("‘최고안 적용’ UI 경로 = 로그의 최고 총점과 일치",
    S.score.total !== null && Math.abs(S.score.total - t1) < 0.051,
    `화면 ${S.score.total} vs 로그 ${t1}`);
  run("state.opt = null; state.mode='seed'");
}

// ── 20. 퍼머링크 왕복 (UV 모드 포함) ────────────────────────
{
  // seed 모드
  run("writeHash()");
  const h1 = captured.hash;
  const before = S.seeds.slice();
  S.seeds = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  ctxObj.location.hash = h1;
  const u1 = run("readHash()");
  check("퍼머링크 왕복 — 시드 모드", u1 && JSON.stringify(S.seeds) === JSON.stringify(before), h1.slice(0, 60) + "…");
  // uv 모드
  run("state.mode='uv'");
  run("state.uvs = uvFromResult(SITE_DATA, state.result)");
  run("writeHash()");
  const h2 = captured.hash;
  const uvBefore = JSON.parse(JSON.stringify(S.uvs));
  S.uvs = null;
  ctxObj.location.hash = h2;
  const u2 = run("readHash()");
  const ok2 = u2 && S.uvs && S.uvs.length === 11 &&
    S.uvs.every((g, i) => Math.abs(g.u - uvBefore[i].u) < 0.0011 && Math.abs(g.v - uvBefore[i].v) < 0.0011);
  check("퍼머링크 왕복 — UV 모드(소수 3자리 허용오차)", ok2, h2.slice(0, 60) + "…");
  run("state.mode='seed'");
}

// ── 21. 스케일바 1·2·5 계열 ─────────────────────────────────
{
  const nice = run("[0.0005,0.002,0.01].map(s=>niceScaleLength(s,1))");
  check("스케일바 1·2·5 계열", nice.every((v) => {
    const m = v / Math.pow(10, Math.floor(Math.log10(v)));
    return [1, 2, 5, 10].some((k) => Math.abs(m - k) < 1e-9);
  }), JSON.stringify(nice));
}

console.log(`\n결과: 검사 ${n}건 중 FAIL ${fails.length} ${fails.length ? JSON.stringify(fails) : ""}`);
process.exit(fails.length ? 1 : 0);
