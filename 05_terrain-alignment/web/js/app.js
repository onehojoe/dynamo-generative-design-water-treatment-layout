/* app.js — UI · 렌더 · 워커 연동 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ELEM_COLOR = { tangent: '#ffd33d', spiral: '#d2a8ff', arc: '#56d4dd' };
  const cv = $('cv'), ctx = cv.getContext('2d');
  const convCv = $('conv'), parCv = $('pareto');

  let SITE = null, CTXE = null, PATHS = {}, worker = null;
  let TPATH = null, PROF = null, TERRAIN_RAW = null, BASE_PARAMS = null, BASE_TERRAIN = null;                 // 지형 Path2D · 현재 종단 계산 결과
  let view = { cx: 0, cy: 0, k: 0.05 };
  let best = null, history = [], front = [], lastSamples = [];
  let frontGenomes = [];   // 파레토 해의 유전자 (파라미터 바뀌면 재채점 대상)
  let candidates = [];     // {gen, m, pts} — 현재 파라미터로 재채점한 대안
  let shown = [];          // 필터 통과분 (목록·고스트가 같은 집합을 본다)
  let selIdx = -1, selGen = null;   // 선택은 유전자 참조로 추적(정렬/재채점해도 안 튀게)

  // v7 저장 상태 그대로: PI01 U=0.06, 나머지 0.5 / Active PI = 5
  const PROF0 = () => ({ nVIP: 6, dz: new Array(12).fill(0), lvc: new Array(12).fill(0) });
  let genome = { activePI: 5, u: [0.06, .5, .5, .5, .5, .5, .5, .5, .5, .5],
    v: new Array(10).fill(0.5), prof: PROF0() };

  function params() {
    return {
      mode: $('mode').value,
      R: +$('R').value, Ls: +$('Ls').value, curveStep: 8,
      widthM: +$('w').value, scale: 1.0,
      samples: +$('ns').value,
      sampleMode: $('smode').value, sampleSpacing: +$('sp').value,
      roadTol: +$('rt').value, obstacleTol: +$('ot').value,
      roadWins: $('roadwin').checked, roadWinsTol: +$('rwt').value,
      lengthWeight: 100, roadWeight: +$('rw').value, obstacleWeight: +$('ow').value,
      piMin: 1, piMax: 10,
      useExtraObstacle: $('lyExtra').checked
    };
  }

  function pparams() {
    return {
      ds: +$('pds').value, nVIP: +$('nvip').value,
      widthB: +$('bwid').value, slopeCut: +$('mcut').value, slopeFill: +$('mfill').value,
      zRange: +$('zrng').value,
      superElev: +$('supe').value, sectionHalfWidth: +$('xsw').value, sectionStep: 2,
      hTunnel: +$('hTun').value, hBridge: +$('hBrg').value,
      lTunnel: +$('lTun').value, lBridge: +$('lBrg').value,
      std: { iMax: +$('imax').value, iMin: +$('imin').value,
             Kcrest: +$('kcrest').value, Ksag: +$('ksag').value },
    };
  }

  const STRUCT_COLOR = { earth: '#4A7FA5', tunnel: '#6B4E9E', bridge: '#2E7D5B', out: '#B3AA98' };
  const STRUCT_NAME = { earth: '토공', tunnel: '터널', bridge: '교량', out: '대지 밖' };

  /* 화면 슬라이더 → 지형 변수. 산 위치·형상은 원본 배치를 배율로 조정한다. */
  function tparams() {
    const base = KHTerrain.params() || {};
    const src = BASE_PARAMS || base;
    const n = +$('tnp').value, hk = +$('tph').value, rk = +$('tpr').value;
    const peaks = (src.peaks || []).slice(0, n).map(p => [p[0], p[1], p[2] * hk, p[3] * rk, p[4]]);
    while (peaks.length < n) {                       // 원본보다 많이 요구하면 규칙적으로 더 놓는다
      const i = peaks.length;
      peaks.push([0.18 + 0.62 * ((i * 0.37) % 1), 0.18 + 0.62 * ((i * 0.61) % 1),
                  60 * hk, 850 * rk, 1.6]);
    }
    return {
      base_el: +$('tbase').value, slope_dir_deg: +$('tdir').value, slope_pct: +$('tslp').value,
      peaks: peaks, river: src.river || [], river_depth: +$('trd').value,
      river_width: +$('trw').value, noise_amp: +$('tna').value,
      noise_octaves: +$('tno').value, seed: +$('tsd').value,
    };
  }

  function syncTerrainUI(P) {
    if (!P) return;
    const set = (id, v, out) => { $(id).value = v; if (out) $(out).textContent = v; };
    set('tbase', P.base_el, 'tbasev'); set('tdir', P.slope_dir_deg, 'tdirv');
    set('tslp', P.slope_pct, 'tslpv'); set('tnp', (P.peaks || []).length, 'tnpv');
    set('tph', 1, 'tphv'); set('tpr', 1, 'tprv');
    set('trd', P.river_depth, 'trdv'); set('trw', P.river_width, 'trwv');
    set('tna', P.noise_amp, 'tnav'); set('tno', P.noise_octaves, 'tnov');
    set('tsd', P.seed);
  }

  function regenTerrain() {
    if (!KHTerrain.loaded() || !KHTerrain.generate) return;
    const t0 = performance.now();
    KHTerrain.generate(tparams());
    TPATH = KHTerrain.buildPaths(5);
    TERRAIN_RAW = KHTerrain.raw();
    const m = KHTerrain.meta();
    $('tgnote').innerHTML = '재생성 ' + Math.round(performance.now() - t0) + ' ms · EL ' +
      m.z_min + '~' + m.z_max + ' m · 등고선 ' + KHTerrain.contours().length + '레벨';
    rebuildCtx(); draw();
  }

  /* ---------- 데이터 ---------- */
  function buildPaths() {
    const mk = (polys) => {
      const p = new Path2D();
      for (const poly of polys) {
        if (poly.length < 3) continue;
        p.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) p.lineTo(poly[i][0], poly[i][1]);
        p.closePath();
      }
      return p;
    };
    PATHS.obs = mk(SITE.obstacle);
    PATHS.extra = mk(SITE.obstacle_extra);
    PATHS.road = mk(SITE.road);
  }

  function rebuildCtx() {
    const p = params();
    const obs = p.useExtraObstacle ? SITE.obstacle.concat(SITE.obstacle_extra) : SITE.obstacle;
    CTXE = { site: SITE, params: p, pparams: pparams(),
      useGenomeProfile: $('gdProf') ? $('gdProf').checked : false,
      obsGrid: new KHGeom.Grid(obs, 120), roadGrid: new KHGeom.Grid(SITE.road, 120) };
    if (frontGenomes.length) { buildCandidates(); renderCandidates(); }
    // Active PI·설계폭이 바뀌면 점 목록도 따라간다(개수·좌표 모두)
    if ($('ptList')) renderPointList();
  }

  /* ---------- 뷰 ---------- */
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(dpr, dpr);
    const pf = $('pfcv');
    if (pf) { pf.width = pf.clientWidth * dpr; pf.height = pf.clientHeight * dpr; }
    const xs = $('xscv');
    if (xs) { xs.width = xs.clientWidth * dpr; xs.height = xs.clientHeight * dpr; }
    draw();
  }
  function fit() {
    const b = SITE.bounds.slice();
    b[0] = Math.min(b[0], SITE.start[0], SITE.end[0]); b[1] = Math.min(b[1], SITE.start[1], SITE.end[1]);
    b[2] = Math.max(b[2], SITE.start[0], SITE.end[0]); b[3] = Math.max(b[3], SITE.start[1], SITE.end[1]);
    const w = b[2] - b[0], h = b[3] - b[1];
    view.cx = (b[0] + b[2]) / 2; view.cy = (b[1] + b[3]) / 2;
    view.k = Math.min(cv.clientWidth / (w * 1.12), cv.clientHeight / (h * 1.12));
  }
  const W = () => cv.clientWidth, H = () => cv.clientHeight;
  const DPR = () => window.devicePixelRatio || 1;

  /* ★캔버스 백업스토어는 CSS픽셀 × DPR 이다. 여기에 DPR을 곱하지 않으면
   *   그림만 1/DPR 로 줄어 좌상단에 몰리고, worldToScreen(=클릭 판정)과 어긋난다.
   *   → 보이는 점을 눌러도 안 잡히는 증상. (2026-08-12, DPR 1.5에서 재현 확인) */
  function applyT() {
    const d = DPR();
    ctx.setTransform(view.k * d, 0, 0, -view.k * d,
      (W() / 2 - view.cx * view.k) * d, (H() / 2 + view.cy * view.k) * d);
  }
  function screenToWorld(sx, sy) {
    return [(sx - W() / 2) / view.k + view.cx, -(sy - H() / 2) / view.k + view.cy];
  }

  /* ---------- 렌더 ---------- */
  function draw() {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#F7F4EC'; ctx.fillRect(0, 0, W(), H());
    if (!SITE) return;
    applyT();
    const px = 1 / view.k;

    // 지형 — 가장 아래
    if (TPATH) {
      if ($('lyTfill').checked) {
        const cs = KHTerrain.contours();
        for (let i = 0; i < cs.length; i++) {
          const pth = new Path2D();
          cs[i].rings.forEach(r => {
            if (r.length < 3) return;
            pth.moveTo(r[0][0], r[0][1]);
            for (let k = 1; k < r.length; k++) pth.lineTo(r[k][0], r[k][1]);
            pth.closePath();
          });
          ctx.fillStyle = KHTerrain.color(cs[i].el, 0.30); ctx.fill(pth, 'evenodd');
        }
      }
      if ($('lyTerr').checked) {
        ctx.strokeStyle = 'rgba(150,124,84,.55)'; ctx.lineWidth = px * 0.9; ctx.stroke(TPATH.minor);
        ctx.strokeStyle = 'rgba(120,96,58,.85)'; ctx.lineWidth = px * 1.8; ctx.stroke(TPATH.major);
      }
      if ($('lyBnd').checked) {
        ctx.strokeStyle = 'rgba(140,90,43,.80)'; ctx.lineWidth = px * 2.2;
        ctx.setLineDash([px * 18, px * 10]); ctx.stroke(TPATH.boundary); ctx.setLineDash([]);
      }
    }

    const drawRoad = () => {
      if (!$('lyRoad').checked) return;
      ctx.fillStyle = 'rgba(74,127,165,.26)'; ctx.fill(PATHS.road);
      ctx.strokeStyle = 'rgba(58,104,140,.40)'; ctx.lineWidth = px; ctx.stroke(PATHS.road);
    };
    const drawObs = () => {
      if ($('lyExtra').checked) {
        ctx.fillStyle = 'rgba(176,67,47,.16)'; ctx.fill(PATHS.extra);
        ctx.strokeStyle = 'rgba(176,67,47,.45)'; ctx.lineWidth = px; ctx.stroke(PATHS.extra);
      }
      if ($('lyObs').checked) {
        ctx.fillStyle = 'rgba(176,67,47,.40)'; ctx.fill(PATHS.obs);
        ctx.strokeStyle = 'rgba(140,45,30,.75)'; ctx.lineWidth = px; ctx.stroke(PATHS.obs);
      }
    };
    // 도로 우선이면 도로를 위에 덮어 그린다 — 겹침 구간이 화면에서도 도로로 읽히게.
    if ($('roadwin').checked) { drawObs(); drawRoad(); } else { drawRoad(); drawObs(); }

    // baseline
    ctx.strokeStyle = 'rgba(122,114,100,.60)'; ctx.lineWidth = px * 1.4;
    ctx.setLineDash([px * 12, px * 8]);
    ctx.beginPath(); ctx.moveTo(SITE.start[0], SITE.start[1]); ctx.lineTo(SITE.end[0], SITE.end[1]); ctx.stroke();
    ctx.setLineDash([]);

    const r = KHScore.evaluate(genome, CTXE);
    const al = r.alignment, fr = r.frame;

    // 설계폭 프레임
    const [nx, ny] = fr.normal, hw = params().widthM / 2;
    ctx.strokeStyle = 'rgba(140,90,43,.30)'; ctx.lineWidth = px;
    ctx.beginPath();
    ctx.moveTo(SITE.start[0] + nx * hw, SITE.start[1] + ny * hw); ctx.lineTo(SITE.end[0] + nx * hw, SITE.end[1] + ny * hw);
    ctx.moveTo(SITE.start[0] - nx * hw, SITE.start[1] - ny * hw); ctx.lineTo(SITE.end[0] - nx * hw, SITE.end[1] - ny * hw);
    ctx.stroke();

    // 샘플점
    if ($('lySample').checked) {
      const spp = al.mode === 'poly' ? params().samples : 1;
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      for (const s of al.spans) {
        for (let k = 0; k < spp; k++) {
          const t = (k + 0.5) / spp;
          const x = s[0][0] + (s[1][0] - s[0][0]) * t, y = s[0][1] + (s[1][1] - s[0][1]) * t;
          ctx.fillRect(x - px * 1.5, y - px * 1.5, px * 3, px * 3);
        }
      }
    }

    // 대안 고스트 — 선택된 것 빼고 전부 흐리게
    if ($('ghost').checked && shown.length) {
      ctx.lineWidth = px * 1.1; ctx.lineJoin = 'round';
      for (let i = 0; i < shown.length; i++) {
        if (i === selIdx) continue;
        const m = shown[i].m;
        ctx.strokeStyle = m.obstacleOverlap > 0.5 ? 'rgba(248,81,73,.07)' : 'rgba(255,211,61,.13)';
        const pts = shown[i].pts;
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
        ctx.stroke();
      }
    }

    // 선형 — 요소 구분 모드면 직선/완화곡선/원곡선을 색으로 나눈다
    ctx.lineWidth = px * 3.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if ($('elems').checked && al.kinds && al.kinds.length) {
      let i = 0;
      while (i < al.kinds.length) {
        const k = al.kinds[i];
        let j = i;
        while (j < al.kinds.length && al.kinds[j] === k) j++;
        ctx.strokeStyle = ELEM_COLOR[k] || '#ffd33d';
        ctx.beginPath();
        ctx.moveTo(al.points[i][0], al.points[i][1]);
        for (let n = i + 1; n <= j; n++) ctx.lineTo(al.points[n][0], al.points[n][1]);
        ctx.stroke();
        i = j;
      }
      // 요소 경계점 TS/SC/CS/ST
      ctx.lineWidth = px * 1.6;
      (al.nodes || []).forEach(nd => {
        ctx.strokeStyle = '#2E2A24'; ctx.fillStyle = '#F7F4EC';
        ctx.beginPath(); ctx.arc(nd.p[0], nd.p[1], px * 4.5, 0, 6.2832);
        ctx.fill(); ctx.stroke();
      });
    } else {
      ctx.strokeStyle = '#C8891F';
      ctx.beginPath();
      ctx.moveTo(al.points[0][0], al.points[0][1]);
      for (let i = 1; i < al.points.length; i++) ctx.lineTo(al.points[i][0], al.points[i][1]);
      ctx.stroke();
    }

    // 평면 위 터널·교량 구간 — 선형 위에 굵게 덧그린다
    if (PROF && PROF.struct && $('lyStruct') && $('lyStruct').checked) {
      const sc = params().scale || 1;
      ctx.lineWidth = px * 6.5; ctx.lineCap = 'round';
      PROF.struct.runs.forEach(r => {
        if (r.kind === 'earth' || r.kind === 'out') return;
        ctx.strokeStyle = STRUCT_COLOR[r.kind];
        ctx.beginPath();
        for (let i = r.i0; i <= r.i1; i++) {
          const st = PROF.stations[i];
          if (i === r.i0) ctx.moveTo(st.x * sc, st.y * sc); else ctx.lineTo(st.x * sc, st.y * sc);
        }
        ctx.stroke();
      });
      ctx.lineWidth = px * 3.2;
    }

    // PI 점
    ctx.fillStyle = '#A85F1A';
    for (const row of fr.rows) { ctx.beginPath(); ctx.arc(row.x, row.y, px * 5, 0, 6.2832); ctx.fill(); }
    // PI 드래그 중이면 그 PI가 갈 수 있는 구간(허용대)을 깔아준다 — 왜 안 나가는지 보이게
    const dm = dragPt && /^pi(\d+)$/.exec(dragPt);
    if (dm) {
      const i = +dm[1] - 1, n = genome.activePI;
      const bx = SITE.end[0] - SITE.start[0], by = SITE.end[1] - SITE.start[1];
      const hw = params().widthM / 2;
      const q = (t, o) => [SITE.start[0] + bx * t + nx * o, SITE.start[1] + by * t + ny * o];
      const a = q(i / n, -hw), b = q((i + 1) / n, -hw), c2 = q((i + 1) / n, hw), d2 = q(i / n, hw);
      ctx.fillStyle = 'rgba(255,157,63,.10)';
      ctx.strokeStyle = 'rgba(255,157,63,.55)'; ctx.lineWidth = px * 1.2;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      ctx.lineTo(c2[0], c2[1]); ctx.lineTo(d2[0], d2[1]); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }

    // 점 핸들 — 잠김: 회색 링 + 사선 / 호버·드래그: 강조 링
    handles().forEach(h => {
      const lock = locks.has(h.id), act = (dragPt === h.id || hoverPt === h.id);
      const rr = h.id === 'start' || h.id === 'end' ? 7 : 5.5;
      if (act) {
        ctx.strokeStyle = h.c; ctx.lineWidth = px * 2;
        ctx.beginPath(); ctx.arc(h.p[0], h.p[1], px * (rr + 7), 0, 6.2832); ctx.stroke();
      }
      ctx.fillStyle = h.c;
      ctx.beginPath(); ctx.arc(h.p[0], h.p[1], px * rr, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = 'rgba(247,244,236,.90)'; ctx.lineWidth = px * 1.2;
      ctx.beginPath(); ctx.arc(h.p[0], h.p[1], px * rr, 0, 6.2832); ctx.stroke();
      if (lock) {
        ctx.strokeStyle = '#7A7264'; ctx.lineWidth = px * 1.6;
        ctx.beginPath(); ctx.arc(h.p[0], h.p[1], px * (rr + 3.5), 0, 6.2832); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(h.p[0] - px * (rr + 2), h.p[1] - px * (rr + 2));
        ctx.lineTo(h.p[0] + px * (rr + 2), h.p[1] + px * (rr + 2));
        ctx.stroke();
      }
    });

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 도로 우선 교정의 영향 계측 — 반대 설정으로 한 번 더 채점.
    // 드래그 중에는 건너뛴다(평가 비용이 2배가 되어 끊긴다).
    let alt = null;
    if (!dragPt) {
      const altParams = Object.assign({}, CTXE.params, { roadWins: !CTXE.params.roadWins });
      alt = KHScore.evaluate(genome, Object.assign({}, CTXE, { params: altParams })).metrics;
    }
    showMetrics(r.metrics, al, alt);
    if (!dragPt) renderDesign(fr.points);
    renderProfile(al);
  }

  /* ---------- 종단 ---------- */
  function computeProfile(al) {
    if (!KHTerrain.loaded() || !al || !al.points || al.points.length < 2) return null;
    const sc = params().scale || 1;
    const pts = al.points.map(q => [q[0] / sc, q[1] / sc]);
    const o = pparams(); o.fallback = KHTerrain.sampleOrNearest;
    if ($('gdProf') && $('gdProf').checked && genome.prof) o.genomeProf = genome.prof;
    return KHProfile.compute(pts, KHTerrain.sample, o);
  }

  function renderProfile(al) {
    const cvp = $('pfcv');
    if (!cvp || $('profile').classList.contains('off')) return;
    PROF = computeProfile(al);
    const c = cvp.getContext('2d'), dpr = window.devicePixelRatio || 1;
    const w = cvp.clientWidth, h = cvp.clientHeight;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#F7F4EC'; c.fillRect(0, 0, w, h);
    if (!PROF) {
      c.fillStyle = '#7A7264'; c.font = '12px "Malgun Gothic",sans-serif';
      c.fillText('지형 로딩 대기…', 12, 20);
      return;
    }

    const P = PROF, pad = { l: 52, r: 14, t: 12, b: 22 };
    const iw = Math.max(10, w - pad.l - pad.r), ih = Math.max(10, h - pad.t - pad.b);
    const S = P.length || 1;
    const zAll = P.ground.concat(P.design);
    let z0 = Math.min.apply(null, zAll), z1 = Math.max.apply(null, zAll);
    const ex = +$('pfex').value;                        // 과장 V:H
    // 과장을 지키되 화면을 벗어나지 않게 — 필요한 표고폭을 계산해 중앙 정렬
    const needZ = (ih / iw) * S / Math.max(1, ex);
    const zc = (z0 + z1) / 2;
    const span = Math.max(z1 - z0 + 4, needZ);
    z0 = zc - span / 2; z1 = zc + span / 2;
    const X = (sv) => pad.l + iw * sv / S;
    const Y = (zv) => pad.t + ih * (1 - (zv - z0) / Math.max(1e-9, z1 - z0));

    // 격자
    c.strokeStyle = '#E2DACB'; c.lineWidth = 1;
    c.font = '10px "Malgun Gothic",sans-serif'; c.fillStyle = '#8C8271';
    const zstep = niceStep((z1 - z0) / 5);
    for (let z = Math.ceil(z0 / zstep) * zstep; z <= z1; z += zstep) {
      c.beginPath(); c.moveTo(pad.l, Y(z)); c.lineTo(w - pad.r, Y(z)); c.stroke();
      c.fillText('EL ' + z.toFixed(0), 6, Y(z) + 3);
    }
    const sstep = niceStep(S / 8);
    for (let sv = 0; sv <= S; sv += sstep) {
      c.beginPath(); c.moveTo(X(sv), pad.t); c.lineTo(X(sv), h - pad.b); c.stroke();
      c.fillText((sv / 1000).toFixed(2) + 'k', X(sv) - 12, h - pad.b + 13);
    }

    // 절토(위) / 성토(아래) 채우기 — 연속 구간마다 독립 폴리곤으로 닫는다
    const fillBand = (wantCut, col) => {
      c.fillStyle = col;
      let i = 0;
      const n = P.stations.length;
      while (i < n) {
        while (i < n && (P.outside[i] || (P.design[i] < P.ground[i]) !== wantCut)) i++;
        if (i >= n) break;
        let j = i;
        while (j + 1 < n && !P.outside[j + 1] && (P.design[j + 1] < P.ground[j + 1]) === wantCut) j++;
        if (j > i) {
          c.beginPath();
          c.moveTo(X(P.stations[i].s), Y(P.ground[i]));
          for (let k = i + 1; k <= j; k++) c.lineTo(X(P.stations[k].s), Y(P.ground[k]));
          for (let k = j; k >= i; k--) c.lineTo(X(P.stations[k].s), Y(P.design[k]));
          c.closePath(); c.fill();
        }
        i = j + 1;
      }
    };
    fillBand(true, 'rgba(190,110,60,.34)');    // 절토
    fillBand(false, 'rgba(74,127,165,.28)');   // 성토

    // 지반고 — 대지 밖 구간은 회색 점선(추정값임을 화면에서 구분)
    c.lineWidth = 1.6;
    for (let i = 1; i < P.stations.length; i++) {
      const out = P.outside[i - 1] || P.outside[i];
      c.strokeStyle = out ? '#B3AA98' : '#8C6A3A';
      c.setLineDash(out ? [4, 3] : []);
      c.beginPath();
      c.moveTo(X(P.stations[i - 1].s), Y(P.ground[i - 1]));
      c.lineTo(X(P.stations[i].s), Y(P.ground[i]));
      c.stroke();
    }
    c.setLineDash([]);

    // 계획고 — 경사 위반 구간은 빨강
    const bad = new Set();
    P.review.items.forEach(it => { if (it.kind === 'grade' && !it.ok) bad.add(it.idx); });
    let gi = 0;
    for (let i = 1; i < P.stations.length; i++) {
      const sv = P.stations[i].s;
      while (gi < P.vips.length - 2 && sv > P.vips[gi + 1].s) gi++;
      const k = P.struct ? P.struct.kind[i] : 'earth';
      c.strokeStyle = bad.has(gi) ? '#B0432F' : (STRUCT_COLOR[k] || '#4ea3ff');
      c.lineWidth = (k === 'tunnel' || k === 'bridge') ? 4.2 : 2.6;
      c.beginPath();
      c.moveTo(X(P.stations[i - 1].s), Y(P.design[i - 1]));
      c.lineTo(X(sv), Y(P.design[i]));
      c.stroke();
    }
    c.lineWidth = 2.6;

    // 구조물 구간 띠 — 종단 하단에 색으로 눕힌다
    if (P.struct) {
      const by = h - pad.b - 6;
      P.struct.runs.forEach(r => {
        if (r.kind === 'earth' || r.len <= 0) return;
        c.fillStyle = STRUCT_COLOR[r.kind];
        c.fillRect(X(r.from), by, Math.max(2, X(r.to) - X(r.from)), 5);
        const t = STRUCT_NAME[r.kind] + ' ' + Math.round(r.len) + 'm';
        if (X(r.to) - X(r.from) > 44) {
          c.fillStyle = STRUCT_COLOR[r.kind];
          c.font = '9.5px "Malgun Gothic",sans-serif';
          c.fillText(t, (X(r.from) + X(r.to)) / 2 - c.measureText(t).width / 2, by - 3);
        }
      });
    }

    // VIP 마커 + 구간 경사 라벨
    c.font = '10px "Malgun Gothic",sans-serif';
    P.review.grades.forEach((g, i) => {
      const mx = X((g.from + g.to) / 2);
      const my = Y((KHProfile.designAt(P.vips, P.lvc, g.from) + KHProfile.designAt(P.vips, P.lvc, g.to)) / 2);
      c.fillStyle = Math.abs(g.pct) > pparams().std.iMax ? '#B0432F' : '#5A7E9E';
      const t = (g.pct >= 0 ? '+' : '') + g.pct.toFixed(2) + '%';
      c.fillText(t, mx - c.measureText(t).width / 2, my - 6);
    });
    P.vips.forEach((v, i) => {
      c.fillStyle = (i === 0 || i === P.vips.length - 1) ? '#2E2A24' : '#C8891F';
      c.beginPath(); c.arc(X(v.s), Y(v.z), 3.2, 0, 6.2832); c.fill();
    });

    // 요약 — 단면 스윕을 쓰면 근사식 대신 실제 횡단형상 값으로 바꾼다
    let e = P.earth;
    if ($('useSweep') && $('useSweep').checked && P.stations.length <= 900) {
      const sw = KHSection.sweep(P, pparams(), KHTerrain.sampleOrNearest);
      e = Object.assign({}, P.earth, {
        cut: sw.cut, fill: sw.fill, total: sw.total, balance: sw.balance, sweep: true,
      });
      P.sweep = sw;
    }
    $('pfinfo').innerHTML =
      '연장 <b>' + fmt(P.length, 0) + ' m</b> · 최대경사 <b>' + fmt(P.maxGrade, 2) + '%</b>' +
      ' · 절토 <b>' + fmt(e.cut, 0) + ' m³</b> · 성토 <b>' + fmt(e.fill, 0) + ' m³</b>' +
      ' · 불균형 <b>' + fmt(e.balance, 0) + ' m³</b>' +
      (P.struct && P.struct.sum.tunnel > 0 ? ' · <span style="color:' + STRUCT_COLOR.tunnel +
        '">터널 ' + fmt(P.struct.sum.tunnel, 0) + ' m</span>' : '') +
      (P.struct && P.struct.sum.bridge > 0 ? ' · <span style="color:' + STRUCT_COLOR.bridge +
        '">교량 ' + fmt(P.struct.sum.bridge, 0) + ' m</span>' : '') +
      (P.earth.structLen > 0 ? ' · <span class="dim">구조물 ' +
        fmt(P.earth.structLen, 0) + ' m 토공 제외</span>' : '') +
      (P.earth.outsideLen > 0 ? ' · <span style="color:#d29922">지형 없음 ' +
        fmt(P.earth.outsideLen, 0) + ' m</span>' : '') +
      (P.review.ng ? ' · <span style="color:#f85149">위반 ' + P.review.ng + '</span>'
                   : ' · <span style="color:#3fb950">기준 만족</span>');

    if (P.struct) {
      const sm = P.struct.sum;
      $('stnote').innerHTML =
        '<span style="color:' + STRUCT_COLOR.earth + '">토공 ' + fmt(sm.earth, 0) + ' m</span> · ' +
        '<span style="color:' + STRUCT_COLOR.tunnel + '">터널 ' + fmt(sm.tunnel, 0) + ' m</span> · ' +
        '<span style="color:' + STRUCT_COLOR.bridge + '">교량 ' + fmt(sm.bridge, 0) + ' m</span>' +
        (sm.out > 0 ? ' · <span class="dim">대지 밖 ' + fmt(sm.out, 0) + ' m</span>' : '') +
        '<br>구간 ' + P.struct.runs.filter(r => r.kind !== 'earth').length + '개' +
        ' (터널 ' + P.struct.runs.filter(r => r.kind === 'tunnel').length +
        ' · 교량 ' + P.struct.runs.filter(r => r.kind === 'bridge').length + ')';
    }

    $('pfnote').innerHTML =
      '측점 ' + P.stations.length + '개 · VIP ' + P.vips.length + '개 · ' +
      '최대 절토고 ' + fmt(e.maxCutH, 1) + ' m / 성토고 ' + fmt(e.maxFillH, 1) + ' m<br>' +
      '<span class="dim">토공 = ' + (e.sweep ? '선형 따라 <b>횡단면 스윕</b>(실제 지반형상)'
        : '|h|·B + m·h² 근사식') + ' · 평균단면법. ' +
      '비탈면·K·최대경사는 표준 관행값이며 법령 원문 대조 미실시.</span>';

    renderSection(P);

    const rows = P.review.items.filter(it => !it.ok).slice(0, 6).map(it =>
      it.kind === 'grade'
        ? '<span style="color:#f85149">경사</span> STA ' + it.from.toFixed(0) + '~' + it.to.toFixed(0) +
          ' : ' + it.val.toFixed(2) + '% (허용 ±' + it.req + '%)'
        : '<span style="color:#f85149">종단곡선</span> STA ' + it.s.toFixed(0) +
          ' : K=' + it.K.toFixed(1) + ' (최소 ' + it.req + ')');
    $('pfchk').innerHTML = rows.length ? rows.join('<br>')
      : '<span class="ok">경사·종단곡선 검토 통과</span>';
  }

  /* ── 횡단면 ─────────────────────────────────────────────────────── */
  function renderSection(P) {
    const cvx = $('xscv');
    if (!cvx || !KHTerrain.loaded()) return;
    const n = P.stations.length;
    const sl = $('xspos');
    sl.max = String(n - 1);
    const i = Math.min(n - 1, Math.max(0, +sl.value | 0));
    const o = pparams();
    const sec = KHSection.sectionAt(P, i, o, KHTerrain.sampleOrNearest);
    $('xsposv').textContent = 'STA ' + Math.round(P.stations[i].s) + 'm';

    const c = cvx.getContext('2d'), dpr = window.devicePixelRatio || 1;
    const w = cvx.clientWidth, h = cvx.clientHeight;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#F7F4EC'; c.fillRect(0, 0, w, h);
    const pad = { l: 8, r: 8, t: 18, b: 16 };
    const os = sec.ground.map(g => g[0]), zs = sec.ground.map(g => g[1])
      .concat(sec.design.map(d => d[1]));
    const o0 = Math.min.apply(null, os), o1 = Math.max.apply(null, os);
    let z0 = Math.min.apply(null, zs), z1 = Math.max.apply(null, zs);
    const zp = Math.max(2, (z1 - z0) * 0.12); z0 -= zp; z1 += zp;
    const X = (ov) => pad.l + (w - pad.l - pad.r) * (ov - o0) / Math.max(1e-9, o1 - o0);
    const Y = (zv) => pad.t + (h - pad.t - pad.b) * (1 - (zv - z0) / Math.max(1e-9, z1 - z0));

    // 절·성토 채우기
    const band = (wantCut, col) => {
      c.fillStyle = col; c.beginPath();
      let started = false;
      const dAt = (ov) => {
        const d = sec.design;
        for (let k = 0; k < d.length - 1; k++) {
          if (ov >= d[k][0] && ov <= d[k + 1][0]) {
            const t = (ov - d[k][0]) / Math.max(1e-9, d[k + 1][0] - d[k][0]);
            return d[k][1] + (d[k + 1][1] - d[k][1]) * t;
          }
        }
        return null;
      };
      const pts = [];
      sec.ground.forEach(g => {
        const dz = dAt(g[0]);
        if (dz == null) return;
        const isCut = dz < g[1];
        if (isCut === wantCut) pts.push([g[0], g[1], dz]);
      });
      if (pts.length < 2) return;
      pts.forEach((p, k) => k ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])));
      for (let k = pts.length - 1; k >= 0; k--) c.lineTo(X(pts[k][0]), Y(pts[k][2]));
      c.closePath(); c.fill();
    };
    band(true, 'rgba(190,110,60,.38)');
    band(false, 'rgba(74,127,165,.32)');

    // 지반선
    c.strokeStyle = '#8C6A3A'; c.lineWidth = 1.4; c.beginPath();
    sec.ground.forEach((g, k) => k ? c.lineTo(X(g[0]), Y(g[1])) : c.moveTo(X(g[0]), Y(g[1])));
    c.stroke();
    // 계획면(노면 + 비탈면)
    c.strokeStyle = '#4A7FA5'; c.lineWidth = 2.2; c.beginPath();
    sec.design.forEach((d, k) => k ? c.lineTo(X(d[0]), Y(d[1])) : c.moveTo(X(d[0]), Y(d[1])));
    c.stroke();
    // 노면
    c.strokeStyle = '#C8891F'; c.lineWidth = 3.2; c.beginPath();
    c.moveTo(X(sec.road[0][0]), Y(sec.road[0][1]));
    c.lineTo(X(sec.road[1][0]), Y(sec.road[1][1]));
    c.stroke();
    // 비탈끝
    c.fillStyle = '#2E2A24';
    [sec.toeL, sec.toeR].forEach(t => {
      c.beginPath(); c.arc(X(t[0]), Y(t[1]), 2.6, 0, 6.2832); c.fill();
    });

    c.fillStyle = '#7A7264'; c.font = '10px "Malgun Gothic",sans-serif';
    c.fillText('횡단 STA ' + Math.round(sec.s) + 'm', 8, 12);
    c.fillText('절 ' + sec.cutArea.toFixed(0) + ' / 성 ' + sec.fillArea.toFixed(0) + ' m²' +
      ' · 폭 ' + sec.width.toFixed(0) + ' m', 8, h - 4);
  }

  function niceStep(v) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, v))));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  function fmt(v, d) { return (v == null || !isFinite(v)) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }

  function showMetrics(m, al, alt) {
    if (alt) {
      const on = $('roadwin').checked;
      const d = m.obstacleOverlap - alt.obstacleOverlap;   // ON일 때 음수 = 줄어든 양
      $('rwnote').innerHTML = on
        ? '<span class="ok">ON</span> — 장애물겹침 <b>' + fmt(m.obstacleOverlap, 1) + 'm</b>' +
          ' (끄면 ' + fmt(alt.obstacleOverlap, 1) + 'm, <b>' + fmt(-d, 1) + 'm 가 도로와 중복</b>)' +
          '<br><span class="dim">★v7에는 없는 교정. 켜면 v7 값과 달라진다.</span>'
        : '<span class="warn">OFF = v7 그대로</span> — 도로와 겹치는 구간이 장애물로도 계상됨' +
          ' (켜면 ' + fmt(alt.obstacleOverlap, 1) + 'm 로 감소)';
    }
    $('score').textContent = fmt(m.score, 2);
    $('oTL').textContent = fmt(m.totalLength, 1);
    $('oRO').textContent = fmt(m.roadOverlap, 1);
    $('oOO').textContent = fmt(m.obstacleOverlap, 1);
    $('oLS').textContent = fmt(m.lengthScore, 2);
    $('oRS').textContent = fmt(m.roadScore, 2);
    $('oOP').textContent = fmt(m.obstaclePenalty, 2);
    $('oBL').textContent = fmt(m.baselineLen, 1);
    const sc = $('score');
    sc.style.color = m.obstacleOverlap > 0 ? '#d29922' : '#3fb950';
    $('smnote').innerHTML = params().sampleMode === 'v7'
      ? '<span class="warn">추정량 = ' + m.sampleNote + '</span> · 모드마다 샘플 간격이 달라 <b>모드 간 점수 비교 불가</b>'
      : '<span class="ok">추정량 = ' + m.sampleNote + '</span> · 모드 간 비교 가능';
    // 요소별 연장 집계
    const showEl = $('elems').checked;
    $('elemLegend').style.display = showEl ? '' : 'none';
    if (showEl && al.kinds) {
      const L = { tangent: 0, spiral: 0, arc: 0 };
      al.kinds.forEach((k, i) => {
        L[k] = (L[k] || 0) + Math.hypot(al.points[i + 1][0] - al.points[i][0],
                                        al.points[i + 1][1] - al.points[i][1]);
      });
      const tot = L.tangent + L.spiral + L.arc || 1;
      $('elemStat').innerHTML =
        '직선 <b>' + fmt(L.tangent, 0) + 'm</b> (' + (100 * L.tangent / tot).toFixed(0) + '%) · ' +
        '완화 <b>' + fmt(L.spiral, 0) + 'm</b> (' + (100 * L.spiral / tot).toFixed(0) + '%) · ' +
        '원곡 <b>' + fmt(L.arc, 0) + 'm</b> (' + (100 * L.arc / tot).toFixed(0) + '%)';
    }
    const v = al.violations || [];
    $('viol').innerHTML = al.mode === 'poly'
      ? '<span class="dim">poly 모드 = v7 GD01 재현. 곡선 제약 미적용.</span>'
      : (v.length ? '<span class="bad">기하 위반 ' + v.length + '건</span> <span class="dim">(' +
          v.slice(0, 4).map(x => 'PI' + x.pi + ':' + x.kind).join(', ') + ')</span>'
        : '<span class="ok">기하 위반 0 — R/Ls 조합 성립</span>');
    $('hud').innerHTML = '장애물 <b>' + (SITE.obstacle.length + ($('lyExtra').checked ? SITE.obstacle_extra.length : 0)) +
      '</b> · 도로 <b>' + SITE.road.length + '</b> · 선형점 <b>' + al.points.length +
      '</b> · 구간 <b>' + al.spans.length + '</b>';
  }

  /* ---------- 대안 목록 ---------- */
  function statusOf(m) {
    if (m.obstacleOverlap > 0.5) return { cls: 'bd', txt: '장애물 ' + m.obstacleOverlap.toFixed(0) + 'm' };
    const nv = (m.violations || []).length;
    if (nv) return { cls: 'wn', txt: '기하 ' + nv + '건' };
    return { cls: 'ok', txt: '양호' };
  }

  /* 현재 파라미터로 전 대안을 재채점한다.
     → 가중치·추정량·모드를 바꾸면 순위가 즉시 다시 매겨진다. */
  function buildCandidates() {
    // GA가 수렴하면 파레토 front에 사실상 같은 해가 여럿 쌓인다. 접어서 보여준다.
    const seen = new Map();
    frontGenomes.forEach(g => {
      const r = KHScore.evaluate(g, CTXE);
      const m = r.metrics;
      const key = m.score.toFixed(2) + '|' + m.totalLength.toFixed(0) + '|' +
        m.obstacleOverlap.toFixed(0) + '|' + g.activePI;
      const prev = seen.get(key);
      if (prev) { prev.dup++; return; }
      seen.set(key, { gen: g, m: m, pts: r.alignment.points, dup: 1 });
    });
    candidates = Array.from(seen.values());
    if (selGen && !candidates.some(c => c.gen === selGen)) selGen = null;
    sortCandidates();
  }

  function sortCandidates() {
    const key = $('csort').value;
    const cmp = {
      score: (a, b) => b.m.score - a.m.score,
      obs: (a, b) => a.m.obstacleOverlap - b.m.obstacleOverlap || b.m.score - a.m.score,
      len: (a, b) => a.m.totalLength - b.m.totalLength,
      road: (a, b) => b.m.roadScore - a.m.roadScore
    }[key];
    candidates.sort(cmp);
    applyFilter();
  }

  /* 필터: 화면 고스트와 목록이 같은 집합을 보게 한다. */
  function applyFilter() {
    const f = $('cfilter').value;
    shown = candidates.filter(c => {
      const s = statusOf(c.m);
      if (f === 'clean') return s.cls !== 'bd';
      if (f === 'ok') return s.cls === 'ok';
      return true;
    });
    selIdx = selGen ? shown.findIndex(c => c.gen === selGen) : -1;
  }

  function renderCandidates() {
    const list = $('candList');
    let ok = 0, wn = 0, bd = 0;
    candidates.forEach(c => {
      const cls = statusOf(c.m).cls;
      if (cls === 'ok') ok++; else if (cls === 'wn') wn++; else bd++;
    });
    $('candN').textContent = shown.length + ' / ' + candidates.length;
    $('candSum').innerHTML = candidates.length
      ? '<span class="st ok">양호 ' + ok + '</span>' +
        '<span class="st wn">기하위반 ' + wn + '</span>' +
        '<span class="st bd">장애물충돌 ' + bd + '</span>'
      : '';
    if (!shown.length) {
      list.innerHTML = '<div class="crow"><span class="dim">' +
        (candidates.length ? '이 필터에 해당하는 대안 없음' : '최적화를 실행하면 대안이 쌓인다') +
        '</span></div>';
      return;
    }
    let html = '';
    shown.forEach((c, i) => {
      const s = statusOf(c.m);
      html += '<div class="crow' + (i === selIdx ? ' sel' : '') + '" data-i="' + i + '">' +
        '<span class="n">' + (i + 1) + '</span>' +
        '<span class="sc">' + c.m.score.toFixed(2) + '</span>' +
        '<span class="ln">' + (c.m.totalLength / 1000).toFixed(2) + 'km</span>' +
        '<span class="pi">PI' + c.gen.activePI + '</span>' +
        (c.dup > 1 ? '<span class="dim" style="font-size:10px">×' + c.dup + '</span>' : '') +
        '<span class="st ' + s.cls + '">' + s.txt + '</span></div>';
    });
    list.innerHTML = html;
    list.querySelectorAll('.crow[data-i]').forEach(el => {
      el.addEventListener('click', () => selectCandidate(+el.dataset.i));
    });
    renderGallery();
  }

  function selectCandidate(i) {
    if (i < 0 || i >= shown.length) return;
    selIdx = i;
    const g = shown[i].gen;
    selGen = g;
    genome = { activePI: g.activePI, u: g.u.slice(), v: g.v.slice() };
    $('pi').value = genome.activePI; $('piv').textContent = genome.activePI;
    // 선택 표시만 갱신 — 썸네일 전체를 다시 그리지 않는다
    $('candList').querySelectorAll('.crow[data-i]').forEach(el =>
      el.classList.toggle('sel', +el.dataset.i === i));
    $('gbody').querySelectorAll('.card[data-i]').forEach(el =>
      el.classList.toggle('sel', +el.dataset.i === i));
    renderPointList();          // 대안마다 PI 개수·좌표가 다르다 → 목록 동기화
    draw();
  }

  /* ---------- 설계기준 검토 ---------- */
  let STD = null;

  function stdRow() {
    if (!STD) return null;
    const V = +$('Vsel').value;
    const row = STD['설계속도'].find(r => r.V === V) || STD['설계속도'][0];
    return Object.assign({}, STD['전역'], row, { eMax: +$('emax').value });
  }

  function renderDesign(piPts) {
    if (!STD) return;
    const std = stdRow();
    const R = +$('R').value, Ls = +$('Ls').value;
    const Rmin = KHDesign.minRadius(std.V, std.eMax, std.f);
    const sm = KHDesign.spiralMinLength(std.V, R, {
      e: std.eMax, jerk: std.jerk, driveSec: std.driveSec,
      rotWidth: std.rotWidth, runoffRate: std.runoffRate, tableMin: std.LsMin
    });
    const c = KHDesign.clothoid(R, Ls || 1);

    $('stdCalc').innerHTML =
      '<div class="fx">' +
      'R<sub>min</sub> = V²/(127(e+f)) = ' + std.V + '²/(127×(' + std.eMax.toFixed(2) + '+' + std.f + ')) = <b>' +
      fmt(Rmin, 1) + ' m</b>' + (R >= Rmin ? ' <span class="ok">현재 R=' + R + ' OK</span>'
        : ' <span class="bad">현재 R=' + R + ' 미달</span>') +
      '<br>L<sub>s,min</sub> = max(주행 ' + fmt(sm.byTime, 1) + ', jerk ' + fmt(sm.byJerk, 1) +
      ', 편경사 ' + fmt(sm.byRunoff, 1) + ', 표 ' + fmt(sm.tableMin, 0) + ') = <b>' + fmt(sm.governing, 1) +
      ' m</b> <span class="dim">(지배: ' + sm.governingBy + ')</span>' +
      (Ls >= sm.governing ? ' <span class="ok">OK</span>' : ' <span class="bad">미달</span>') +
      '<br>A = √(R·L<sub>s</sub>) = <b>' + fmt(c.A, 1) + '</b>, A/R = ' + c.ratioAR.toFixed(3) +
      ' <span class="dim">(권장 ' + std.aOverRMin.toFixed(2) + '~' + std.aOverRMax.toFixed(2) + ')</span>' +
      '<br>τ = L<sub>s</sub>/2R = ' + c.tauDeg.toFixed(3) + '°, ' +
      'p = ' + fmt(c.p, 3) + ' m <span class="dim">(1차근사 ' + fmt(c.pApprox, 3) + ')</span>, ' +
      'k = ' + fmt(c.k, 3) + ' m <span class="dim">(근사 ' + fmt(c.kApprox, 3) + ')</span>' +
      '</div>';

    if (!piPts || piPts.length < 3) { $('stdTable').innerHTML = ''; return; }
    const rev = KHDesign.review(piPts, R, Ls, std);
    let h = '<table class="std"><tr><th>PI</th><th>Δ</th><th>TL</th><th>원곡선</th><th>A</th><th>판정</th></tr>';
    rev.items.forEach(it => {
      const ngs = it.checks.filter(x => !x.ok);
      const dash = '<td class="dim">—</td>';
      h += '<tr><td>PI' + it.pi + ' ' + it.dir + '</td>' +
        '<td>' + it.deltaDeg.toFixed(1) + '°</td>' +
        (it.noCurve || it.impossible ? dash + dash + dash
          : '<td>' + fmt(it.TL, 0) + '</td><td>' + fmt(it.arcLen, 0) + '</td><td>' + fmt(it.clo.A, 0) + '</td>') +
        '<td class="' + (it.noCurve ? 'dim' : (ngs.length ? 'ng' : 'okv')) + '">' +
        (it.noCurve ? '곡선없음' : (ngs.length ? ngs.map(x => x.key).join(',') : 'OK')) + '</td></tr>';
    });
    rev.straights.forEach(s => {
      h += '<tr><td>직선 ' + s.between + '</td><td colspan="3">' + fmt(s.avail, 0) +
        ' / 필요 ' + fmt(s.req, 0) + '</td><td>' + s.note + '</td>' +
        '<td class="' + (s.ok ? 'okv' : 'ng') + '">' + (s.ok ? 'OK' : '부족') + '</td></tr>';
    });
    h += '</table><div class="note">위반 합계 <b class="' + (rev.ng ? 'bad' : 'ok') + '">' + rev.ng +
      '건</b> · <span class="dim">공식은 유도식이라 신뢰 가능. 표 수치(f·L<sub>s,min</sub>·직선장 계수)는 <b>원문 미대조</b>.</span></div>';
    $('stdTable').innerHTML = h;
  }

  /* 점 드래그 자가검사 — 합성 마우스 이벤트로 실제 드래그를 재현한다.
   * "보기엔 되는 것 같다"가 아니라 좌표가 실제로 변했는지 숫자로 확인한다. */
  function runPointTest() {
    const PE = (type, sx, sy) => {
      const r = cv.getBoundingClientRect();
      const C = window.PointerEvent || MouseEvent;
      return new C(type, {
        pointerId: 1, isPrimary: true, button: 0, buttons: 1,
        clientX: r.left + sx, clientY: r.top + sy, bubbles: true, cancelable: true
      });
    };
    const fire = (type, sx, sy) => cv.dispatchEvent(PE(type, sx, sy));

    /* ★핵심 검사 — 그린 위치와 클릭 판정 위치가 같은가.
     * worldToScreen 이 계산한 자리의 캔버스 픽셀을 실제로 읽어 그 점 색이 있는지 본다.
     * 이게 없으면 DPR 불일치처럼 "자기들끼리만 맞는" 검사가 되어 통과해도 실제론 안 눌린다. */
    function pixelCheck(id, expect) {
      const h = handles().find(x => x.id === id);
      if (!h) return { ok: false, why: '핸들 없음' };
      const s = worldToScreen(h.p), d = DPR();
      const px = Math.round(s[0] * d), py = Math.round(s[1] * d);
      if (px < 0 || py < 0 || px >= cv.width || py >= cv.height) return { ok: false, why: '화면 밖' };
      let hit = false, got = null;
      for (let dx = -2; dx <= 2 && !hit; dx++) {
        for (let dy = -2; dy <= 2 && !hit; dy++) {
          const q = ctx.getImageData(px + dx, py + dy, 1, 1).data;
          got = [q[0], q[1], q[2]];
          if (Math.abs(q[0] - expect[0]) < 60 && Math.abs(q[1] - expect[1]) < 60 && Math.abs(q[2] - expect[2]) < 60) hit = true;
        }
      }
      return { ok: hit, got: got, at: [px, py] };
    }
    const rows = [];
    const tryDrag = (id, dxp, dyp) => {
      const h0 = handles().find(x => x.id === id);
      if (!h0) { rows.push({ id: id, ok: false, why: '핸들 없음' }); return; }
      const s = worldToScreen(h0.p);
      const before = h0.p.slice();
      fire('pointerdown', s[0], s[1]);
      const grabbed = (dragPt === id);
      fire('pointermove', s[0] + dxp, s[1] + dyp);
      const h1 = handles().find(x => x.id === id);
      const after = h1 ? h1.p.slice() : before;
      fire('pointerup', s[0] + dxp, s[1] + dyp);
      const moved = Math.hypot(after[0] - before[0], after[1] - before[1]);
      rows.push({ id: id, ok: grabbed && moved > 1, grabbed: grabbed, moved: moved });
    };

    tryDrag('start', 45, -35);
    tryDrag('pi1', 30, 45);
    tryDrag('end', -40, 25);
    // 고정 동작 확인: 잠그면 잡히지 않아야 한다
    locks.add('start');
    const h = handles().find(x => x.id === 'start');
    const s = worldToScreen(h.p);
    fire('pointerdown', s[0], s[1]);
    const lockedGrab = (dragPt === 'start');
    fire('pointerup', s[0], s[1]);
    locks.delete('start');
    rows.push({ id: 'start(고정)', ok: !lockedGrab, grabbed: lockedGrab, moved: 0, note: '잠금 시 안 잡혀야 정상' });

    // 그린 위치 ↔ 클릭 판정 위치 일치 (DPR 어긋남 검출)
    draw();
    const pxTests = [
      ['start', [63, 185, 80], 'START 녹색'],
      ['end', [240, 246, 252], 'END 흰색'],
      ['pi1', [255, 157, 63], 'PI1 주황']
    ].map(([id, col, lbl]) => {
      const r = pixelCheck(id, col);
      return { id: 'pixel:' + lbl, ok: r.ok, px: true, got: r.got, why: r.why };
    });
    rows.push.apply(rows, pxTests);

    const pass = rows.every(r => r.ok);
    window.__KH_PTEST = { pass: pass, dpr: DPR(), rows: rows };
    $('ptNote').innerHTML = '<b>드래그 자가검사 ' +
      (pass ? '<span class="ok">PASS</span>' : '<span class="bad">FAIL</span>') +
      '</b> <span class="dim">DPR ' + DPR() + '</span><br>' +
      rows.map(r => (r.ok ? '<span class="ok">✔</span> ' : '<span class="bad">✘</span> ') + r.id +
        (r.px ? ' — 그린자리 픽셀 ' + (r.ok ? '일치' : '불일치 ' + (r.why || JSON.stringify(r.got)))
              : ' — 잡힘 ' + (r.grabbed ? 'O' : 'X') +
                (r.moved != null ? ' / 이동 ' + r.moved.toFixed(1) + 'm' : '')) +
        (r.note ? ' <span class="dim">(' + r.note + ')</span>' : '')).join('<br>');
    document.title = 'PTEST ' + (pass ? 'PASS' : 'FAIL') + ' dpr' + DPR();
    renderPointList(); draw();
  }

  /* ---------- 대안 갤러리 (썸네일 그리드) ---------- */
  let THUMB = null;   // {base, k, ox, oy, w, h} — 사이트 배경을 한 번만 그려두고 카드마다 복사

  function siteBounds() {
    const b = SITE.bounds.slice();
    return [Math.min(b[0], SITE.start[0], SITE.end[0]), Math.min(b[1], SITE.start[1], SITE.end[1]),
            Math.max(b[2], SITE.start[0], SITE.end[0]), Math.max(b[3], SITE.start[1], SITE.end[1])];
  }

  function buildThumbBase() {
    // 내부 해상도를 카드 표시폭보다 크게 잡아 넓게 늘려도 안 흐리게(3:2 유지)
    const w = 300, h = 200, dpr = Math.min(2, window.devicePixelRatio || 1);
    const b = siteBounds();
    const k = Math.min(w / ((b[2] - b[0]) * 1.08), h / ((b[3] - b[1]) * 1.08));
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    const ox = w / 2 - cx * k, oy = h / 2 + cy * k;
    const c = document.createElement('canvas');
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = '#F7F4EC'; g.fillRect(0, 0, w, h);
    g.setTransform(k * dpr, 0, 0, -k * dpr, ox * dpr, oy * dpr);
    g.fillStyle = 'rgba(74,127,165,.42)'; g.fill(PATHS.road);
    g.fillStyle = 'rgba(176,67,47,.22)'; g.fill(PATHS.extra);
    g.fillStyle = 'rgba(176,67,47,.48)'; g.fill(PATHS.obs);
    THUMB = { base: c, k: k, ox: ox, oy: oy, w: w, h: h, dpr: dpr };
  }

  function drawThumb(cv, cand) {
    const T = THUMB, d = T.dpr;
    cv.width = T.w * d; cv.height = T.h * d;
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(T.base, 0, 0);
    g.setTransform(T.k * d, 0, 0, -T.k * d, T.ox * d, T.oy * d);
    const px = 1 / T.k;
    // baseline
    g.strokeStyle = 'rgba(122,114,100,.45)'; g.lineWidth = px * .8;
    g.beginPath(); g.moveTo(SITE.start[0], SITE.start[1]); g.lineTo(SITE.end[0], SITE.end[1]); g.stroke();
    // 선형
    const pts = cand.pts;
    g.strokeStyle = cand.m.obstacleOverlap > 0.5 ? '#B0432F' : '#C8891F';
    g.lineWidth = px * 2.4; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.stroke();
    g.fillStyle = '#2E7D5B';
    g.beginPath(); g.arc(SITE.start[0], SITE.start[1], px * 3.4, 0, 6.2832); g.fill();
    g.fillStyle = '#2E2A24';
    g.beginPath(); g.arc(SITE.end[0], SITE.end[1], px * 3.4, 0, 6.2832); g.fill();
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  function renderGallery() {
    if (!$('gallery').classList.contains('on')) return;
    if (!THUMB) buildThumbBase();
    const body = $('gbody');
    $('gN').textContent = shown.length + '개';
    if (!shown.length) {
      body.innerHTML = '<div class="dim" style="grid-column:1/-1;padding:14px;font-size:12px">' +
        '최적화를 실행하면 대안 썸네일이 여기 쌓인다</div>';
      return;
    }
    body.innerHTML = '';
    shown.forEach((c, i) => {
      const s = statusOf(c.m);
      const el = document.createElement('div');
      el.className = 'card' + (i === selIdx ? ' sel' : '');
      el.dataset.i = i;
      el.innerHTML = '<canvas></canvas>' +
        '<span class="crank">#' + (i + 1) + (c.dup > 1 ? ' ×' + c.dup : '') + '</span>' +
        '<span class="cbadge st ' + s.cls + '">' + s.txt + '</span>' +
        '<div class="cmeta"><b>' + c.m.score.toFixed(2) + '</b>' +
        '<span>' + (c.m.totalLength / 1000).toFixed(2) + 'km</span>' +
        '<span style="margin-left:auto">PI' + c.gen.activePI + '</span></div>';
      body.appendChild(el);
      drawThumb(el.querySelector('canvas'), c);
      el.addEventListener('click', () => selectCandidate(i));
    });
  }

  let galW = 352;

  function toggleGallery(on) {
    const g = $('gallery');
    const open = on == null ? !g.classList.contains('on') : on;
    g.classList.toggle('on', open);
    g.style.width = open ? galW + 'px' : '';
    resize();
    renderGallery();
  }

  /* 폭 조절 손잡이. dir=+1: 오른쪽으로 끌면 target이 넓어짐(target이 손잡이 왼쪽). */
  function makeSplit(handle, target, dir, onDone) {
    let st = null;
    handle.addEventListener('mousedown', e => {
      st = { x: e.clientX, w: target.offsetWidth };
      handle.classList.add('act');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!st) return;
      const w = Math.max(210, Math.min(920, st.w + dir * (e.clientX - st.x)));
      target.style.width = w + 'px';
      if (target.id === 'gallery') galW = w;
      resize();
    });
    window.addEventListener('mouseup', () => {
      if (!st) return;
      st = null;
      handle.classList.remove('act');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (onDone) onDone();
    });
  }

  /* ---------- 점 편집 (START / END / PI1..n 전부 드래그·고정) ---------- */
  const HIT_R = 14;                       // 화면 픽셀 기준 잡기 반경
  let ORIG = null, dragPt = null, hoverPt = null;
  const locks = new Set();

  const worldToScreen = (w) =>
    [(w[0] - view.cx) * view.k + W() / 2, -(w[1] - view.cy) * view.k + H() / 2];

  /* 현재 상태의 점 핸들 목록. PI는 genome 에서 파생되므로 매번 새로 만든다. */
  function handles() {
    const p = params();
    const fr = KHAlign.piFrame(SITE.start, SITE.end, genome.activePI, genome.u, genome.v, p.widthM, p.scale);
    const hs = [{ id: 'start', p: [SITE.start[0], SITE.start[1]], c: '#3fb950', label: 'START' }];
    fr.rows.forEach(r => hs.push({
      id: 'pi' + r.pi, p: [r.x, r.y], c: '#ff9d3f', label: 'PI' + r.pi,
      pi: r.pi, u: r.u, v: r.v, station: r.station
    }));
    hs.push({ id: 'end', p: [SITE.end[0], SITE.end[1]], c: '#f0f6fc', label: 'END' });
    return hs;
  }

  function hitPoint(sx, sy) {
    const hs = handles();
    let best = null, bestD = HIT_R;
    for (const h of hs) {                 // 가장 가까운 것 하나만
      if (locks.has(h.id)) continue;
      const s = worldToScreen(h.p);
      const d = Math.hypot(sx - s[0], sy - s[1]);
      if (d <= bestD) { bestD = d; best = h.id; }
    }
    return best;
  }

  /* PI 역매핑 — 월드 좌표를 v7 파라미터(u, v)로 되돌린다.
   *   station = ((P−start)·axis)/|baseline|,  offset = (P−start)·normal
   *   u_i = station·n − i        (자기 구간 [i/n,(i+1)/n] 밖은 잘림)
   *   v_i = offset/Width + 0.5
   * 슬라이더 step 0.01 로 양자화해 GA decode 와 값을 맞춘다.
   */
  function setPIFromWorld(piNo, wx, wy) {
    const p = params(), n = genome.activePI, i = piNo - 1;
    const sx = SITE.start[0], sy = SITE.start[1];
    const bx = SITE.end[0] - sx, by = SITE.end[1] - sy;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-9) return { clampedU: false, clampedV: false };
    const ax = bx / bl, ay = by / bl, nx = -ay, ny = ax;
    const dx = wx - sx, dy = wy - sy;
    const station = (dx * ax + dy * ay) / bl;
    const offset = dx * nx + dy * ny;
    const rawU = station * n - i;
    const rawV = offset / (p.widthM * p.scale) + 0.5;
    const u = Math.min(1, Math.max(0, rawU));
    const v = Math.min(1, Math.max(0, rawV));
    genome.u[i] = Math.round(u * 100) / 100;
    genome.v[i] = Math.round(v * 100) / 100;
    return { clampedU: rawU < 0 || rawU > 1, clampedV: rawV < 0 || rawV > 1 };
  }

  function movePoint(id, wx, wy) {
    if (id === 'start') { SITE.start = [wx, wy, 0]; return {}; }
    if (id === 'end') { SITE.end = [wx, wy, 0]; return {}; }
    const m = /^pi(\d+)$/.exec(id);
    if (m) return setPIFromWorld(+m[1], wx, wy);
    return {};
  }

  /* 점이 움직이면 격자는 그대로, baseline/PI만 바뀐다 → 대안만 재채점.
   * ★light=true(드래그 중)면 대안 재채점과 목록 재구성을 건너뛴다.
   *   대안 120개 × spiral 평가는 마우스 이동 1회당 10ms 넘게 먹어 끊긴다.
   *   놓는 순간(pointerup)에 한 번만 제대로 돌린다. */
  function refreshAfterPtMove(light) {
    if (light) { updatePointCoords(); draw(); return; }
    if (frontGenomes.length) { buildCandidates(); renderCandidates(); }
    renderPointList();
    draw();
  }

  /* 드래그 중 좌표 텍스트만 갱신 — DOM 재생성·리스너 재부착 없음 */
  function updatePointCoords() {
    const hs = handles();
    const rows = $('ptList').querySelectorAll('.prow');
    if (rows.length !== hs.length) { renderPointList(); return; }
    hs.forEach((h, i) => {
      const el = rows[i];
      el.querySelector('.pxy').textContent = h.p[0].toFixed(1) + ', ' + h.p[1].toFixed(1);
      if (h.pi) el.querySelector('.puv').textContent = 'u ' + h.u.toFixed(2) + ' v ' + h.v.toFixed(2);
      el.classList.toggle('act', dragPt === h.id || hoverPt === h.id);
    });
  }

  function renderPointList() {
    const hs = handles();
    $('ptN').textContent = 'Active PI ' + genome.activePI + ' → ' + hs.length + '점';
    $('ptList').innerHTML = hs.map(h =>
      '<div class="prow' + (hoverPt === h.id || dragPt === h.id ? ' act' : '') + '" data-id="' + h.id + '">' +
      '<span class="dot" style="background:' + h.c + '"></span>' +
      '<span class="pnm">' + h.label + '</span>' +
      '<span class="pxy">' + h.p[0].toFixed(1) + ', ' + h.p[1].toFixed(1) + '</span>' +
      (h.pi ? '<span class="puv">u ' + h.u.toFixed(2) + ' v ' + h.v.toFixed(2) + '</span>' : '<span class="puv"></span>') +
      '<input type="checkbox" class="plock"' + (locks.has(h.id) ? ' checked' : '') + '>' +
      '</div>').join('');
    $('ptList').querySelectorAll('.prow').forEach(el => {
      const id = el.dataset.id;
      el.querySelector('.plock').addEventListener('click', ev => {
        ev.stopPropagation();
        if (locks.has(id)) locks.delete(id); else locks.add(id);
        renderPointList(); draw();
      });
      el.addEventListener('click', () => {           // 행 클릭 = 그 점으로 화면 이동
        const h = handles().find(x => x.id === id);
        if (!h) return;
        view.cx = h.p[0]; view.cy = h.p[1];
        hoverPt = id; renderPointList(); draw();
      });
    });
  }

  /* ---------- 차트 ---------- */
  function chart(cvs, series, color) {
    const c = cvs.getContext('2d'), dpr = window.devicePixelRatio || 1;
    cvs.width = cvs.clientWidth * dpr; cvs.height = cvs.clientHeight * dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = cvs.clientWidth, h = cvs.clientHeight;
    c.fillStyle = '#0d1117'; c.fillRect(0, 0, w, h);
    if (!series.length) return;
    const mn = Math.min.apply(null, series), mx = Math.max.apply(null, series);
    const rng = (mx - mn) || 1;
    c.strokeStyle = color; c.lineWidth = 1.6; c.beginPath();
    series.forEach((v, i) => {
      const x = 4 + i / Math.max(1, series.length - 1) * (w - 8);
      const y = h - 5 - (v - mn) / rng * (h - 14);
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    });
    c.stroke();
    c.fillStyle = '#7A7264'; c.font = '10px system-ui';
    c.fillText(mx.toFixed(2), 5, 11); c.fillText(mn.toFixed(2), 5, h - 3);
  }

  function drawPareto() {
    const c = parCv.getContext('2d'), dpr = window.devicePixelRatio || 1;
    parCv.width = parCv.clientWidth * dpr; parCv.height = parCv.clientHeight * dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = parCv.clientWidth, h = parCv.clientHeight;
    c.fillStyle = '#0d1117'; c.fillRect(0, 0, w, h);
    if (!front.length) return;
    const xs = front.map(f => f.m.obstacleOverlap), ys = front.map(f => f.m.totalLength);
    const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs) || 1;
    const y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    const sx = v => 8 + (x1 - x0 ? (v - x0) / (x1 - x0) : .5) * (w - 20);
    const sy = v => h - 10 - (y1 - y0 ? (v - y0) / (y1 - y0) : .5) * (h - 22);
    front.forEach(f => {
      c.fillStyle = f.m.obstacleOverlap <= 0 ? '#3fb950' : '#d29922';
      c.beginPath(); c.arc(sx(f.m.obstacleOverlap), sy(f.m.totalLength), 2.6, 0, 6.2832); c.fill();
    });
    c.fillStyle = '#7A7264'; c.font = '10px system-ui';
    c.fillText('장애물 ' + x0.toFixed(0) + '→' + x1.toFixed(0) + 'm', 7, 11);
    c.fillText('연장 ' + y0.toFixed(0) + '→' + y1.toFixed(0) + 'm', 7, h - 2);
  }

  /* ---------- 최적화 ---------- */
  function gaCfg() {
    return {
      pop: +$('pop').value, gens: +$('gens').value, seed: +$('seed').value,
      elite: 2, mutRate: 0.18, mutSigma: 0.13, report: 5,
      earthPenalty: +($('ewp') ? $('ewp').value : 0),
      outsidePenalty: +($('owp') ? $('owp').value : 0)
    };
  }

  function applyResult(d) {
    best = d.best; history = d.history; front = d.front || [];
    genome = { activePI: best.gen.activePI, u: best.gen.u.slice(), v: best.gen.v.slice(),
      prof: best.gen.prof ? JSON.parse(JSON.stringify(best.gen.prof)) : PROF0() };
    $('pi').value = genome.activePI; $('piv').textContent = genome.activePI;

    // 파레토 해 + 최적해를 대안 목록으로. 현재 파라미터로 재채점된다.
    frontGenomes = front.map(f => f.gen);
    if (!frontGenomes.some(g => g.activePI === best.gen.activePI &&
        g.u.join() === best.gen.u.join() && g.v.join() === best.gen.v.join())) {
      frontGenomes.unshift(best.gen);
    }
    selGen = best.gen;
    buildCandidates();
    if (!selGen && candidates.length) selGen = candidates[0].gen;  // 중복접기로 사라졌으면 1위 선택
    applyFilter();
    renderCandidates();

    chart(convCv, history, '#3fb950');
    drawPareto();
    $('frontN').textContent = '비지배 해 ' + front.length + '개';
    const g = (d.gen != null ? d.gen : d.gens) || $('gens').value;
    const secs = d.ms / 1000;
    // ms=0 이면 헤드리스 가상시간이라 처리량 수치가 무의미 → 표시하지 않는다
    $('perf').innerHTML = '세대 ' + g + '/' + (d.gens || $('gens').value) +
      ' · 평가 <b>' + d.evals + '</b>회 · ' +
      (d.ms > 0 ? secs.toFixed(2) + 's · <b>' + Math.round(d.evals / secs) + ' 평가/초</b>'
                : '<span class="dim">경과 0ms(가상시간) — 처리량 미측정</span>');
    draw();
    if (d.type === 'done') {
      $('run').disabled = false; $('stop').disabled = true;
      window.__KH_RESULT = { score: best.m.score, metrics: best.m, genome: best.gen, evals: d.evals, ms: d.ms };
      window.__KH_EARTH = { ewp: +$('ewp').value, cut: best.m.cutM3, fill: best.m.fillM3,
        total: best.m.earthTotal, maxGrade: best.m.maxGrade, ng: best.m.gradeNG, score: best.m.score };
      document.body.setAttribute('data-earth',
        'EWP=' + $('ewp').value + '|cut=' + Math.round(best.m.cutM3 == null ? -1 : best.m.cutM3) +
        '|total=' + Math.round(best.m.earthTotal == null ? -1 : best.m.earthTotal) +
        '|score=' + best.m.score.toFixed(2) + '|ng=' + best.m.gradeNG +
        '|outside=' + Math.round(best.m.outsideLen == null ? -1 : best.m.outsideLen) +
        '|len=' + Math.round(best.m.totalLength) +
        '|nVIP=' + (best.gen.prof ? best.gen.prof.nVIP : -1) +
        '|gdProf=' + ($('gdProf').checked ? 1 : 0) +
        '|terr=' + (KHTerrain.loaded() ? 1 : 0) + '|pp=' + (CTXE.pparams ? 1 : 0));
      window.__KH_DONE = true;
      document.title = 'KH 워크벤치 [DONE ' + best.m.score.toFixed(2) + ']';
    }
  }

  /* 워커 경로 — 평소 UI용. 계산 중에도 화면이 안 멈춘다. */
  function startGA() {
    if (!worker) {
      worker = new Worker('js/worker.js');
      worker.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'progress' || d.type === 'done') applyResult(d);
      };
    }
    worker.postMessage({ type: 'init', site: SITE, params: params(),
      terrain: TERRAIN_RAW, pparams: pparams(),
      useGenomeProfile: $('gdProf').checked });
    worker.postMessage({ type: 'run', cfg: gaCfg() });
    $('run').disabled = true; $('stop').disabled = false;
    window.__KH_DONE = false;
  }

  /* 동기 경로 — 헤드리스 캡처용.
     ★Chrome --virtual-time-budget 은 메인 프레임만 가상시간을 진행시키고
       전용 워커의 태스크는 스케줄하지 않는다. 그래서 캡처 시엔 메인스레드에서 돌린다. */
  function startGASync() {
    $('run').disabled = true; $('stop').disabled = false;
    window.__KH_DONE = false;
    rebuildCtx();
    const res = KHGA.run(gaCfg(), CTXE, null, () => false);
    applyResult(res);
  }

  /* ---------- 이벤트 ---------- */
  function bindSlider(id, out, after) {
    $(id).addEventListener('input', () => {
      $(out).textContent = $(id).value;
      if (after) after();
      rebuildCtx(); draw();
    });
  }

  function init(site) {
    SITE = site;
    $('src').textContent = '장애물 ' + site.obstacle.length + ' · 추가 ' + site.obstacle_extra.length +
      ' · 도로 ' + site.road.length + ' 폴리곤 · SAB 디코드';
    buildPaths(); rebuildCtx(); fit(); resize();

    bindSlider('R', 'Rv'); bindSlider('Ls', 'Lsv');
    bindSlider('w', 'wv'); bindSlider('ns', 'nsv');
    bindSlider('rt', 'rtv'); bindSlider('ot', 'otv');
    bindSlider('rw', 'rwv'); bindSlider('ow', 'owv');
    bindSlider('sp', 'spv'); bindSlider('rwt', 'rwtv');
    $('roadwin').addEventListener('change', () => { rebuildCtx(); draw(); });
    $('cfilter').addEventListener('change', () => { applyFilter(); renderCandidates(); draw(); });
    bindSlider('pi', 'piv', () => { genome.activePI = +$('pi').value; renderPointList(); });
    // 곡선 모드로 바꾸면 v7 추정량은 비교 무효 → 균일 간격으로 자동 전환
    $('mode').addEventListener('change', () => {
      if ($('mode').value !== 'poly' && $('smode').value === 'v7') $('smode').value = 'uniform';
      rebuildCtx(); draw();
    });
    $('smode').addEventListener('change', () => { rebuildCtx(); draw(); });
    ['lyObs', 'lyExtra', 'lyRoad', 'lySample', 'lyTerr', 'lyTfill', 'lyBnd'].forEach(id =>
      $(id).addEventListener('change', () => { rebuildCtx(); draw(); }));

    // 지형·종단 컨트롤
    bindSlider('pds', 'pdsv'); bindSlider('nvip', 'nvipv'); bindSlider('pfex', 'pfexv');
    bindSlider('zrng', 'zrngv');
    $('gdProf').addEventListener('change', () => { rebuildCtx(); draw(); });
    ['hTun', 'hBrg', 'lTun', 'lBrg', 'supe'].forEach(id => $(id).addEventListener('input', draw));
    bindSlider('xsw', 'xswv');
    $('xspos').addEventListener('input', () => { if (PROF) renderSection(PROF); });
    $('useSweep').addEventListener('change', draw);
    if ($('lyStruct')) $('lyStruct').addEventListener('change', draw);

    // 지형 변수 — 값 표시만 즉시, 재생성은 버튼(격자 12만 셀이라 실시간은 무겁다)
    [['tbase', 'tbasev'], ['tdir', 'tdirv'], ['tslp', 'tslpv'], ['tnp', 'tnpv'],
     ['tph', 'tphv'], ['tpr', 'tprv'], ['trd', 'trdv'], ['trw', 'trwv'],
     ['tna', 'tnav'], ['tno', 'tnov']].forEach(([id, out]) =>
      $(id).addEventListener('input', () => { $(out).textContent = $(id).value; }));
    $('tgen').addEventListener('click', regenTerrain);
    $('tdice').addEventListener('click', () => {
      $('tsd').value = Math.floor(Math.random() * 99999);
      regenTerrain();
    });
    $('tundo').addEventListener('click', () => {
      if (!BASE_TERRAIN) return;
      TERRAIN_RAW = JSON.parse(JSON.stringify(BASE_TERRAIN));
      KHTerrain.load(TERRAIN_RAW);
      TPATH = KHTerrain.buildPaths(5);
      syncTerrainUI(TERRAIN_RAW.params);
      $('tgnote').innerHTML = '<span class="ok">원본(파이썬 생성본)으로 복귀</span>';
      rebuildCtx(); draw();
    });
    syncTerrainUI(BASE_PARAMS);
    ['imax', 'imin', 'kcrest', 'ksag', 'bwid', 'mcut', 'mfill'].forEach(id =>
      $(id).addEventListener('input', draw));
    $('vdes').addEventListener('change', () => {
      const d = KHProfile.SPEED_DEFAULTS[+$('vdes').value];
      if (d) { $('imax').value = d.iMax; $('kcrest').value = d.Kcrest; $('ksag').value = d.Ksag; }
      if ($('V')) { $('V').value = $('vdes').value; }      // 평면 설계기준 표와 동기
      rebuildCtx(); draw();
    });
    $('pftog').addEventListener('click', () => {
      const off = $('profile').classList.toggle('off');
      $('pftog').textContent = off ? '펼치기' : '접기';
      resize();
    });
    $('elems').addEventListener('change', draw);
    $('csort').addEventListener('change', () => { sortCandidates(); renderCandidates(); draw(); });
    $('ghost').addEventListener('change', draw);
    renderCandidates();

    $('run').addEventListener('click', startGA);
    $('stop').addEventListener('click', () => { if (worker) worker.postMessage({ type: 'stop' }); });
    $('reset').addEventListener('click', () => {
      genome = { activePI: 5, u: [0.06, .5, .5, .5, .5, .5, .5, .5, .5, .5],
        v: new Array(10).fill(0.5), prof: PROF0() };
      $('pi').value = 5; $('piv').textContent = 5;
      history = []; front = []; best = null;
      frontGenomes = []; candidates = []; selIdx = -1; selGen = null; renderCandidates();
      chart(convCv, [], '#3fb950'); drawPareto(); draw();
    });

    // 점 편집
    ORIG = { start: SITE.start.slice(), end: SITE.end.slice() };
    renderPointList();
    $('ptReset').addEventListener('click', () => {
      SITE.start = ORIG.start.slice(); SITE.end = ORIG.end.slice();
      THUMB = null; refreshAfterPtMove(); renderGallery();
    });
    $('lockAll').addEventListener('click', () => {
      const hs = handles();
      if (hs.every(h => locks.has(h.id))) locks.clear();
      else hs.forEach(h => locks.add(h.id));
      renderPointList(); draw();
    });
    $('galBtn').addEventListener('click', () => toggleGallery());
    $('gClose').addEventListener('click', () => toggleGallery(false));

    // 좌우 폭 조절
    makeSplit($('splitL'), $('gallery'), 1, renderGallery);
    makeSplit($('splitR'), $('panel'), -1);

    /* 팬/줌 + 점 드래그 — Pointer Events + setPointerCapture.
     * 캡처를 걸면 빠르게 끌어 캔버스를 벗어나도, 위에 뭐가 덮여 있어도
     * 이후 move/up 이 전부 캔버스로 온다. 터치·펜도 같이 먹는다. */
    let drag = null;
    const local = (e) => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    cv.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const [sx, sy] = local(e);
      const hp = hitPoint(sx, sy);
      try { cv.setPointerCapture(e.pointerId); } catch (_) { }
      if (hp) { dragPt = hp; cv.style.cursor = 'grabbing'; renderPointList(); draw(); }
      else drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy };
      e.preventDefault();
    });

    cv.addEventListener('pointermove', e => {
      const [sx, sy] = local(e);
      if (dragPt) {
        const w = screenToWorld(sx, sy);
        const res = movePoint(dragPt, w[0], w[1]);
        $('ptNote').innerHTML = (res.clampedU || res.clampedV)
          ? '<span class="warn">' + dragPt.toUpperCase() + ' 경계에 걸림</span> — ' +
            (res.clampedU ? 'station이 자기 구간 밖(u=0 또는 1). Active PI를 늘리거나 옆 PI를 쓸 것. ' : '') +
            (res.clampedV ? 'offset이 Design Area Width 밖(v=0 또는 1). 폭을 키우면 더 나간다.' : '')
          : '<span class="dim">드래그 중: ' + dragPt.toUpperCase() + '</span>';
        refreshAfterPtMove(true);          // 가벼운 경로
        return;
      }
      if (drag) {
        view.cx = drag.cx - (e.clientX - drag.x) / view.k;
        view.cy = drag.cy + (e.clientY - drag.y) / view.k;
        draw();
        return;
      }
      const hp = hitPoint(sx, sy);        // 호버 강조 + 커서
      if (hp !== hoverPt) {
        hoverPt = hp; cv.style.cursor = hp ? 'grab' : 'crosshair';
        renderPointList(); draw();
      }
    });

    const endDrag = (e) => {
      try { cv.releasePointerCapture(e.pointerId); } catch (_) { }
      if (dragPt) {                       // 놓는 순간에만 대안 재채점 + 썸네일 갱신
        dragPt = null; THUMB = null; $('ptNote').innerHTML = '';
        refreshAfterPtMove(false); renderGallery();
      }
      drag = null;
      cv.style.cursor = hoverPt ? 'grab' : 'crosshair';
    };
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const before = screenToWorld(e.clientX - r.left, e.clientY - r.top);
      view.k *= e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const after = screenToWorld(e.clientX - r.left, e.clientY - r.top);
      view.cx += before[0] - after[0]; view.cy += before[1] - after[1];
      draw();
    }, { passive: false });
    window.addEventListener('resize', resize);

    draw();

    // 설계기준 로드
    fetch('../data/design_standards.json').then(r => r.json()).then(s => {
      STD = s;
      $('Vsel').innerHTML = s['설계속도'].map(r =>
        '<option value="' + r.V + '"' + (r.V === 60 ? ' selected' : '') + '>' + r.V + '</option>').join('');
      $('stdFlag').textContent = s._검증상태 === '미검증' ? '수치 미검증' : s._검증상태;
      if (s._적용대상) $('stdTarget').textContent = String(s._적용대상).split('(')[0].trim();
      // 지역구분 — 선택 시 최대편경사 프리셋 적용 (R_min 에 직접 영향)
      const regions = s['지역구분'] || [];
      $('regionSel').innerHTML = regions.map((r, i) =>
        '<option value="' + i + '"' + (r.eMax === 0.06 && i === 1 ? ' selected' : '') + '>' +
        r.key + ' (e≤' + r.eMax.toFixed(2) + ')</option>').join('');
      $('regionSel').addEventListener('change', () => {
        const r = regions[+$('regionSel').value];
        if (r) { $('emax').value = r.eMax; $('emaxv').textContent = r.eMax.toFixed(2); }
        draw();
      });
      $('Vsel').addEventListener('change', draw);
      $('emax').addEventListener('input', () => { $('emaxv').textContent = (+$('emax').value).toFixed(2); draw(); });
      $('applyStd').addEventListener('click', () => {
        const std = stdRow();
        const Rmin = Math.ceil(KHDesign.minRadius(std.V, std.eMax, std.f) / 50) * 50;
        $('R').value = Math.max(+$('R').min, Rmin); $('Rv').textContent = $('R').value;
        const sm = KHDesign.spiralMinLength(std.V, +$('R').value, {
          e: std.eMax, jerk: std.jerk, driveSec: std.driveSec,
          rotWidth: std.rotWidth, runoffRate: std.runoffRate, tableMin: std.LsMin
        });
        const Lsm = Math.ceil(sm.governing / 10) * 10;
        $('Ls').value = Math.min(+$('Ls').max, Lsm); $('Lsv').textContent = $('Ls').value;
        if ($('mode').value === 'poly') { $('mode').value = 'spiral'; $('smode').value = 'uniform'; }
        rebuildCtx(); draw();
      });
      draw();
    }).catch(err => {
      // 원인을 숨기지 않는다 — '파일 없음'으로 뭉개면 진짜 원인을 못 찾는다
      $('stdCalc').innerHTML = '<span class="bad">설계기준 로드 실패</span><br><span class="dim">' +
        (err && err.message ? err.message : String(err)) + '</span>';
      console.error('[설계기준]', err);
    });

    // 사양일치 검사 — 파이썬 기준값과 자동 대조
    fetch('../data/reference_cases.json').then(r => r.json()).then(refs => {
      const v = KHVerify.run(SITE, refs);
      window.__KH_VERIFY = v;
      const bad = v.rows.filter(r => !r.pass);
      $('vfy').innerHTML = (v.pass
        ? '<span class="ok">PASS ' + v.rows.length + '/' + v.rows.length + '</span> — 파이썬 독립 재구현과 전 케이스 일치'
        : '<span class="bad">FAIL ' + bad.length + '/' + v.rows.length + '</span> — ' + bad.map(b => b.case).join(', '))
        + '<br><span class="dim">최대 오차 score ' +
        Math.max.apply(null, v.rows.map(r => r.diff.score)).toExponential(1) + ' · 길이 ' +
        Math.max.apply(null, v.rows.map(r => r.diff.total)).toExponential(1) + 'm</span>'
        + '<br><span class="dim">※ 사양(v7 .dyn) 일치 검사. Dynamo 실행 대조는 미실시.</span>';
    }).catch(() => { $('vfy').textContent = '기준값 없음'; });

    // 헤드리스 자동실행 훅
    // ★URL 파라미터는 auto 여부와 무관하게 적용한다.
    //   (예전엔 auto 안에만 있어 ?mode=spiral 만 줘도 무시됐다)
    const q = new URLSearchParams(location.search);
    if (q.get('pop')) $('pop').value = q.get('pop');
    if (q.get('gens')) $('gens').value = q.get('gens');
    if (q.get('mode')) $('mode').value = q.get('mode');
    if (q.get('R')) { $('R').value = q.get('R'); $('Rv').textContent = q.get('R'); }
    if (q.get('Ls')) { $('Ls').value = q.get('Ls'); $('Lsv').textContent = q.get('Ls'); }
    if (q.get('sp')) { $('sp').value = q.get('sp'); $('spv').textContent = q.get('sp'); }
    if (q.get('pi')) { $('pi').value = q.get('pi'); $('piv').textContent = q.get('pi'); genome.activePI = +q.get('pi'); }
    if (q.get('tsd') != null) $('tsd').value = q.get('tsd');
    if (q.get('tnp') != null) { $('tnp').value = q.get('tnp'); $('tnpv').textContent = q.get('tnp'); }
    if (q.get('tph') != null) { $('tph').value = q.get('tph'); $('tphv').textContent = q.get('tph'); }
    if (q.get('trd') != null) { $('trd').value = q.get('trd'); $('trdv').textContent = q.get('trd'); }
    if (q.get('gdprof') != null) $('gdProf').checked = q.get('gdprof') !== '0';
    if (q.get('nvip') != null) { $('nvip').value = q.get('nvip'); $('nvipv').textContent = q.get('nvip'); }
    if (q.get('tgen')) setTimeout(regenTerrain, 60);
    if (q.get('ewp') != null) $('ewp').value = q.get('ewp');
    if (q.get('owp') != null) $('owp').value = q.get('owp');
    if (q.get('pop')) $('pop').value = q.get('pop');
    if (q.get('gens')) $('gens').value = q.get('gens');
    if (q.get('roadwin') != null) $('roadwin').checked = q.get('roadwin') !== '0';
    if (q.get('cfilter')) $('cfilter').value = q.get('cfilter');
    if (q.get('elems') != null) $('elems').checked = q.get('elems') !== '0';
    if (q.get('gallery')) toggleGallery(true);
    if (q.get('galw')) { galW = +q.get('galw'); if ($('gallery').classList.contains('on')) toggleGallery(true); }
    if (q.get('panelw')) $('panel').style.width = q.get('panelw') + 'px';
    // 곡선 모드면 균일 추정량이 기본. v7 추정량은 명시 지정할 때만.
    if (q.get('smode')) $('smode').value = q.get('smode');
    else if ($('mode').value !== 'poly') $('smode').value = 'uniform';
    rebuildCtx(); resize();

    // 헤드리스(=sync)면 메인스레드 동기 실행, 아니면 워커
    if (q.get('auto')) setTimeout(q.get('sync') ? startGASync : startGA, 120);
    if (q.get('ptest')) setTimeout(runPointTest, 300);
  }

  /* 설계기준 등록부 — 미검증 개수를 화면에 정직하게 띄운다 */
  function loadRegistry() {
    const packed = window.KH_DATA && window.KH_DATA.aux && window.KH_DATA.aux.standards_registry;
    (packed ? Promise.resolve(packed)
            : fetch('../data/standards_registry.json').then(r => r.ok ? r.json() : null)).then(reg => {
      if (!reg) return;
      const n = reg.items.length, ok = reg.items.filter(i => i.verified).length;
      const el = document.querySelectorAll('.chip.bad, .chip[style*="ff8a80"]');
      el.forEach(e => { if (/미검증/.test(e.textContent)) e.textContent = '수치 ' + ok + '/' + n + ' 검증'; });
      const box = document.createElement('div');
      box.className = 'note';
      box.innerHTML = '<b>설계기준 등록부</b> — ' + ok + ' / ' + n + ' 검증됨<br>' +
        reg.items.filter(i => !i.verified).map(i => '· ' + i.label).join('<br>') +
        '<br><span class="dim">data/standards_registry.json 에 조문번호를 채우면 여기서 사라진다.</span>';
      const host = $('stnote');
      if (host && host.parentNode) host.parentNode.appendChild(box);
    }).catch(() => {});
  }

  /* 데이터 확보 — ① 미리 실은 window.KH_DATA(서버 불필요) ② 없으면 fetch(개발 중) */
  function getData() {
    const D = window.KH_DATA;
    if (D && D.site) return Promise.resolve([D.site, D.terrain || null]);
    return Promise.all([
      fetch('../data/site.json').then(r => r.json()),
      fetch('../data/terrain.json').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
  }

  getData().then(([site, terr]) => {
    if (terr) {
      TERRAIN_RAW = terr;
      BASE_TERRAIN = JSON.parse(JSON.stringify(terr));
      BASE_PARAMS = terr.params;
      KHTerrain.load(terr);
      TPATH = KHTerrain.buildPaths(5);
      const m = KHTerrain.meta();
      $('tchip').textContent = terr.mode === 'file' ? '파일' : '합성';
      $('tnote').innerHTML =
        '대지 ' + (m.site_area_m2 / 1e6).toFixed(2) + ' km² (도로망 외곽) · ' +
        'EL ' + m.z_min + '~' + m.z_max + ' m · 등고 ' + m.interval + ' m<br>' +
        '<span class="dim">' + m.honest + '</span>';
    } else {
      $('tnote').textContent = 'terrain.json 없음 — 20_TOOLS/build_terrain.py 로 생성';
    }
    init(site);
    loadRegistry();
  }).catch(e => { $('hud').textContent = '데이터 로드 실패: ' + e; });
})();
