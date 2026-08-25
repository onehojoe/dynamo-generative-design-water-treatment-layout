# -*- coding: utf-8 -*-
"""
NATM 도로터널 내공단면 산정 엔진  (23번 프로젝트 · 2026-08-25)

구성 원칙 (Cho 결정 2번 = C안: 3심원 표준 구성으로 새로 정의)
  · 단위는 내부 전부 mm. 각도는 내부 rad.
  · 좌표계 원점 = 터널 중심축의 노면 레벨. +x 우, +y 상.
  · 도로/시설한계/공동구는 편경사 s 만큼 원점 중심 회전. 터널 라이닝은 연직 유지.

기하 정의
  O1  = (0, EL1)                      R1 원의 중심 (중심높이 EL1)
  R1  = 시설한계를 시공오차 t 만큼 바깥 오프셋한 폴리곤을 모두 감싸는
        최소 반지름을 grid(기본 5mm) 로 올림.
        ★검증: 원본 결과 60행 중 56행이 이 규칙과 정확히 일치(잔차 0~5mm).
           4행(cc=-900·편경사+2%)은 원본이 9~14mm 크게 잡았다 — 원인 미확인.
  S_R/S_L = O1 에서 연직 기준 ±θ/2 방향의 R1 호 끝점(스프링잉)
  O2  = O1 + (R1-R2)·u   (u = 스프링잉 방향 단위벡터) → R1 호와 접선 연속(내접)
  R2  = 그 측 제약점(시설한계 오프셋 하부 꼭짓점 + 공동구 사각형)을 모두 품는
        최소 반지름. 작을수록 벽이 안으로 서므로 단면적이 준다.
  하단 = y=0 (라이닝 하단 기준선) 에서 종결.

★재현 불가 명시: 원본 R2/R2' 값은 위 구성으로 재현되지 않았다(오차 400~2500mm).
  통과점 후보 7종·접점각 역산 모두 불일치. 원본 알고리즘 부재(M1)이므로
  본 엔진 값은 '표준 구성에 의한 신규 산정'이며 원본값은 참조 병기만 한다.
"""
import math

GRID_DEFAULT = 5.0


# ---------------------------------------------------------------- 기본 유틸
def rot(x, y, s):
    c, sn = math.cos(s), math.sin(s)
    return (x * c - y * sn, x * sn + y * c)


def shoelace(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def offset_miter(P, t):
    """CCW 폴리곤을 바깥으로 t 평행 오프셋(마이터 조인)."""
    if t == 0:
        return list(P)
    n = len(P)
    out = []
    for i in range(n):
        p0, p1, p2 = P[i - 1], P[i], P[(i + 1) % n]

        def nrm(A, B):
            dx, dy = B[0] - A[0], B[1] - A[1]
            L = math.hypot(dx, dy)
            return None if L < 1e-9 else (dy / L, -dx / L)

        n1, n2 = nrm(p0, p1), nrm(p1, p2)
        n1 = n1 or n2
        n2 = n2 or n1
        bx, by = n1[0] + n2[0], n1[1] + n2[1]
        L = math.hypot(bx, by) or 1.0
        bx, by = bx / L, by / L
        c = max(0.2, bx * n1[0] + by * n1[1])          # 마이터 신장(과신장 제한)
        out.append((p1[0] + bx * t / c, p1[1] + by * t / c))
    return out


# ---------------------------------------------------------------- 시설한계
def clearance_polygon(P, cc, s):
    """.dyn Python 노드와 동일한 8점 폴리곤. 검산: 10800x4800, 51.040㎡."""
    l1, l2 = P["lane_L"], P["shoulder_L"]
    r1, r2 = P["lane_R"], P["shoulder_R"]
    H, a, b = P["H"], P["ha"], P["hb"]
    xr, xl = r1 + r2 + cc, -l1 - l2 + cc
    return [rot(0, 0, s), rot(xr, 0, s), rot(xr, H - b, s), rot(xr - a, H, s),
            rot(0, H, s), rot(xl + a, H, s), rot(xl, H - b, s), rot(xl, 0, s)]


def extra_shapes(P, cc, s, use_walk=False, use_jet=False):
    """부대공 형상. binding=True 면 R1/R2 산정 제약에 실제로 들어간다.

    ★배치 규칙은 자료에 없다(M4). 아래는 **명시된 가정**이며 파라미터로 바꿀 수 있다.
      · 검사원통로 : 지정한 쪽 공동구 뚜껑 위에 세운다(시설한계 바깥).
      · 제트팬     : 팬 하단 = 시설한계 상단(H), 중심 x = jet_dx, 라이닝과 0.3D(=jet_gap) 이격.
    """
    out = []
    xl = -P["lane_L"] - P["shoulder_L"] + cc
    xr = P["lane_R"] + P["shoulder_R"] + cc
    if use_walk and P["walk_w"] > 0 and P["walk_h"] > 0:
        if P.get("walk_side", "L") == "R":
            x0, y0 = xr + P["duct_RW"] - P["walk_w"], P["duct_RH"]
        else:
            x0, y0 = xl - P["duct_LW"], P["duct_LH"]
        pts = [rot(x0, y0, s), rot(x0 + P["walk_w"], y0, s),
               rot(x0 + P["walk_w"], y0 + P["walk_h"], s), rot(x0, y0 + P["walk_h"], s)]
        out.append({"kind": "walk", "binding": True, "pts": pts,
                    "label": "검사원통로 %.0f×%.0f" % (P["walk_w"], P["walk_h"])})
    if use_jet and P["jetfan_d"] > 0:
        d = P["jetfan_d"]
        c = rot(P.get("jet_dx", 0.0), P["H"] + d / 2.0, s)
        out.append({"kind": "jetfan", "binding": True, "c": c, "r": d / 2.0,
                    "gap": P.get("jet_gap_ratio", 0.3) * d,
                    "label": "제트팬 Φ%.0f (이격 %.2fD)" % (d, P.get("jet_gap_ratio", 0.3))})
    return out


def duct_rects(P, cc, s):
    """공동구 사각형(좌/우). 시설한계 바깥에 접해 노면 위에 놓인다."""
    xr, xl = P["lane_R"] + P["shoulder_R"] + cc, -P["lane_L"] - P["shoulder_L"] + cc
    R = []
    if P["duct_RW"] > 0 and P["duct_RH"] > 0:
        R.append(("R", [rot(xr, 0, s), rot(xr + P["duct_RW"], 0, s),
                        rot(xr + P["duct_RW"], P["duct_RH"], s), rot(xr, P["duct_RH"], s)]))
    if P["duct_LW"] > 0 and P["duct_LH"] > 0:
        R.append(("L", [rot(xl, 0, s), rot(xl - P["duct_LW"], 0, s),
                        rot(xl - P["duct_LW"], P["duct_LH"], s), rot(xl, P["duct_LH"], s)]))
    return R


# ---------------------------------------------------------------- 3심원 산정
def solve_R1(pts, O1, grid=GRID_DEFAULT):
    need = max(math.hypot(p[0] - O1[0], p[1] - O1[1]) for p in pts)
    return math.ceil(need / grid) * grid, need


def _R2_through(O1, R1, u, Q):
    """접점방향 u 로 내접하는 원이 점 Q 를 정확히 지나게 하는 R2."""
    vx, vy = Q[0] - O1[0], Q[1] - O1[1]
    uv = u[0] * vx + u[1] * vy
    den = 2.0 * (R1 - uv)
    if abs(den) < 1e-9:
        return None
    return R1 - (R1 * R1 - (vx * vx + vy * vy)) / den


def solve_side(C, R, half_ang, side, constraints, grid=GRID_DEFAULT):
    """부모 원(C,R)에 연직기준 half_ang 방향 접점에서 내접하는 자식 원.
       side=+1 우 / -1 좌. 제약점을 모두 품는 **최소** 반지름(자식 R <= 부모 R)."""
    u = (side * math.sin(half_ang), math.cos(half_ang))
    cand = []
    for Q in constraints:
        r = _R2_through(C, R, u, Q)
        if r is not None and 1.0 < r <= R * 4:
            cand.append(min(r, R))
    R2 = max(cand) if cand else R
    for _ in range(400):                     # 수치 검증 후 5mm 씩 보정
        O2 = (C[0] + (R - R2) * u[0], C[1] + (R - R2) * u[1])
        worst = max((math.hypot(Q[0] - O2[0], Q[1] - O2[1]) - R2) for Q in constraints) if constraints else -1
        if worst <= 1e-6 or R2 >= R:
            break
        R2 = min(R, R2 + grid)
    R2 = min(R, math.ceil(R2 / grid) * grid)
    O2 = (C[0] + (R - R2) * u[0], C[1] + (R - R2) * u[1])
    T = (C[0] + R * u[0], C[1] + R * u[1])   # 접점
    return R2, O2, u, T


def arc_points(C, R, a0, a1, n=64, ccw=None):
    """ccw=True 반시계 / False 시계 / None 짧은쪽."""
    d = a1 - a0
    if ccw is True:
        while d <= 0:
            d += 2 * math.pi
    elif ccw is False:
        while d >= 0:
            d -= 2 * math.pi
    else:
        while d > math.pi:
            d -= 2 * math.pi
        while d < -math.pi:
            d += 2 * math.pi
    return [(C[0] + R * math.cos(a0 + d * i / n),
             C[1] + R * math.sin(a0 + d * i / n)) for i in range(n + 1)]


def circle_line(C, R, u, side, off=0.0):
    """원과 노면선의 교점. 노면선 = 원점을 지나는 방향 u 의 직선을 법선쪽으로 off 만큼 평행이동.
       side=+1 진행방향 쪽. ★편경사가 붙으면 노면이 기울므로 하단 기준은 y=0 이 아니라 이 선이다."""
    n = (-u[1], u[0])
    A = (n[0] * off, n[1] * off)                       # 직선 위의 기준점
    dx, dy = C[0] - A[0], C[1] - A[1]
    b = u[0] * dx + u[1] * dy
    c = dx * dx + dy * dy - R * R
    d = b * b - c
    if d < 0:
        return None
    t = b + side * math.sqrt(d)
    return (A[0] + u[0] * t, A[1] + u[1] * t)


# ---------------------------------------------------------------- 단면 1개
def build_section(P, cc, s_pct, EL1, theta_deg, tol=50.0, grid=GRID_DEFAULT,
                  use_walk=False, use_jet=False):
    s = s_pct / 100.0                      # 원본과 동일한 소각근사(rad 직결)
    theta = math.radians(theta_deg)
    O1 = (0.0, EL1)

    clr = clearance_polygon(P, cc, s)
    clr_off = offset_miter(clr, tol)
    ducts = duct_rects(P, cc, s)
    extras = extra_shapes(P, cc, s, use_walk, use_jet)

    half = theta / 2.0
    R1, need = solve_R1(clr_off, O1, grid)
    for e in extras:
        # 제트팬: R1 >= |O1→팬중심| + D/2 + 이격
        if e["kind"] == "jetfan":
            need = max(need, math.hypot(e["c"][0] - O1[0], e["c"][1] - O1[1]) + e["r"] + e["gap"])
        # 상부호 각도 범위 안에 들어오는 부대공 점은 R1 이 품어야 한다
        for q in e.get("pts", []):
            if abs(math.atan2(q[0] - O1[0], q[1] - O1[1])) <= half:
                need = max(need, math.hypot(q[0] - O1[0], q[1] - O1[1]))
    R1 = math.ceil(need / grid) * grid

    def outside_span(Q, side):
        ang = math.atan2(Q[0] - O1[0], Q[1] - O1[1])      # 연직기준 시계각
        return (ang > half) if side > 0 else (ang < -half)

    conR = [q for q in clr_off if outside_span(q, +1)]
    conL = [q for q in clr_off if outside_span(q, -1)]
    for tag, rect in ducts:
        (conR if tag == "R" else conL).extend(rect)
    for e in extras:                       # 부대공을 실제 제약으로
        if e["kind"] == "walk":
            for q in e["pts"]:
                (conR if q[0] > 0 else conL).append(q)

    u_road = (math.cos(s), math.sin(s))          # 노면 방향
    n_road = (-math.sin(s), math.cos(s))         # 노면 법선(위쪽)

    # 5심원: 측벽을 R2(상부 측벽) → R3(하부 측벽) 두 단으로 나눈다. theta3 = 2단 전이각.
    five = bool(P.get("five_center")) and float(P.get("theta3", 0)) > theta_deg
    half3 = math.radians(float(P.get("theta3", theta_deg + 40))) / 2.0

    def split(cons):
        """1단(R2) / 2단(R3) 제약 분리 — O1 기준 각도로 나눈다."""
        if not five:
            return cons, []
        a = [], []
        for q in cons:
            (a[0] if abs(math.atan2(q[0] - O1[0], q[1] - O1[1])) <= half3 else a[1]).append(q)
        return a

    # 자식 반지름은 부모보다 클 수 없다(심원 구성 유지). 그 범위에서 제약을 못 품으면
    # 단면 자체가 작은 것이므로 R1 을 키워 다시 푼다(부대공·통로가 클 때 실제로 발생).
    R1_base = R1
    five_note = ""

    def chain(R1v, use_five):
        c1r, c2r = (split(conR) if use_five else (conR, []))
        c1l, c2l = (split(conL) if use_five else (conL, []))
        a2r, b2r, _, sr = solve_side(O1, R1v, half, +1, c1r, grid)
        a2l, b2l, _, sl = solve_side(O1, R1v, half, -1, c1l, grid)
        if use_five:
            a3r, b3r, _, tr = solve_side(b2r, a2r, half3, +1, c2r, grid)
            a3l, b3l, _, tl = solve_side(b2l, a2l, half3, -1, c2l, grid)
        else:
            a3r, b3r, tr = a2r, b2r, None
            a3l, b3l, tl = a2l, b2l, None
        w = -1.0
        for Q, C, R in ([(q, b2r, a2r) for q in c1r] + [(q, b2l, a2l) for q in c1l] +
                        [(q, b3r, a3r) for q in c2r] + [(q, b3l, a3l) for q in c2l]):
            w = max(w, math.hypot(Q[0] - C[0], Q[1] - C[1]) - R)
        return w, (a2r, b2r, sr, a2l, b2l, sl, a3r, b3r, tr, a3l, b3l, tl)

    def run(use_five, cap):
        R1v = R1_base
        for _ in range(cap):
            w, res = chain(R1v, use_five)
            if w <= 1e-6:
                return R1v, res
            R1v += grid
        return None, None

    R1v, res = run(five, 80 if five else 600)
    if R1v is None and five:
        # 5심원(하부 축소형)이 성립하지 않는 배치 — 공동구가 노면 레벨에서 최대폭을
        # 규정하면 R3 <= R2 로는 품을 수 없다. 정직하게 3심원으로 되돌린다.
        five = False
        five_note = "5심원 불성립(하부 제약이 R3<=R2 로 수용 불가) → 3심원으로 복귀"
        R1v, res = run(False, 600)
    if R1v is None:
        R1v, res = R1_base, chain(R1_base, False)[1]
    R1 = R1v
    (R2r, O2r, S_R, R2l, O2l, S_L, R3r, O3r, T_R, R3l, O3l, T_L) = res

    # ---- 링(내공선 / 라이닝 외면 / 숏크리트 외면 / 굴착선) ----
    def ring(t):
        """중심은 그대로, 반지름 +t, 바닥선은 법선 반대쪽으로 t. (동심 오프셋이므로 접선연속 유지)"""
        sl = (O1[0] - (R1 + t) * math.sin(half), O1[1] + (R1 + t) * math.cos(half))
        sr = (O1[0] + (R1 + t) * math.sin(half), O1[1] + (R1 + t) * math.cos(half))
        cr = arc_points(O1, R1 + t,
                        math.atan2(sl[1] - O1[1], sl[0] - O1[0]),
                        math.atan2(sr[1] - O1[1], sr[0] - O1[0]), 96, ccw=False)

        def wall(O2, R2, S, O3, R3, side):
            seg = []
            if five:
                T = (O2[0] + (R2 + t) * side * math.sin(half3), O2[1] + (R2 + t) * math.cos(half3))
                seg += arc_points(O2, R2 + t,
                                  math.atan2(S[1] - O2[1], S[0] - O2[0]),
                                  math.atan2(T[1] - O2[1], T[0] - O2[0]), 40, ccw=(side < 0))
                B = circle_line(O3, R3 + t, u_road, side, -t) or (O3[0] + side * (R3 + t), O3[1])
                seg += arc_points(O3, R3 + t,
                                  math.atan2(T[1] - O3[1], T[0] - O3[0]),
                                  math.atan2(B[1] - O3[1], B[0] - O3[0]), 40, ccw=(side < 0))[1:]
            else:
                B = circle_line(O2, R2 + t, u_road, side, -t) or (O2[0] + side * (R2 + t), O2[1])
                seg += arc_points(O2, R2 + t,
                                  math.atan2(S[1] - O2[1], S[0] - O2[0]),
                                  math.atan2(B[1] - O2[1], B[0] - O2[0]), 48, ccw=(side < 0))
            return seg, B

        wr, br = wall(O2r, R2r, sr, O3r, R3r, +1)
        wl, bl = wall(O2l, R2l, sl, O3l, R3l, -1)
        return cr + wr[1:] + wl[::-1][:-1], br, bl

    section, BR, BL = ring(0.0)
    poly = section
    t_l = float(P.get("lining_t", 0) or 0)
    t_s = float(P.get("shot_t", 0) or 0)
    t_o = float(P.get("overbreak", 0) or 0)
    layers = []
    acc = 0.0
    for nm, t in (("lining", t_l), ("shotcrete", t_s), ("overbreak", t_o)):
        if t > 0:
            acc += t
            pl, _, _ = ring(acc)
            layers.append({"name": nm, "t": t, "offset": acc,
                           "poly": pl, "area_m2": shoelace(pl) / 1e6})

    # 폭·높이는 노면 좌표계에서 잰다(편경사 정합)
    tt = [u_road[0] * p[0] + u_road[1] * p[1] for p in section]
    nn = [n_road[0] * p[0] + n_road[1] * p[1] for p in section]
    width = max(tt) - min(tt)
    height = max(nn) - min(nn)
    area = shoelace(section)
    flat = height / width if width else 0.0
    exc_m2 = layers[-1]["area_m2"] if layers else area / 1e6

    aT = (abs(math.atan2(T_R[0] - O1[0], T_R[1] - O1[1])) if (five and T_R) else 9.9)

    # 라이닝까지의 반경 여유(mm). 양수 = 안쪽에 여유 있음
    def gap(Q):
        ang = math.atan2(Q[0] - O1[0], Q[1] - O1[1])
        if -half <= ang <= half:
            return R1 - math.hypot(Q[0] - O1[0], Q[1] - O1[1])
        if abs(ang) <= aT:
            C, R = (O2r, R2r) if ang > 0 else (O2l, R2l)
        else:
            C, R = (O3r, R3r) if ang > 0 else (O3l, R3l)
        return R - math.hypot(Q[0] - C[0], Q[1] - C[1])

    # 시설한계 8점 중 0·1·7 은 노면 위에 있다 = 라이닝 바닥선과 같은 선 → 여유 0 이 당연.
    # (원본 결과 60행에서 여유폭이 44행이나 0 으로 찍힌 것과 같은 이유로 보인다.)
    UP = [i for i in range(8) if i not in (0, 1, 7)]
    margin = min(gap(clr[i]) for i in UP)
    contain = min(gap(clr_off[i]) for i in UP)
    side_q = [clr[i] for i in UP if abs(math.atan2(clr[i][0] - O1[0], clr[i][1] - O1[1])) > half]
    margin_side = min((gap(q) for q in side_q), default=margin)

    return {
        "in": {"cc": cc, "s_pct": s_pct, "EL1": EL1, "theta": theta_deg, "tol": tol,
               "five": five, "theta3": math.degrees(half3 * 2) if five else None,
               "note": five_note},
        "R1": R1, "R2": R2l, "R2p": R2r, "R3": R3l, "R3p": R3r, "R1_need": need,
        "O1": O1, "O2L": O2l, "O2R": O2r, "O3L": O3l, "O3R": O3r,
        "SL": S_L, "SR": S_R, "TL": T_L, "TR": T_R, "BL": BL, "BR": BR,
        "area": area, "area_m2": area / 1e6, "flat": flat, "exc_m2": exc_m2,
        "width": width, "height": height,
        "margin": margin, "margin_side": margin_side, "contain": contain,
        "poly": poly, "layers": layers, "clr": clr, "clr_off": clr_off,
        "u_road": u_road, "n_road": n_road,
        "ducts": [{"side": t, "pts": r} for t, r in ducts],
        "extras": extras,
    }


def judge(sec, flat_min=0.55, margin_min=50.0):
    """판정 기준은 자료에 없다(M3). 아래 기본값은 잠정 — 파라미터로 노출한다.
       flat_min 0.55  : 원본 60행에서 OK 로 찍힌 6행이 전부 0.5501~0.5510 인 데서 역산(추정)
       margin_min 50  : 검토보고서의 시공오차(시설한계) 50mm 를 하한으로 사용(잠정)"""
    ok_f = sec["flat"] >= flat_min
    ok_m = sec["margin"] >= margin_min - 1e-6
    ok_c = sec["contain"] >= -1e-6
    return {"flat": "OK" if ok_f else "NG", "margin": "OK" if ok_m else "NG",
            "contain": "OK" if ok_c else "NG",
            "all": "OK" if (ok_f and ok_m and ok_c) else "NG"}


# ---------------------------------------------------------------- 스윕
def frange(a, b, st):
    if st == 0:
        return [a]
    n = int(round(abs(b - a) / abs(st)))
    sg = 1 if b >= a else -1
    return [round(a + sg * abs(st) * i, 6) for i in range(n + 1)]


def sweep(P, sw, tol=50.0, grid=GRID_DEFAULT, flat_min=0.55, margin_min=50.0, limit=4000,
          use_walk=False, use_jet=False):
    ccs = [v * 1000 for v in frange(sw["cc"][0], sw["cc"][1], sw["cc"][2])]
    ss = frange(sw["s"][0], sw["s"][1], sw["s"][2])
    els = [v * 1000 for v in frange(sw["EL1"][0], sw["EL1"][1], sw["EL1"][2])]
    ths = frange(sw["theta"][0], sw["theta"][1], sw["theta"][2])
    rows = []
    for cc in ccs:
        for s in ss:
            for el in els:
                for th in ths:
                    if len(rows) >= limit:
                        return rows, (len(ccs), len(ss), len(els), len(ths))
                    sec = build_section(P, cc, s, el, th, tol, grid, use_walk, use_jet)
                    j = judge(sec, flat_min, margin_min)
                    rows.append({"cc": cc / 1000.0, "s": s, "EL1": el / 1000.0, "theta": th,
                                 "R1": sec["R1"], "R2": sec["R2"], "R2p": sec["R2p"],
                                 "area_m2": round(sec["area_m2"], 4),
                                 "exc_m2": round(sec["exc_m2"], 4),
                                 "R3": sec["R3"], "R3p": sec["R3p"],
                                 "flat": round(sec["flat"], 6),
                                 "margin": round(sec["margin"], 2),
                                 "margin_side": round(sec["margin_side"], 2),
                                 "width": round(sec["width"], 1), "height": round(sec["height"], 1),
                                 "jf": j["flat"], "jm": j["margin"], "jc": j["contain"], "j": j["all"]})
    return rows, (len(ccs), len(ss), len(els), len(ths))


DEFAULT_PARAMS = {
    "lane_L": 3000.0, "shoulder_L": 1200.0, "lane_R": 3600.0, "shoulder_R": 3000.0,
    "H": 4800.0, "ha": 1000.0, "hb": 800.0,
    "duct_LW": 800.0, "duct_LH": 900.0, "duct_RW": 800.0, "duct_RH": 600.0,
    "jetfan_d": 1500.0, "walk_w": 750.0, "walk_h": 1710.0, "drain_b1": 30.0,
    "walk_side": "L", "jet_dx": 0.0, "jet_gap_ratio": 0.3,
    "lining_t": 300.0, "shot_t": 100.0, "overbreak": 100.0,
    "five_center": 0, "theta3": 150.0,
}
DEFAULT_SWEEP = {"cc": [-0.9, -0.5, 0.05], "s": [-2, 2, 1],
                 "EL1": [0.3, 0.5, 0.05], "theta": [100, 130, 10]}
