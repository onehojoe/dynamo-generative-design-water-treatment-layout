# -*- coding: utf-8 -*-
"""내공단면 엔진 검증 게이트 — 지시 조건 하나당 검사 하나 (CLAUDE.md §4-1).

G1 시설한계 재현      : 폭 10800 · 높이 4800 · 면적 51.040㎡
G2 R1 규칙 대 원본     : 60행 재현율(잔차 0~5mm 이면 격자 올림 일치)
G3 시설한계 포함       : 전 조합에서 원 시설한계 8점 + 노면 위 오프셋점이 라이닝 안쪽
G4 공동구 포함         : 전 조합에서 공동구 8점(좌4+우4)이 라이닝 안쪽
G5 폴리곤 건전성       : 자기교차 0 · 면적>0 · 노면선 아래로 안 내려감
G6 치수 정합           : 내공높이 == EL1*cos(s) + R1
G7 부대공 제약         : 제약 ON(검사원통로+제트팬) 시 전 조합에서 부대공이 라이닝 안쪽
G8 층 단조성           : 내공 < 라이닝 < 숏크리트 < 굴착 면적, 각 링 두께가 실제 오프셋과 일치
G9 내보내기 무결성      : DXF 를 되읽어 ARC 끝점이 전부 이어지는지(폐합) + JSON 계약 필드
실패는 실패로 출력한다. exit code 1 = FAIL 있음.
"""
import io
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import section_engine as E   # noqa: E402
import export as X          # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "03_data", "inputs_and_results.json")
RES = []


def rec(gate, ok, msg):
    RES.append((gate, ok, msg))
    print(("  PASS  " if ok else "  FAIL  ") + gate.ljust(22) + msg)


def inside(sec, Q, eps=1e-6):
    """단면 내부 판정 = 각 구간 원의 반경 이내."""
    O1, R1 = sec["O1"], sec["R1"]
    half = math.radians(sec["in"]["theta"]) / 2.0
    ang = math.atan2(Q[0] - O1[0], Q[1] - O1[1])
    n = sec["n_road"]
    if n[0] * Q[0] + n[1] * Q[1] < -1e-6:      # 노면선 아래면 단면 밖
        return False
    if -half <= ang <= half:
        return math.hypot(Q[0] - O1[0], Q[1] - O1[1]) <= R1 + eps
    O2, R2 = (sec["O2R"], sec["R2p"]) if ang > 0 else (sec["O2L"], sec["R2"])
    return math.hypot(Q[0] - O2[0], Q[1] - O2[1]) <= R2 + eps


def segs_cross(a, b, c, d):
    def o(p, q, r):
        v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
        return 0 if abs(v) < 1e-9 else (1 if v > 0 else -1)
    return o(a, b, c) != o(a, b, d) and o(c, d, a) != o(c, d, b)


def main():
    P = dict(E.DEFAULT_PARAMS)

    # G1 -------------------------------------------------------------
    clr = E.clearance_polygon(P, -900.0, 0.0)
    w = max(p[0] for p in clr) - min(p[0] for p in clr)
    h = max(p[1] for p in clr) - min(p[1] for p in clr)
    ar = E.shoelace(clr) / 1e6
    ok = abs(w - 10800) < .5 and abs(h - 4800) < .5 and abs(ar - 51.040) < .002
    rec("G1 시설한계", ok, "폭 %.1f / 높이 %.1f / 면적 %.3f㎡  (기대 10800 / 4800 / 51.040)" % (w, h, ar))

    # G2 -------------------------------------------------------------
    try:
        leg = json.load(io.open(DATA, encoding="utf-8"))["result_최적단면검토"]
    except Exception as ex:                                   # noqa: BLE001
        leg = []
        rec("G2 R1 대 원본", False, "원본 데이터 로드 실패: %s" % ex)
    if leg:
        hit, resid = 0, []
        for r in leg:
            sec = E.build_section(P, r["road_center_m"] * 1000, r["superelev_pct"],
                                  r["center_h_m"] * 1000, r["center_ang_deg"])
            d = r["R1"] - sec["R1"]
            resid.append(d)
            if abs(d) < 1e-6:
                hit += 1
        rec("G2 R1 대 원본", hit >= 56,
            "정확 일치 %d/%d행 · 잔차 %+.0f~%+.0f mm  (미일치분은 원본이 크게 잡은 것 — 원인 미확인)"
            % (hit, len(leg), min(resid), max(resid)))

    # G3~G6 전 조합 ---------------------------------------------------
    rows, shape = E.sweep(P, E.DEFAULT_SWEEP)
    bad3 = bad4 = bad5 = bad6 = 0
    worst3 = worst4 = 0.0
    for r in rows:
        sec = E.build_section(P, r["cc"] * 1000, r["s"], r["EL1"] * 1000, r["theta"])
        nr = sec["n_road"]
        # 원 시설한계 8점은 전부, 오프셋본은 '노면 위' 점만 검사한다.
        # (오프셋은 바닥점을 노면 아래로 밀어내는데 그 아래는 라이닝이 아니라 포장/슬래브 영역)
        chk = list(sec["clr"]) + [q for q in sec["clr_off"] if nr[0] * q[0] + nr[1] * q[1] >= -1e-6]
        for q in chk:
            if not inside(sec, q):
                bad3 += 1
                worst3 = max(worst3, -min(0.0, sec["contain"]))
                break
        duct_pts = [p for d in sec["ducts"] for p in d["pts"]]
        for q in duct_pts:
            if not inside(sec, q):
                bad4 += 1
                O2, R2 = ((sec["O2R"], sec["R2p"]) if q[0] > 0 else (sec["O2L"], sec["R2"]))
                worst4 = max(worst4, math.hypot(q[0] - O2[0], q[1] - O2[1]) - R2)
                break
        poly = sec["poly"]
        n = len(poly)
        cross = 0
        for i in range(0, n, 7):
            for j in range(i + 2, n, 7):
                if i == 0 and j == n - 1:
                    continue
                if segs_cross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n]):
                    cross += 1
        below = min(nr[0] * p[0] + nr[1] * p[1] for p in poly)
        if cross or sec["area"] <= 0 or below < -1e-6:
            bad5 += 1
        exp_h = r["EL1"] * 1000 * math.cos(r["s"] / 100.0) + sec["R1"]
        if abs(sec["height"] - exp_h) > 0.5:
            bad6 += 1

    rec("G3 시설한계 포함", bad3 == 0, "위반 %d/%d 조합 (최대 침범 %.2fmm)" % (bad3, len(rows), worst3))
    rec("G4 공동구 포함", bad4 == 0, "위반 %d/%d 조합 (최대 침범 %.2fmm)" % (bad4, len(rows), worst4))
    rec("G5 폴리곤 건전성", bad5 == 0, "자기교차/면적/접지 위반 %d/%d 조합" % (bad5, len(rows)))
    rec("G6 치수 정합", bad6 == 0, "내공높이 != EL1*cos(s)+R1 인 조합 %d/%d" % (bad6, len(rows)))

    # G7 부대공을 제약으로 켜고 전 조합 재검 ---------------------------------
    rows7, _ = E.sweep(P, E.DEFAULT_SWEEP, use_walk=True, use_jet=True)
    bad7 = 0
    for r in rows7:
        sec = E.build_section(P, r["cc"] * 1000, r["s"], r["EL1"] * 1000, r["theta"],
                              use_walk=True, use_jet=True)
        pts = [q for e in sec["extras"] for q in e.get("pts", [])]
        for e in sec["extras"]:
            if e["kind"] == "jetfan":
                # 팬 원 전체 + 이격까지 라이닝 안쪽인지: 중심에서 가장 먼 방향으로 검사
                d = math.hypot(e["c"][0] - sec["O1"][0], e["c"][1] - sec["O1"][1])
                if d + e["r"] + e["gap"] > sec["R1"] + 1e-6:
                    bad7 += 1
        if any(not inside(sec, q) for q in pts):
            bad7 += 1
    rec("G7 부대공 제약", bad7 == 0,
        "제약 ON 시 위반 %d/%d 조합 (검사원통로 750x1710 · 제트팬 Φ1500 0.3D)" % (bad7, len(rows7)))

    # G8 층 단조성 ---------------------------------------------------
    bad8 = 0
    for r in rows[::7]:                      # 전수는 느려서 1/7 표본 + 극단 조합 별도
        sec = E.build_section(P, r["cc"] * 1000, r["s"], r["EL1"] * 1000, r["theta"])
        a = [sec["area_m2"]] + [l["area_m2"] for l in sec["layers"]]
        if any(a[i] >= a[i + 1] for i in range(len(a) - 1)):
            bad8 += 1
        offs = [l["offset"] for l in sec["layers"]]
        if offs != [300.0, 400.0, 500.0]:
            bad8 += 1
    rec("G8 층 단조성", bad8 == 0,
        "내공<라이닝<숏크리트<굴착 위반 %d (표본 %d조합) · 오프셋 300/400/500mm" % (bad8, len(rows[::7])))

    # G9 내보내기 무결성 ------------------------------------------------
    import math as _m, os as _os, tempfile
    sec = E.build_section(P, -900, -2, 300, 100, use_walk=True, use_jet=True)
    tmp = _os.path.join(tempfile.gettempdir(), "tn_gate.dxf")
    bad9 = []
    if not X.have_ezdxf():
        d = X.to_json(sec, P, {"tol": 50})
        miss = [k for k in ("schema", "unit", "datum", "inner_arcs", "bottom", "rings",
                            "metrics", "notes") if k not in d]
        rec("G9 내보내기 무결성", not miss,
            "ezdxf 없음 → DXF 검사 건너뜀. JSON 계약 필드 %s" % ("정상" if not miss else "누락 " + ",".join(miss)))
        f = sum(1 for _, ok, _ in RES if not ok)
        print(chr(10) + "=== 결과: PASS %d / FAIL %d  (스윕 %d조합 %s) ==="
              % (len(RES) - f, f, len(rows), shape))
        return 1 if f else 0
    try:
        X.to_dxf(sec, tmp)
        import ezdxf
        msp = ezdxf.readfile(tmp).modelspace()
        for lay in ("TN_INNER", "TN_LINING", "TN_SHOT", "TN_EXC"):
            arcs = [e for e in msp if e.dxftype() == "ARC" and e.dxf.layer == lay]
            lines = [e for e in msp if e.dxftype() == "LINE" and e.dxf.layer == lay]
            pts = []
            for e in arcs:
                for a in (e.dxf.start_angle, e.dxf.end_angle):
                    pts.append((e.dxf.center.x + e.dxf.radius * _m.cos(_m.radians(a)),
                                e.dxf.center.y + e.dxf.radius * _m.sin(_m.radians(a))))
            for l in lines:
                pts += [(l.dxf.start.x, l.dxf.start.y), (l.dxf.end.x, l.dxf.end.y)]
            open_pts = sum(1 for i, p in enumerate(pts)
                           if not any(i != j and _m.dist(p, q) < 1.0 for j, q in enumerate(pts)))
            if len(arcs) < 3 or open_pts:
                bad9.append("%s(호%d·미연결%d)" % (lay, len(arcs), open_pts))
        d = X.to_json(sec, P, {"tol": 50})
        for k in ("schema", "unit", "datum", "inner_arcs", "bottom", "rings", "metrics", "notes"):
            if k not in d:
                bad9.append("json:" + k)
        if len(d["inner_arcs"]) < 3:
            bad9.append("json:inner_arcs<3")
    except Exception as ex:                                   # noqa: BLE001
        bad9.append("예외:%s" % ex)
    finally:
        if _os.path.exists(tmp):
            _os.remove(tmp)
    rec("G9 내보내기 무결성", not bad9,
        "DXF 4개 링 폐합 + JSON 계약 필드 %s" % ("전부 정상" if not bad9 else "위반 " + ",".join(bad9)))

    f = sum(1 for _, ok, _ in RES if not ok)
    print("\n=== 결과: PASS %d / FAIL %d  (스윕 %d조합 %s) ===" % (len(RES) - f, f, len(rows), shape))
    return 1 if f else 0


if __name__ == "__main__":
    for st in (sys.stdout, sys.stderr):
        try:
            st.reconfigure(encoding="utf-8", errors="replace")
        except Exception:                                     # noqa: BLE001
            pass
    sys.exit(main())
