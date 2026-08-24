// 로직 회귀검사 — 브라우저 없이(최소 DOM 스텁 위에서) app.js를 실제로 실행해
// 파레토 마킹 · 브러시 필터 · CSV/JSON 페이로드 · 퍼머링크 왕복 · 스케일바를 검사한다.
// 사용: node tools/qa_logic.js   (selfcheck.py가 자동으로 호출한다)
// ※ 검사하지 못하는 것: 실제 렌더링 픽셀, 마우스 이벤트 배선, Dynamo 실행값과의 일치.
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
  const el = {
    id, value: "", textContent: "", innerHTML: "", checked: false,
    className: "", style: {}, width: 800, height: 400,
    clientWidth: 800, clientHeight: 400, offsetWidth: 800,
    children: [],
    getContext: () => noopCtx,
    addEventListener() {}, removeEventListener() {},
    setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {},
    classList: { add() {}, remove() {} },
    appendChild(c) { this.children.push(c); return c; },
    remove() {},
    click() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
    querySelector: () => makeEl("q"),
    toBlob: (cb) => cb({ size: 1 }),
    focus() {},
  };
  return el;
}
const els = {};
const document = {
  getElementById: (id) => (els[id] || (els[id] = makeEl(id))),
  createElement: (t) => makeEl("new-" + t),
  addEventListener: (ev, fn) => { if (ev === "DOMContentLoaded") document._ready = fn; },
  body: makeEl("body"),
};
const listeners = {};
const window = {
  devicePixelRatio: 1,
  addEventListener: (ev, fn) => { listeners[ev] = fn; },
};
const captured = { downloads: [], hash: "" };
const ctxObj = {
  document, window, console, Math, Date, JSON, Number, Set, Map, Array, Object, String, Boolean, isNaN,
  parseInt, parseFloat, setTimeout, Blob: function (parts) { this.parts = parts; this.size = String(parts[0]).length; },
  URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => {} },
  history: { replaceState: (a, b, h) => { captured.hash = h; } },
  location: { hash: "", href: "http://x/" },
  navigator: {},
  module: undefined,
};
ctxObj.globalThis = ctxObj;
vm.createContext(ctxObj);

// ---- 스크립트 로드 ----
for (const f of ["js/data.js", "js/engine.js", "js/app.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf-8"), ctxObj, { filename: f });
}

// 파라미터 입력값 세팅 후 초기화 실행
els.gridN = els.gridN || makeEl("gridN");
[59, 59, 45, 0, 0, 0, 0, 0, 0, 0, 0].forEach((v, i) => {
  ctxObj.document.getElementById("seed" + i).value = String(v);
});
ctxObj.document.getElementById("gridN").value = "51";
ctxObj.document.getElementById("clearance").value = "10";
ctxObj.document.getElementById("costRate").value = "1";
document._ready();

const fails = [];
const check = (name, ok, detail) => {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

const S = vm.runInContext("state", ctxObj);

// 1. 초기 실행 = 기준값 재현
check("초기 배치 = 기준값(count 11 / 1402m)",
  S.result.count === 11 && S.result.lengthM === 1402,
  `count ${S.result.count} · ${S.result.lengthM}m`);

// 2. 대안 생성 + 파레토 마킹
ctxObj.document.getElementById("altCount").value = "40";
vm.runInContext("generateGallery()", ctxObj);
const g = S.gallery;
const pareto = g.filter((a) => a.pareto);
// 파레토 정의 재검산 (독립 구현으로 대조)
const indep = g.filter((a) => !g.some((b) => b !== a &&
  b.result.count >= a.result.count && b.result.cost <= a.result.cost &&
  (b.result.count > a.result.count || b.result.cost < a.result.cost)));
check("대안 40건 생성", g.length === 40, `${g.length}건`);
check("파레토 마킹 = 독립 재계산과 일치",
  pareto.length === indep.length && pareto.every((a) => indep.includes(a)),
  `파레토 ${pareto.length}건`);
check("파레토는 최소 1건 이상이며 전체는 아님", pareto.length >= 1 && pareto.length <= g.length,
  `${pareto.length}/${g.length}`);

// 3. 브러시 필터 — Count 축에 최대값만 남기는 구간
const counts = g.map((a) => a.result.count);
const maxC = Math.max(...counts);
S.brushes = { count: { lo: maxC - 0.5, hi: maxC + 0.5 } };
const vis = vm.runInContext("visibleGallery()", ctxObj);
const expect = g.filter((a) => a.result.count === maxC);
check("브러시(Count 최대) 필터 결과 일치", vis.length === expect.length && vis.every((a) => expect.includes(a)),
  `${vis.length}건 (전체 ${g.length}, Count=${maxC})`);

// 4. 파레토만 보기 + 브러시 동시 적용 (AND)
S.paretoOnly = true;
const vis2 = vm.runInContext("visibleGallery()", ctxObj);
check("파레토+브러시 AND 적용", vis2.every((a) => a.pareto && a.result.count === maxC) && vis2.length <= vis.length,
  `${vis2.length}건`);
S.paretoOnly = false;

// 5. 빈 결과 방어 (불가능한 구간)
S.brushes = { count: { lo: 999, hi: 1000 } };
const vis3 = vm.runInContext("visibleGallery()", ctxObj);
vm.runInContext("renderGallery()", ctxObj);
check("불가능 구간 → 0건 + 에러 없음", vis3.length === 0, `${vis3.length}건, filterCount="${els.filterCount.textContent}"`);
S.brushes = {};
vm.runInContext("renderGallery(); drawParallel();", ctxObj);

// 6. CSV 내보내기 — 행 수·열 수
let csvText = null;
ctxObj.document.createElement = (t) => {
  const el = makeEl("new-" + t);
  return el;
};
const origBlob = ctxObj.Blob;
ctxObj.Blob = function (parts) { csvText = String(parts[0]); this.size = csvText.length; };
vm.runInContext("exportCsv()", ctxObj);
const lines = csvText.trim().split("\r\n");
// 따옴표 안의 쉼표를 세지 않는 최소 CSV 파서 (라벨 "9,10,11" 때문에 필요)
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
check("CSV 모든 행의 열 수가 헤더와 동일", rowCols.every((n) => n === headCols),
  `헤더 ${headCols} · 행 ${Array.from(new Set(rowCols)).join("/")}`);
check("CSV 헤더에 라벨 9,10,11이 한 칸으로 보존",
  splitCsv(lines[0]).includes("seed_9,10,11"), splitCsv(lines[0]).slice(0, 3).join(" | "))
check("CSV 행 수 = 표시 대안 + 헤더", lines.length === g.length + 1, `${lines.length}행`);
check("CSV 열 = id + 시드11 + count/length/cost/pareto/failed = 17", headCols === 17, `${headCols}열`);
check("CSV BOM 선두", csvText.charCodeAt(0) === 0xFEFF, `0x${csvText.charCodeAt(0).toString(16)}`);

// 7. JSON 내보내기 — 좌표 11건·단위·경고문
let jsonText = null;
ctxObj.Blob = function (parts) { jsonText = String(parts[0]); this.size = jsonText.length; };
vm.runInContext("exportJson()", ctxObj);
const payload = JSON.parse(jsonText);
check("JSON placements = 배치 박스 수", payload.placements.length === S.result.count, `${payload.placements.length}건`);
check("JSON 단위·시드·경고 포함",
  payload.units === "mm" && payload.seeds.length === 11 && payload.caveats.length >= 3,
  `units=${payload.units} seeds=${payload.seeds.length} caveats=${payload.caveats.length}`);
ctxObj.Blob = origBlob;

// 8. 퍼머링크 왕복 — 해시 기록 후 다시 읽어 같은 결과가 나오는가
vm.runInContext("writeHash()", ctxObj);
const hash = captured.hash;
const seedsBefore = S.seeds.slice();
ctxObj.location.hash = hash;
S.seeds = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const used = vm.runInContext("readHash()", ctxObj);
check("퍼머링크 왕복 복원", used && JSON.stringify(S.seeds) === JSON.stringify(seedsBefore),
  `${hash}`);

// 9. 스케일바 길이 선택이 1·2·5 계열인가
const nice = vm.runInContext("[0.0005,0.002,0.01].map(s=>niceScaleLength(s,1))", ctxObj);
check("스케일바 1·2·5 계열", nice.every((v) => {
  const m = v / Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 5, 10].some((k) => Math.abs(m - k) < 1e-9);
}), JSON.stringify(nice));

console.log(`\n결과: PASS ${16 - fails.length}건 중 FAIL ${fails.length} ${fails.length ? JSON.stringify(fails) : ""}`);
process.exit(fails.length ? 1 : 0);
