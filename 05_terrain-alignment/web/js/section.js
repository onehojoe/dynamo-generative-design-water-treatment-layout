/* section.js — 평면 선형에 의한 횡단면 생성 (2D 라이브러리 스윕)
 *
 * 터널 내공단면 산정에서 쓰이는 «2D 라이브러리 스윕» 방식을
 * 도로 횡단에 적용한다. 단면을 파라메트릭으로 정의하고 선형을 따라 쓸어 간다.
 *
 * 측점 하나의 단면 구성
 *   ① 노면      계획고에서 좌우 B/2 (편경사 e 적용)
 *   ② 지반선    선형 법선 방향으로 지형을 샘플 (offset −W … +W)
 *   ③ 비탈면    노면 끝에서 1:m 로 내려/올라가 지반선과 만나는 점까지
 *   ④ 면적      ②와 ①+③ 사이 폐합 다각형을 신발끈 공식으로. 절토/성토 분리.
 *
 * 이 방식은 종단의 근사식(A = |h|·B + m·h²)과 달리 **실제 지반 횡단형상**을 쓴다.
 * 편측 절토·편측 성토(반절반성)가 잡힌다.
 *
 * ★비탈면 경사·소단은 관행값이며 법령 원문 대조 미실시.
 */
(function (global) {
  'use strict';

  /* 선형 폴리라인에서 측점 i 의 접선·법선 */
  function frameAt(sts, i) {
    const a = sts[Math.max(0, i - 1)], b = sts[Math.min(sts.length - 1, i + 1)];
    let tx = b.x - a.x, ty = b.y - a.y;
    const L = Math.hypot(tx, ty) || 1;
    tx /= L; ty /= L;
    return { tx: tx, ty: ty, nx: -ty, ny: tx };   // 법선 = 접선 90° 좌회전
  }

  /* 한 측점의 횡단면. 반환 좌표는 (offset, EL) 로컬계. */
  function sectionAt(P, i, opt, sampler) {
    const st = P.stations[i];
    const f = frameAt(P.stations, i);
    const B = opt.widthB, half = B / 2;
    const mC = opt.slopeCut, mF = opt.slopeFill;
    const e = (opt.superElev || 0) / 100;            // 편경사 %
    const W = Math.max(half + 5, opt.sectionHalfWidth || 120);
    const step = opt.sectionStep || 2;

    // ② 지반선
    const gl = [];
    for (let o = -W; o <= W + 1e-9; o += step) {
      const gx = st.x + f.nx * o, gy = st.y + f.ny * o;
      let z = sampler(gx, gy);
      if (!(z === z)) z = P.ground[i];
      gl.push([o, z]);
    }
    const groundAtOff = (o) => {
      const t = (o + W) / step;
      const k = Math.max(0, Math.min(gl.length - 2, Math.floor(t)));
      const r = t - k;
      return gl[k][1] + (gl[k + 1][1] - gl[k][1]) * r;
    };

    // ① 노면 — 편경사는 우측이 낮아지는 방향(부호는 입력대로)
    const zc = P.design[i];
    const road = [[-half, zc + e * half], [half, zc - e * half]];

    // ③ 비탈면 — 노면 끝에서 지반선과 만날 때까지 전진
    function toe(sign) {
      const x0 = sign * half, z0 = sign > 0 ? road[1][1] : road[0][1];
      const dg0 = z0 - groundAtOff(x0);
      const m = dg0 >= 0 ? mF : mC;                 // 성토면 1:mF / 절토면 1:mC
      const dz = dg0 >= 0 ? -1 : 1;                 // 성토는 내려가고 절토는 올라간다
      let o = x0, prev = dg0;
      for (let k = 1; k <= 600; k++) {
        o = x0 + sign * (k * step);
        const zs = z0 + dz * (k * step) / m;
        const d = zs - groundAtOff(o);
        if (d === 0 || (d > 0) !== (prev > 0)) {
          const t = prev / (prev - d);
          const oo = x0 + sign * ((k - 1 + t) * step);
          return [oo, groundAtOff(oo)];
        }
        prev = d;
        if (Math.abs(o) > W) break;
      }
      return [o, groundAtOff(o)];                   // 대지 폭 안에서 못 만나면 끝점
    }

    const tL = toe(-1), tR = toe(1);

    // ④ 면적 — 계획면(노면+비탈면)과 지반선 사이
    const oL = Math.min(tL[0], -half), oR = Math.max(tR[0], half);
    const design = [];
    design.push(tL);
    design.push(road[0]);
    design.push(road[1]);
    design.push(tR);
    const dAt = (o) => {
      if (o <= road[0][0]) {
        const t = (o - tL[0]) / Math.max(1e-9, road[0][0] - tL[0]);
        return tL[1] + (road[0][1] - tL[1]) * t;
      }
      if (o >= road[1][0]) {
        const t = (o - road[1][0]) / Math.max(1e-9, tR[0] - road[1][0]);
        return road[1][1] + (tR[1] - road[1][1]) * t;
      }
      const t = (o - road[0][0]) / Math.max(1e-9, road[1][0] - road[0][0]);
      return road[0][1] + (road[1][1] - road[0][1]) * t;
    };

    let cut = 0, fill = 0;
    const n = Math.max(2, Math.ceil((oR - oL) / step));
    const h = (oR - oL) / n;
    let prevD = dAt(oL) - groundAtOff(oL);
    for (let k = 1; k <= n; k++) {
      const o = oL + k * h;
      const d = dAt(o) - groundAtOff(o);
      const mid = (prevD + d) / 2;
      if (mid >= 0) fill += mid * h; else cut += -mid * h;
      prevD = d;
    }
    return {
      s: st.s, offsetL: tL[0], offsetR: tR[0],
      ground: gl, road: road, design: design, toeL: tL, toeR: tR,
      cutArea: cut, fillArea: fill,
      cutDepth: Math.max(0, groundAtOff(0) - zc), fillHeight: Math.max(0, zc - groundAtOff(0)),
      width: oR - oL,
    };
  }

  /* 선형 전체 스윕 — 평균단면법으로 체적. 구조물·대지밖 구간은 제외. */
  function sweep(P, opt, sampler) {
    const secs = [];
    for (let i = 0; i < P.stations.length; i++) secs.push(sectionAt(P, i, opt, sampler));
    let cut = 0, fill = 0, maxW = 0;
    for (let i = 0; i < P.stations.length - 1; i++) {
      const skip = (P.outside && (P.outside[i] || P.outside[i + 1])) ||
        (P.struct && (P.struct.kind[i] !== 'earth' || P.struct.kind[i + 1] !== 'earth'));
      if (skip) continue;
      const ds = P.stations[i + 1].s - P.stations[i].s;
      cut += (secs[i].cutArea + secs[i + 1].cutArea) / 2 * ds;
      fill += (secs[i].fillArea + secs[i + 1].fillArea) / 2 * ds;
    }
    secs.forEach(x => { if (x.width > maxW) maxW = x.width; });
    return {
      sections: secs, cut: cut, fill: fill, total: cut + fill,
      balance: Math.abs(cut - fill), maxWidth: maxW,
    };
  }

  global.KHSection = { frameAt: frameAt, sectionAt: sectionAt, sweep: sweep };
})(this);
