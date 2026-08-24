// reason.js — 추론 (v0.4)
//
// 두 가지를 한다.
//  (1) explain()  — 지금 대안이 왜 이 점수인지, 무엇이 발목을 잡는지, 다음에 뭘 건드려야 하는지를
//                   **실측값에서만** 끌어내 서술한다. 문장은 규칙 기반이고 숫자는 전부 evaluate()가 잰 값이다.
//                   LLM도, 지어낸 근거도 없다.
//  (2) makeOptimizer() — 총점을 올리는 방향으로 UV를 스스로 고쳐 가는 로컬 탐색.
//                   받아들인 수(手)마다 "무엇을 왜 바꿨고 어느 지표가 얼마 움직였는지"를 로그로 남긴다.
//                   이 로그가 곧 추론 과정이다.
//
// ※ 한계(정직): 로컬 탐색은 전역 최적을 보장하지 않는다. 언덕오르기라 시작점에 따라 다른 봉우리에 선다.
//    그래서 "여러 시작점에서 돌려 보라"는 안내를 화면에 남긴다.
"use strict";

// ── 도우미 ────────────────────────────────────────────────────
function fmt(n, d) {
  if (n === null || n === undefined || !isFinite(n)) return "–";
  const p = d === undefined ? 0 : d;
  return Number(n.toFixed(p)).toLocaleString();
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

// ── (1) 서술 ──────────────────────────────────────────────────
// 반환: [{id, title, kind:'table'|'lines'|'note', head?, rows?, lines?}]
function explain(ctx) {
  const { data, net, result, ev, score, gallery, selectedId } = ctx;
  const S = [];
  const nBox = data.boxes.length;

  // ── 1. 채점 회계 ──
  const rows = score.items.map((it) => [
    it.label,
    `${fmt(it.val, it.key === "o2" ? 2 : 0)} ${it.unit}`,
    `${fmt(it.base, it.key === "o2" ? 2 : 0)}`,
    `${fmt(it.index, 1)}`,
    `${fmt(it.weight, 0)}%`,
    `${fmt(it.contrib, 1)}`,
  ]);
  score.penalties.forEach((p) => rows.push([`감점 ${p.key} ${p.label}`, p.detail || "", "", "", "", `−${fmt(p.points, 1)}`]));
  rows.push(["<b>총점</b>", score.disq ? `<b>실격</b> — ${score.disq.reason}` : "", "", "", "",
    `<b>${score.total === null ? "–" : fmt(score.total, 1)}</b>`]);
  S.push({
    id: "acct", title: "1. 채점 회계 — 기준안 대비 지수",
    kind: "table", head: ["목표", "실측", "기준안", "지수", "가중", "기여"], rows,
    note: score.reconciles
      ? "기여 합 − 감점 = 총점. 회계 일치."
      : "★회계 불일치 — 표시 값을 신뢰하지 말 것.",
    bad: !score.reconciles,
  });

  // ── 2. 병목 ──
  const lines2 = [];
  if (score.disq) {
    lines2.push(`<b class="bad">실격</b> — ${score.disq.reason}. 다른 지표는 참고값일 뿐이다.`);
  } else {
    const worst = score.items.slice().sort((a, b) => a.index - b.index)[0];
    const bestIt = score.items.slice().sort((a, b) => b.index - a.index)[0];
    lines2.push(`발목을 잡는 축 = <b>${worst.label}</b> (지수 ${fmt(worst.index, 1)}). ${worst.why}`);
    lines2.push(`가장 나은 축 = <b>${bestIt.label}</b> (지수 ${fmt(bestIt.index, 1)}).`);
    const lost = score.items.filter((it) => it.index < 100);
    if (!lost.length) lines2.push("네 축 모두 기준안 이상이다 — 이 대안은 기준안을 지배한다.");
    else lines2.push(`기준안보다 못한 축: ${lost.map((it) => `${it.label}(${fmt(it.index, 1)})`).join(" · ")}`);
  }
  S.push({ id: "bottleneck", title: "2. 병목 진단", kind: "lines", lines: lines2 });

  // ── 3. O1 내역 ──
  const live = ev.links.filter((l) => !l.missing);
  const top = live.slice().sort((a, b) => b.wLenM - a.wLenM).slice(0, 4);
  const lines3 = top.map((l) => {
    const share = ev.o1 > 0 ? (100 * l.wLenM) / ev.o1 : 0;
    const sys = net.systems[l.system];
    return `<b>${l.id}</b> [${l.a}]→[${l.b}] <span class="dim">${sys ? sys.name : l.system}</span> ` +
      `${fmt(l.lenM)}m × ${l.weight} = <b>${fmt(l.wLenM)}</b> — 전체의 <b>${fmt(share, 1)}%</b>`;
  });
  const missing = ev.links.filter((l) => l.missing);
  if (missing.length) lines3.push(`<span class="bad">끊긴 링크 ${missing.length}건</span>: ${missing.map((l) => l.id).join(", ")} — 해당 시설이 배치되지 않았다.`);
  const sysRows = Object.keys(ev.bySystem).map((k) => {
    const s = net.systems[k];
    return `${s ? s.name : k} ${fmt(ev.bySystem[k])} (${fmt((100 * ev.bySystem[k]) / (ev.o1 || 1), 0)}%)`;
  });
  if (sysRows.length) lines3.push(`<span class="dim">계통별: ${sysRows.join(" · ")}</span>`);
  S.push({ id: "o1", title: `3. O1 내역 — 가중 관로연장 ${fmt(ev.o1)} (실연장 ${fmt(ev.rawLengthM)}m)`, kind: "lines", lines: lines3 });

  // ── 4. O2 교차 ──
  const lines4 = [];
  if (!ev.crossings.length) lines4.push("관로 교차 없음. 상하 분리 구조물이 필요한 지점이 없다.");
  else {
    ev.crossings.forEach((c) => {
      const sa = net.systems[c.aSys], sb = net.systems[c.bSys];
      lines4.push(`<b>${c.a} × ${c.b}</b> — ${sa ? sa.name : c.aSys} ↔ ${sb ? sb.name : c.bSys}, 가중 ${c.w}`);
    });
    const mainCross = ev.crossings.filter((c) => c.aSys === "main" && c.bSys === "main");
    if (mainCross.length) lines4.push(`<span class="bad">본류끼리의 교차 ${mainCross.length}건</span> — 가장 비싼 종류다.`);
  }
  S.push({ id: "o2", title: `4. O2 — 관로교차 ${ev.crossings.length}건 (가중 ${ev.o2})`, kind: "lines", lines: lines4 });

  // ── 5. O3 증설 여지 ──
  const lines5 = [];
  if (ev.exp.areaM2 <= 0) lines5.push("<span class=\"bad\">빈 사각형 없음</span> — 증설 부지가 남지 않는다.");
  else {
    lines5.push(`최대 빈 사각형 <b>${fmt(ev.exp.wM)} × ${fmt(ev.exp.hM)} m</b> = <b>${fmt(ev.exp.areaM2)} m²</b> (평면의 점선 사각형).`);
    const biggest = data.boxes.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
    const bA = (biggest.w * biggest.h) / 1e6;
    lines5.push(bA > 0 && ev.exp.areaM2 >= bA
      ? `가장 큰 시설 [${biggest.label}] ${fmt(bA)} m² 가 <b>들어갈 만한 크기</b>다.`
      : `가장 큰 시설 [${biggest.label}] ${fmt(bA)} m² 는 <b>못 들어간다</b> — 계열 증설 여지로는 부족.`);
  }
  lines5.push(`<span class="dim">여백 판정에 이격 ${fmt(ev.minGapM)}m 기준을 그대로 적용했다. 격자 근사이므로 ±1칸 오차가 있다.</span>`);
  S.push({ id: "o3", title: `5. O3 — 증설 여지 ${fmt(ev.o3)} m²`, kind: "lines", lines: lines5 });

  // ── 6. O4 동선 ──
  const lines6 = ev.access.map((a) => {
    if (a.missing) return `<span class="bad">${a.id} ${a.label}</span> — 해당 시설 미배치.`;
    const pi = a.pierced.length
      ? `<span class="bad">관통 ${a.pierced.length}건</span> [${a.pierced.join("], [")}] → 우회 근사 +${fmt(a.detourM)}m`
      : "관통 없음";
    return `<b>${a.id}</b> ${a.label}: 직선 ${fmt(a.straightM)}m · ${pi} → 합 <b>${fmt(a.totalM)}m</b>`;
  });
  lines6.push('<span class="dim">우회는 근사다 — 관통 박스마다 (w+h)/4를 더한다. 실제 도로 우회 계산이 아니다.</span>');
  S.push({ id: "o4", title: `6. O4 — 반출·관리 동선 ${fmt(ev.o4)} m`, kind: "lines", lines: lines6 });

  // ── 7. 제약 ──
  const lines7 = [];
  lines7.push(`C1 배치 수 ${ev.count}/${nBox} — ${ev.count === nBox ? '<span class="ok">충족</span>' : '<span class="bad">미달</span>'}`);
  lines7.push(`C2 겹침 ${ev.overlaps}건 · C3 경계이탈 ${ev.outside}건 — ${ev.overlaps + ev.outside === 0 ? '<span class="ok">충족</span>' : '<span class="bad">위반</span>'}`);
  lines7.push(`C4 최소 이격 <b>${fmt(ev.minGapM)}m</b> (설정 이격 ${fmt(result.opts.clearance / 1000)}m) <span class="dim">★규정 원문 미확인</span>`);
  if (ev.reverseCount) {
    lines7.push(`C5 자연유하 <span class="bad">역행 ${ev.reverseCount}건</span> — ${ev.reverse.map((r) => `${r.id}([${r.a}]→[${r.b}]) ${fmt(r.projM)}m`).join(" · ")}`);
    lines7.push('<span class="dim">본류는 중력흐름이 원칙이라 [1]→[7] 주축을 거슬러 가면 관로가 길어지고 수두손실이 커진다. 표고가 없어 주축 투영으로 대리 측정했다.</span>');
  } else lines7.push('C5 자연유하 — <span class="ok">역행 없음</span>');
  ev.hazard.forEach((h) => {
    lines7.push(`C6 ${h.label} 이격 ${h.gapM === null ? "–" : fmt(h.gapM) + "m"} — ` +
      (h.ok === null ? '<span class="dim">임계값 미설정(검사 안 함)</span>' : h.ok ? '<span class="ok">충족</span>' : '<span class="bad">미달</span>'));
  });
  S.push({ id: "cons", title: "7. 제약 상태", kind: "lines", lines: lines7 });

  // ── 8. 대안군 안에서의 위치 ──
  if (gallery && gallery.length >= 3) {
    const live2 = gallery.filter((a) => a.score && a.score.total !== null);
    const lines8 = [];
    if (live2.length) {
      const sorted = live2.slice().sort((a, b) => b.score.total - a.score.total);
      const cur = gallery.find((a) => a.id === selectedId);
      if (cur && cur.score && cur.score.total !== null) {
        const rank = sorted.findIndex((a) => a.id === cur.id) + 1;
        lines8.push(`이 대안은 유효 ${live2.length}건 중 <b>${rank}위</b> (총점 ${fmt(cur.score.total, 1)})` +
          (cur.pareto ? " · <b>파레토</b>" : ""));
      }
      const best = sorted[0];
      if (best && cur && best.id !== cur.id) {
        const d = ["o1", "o2", "o3", "o4"].map((k) => {
          const o = { o1: "관로", o2: "교차", o3: "증설", o4: "동선" }[k];
          const dv = best.ev[k] - cur.ev[k];
          const better = (k === "o3") ? dv > 0 : dv < 0;
          return `${o} ${dv > 0 ? "+" : ""}${fmt(dv, k === "o2" ? 2 : 0)}<span class="${better ? "ok" : "bad"}">${better ? "↑" : "↓"}</span>`;
        }).join(" · ");
        lines8.push(`최고점 #${best.id}(${fmt(best.score.total, 1)}) 대비: ${d}`);
      }
      lines8.push(`실격 ${gallery.length - live2.length}건 / 파레토 ${gallery.filter((a) => a.pareto).length}건`);
      // 실측 상충 — 이 대안군에서 목표들이 실제로 다투는가
      const pairs = [["o1", "o3", "관로↔증설"], ["o1", "o4", "관로↔동선"], ["o1", "o2", "관로↔교차"], ["o3", "o4", "증설↔동선"]];
      const cors = pairs.map(([a, b, nm]) => {
        const r = pearson(live2.map((x) => x.ev[a]), live2.map((x) => x.ev[b]));
        return r === null ? null : { nm, r };
      }).filter(Boolean);
      if (cors.length) {
        lines8.push("<span class=\"dim\">이 대안군에서 실측한 상관: " +
          cors.map((c) => `${c.nm} r=${c.r.toFixed(2)}`).join(" · ") +
          " — 다투지 않는 축(|r|이 1에 가깝고 부호가 같은 방향)만 남으면 파레토가 붕괴한다.</span>");
      }
    } else lines8.push('<span class="bad">유효 대안이 없다</span> — 전부 실격이다. 이격을 줄이거나 그리드를 키워 보라.');
    S.push({ id: "pool", title: `8. 대안군 안에서의 위치 (${gallery.length}건)`, kind: "lines", lines: lines8 });
  }

  // ── 9. 다음 수 ──
  const sug = [];
  if (score.disq) {
    sug.push("① <b>실격 해소가 먼저다.</b> 이격(제외영역)을 줄이거나 후보점 그리드 N을 키우면 배치가 들어간다. 회전을 켜면 좁은 자리에도 들어간다.");
  }
  if (top.length) {
    const t = top[0];
    sug.push(`① <b>${t.id}([${t.a}]→[${t.b}])가 O1의 ${fmt((100 * t.wLenM) / (ev.o1 || 1), 1)}%</b>다. 이 둘을 붙이는 게 총점에 가장 크게 먹힌다.`);
  }
  if (ev.crossings.length) {
    const c = ev.crossings[0];
    sug.push(`② <b>${c.a} × ${c.b} 교차</b>를 푼다 — 둘 중 한쪽 끝 시설을 반대편으로 넘기면 대개 풀린다.`);
  }
  if (ev.reverseCount) {
    sug.push(`② <b>역행 ${ev.reverseCount}건</b> — ${ev.reverse.map((r) => `[${r.b}]`).join("·")}를 [1]→[7] 진행방향 앞쪽으로 옮긴다.`);
  }
  const pierce = ev.access.filter((a) => !a.missing && a.pierced.length);
  if (pierce.length) {
    sug.push(`③ <b>${pierce.map((a) => a.label).join("·")} 동선이 [${pierce[0].pierced.join("], [")}]를 관통</b>한다. 해당 시설을 정문 쪽 열린 방향으로 돌린다.`);
  }
  const bigRepair = (result.repairs || []).filter((r) => r.movedM !== null && r.movedM > 0).sort((a, b) => b.movedM - a.movedM)[0];
  if (bigRepair && bigRepair.movedM > 1) {
    sug.push(`④ <b>[${bigRepair.label}]의 UV 목표점이 막혀 ${fmt(bigRepair.movedM)}m 밀렸다</b>(수복 ${bigRepair.ring}칸). 그 자리는 이미 붐빈다 — 목표점을 옮기면 의도대로 앉는다.`);
  }
  if (ev.exp.areaM2 > 0 && score.items[2].index < 100) {
    sug.push(`⑤ 증설 여지가 기준안의 ${fmt(score.items[2].index, 0)}%다. 시설을 한쪽으로 몰면 남는 땅이 한 덩어리가 된다 — 다만 O4(동선)와 다툰다.`);
  }
  sug.push('<span class="dim">⑥ 손으로 못 찾겠으면 아래 <b>자동 개선</b>을 돌린다. 언덕오르기라 시작점에 따라 다른 봉우리에 서므로, 서로 다른 대안에서 두세 번 돌려 비교하는 편이 낫다.</span>');
  S.push({ id: "next", title: "9. 다음 수", kind: "lines", lines: sug });

  return S;
}

// ── (2) 로컬 탐색 ─────────────────────────────────────────────
// evalUv(uvs) → {result, ev, score}  (app.js가 넘겨준다)
// mulberry32는 engine.js의 전역이다(브라우저·vm). 순수 node require 경로만 폴백이 필요하다.
var _rndFactory = (typeof mulberry32 === "function") ? mulberry32
  : (typeof require === "function" ? require("./engine.js").mulberry32 : null);

function makeOptimizer(cfg) {
  const rnd = _rndFactory(cfg.seed || 1);
  const nB = cfg.uvs.length;
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const clip = (x) => Math.min(1, Math.max(0, x));
  const copy = (a) => a.map((g) => ({ u: g.u, v: g.v, rot: g.rot || 0 }));

  const start = evalOf(cfg.uvs);
  function evalOf(uvs) { return cfg.evalUv(uvs); }
  function totalOf(e) { return e.score.total === null ? -1e9 : e.score.total; }

  const st = {
    uvs: copy(cfg.uvs),
    cur: start,
    best: start,
    bestUvs: copy(cfg.uvs),
    it: 0,
    tried: 0,
    accepted: 0,
    log: [],
    step: cfg.step0 === undefined ? 0.14 : cfg.step0,
    maxIter: cfg.maxIter || 400,
    labels: cfg.labels || [],
    done: false,
  };

  st.tick = function (n) {
    const fresh = [];
    for (let c = 0; c < n && st.it < st.maxIter; c++) {
      st.it++;
      // 담금질처럼 보폭을 줄인다 — 처음엔 크게 옮기고 나중엔 다듬는다
      const t = st.it / st.maxIter;
      const step = st.step * (1 - 0.8 * t);
      const cand = copy(st.uvs);
      let kind, k, k2, from, to;
      const roll = rnd();
      if (roll < 0.72 || nB < 2) {           // (a) 한 시설을 흔든다
        kind = "이동"; k = Math.floor(rnd() * nB);
        from = { u: cand[k].u, v: cand[k].v };
        cand[k].u = clip(cand[k].u + gauss() * step);
        cand[k].v = clip(cand[k].v + gauss() * step);
        to = { u: cand[k].u, v: cand[k].v };
      } else if (roll < 0.92 || !cfg.allowRotate) {  // (b) 두 시설의 자리를 맞바꾼다
        kind = "교환"; k = Math.floor(rnd() * nB);
        k2 = Math.floor(rnd() * nB);
        if (k2 === k) k2 = (k + 1) % nB;
        const tmp = { u: cand[k].u, v: cand[k].v };
        cand[k].u = cand[k2].u; cand[k].v = cand[k2].v;
        cand[k2].u = tmp.u; cand[k2].v = tmp.v;
      } else {                                 // (c) 90° 돌린다
        kind = "회전"; k = Math.floor(rnd() * nB);
        cand[k].rot = cand[k].rot ? 0 : 1;
      }
      st.tried++;
      const e = evalOf(cand);
      const gain = totalOf(e) - totalOf(st.cur);
      if (gain > 1e-9) {
        const prev = st.cur;
        st.uvs = cand; st.cur = e; st.accepted++;
        if (totalOf(e) > totalOf(st.best)) { st.best = e; st.bestUvs = copy(cand); }
        const why = ["o1", "o2", "o3", "o4"].map((key) => {
          const nm = { o1: "관로", o2: "교차", o3: "증설", o4: "동선" }[key];
          const d = e.ev[key] - prev.ev[key];
          if (Math.abs(d) < (key === "o2" ? 0.01 : 0.5)) return null;
          const better = key === "o3" ? d > 0 : d < 0;
          return `${nm} ${d > 0 ? "+" : ""}${fmt(d, key === "o2" ? 2 : 0)}${better ? "↑" : "↓"}`;
        }).filter(Boolean).join(" · ");
        const entry = {
          it: st.it, kind,
          label: st.labels[k] || String(k),
          label2: k2 === undefined ? null : (st.labels[k2] || String(k2)),
          from, to,
          before: prev.score.total, after: e.score.total,
          gain: Math.round(gain * 100) / 100,
          why: why || "지표 변화 미미 (제약 감점 해소)",
        };
        st.log.push(entry); fresh.push(entry);
      }
    }
    if (st.it >= st.maxIter) st.done = true;
    return fresh;
  };

  return st;
}

if (typeof module !== "undefined") {
  module.exports = { explain, makeOptimizer, pearson };
}
