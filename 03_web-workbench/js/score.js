// score.js — 총점 회계 (v0.4)
//
// 원칙 두 가지.
//  1) 절대금액을 지어내지 않는다. 관로 단가가 미확보이므로 점수는 **기준안 대비 지수**다.
//     기준안 = dyn 저장 시드([59,59,45,0…])의 배치. 그 배치의 모든 지표가 정확히 100.
//  2) 총점은 반드시 회계가 맞아야 한다. 표에 적힌 기여도의 합 − 감점 = 총점.
//     맞지 않으면 표시하지 않는다(게이트가 이걸 검사한다).
"use strict";

const OBJECTIVES = [
  { key: "o1", label: "가중 관로연장", dir: "min", unit: "m·가중", k: 0,
    why: "본류 대구경과 슬러지 소구경의 원가가 다르다. 단순 길이합은 본류를 과소평가한다." },
  { key: "o2", label: "가중 관로교차", dir: "min", unit: "건", k: 1,
    why: "교차는 상하 분리 구조물을 부른다. 본류끼리의 교차가 슬러지 교차보다 훨씬 비싸다." },
  { key: "o3", label: "증설 여지",     dir: "max", unit: "m²", k: 0,
    why: "정수장은 계열 단위로 증설한다. 남는 땅은 넓이가 아니라 '한 덩어리'여야 쓸 수 있다." },
  { key: "o4", label: "반출·관리 동선", dir: "min", unit: "m", k: 0,
    why: "탈수 케이크는 덤프트럭 반출. 관리동은 정문 동선. 둘 다 본류를 관통하면 안 된다." },
];

const DEFAULT_WEIGHTS = { o1: 45, o2: 15, o3: 20, o4: 20 };
const DEFAULT_PENALTY = { reverse: 3, hazard: 5 };

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// 지수: 기준안 = 100. min 목표는 작을수록, max 목표는 클수록 100을 넘는다.
// k는 0 근처에서 지수가 폭발하는 것을 막는 안정화항(교차 건수처럼 0이 가능한 지표용).
function indexOf(val, base, dir, k) {
  const kk = k || 0;
  if (!isFinite(val) || !isFinite(base)) return 0;
  if (val === base) return 100;   // 0 vs 0 같은 퇴화 경우까지 한 줄로 막는다
  if (dir === "min") {
    if (val + kk <= 0) return 300;
    return clamp((100 * (base + kk)) / (val + kk), 0, 300);
  }
  if (base + kk <= 0) return val > 0 ? 300 : 100;
  return clamp((100 * (val + kk)) / (base + kk), 0, 300);
}

// ev = evaluate() 결과, baseEv = 기준안의 evaluate() 결과
// weights = {o1..o4} (합이 100일 필요 없음 — 내부에서 정규화)
function scoreLayout(ev, baseEv, weights, penalty, nBoxes) {
  const W = Object.assign({}, DEFAULT_WEIGHTS, weights || {});
  const P = Object.assign({}, DEFAULT_PENALTY, penalty || {});
  const wSum = OBJECTIVES.reduce((s, o) => s + (W[o.key] || 0), 0) || 1;

  const items = OBJECTIVES.map((o) => {
    const val = ev[o.key], base = baseEv ? baseEv[o.key] : val;
    const index = indexOf(val, base, o.dir, o.k);
    const w = W[o.key] || 0;
    return {
      key: o.key, label: o.label, dir: o.dir, unit: o.unit, why: o.why,
      val, base, index: Math.round(index * 10) / 10,
      weight: w, share: w / wSum,
      contrib: Math.round(((index * w) / wSum) * 10) / 10,
    };
  });

  const gross = items.reduce((s, it) => s + it.contrib, 0);

  // 감점 — C5 자연유하 역행 · C6 안전이격
  const penalties = [];
  if (ev.reverseCount > 0) {
    penalties.push({
      key: "C5", label: `자연유하 역행 ${ev.reverseCount}건`, points: P.reverse * ev.reverseCount,
      detail: ev.reverse.map((r) => `${r.id}([${r.a}]→[${r.b}]) ${r.projM}m`).join(" · "),
    });
  }
  const hazBad = (ev.hazard || []).filter((h) => h.ok === false);
  if (hazBad.length) {
    penalties.push({
      key: "C6", label: `안전이격 미달 ${hazBad.length}건`, points: P.hazard * hazBad.length,
      detail: hazBad.map((h) => `${h.label} ${h.gapM}m`).join(" · "),
    });
  }
  const penSum = penalties.reduce((s, p) => s + p.points, 0);

  // 실격 — C1 배치 수 미달. 배치가 안 된 시설이 있으면 점수를 매기지 않는다.
  const disq = ev.count < (nBoxes || 11)
    ? { key: "C1", reason: `배치 수 ${ev.count}/${nBoxes || 11} — 미배치 [${ev.failed.join(", ")}]` }
    : (ev.overlaps > 0 ? { key: "C2", reason: `박스 겹침 ${ev.overlaps}건` }
      : (ev.outside > 0 ? { key: "C3", reason: `경계 이탈 ${ev.outside}건` } : null));

  const total = disq ? null : Math.round((gross - penSum) * 10) / 10;

  return {
    items, gross: Math.round(gross * 10) / 10, penalties,
    penaltySum: Math.round(penSum * 10) / 10,
    disq, total,
    weights: W, wSum,
    // 회계 검산: 표의 기여 합 − 감점 = 총점 (게이트가 이 값을 본다)
    reconciles: disq ? true : Math.abs((gross - penSum) - total) < 0.051,
  };
}

// 파레토 — 4목표 동시. 실격 대안은 애초에 비교 대상에서 뺀다.
function markPareto4(alts) {
  const live = alts.filter((a) => a.score && a.score.total !== null);
  alts.forEach((a) => { a.pareto = false; });
  live.forEach((a) => {
    a.pareto = !live.some((b) => {
      if (b === a) return false;
      const ge = OBJECTIVES.every((o) => {
        const x = b.ev[o.key], y = a.ev[o.key];
        return o.dir === "min" ? x <= y : x >= y;
      });
      const gt = OBJECTIVES.some((o) => {
        const x = b.ev[o.key], y = a.ev[o.key];
        return o.dir === "min" ? x < y : x > y;
      });
      return ge && gt;
    });
  });
  return alts;
}

if (typeof module !== "undefined") {
  module.exports = { OBJECTIVES, DEFAULT_WEIGHTS, DEFAULT_PENALTY, indexOf, scoreLayout, markPareto4 };
}
