/* profile.js — 종단(縱斷) 선형과 토공
 *
 * 평면 선형(폴리라인) → 측점 → 지반고 → 계획고(VIP + 종단곡선) → 경사 검토 → 절성토.
 *
 * 토목 규약
 *  · 종단곡선은 2차 포물선. VIP 를 중심으로 길이 L 을 반씩 나눠 쓴다.
 *      BVC = s_vip − L/2,  EVC = s_vip + L/2
 *      z(x) = z_BVC + g1·x + (g2 − g1)/(2L)·x²      (x 는 BVC 기준, g 는 소수 경사)
 *  · 종단곡선 변화비율  K = L / |g2 − g1|(%)   ← 설계속도별 최소 K 를 만족해야 한다
 *  · 절성토 단면적(표준 횡단 + 비탈면):
 *      A = |h|·B + m·h²        h = 계획고 − 지반고,  m = 비탈면 수평/수직 비
 *      (윗변 B, 아랫변 B + 2·m·|h| 인 사다리꼴)
 *  · 체적은 평균단면법:  V = (A_i + A_{i+1})/2 · Δs
 *
 * ★ 기본 수치(비탈면 1:1.2 / 1:1.5, 최소 K, 최대 경사)는 실무 표준 관행값이며
 *   법령 원문 대조를 하지 않았다. 화면에 «수치 미검증» 으로 표시하고 전부 입력으로 연다.
 */
(function (global) {
  'use strict';

  /* 설계속도별 기본값 — 전부 편집 가능. 원문 대조 전까지 미검증. */
  const SPEED_DEFAULTS = {
    60: { iMax: 8.0, Kcrest: 11, Ksag: 15 },
    80: { iMax: 7.0, Kcrest: 21, Ksag: 25 },
    100: { iMax: 5.0, Kcrest: 39, Ksag: 39 },
  };

  /* ── 측점 ──────────────────────────────────────────────────────────
   * 평면 폴리라인을 등간격 ds 로 잘라 {s, x, y} 목록을 만든다. 끝점은 항상 포함. */
  function stations(pts, ds) {
    const out = [];
    if (!pts || pts.length < 2) return out;
    const seg = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      seg.push({ i: i, L: L, s0: total });
      total += L;
    }
    const n = Math.max(1, Math.round(total / ds));
    const step = total / n;
    let k = 0;
    for (let a = 0; a <= n; a++) {
      const s = Math.min(total, a * step);
      while (k < seg.length - 1 && s > seg[k].s0 + seg[k].L) k++;
      const t = seg[k].L > 1e-9 ? (s - seg[k].s0) / seg[k].L : 0;
      const p = pts[seg[k].i], q = pts[seg[k].i + 1];
      out.push({ s: s, x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t });
    }
    return out;
  }

  /* 지반고. 대지 밖이면 가장 가까운 유효 표고로 채우되 outside 로 표시한다.
   * 표고를 지어내지 않는 대신 «대지 밖»이라고 말하는 쪽을 택했다. */
  function ground(sts, sampler, fallback) {
    const z = [], outside = [];
    sts.forEach(p => {
      let v = sampler(p.x, p.y);
      const out = !(v === v);
      if (out && fallback) v = fallback(p.x, p.y);
      if (!(v === v)) v = z.length ? z[z.length - 1] : 0;
      z.push(v); outside.push(out);
    });
    return { z: z, outside: outside };
  }

  /* ── 계획고 ────────────────────────────────────────────────────────
   * vips = [{s, z}] (측점 오름차순, 시·종점 포함) · lvc = 각 중간 VIP 의 종단곡선 길이 */
  function designAt(vips, lvc, s) {
    if (vips.length < 2) return vips.length ? vips[0].z : 0;
    let k = 0;
    while (k < vips.length - 2 && s > vips[k + 1].s) k++;
    const a = vips[k], b = vips[k + 1];
    const g = (b.z - a.z) / Math.max(1e-9, b.s - a.s);
    let z = a.z + g * (s - a.s);

    // 앞뒤 VIP 의 종단곡선 보정
    for (let i = 1; i < vips.length - 1; i++) {
      const L = Math.max(0, lvc[i] || 0);
      if (L <= 0) continue;
      const v = vips[i];
      const bvc = v.s - L / 2, evc = v.s + L / 2;
      if (s < bvc || s > evc) continue;
      const g1 = (v.z - vips[i - 1].z) / Math.max(1e-9, v.s - vips[i - 1].s);
      const g2 = (vips[i + 1].z - v.z) / Math.max(1e-9, vips[i + 1].s - v.s);
      const zb = v.z - g1 * (L / 2);
      const x = s - bvc;
      z = zb + g1 * x + ((g2 - g1) / (2 * L)) * x * x;
      break;
    }
    return z;
  }

  function designLine(sts, vips, lvc) {
    return sts.map(p => designAt(vips, lvc, p.s));
  }

  /* ── 경사 · 종단곡선 검토 ─────────────────────────────────────────── */
  function grades(vips) {
    const g = [];
    for (let i = 0; i < vips.length - 1; i++) {
      const ds = vips[i + 1].s - vips[i].s;
      g.push({
        from: vips[i].s, to: vips[i + 1].s, len: ds,
        pct: ds > 1e-9 ? (vips[i + 1].z - vips[i].z) / ds * 100 : 0,
      });
    }
    return g;
  }

  function reviewProfile(vips, lvc, std) {
    const g = grades(vips);
    const items = [];
    let ng = 0;

    g.forEach((seg, i) => {
      const over = Math.abs(seg.pct) > std.iMax + 1e-9;
      const flat = Math.abs(seg.pct) < std.iMin - 1e-9;
      if (over) ng++;
      items.push({
        kind: 'grade', idx: i, from: seg.from, to: seg.to, len: seg.len,
        val: seg.pct, req: std.iMax, ok: !over, flat: flat,
        note: over ? '최대 종단경사 초과' : (flat ? '배수 최소경사 미달' : ''),
      });
    });

    for (let i = 1; i < vips.length - 1; i++) {
      const g1 = g[i - 1].pct, g2 = g[i].pct;
      const A = Math.abs(g2 - g1);                    // 경사 변화량 %
      if (A < 1e-6) continue;
      const L = Math.max(0, lvc[i] || 0);
      const K = L / A;
      const crest = (g2 - g1) < 0;                    // 볼록(凸)
      const req = crest ? std.Kcrest : std.Ksag;
      const ok = K >= req - 1e-9;
      if (!ok) ng++;
      items.push({
        kind: 'vcurve', idx: i, s: vips[i].s, A: A, L: L, K: K, req: req,
        crest: crest, ok: ok, note: ok ? '' : (crest ? '볼록 종단곡선 K 부족' : '오목 종단곡선 K 부족'),
      });
    }
    return { items: items, ng: ng, grades: g };
  }

  /* ── 토공 ──────────────────────────────────────────────────────────
   * B = 도로폭(m) · mCut/mFill = 비탈면 수평/수직 비(1:m) */
  function earthwork(sts, gnd, dsn, opt, outside, kind) {
    const B = opt.widthB, mC = opt.slopeCut, mF = opt.slopeFill;
    const skip = (outside || new Array(sts.length).fill(false)).map(
      (o, i) => o || (kind ? kind[i] !== 'earth' : false));   // 터널·교량은 토공 아님
    const areas = [], hs = [];
    for (let i = 0; i < sts.length; i++) {
      const h = dsn[i] - gnd[i];                       // +성토 / −절토
      hs.push(h);
      const m = h >= 0 ? mF : mC;
      const A = Math.abs(h) * B + m * h * h;
      areas.push(h >= 0 ? { fill: A, cut: 0 } : { fill: 0, cut: A });
    }
    let cut = 0, fill = 0, maxCut = 0, maxFill = 0;
    // 토공에서 빠지는 연장은 두 갈래다 — 섞으면 화면이 거짓말을 한다.
    let outLen = 0, structLen = 0;
    const isOut = outside || new Array(sts.length).fill(false);
    for (let i = 0; i < sts.length - 1; i++) {
      const ds = sts[i + 1].s - sts[i].s;
      if (skip[i] || skip[i + 1]) {
        if (isOut[i] || isOut[i + 1]) outLen += ds;             // 지형이 없는 구간
        else structLen += ds;                                    // 터널·교량으로 대체된 구간
        continue;
      }
      cut += (areas[i].cut + areas[i + 1].cut) / 2 * ds;
      fill += (areas[i].fill + areas[i + 1].fill) / 2 * ds;
    }
    hs.forEach((h, i) => {
      if (skip[i]) return;
      if (h < 0) maxCut = Math.max(maxCut, -h); else maxFill = Math.max(maxFill, h);
    });
    return {
      cut: cut, fill: fill, net: fill - cut, total: cut + fill,
      balance: Math.abs(cut - fill), maxCutH: maxCut, maxFillH: maxFill,
      outsideLen: outLen, structLen: structLen, h: hs, areas: areas,
    };
  }


  /* ── 구조물 판정 — 토공 / 터널 / 교량 ──────────────────────────────
   * 절토고가 임계를 넘으면 터널, 성토고가 넘으면 교량으로 본다.
   * 짧은 조각은 최소연장 미달로 토공으로 되돌린다(잘게 쪼개진 구조물은 시공이 안 된다).
   * ★임계·최소연장은 관행값이며 법령·설계기준 원문 대조 미실시.
   * 판정된 구간은 토공(절성토)에서 제외한다 — 구조물로 대체되기 때문. */
  function classify(sts, gnd, dsn, opt, outside) {
    const hTun = opt.hTunnel, hBrg = opt.hBridge;
    const kind = [];
    for (let i = 0; i < sts.length; i++) {
      const h = dsn[i] - gnd[i];
      if (outside && outside[i]) kind.push('out');
      else if (-h >= hTun) kind.push('tunnel');       // 깊은 절토
      else if (h >= hBrg) kind.push('bridge');        // 높은 성토
      else kind.push('earth');
    }
    // 최소연장 미달 되돌리기
    const runs = [];
    let i = 0;
    while (i < kind.length) {
      let j = i;
      while (j + 1 < kind.length && kind[j + 1] === kind[i]) j++;
      runs.push({ k: kind[i], i: i, j: j, len: sts[j].s - sts[i].s });
      i = j + 1;
    }
    runs.forEach(r => {
      const min = r.k === 'tunnel' ? opt.lTunnel : (r.k === 'bridge' ? opt.lBridge : 0);
      if (min > 0 && r.len < min) for (let k = r.i; k <= r.j; k++) kind[k] = 'earth';
    });
    // 되돌린 뒤 최종 구간 재수집
    const out = [];
    i = 0;
    while (i < kind.length) {
      let j = i;
      while (j + 1 < kind.length && kind[j + 1] === kind[i]) j++;
      out.push({ kind: kind[i], from: sts[i].s, to: sts[j].s, i0: i, i1: j,
                 len: sts[j].s - sts[i].s });
      i = j + 1;
    }
    const sum = { earth: 0, tunnel: 0, bridge: 0, out: 0 };
    out.forEach(r => { sum[r.kind] += r.len; });
    return { kind: kind, runs: out, sum: sum };
  }

  /* ── 초기 계획고 자동 산정 ──────────────────────────────────────────
   * 지반고를 따라가되 |경사| ≤ iMax 를 만족하는 VIP 열을 만든다.
   * ① 지반고를 VIP 측점에서 샘플 → ② 앞·뒤 훑기로 경사 상한을 강제(경사 제한 필터). */
  function fitDesign(sts, gnd, nVIP, std) {
    const total = sts[sts.length - 1].s;
    const n = Math.max(2, nVIP);
    const vs = [];
    for (let i = 0; i < n; i++) {
      const s = total * i / (n - 1);
      let k = 0;
      while (k < sts.length - 2 && sts[k + 1].s < s) k++;
      const t = (s - sts[k].s) / Math.max(1e-9, sts[k + 1].s - sts[k].s);
      vs.push({ s: s, z: gnd[k] + (gnd[k + 1] - gnd[k]) * t });
    }
    const gmax = std.iMax / 100;
    for (let pass = 0; pass < 12; pass++) {
      let moved = 0;
      for (let i = 1; i < n; i++) {                    // 앞으로
        const ds = vs[i].s - vs[i - 1].s;
        const lim = gmax * ds;
        if (vs[i].z - vs[i - 1].z > lim) { vs[i].z = vs[i - 1].z + lim; moved++; }
        if (vs[i - 1].z - vs[i].z > lim) { vs[i].z = vs[i - 1].z - lim; moved++; }
      }
      for (let i = n - 2; i >= 0; i--) {               // 뒤로
        const ds = vs[i + 1].s - vs[i].s;
        const lim = gmax * ds;
        if (vs[i].z - vs[i + 1].z > lim) { vs[i].z = vs[i + 1].z - lim; moved++; }
        if (vs[i + 1].z - vs[i].z > lim) { vs[i].z = vs[i + 1].z + lim; moved++; }
      }
      if (!moved) break;
    }
    return vs;
  }

  /* 종단곡선 길이 기본값 — 최소 K 를 만족하는 최소 길이(+10% 여유). */
  function fitLVC(vips, std) {
    const g = grades(vips);
    const lvc = new Array(vips.length).fill(0);
    for (let i = 1; i < vips.length - 1; i++) {
      const A = Math.abs(g[i].pct - g[i - 1].pct);
      if (A < 1e-6) { lvc[i] = 0; continue; }
      const crest = (g[i].pct - g[i - 1].pct) < 0;
      const req = crest ? std.Kcrest : std.Ksag;
      const room = Math.min(vips[i].s - vips[i - 1].s, vips[i + 1].s - vips[i].s) * 2 * 0.9;
      lvc[i] = Math.min(room, req * A * 1.1);
    }
    return lvc;
  }


  /* ── 유전자 → VIP ──────────────────────────────────────────────────
   * dz 는 «해당 측점 지반고 대비 offset» (−1..+1 → ∓zRange m).
   * 만든 뒤 경사 상한을 강제한다(제약을 유전자에 맡기면 실격만 쏟아진다). */
  function vipsFromGenome(sts, gnd, prof, std, zRange) {
    /* ★2026-08-25 교정 — 기준선을 «지반고» 로 두면 안 된다.
     *   실측: 평면이 좋고 종단이 나쁜 개체가 이겨 토공이 4.8배 나빴다
     *   (1,083,453 vs 223,950 m³). 유전자가 «자동산정선 대비 편차» 를 뜻하도록 바꾸면
     *   dz=0 이 곧 자동산정과 동일해져, GD 결과가 자동산정보다 나빠질 수 없다. */
    const n = Math.max(2, Math.min(12, prof.nVIP | 0));
    const base = fitDesign(sts, gnd, n, std);          // 지반추종 + 경사 상한 적용
    const R = zRange == null ? 25 : zRange;
    const vs = base.map((v, i) => ({
      s: v.s,
      z: v.z + ((i === 0 || i === base.length - 1) ? 0 : (prof.dz[i] || 0) * R),
    }));
    clampGrades(vs, std.iMax);
    return vs;
  }

  function clampGrades(vs, iMax) {
    const gmax = iMax / 100;
    const n = vs.length;
    for (let pass = 0; pass < 16; pass++) {
      let moved = 0;
      for (let i = 1; i < n; i++) {
        const lim = gmax * (vs[i].s - vs[i - 1].s);
        if (vs[i].z - vs[i - 1].z > lim) { vs[i].z = vs[i - 1].z + lim; moved++; }
        if (vs[i - 1].z - vs[i].z > lim) { vs[i].z = vs[i - 1].z - lim; moved++; }
      }
      for (let i = n - 2; i >= 0; i--) {
        const lim = gmax * (vs[i + 1].s - vs[i].s);
        if (vs[i].z - vs[i + 1].z > lim) { vs[i].z = vs[i + 1].z - lim; moved++; }
        if (vs[i + 1].z - vs[i].z > lim) { vs[i].z = vs[i + 1].z + lim; moved++; }
      }
      if (!moved) break;
    }
    return vs;
  }

  /* 유전자 lvc(0..1) → 실제 종단곡선 길이. 최소 K 를 만족하는 길이를 하한으로 둔다. */
  function lvcFromGenome(vips, prof, std) {
    const base = fitLVC(vips, std);
    return base.map((L, i) => {
      if (i === 0 || i === vips.length - 1 || L <= 0) return 0;
      const room = Math.min(vips[i].s - vips[i - 1].s, vips[i + 1].s - vips[i].s) * 2 * 0.9;
      const k = prof && prof.lvc ? prof.lvc[i] : 0;
      return Math.min(room, L * (1 + 2 * k));      // 최소 K 이상, 최대 3배까지 늘린다
    });
  }

  /* ── 한 번에 계산 ──────────────────────────────────────────────────
   * opt = {ds, nVIP, widthB, slopeCut, slopeFill, std:{iMax,iMin,Kcrest,Ksag}, vips?, lvc?} */
  function compute(pts, sampler, opt) {
    const sts = stations(pts, opt.ds);
    if (sts.length < 2) return null;
    const g = ground(sts, sampler, opt.fallback);
    const gnd = g.z;
    const vips = opt.vips || (opt.genomeProf
      ? vipsFromGenome(sts, gnd, opt.genomeProf, opt.std, opt.zRange)
      : fitDesign(sts, gnd, opt.nVIP, opt.std));
    const lvc = opt.lvc || (opt.genomeProf
      ? lvcFromGenome(vips, opt.genomeProf, opt.std)
      : fitLVC(vips, opt.std));
    const dsn = designLine(sts, vips, lvc);
    const rev = reviewProfile(vips, lvc, opt.std);
    const st = classify(sts, gnd, dsn, opt, g.outside);
    const ew = earthwork(sts, gnd, dsn, opt, g.outside, st.kind);
    return {
      stations: sts, ground: gnd, outside: g.outside, design: dsn, vips: vips, lvc: lvc,
      struct: st,
      review: rev, earth: ew, length: sts[sts.length - 1].s,
      maxGrade: rev.grades.reduce((m, g) => Math.max(m, Math.abs(g.pct)), 0),
    };
  }

  global.KHProfile = {
    SPEED_DEFAULTS: SPEED_DEFAULTS,
    stations: stations, ground: ground, designAt: designAt, designLine: designLine,
    grades: grades, reviewProfile: reviewProfile, earthwork: earthwork, classify: classify,
    fitDesign: fitDesign, fitLVC: fitLVC, compute: compute,
    vipsFromGenome: vipsFromGenome, lvcFromGenome: lvcFromGenome, clampGrades: clampGrades,
  };
})(this);
