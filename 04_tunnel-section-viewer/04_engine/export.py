# -*- coding: utf-8 -*-
"""내보내기 — BIM 핸드오프 (DXF / JSON 계약 / CSV).

DXF  : 실제 ARC/LINE 엔티티로 내보낸다(폴리라인 근사 아님) → CAD·Revit·Dynamo 에서 그대로 쓴다.
JSON : 중심·반지름·각도의 계약. Dynamo/애드인이 이 한 파일만 읽으면 단면을 재구성할 수 있다.
CSV  : 스윕 결과표.
"""
import csv
import io
import json
import math

LAYERS = [
    ("TN_INNER", 7, "내공선(3심원)"),
    ("TN_LINING", 3, "라이닝 외면"),
    ("TN_SHOT", 4, "숏크리트 외면"),
    ("TN_EXC", 1, "굴착선"),
    ("TN_CLEAR", 2, "시설한계"),
    ("TN_CLEAR_OFF", 2, "시설한계+시공오차"),
    ("TN_DUCT", 6, "공동구"),
    ("TN_EXTRA", 5, "부대공(검사원통로·제트팬)"),
    ("TN_CENTER", 8, "중심점·축선"),
]


def _ang(C, P):
    return math.degrees(math.atan2(P[1] - C[1], P[0] - C[0])) % 360.0


def _ccw_pair(C, p0, p1):
    """CCW 스윕이 180도 미만이 되도록 (시작각, 끝각) 순서를 정한다."""
    a0, a1 = _ang(C, p0), _ang(C, p1)
    return (a0, a1) if (a1 - a0) % 360.0 <= 180.0 else (a1, a0)


def _arcs_of(sec, t=0.0):
    """오프셋 t 인 링을 구성하는 원호 목록. 중심은 그대로, 반지름 +t."""
    half = math.radians(sec["in"]["theta"]) / 2.0
    five = bool(sec["in"].get("five"))
    half3 = math.radians(sec["in"].get("theta3") or 0) / 2.0
    O1, R1 = sec["O1"], sec["R1"] + t
    sl = (O1[0] - R1 * math.sin(half), O1[1] + R1 * math.cos(half))
    sr = (O1[0] + R1 * math.sin(half), O1[1] + R1 * math.cos(half))
    out = [("R1", O1, R1, sr, sl)]
    for side, O2, R2, S, O3, R3, nm2, nm3 in (
            (+1, sec["O2R"], sec["R2p"] + t, sr, sec["O3R"], sec["R3p"] + t, "R2'", "R3'"),
            (-1, sec["O2L"], sec["R2"] + t, sl, sec["O3L"], sec["R3"] + t, "R2", "R3")):
        if five:
            T = (O2[0] + R2 * side * math.sin(half3), O2[1] + R2 * math.cos(half3))
            out.append((nm2, O2, R2, S, T))
            B = _bottom_hit(O3, R3, sec, side, -t)
            out.append((nm3, O3, R3, T, B))
        else:
            B = _bottom_hit(O2, R2, sec, side, -t)
            out.append((nm2, O2, R2, S, B))
    return out


def _bottom_hit(C, R, sec, side, off):
    u = sec["u_road"]
    n = (-u[1], u[0])
    A = (n[0] * off, n[1] * off)
    dx, dy = C[0] - A[0], C[1] - A[1]
    b = u[0] * dx + u[1] * dy
    c = dx * dx + dy * dy - R * R
    d = b * b - c
    if d < 0:
        return (C[0] + side * R, C[1])
    tt = b + side * math.sqrt(d)
    return (A[0] + u[0] * tt, A[1] + u[1] * tt)


def have_ezdxf():
    """ezdxf 는 DXF 내보내기에만 쓴다. 없어도 뷰어·JSON·CSV·보고서는 전부 돈다."""
    try:
        import ezdxf                                          # noqa: F401
        return True
    except Exception:                                         # noqa: BLE001
        return False


# ---------------------------------------------------------------- DXF 라이터
# ★의존성 0. ezdxf(+numpy 등 92MB)를 배포에 넣지 않으려고 직접 쓴다.
#   R12(AC1009) ASCII — 가장 관대한 포맷이고 CAD·Revit·Dynamo 가 모두 읽는다.
#   내보내는 엔티티는 LINE / ARC / CIRCLE / POLYLINE+VERTEX / POINT / TEXT 6종뿐이다.
#   검증은 게이트 G9 가 (개발 PC 의) ezdxf 로 되읽어서 한다.
def _g(code, val):
    return "%d\n%s\n" % (code, val)


def _num(v):
    return ("%.6f" % v).rstrip("0").rstrip(".") or "0"


def _e_line(lay, a, b):
    return (_g(0, "LINE") + _g(8, lay) + _g(10, _num(a[0])) + _g(20, _num(a[1])) + _g(30, "0")
            + _g(11, _num(b[0])) + _g(21, _num(b[1])) + _g(31, "0"))


def _e_arc(lay, c, r, a0, a1):
    return (_g(0, "ARC") + _g(8, lay) + _g(10, _num(c[0])) + _g(20, _num(c[1])) + _g(30, "0")
            + _g(40, _num(r)) + _g(50, _num(a0)) + _g(51, _num(a1)))


def _e_circle(lay, c, r):
    return (_g(0, "CIRCLE") + _g(8, lay) + _g(10, _num(c[0])) + _g(20, _num(c[1])) + _g(30, "0")
            + _g(40, _num(r)))


def _e_poly(lay, pts, closed=True):
    o = (_g(0, "POLYLINE") + _g(8, lay) + _g(66, "1")
         + _g(10, "0") + _g(20, "0") + _g(30, "0") + _g(70, "1" if closed else "0"))
    for x, y in pts:
        o += (_g(0, "VERTEX") + _g(8, lay)
              + _g(10, _num(x)) + _g(20, _num(y)) + _g(30, "0"))
    return o + _g(0, "SEQEND") + _g(8, lay)


def _e_point(lay, c):
    return _g(0, "POINT") + _g(8, lay) + _g(10, _num(c[0])) + _g(20, _num(c[1])) + _g(30, "0")


def _e_text(lay, c, h, txt):
    return (_g(0, "TEXT") + _g(8, lay) + _g(10, _num(c[0])) + _g(20, _num(c[1])) + _g(30, "0")
            + _g(40, _num(h)) + _g(1, txt))


def to_dxf(sec, path):
    """R12 ASCII DXF 를 직접 쓴다. 외부 라이브러리 없음."""
    ents = []
    rings = [("TN_INNER", 0.0)]
    for lay in sec.get("layers", []):
        rings.append(({"lining": "TN_LINING", "shotcrete": "TN_SHOT",
                       "overbreak": "TN_EXC"}[lay["name"]], lay["offset"]))
    for layer, t in rings:
        arcs = _arcs_of(sec, t)
        for nm, C, R, p0, p1 in arcs:
            a0, a1 = _ccw_pair(C, p0, p1)
            ents.append(_e_arc(layer, C, R, a0, a1))
        b_r = arcs[-2][4] if sec["in"].get("five") else arcs[1][4]
        ents.append(_e_line(layer, b_r, arcs[-1][4]))

    ents.append(_e_poly("TN_CLEAR", sec["clr"]))
    ents.append(_e_poly("TN_CLEAR_OFF", sec["clr_off"]))
    for d in sec["ducts"]:
        ents.append(_e_poly("TN_DUCT", d["pts"]))
    for e in sec.get("extras", []):
        if e["kind"] == "jetfan":
            ents.append(_e_circle("TN_EXTRA", e["c"], e["r"]))
        else:
            ents.append(_e_poly("TN_EXTRA", e["pts"]))
    for nm, C in (("O1", sec["O1"]), ("O2", sec["O2L"]), ("O2p", sec["O2R"])):
        ents.append(_e_point("TN_CENTER", C))
        ents.append(_e_text("TN_CENTER", (C[0] + 90, C[1] + 90), 120, nm))
    u = sec["u_road"]
    L = sec["width"]
    ents.append(_e_line("TN_CENTER", (-u[0] * L, -u[1] * L), (u[0] * L, u[1] * L)))

    tables = _g(0, "TABLE") + _g(2, "LAYER") + _g(70, str(len(LAYERS)))
    for nm, col, _desc in LAYERS:
        tables += (_g(0, "LAYER") + _g(2, nm) + _g(70, "0") + _g(62, str(col))
                   + _g(6, "CONTINUOUS"))
    tables += _g(0, "ENDTAB")

    doc = (_g(0, "SECTION") + _g(2, "HEADER")
           + _g(9, "$ACADVER") + _g(1, "AC1009")
           + _g(9, "$INSUNITS") + _g(70, "4")
           + _g(0, "ENDSEC")
           + _g(0, "SECTION") + _g(2, "TABLES") + tables + _g(0, "ENDSEC")
           + _g(0, "SECTION") + _g(2, "ENTITIES") + "".join(ents) + _g(0, "ENDSEC")
           + _g(0, "EOF"))
    with io.open(path, "w", encoding="utf-8", newline="\r\n") as f:
        f.write(doc)
    return path


def have_ezdxf():
    """더 이상 필수가 아니다. 게이트에서 되읽기 검증에만 쓴다."""
    try:
        import ezdxf                                          # noqa: F401
        return True
    except Exception:                                         # noqa: BLE001
        return False


def to_json(sec, P, q, path=None):
    """BIM 핸드오프 계약. Dynamo/애드인은 이 파일만 읽으면 단면을 재구성한다."""
    def arcs(t):
        return [{"name": nm, "center": [round(C[0], 3), round(C[1], 3)], "r": round(R, 3),
                 "p_start": [round(p0[0], 3), round(p0[1], 3)],
                 "p_end": [round(p1[0], 3), round(p1[1], 3)],
                 "deg_ccw": [round(a, 4) for a in _ccw_pair(C, p0, p1)]}
                for nm, C, R, p0, p1 in _arcs_of(sec, t)]
    inner = _arcs_of(sec, 0.0)
    b_r = inner[-2][4] if sec["in"].get("five") else inner[1][4]
    d = {
        "schema": "tn_section/1.0",
        "unit": "mm",
        "datum": "원점 = 터널 중심축의 노면 레벨, +x 우 / +y 상. 라이닝은 연직, 도로만 편경사 회전.",
        "input": dict(sec["in"]),
        "params": {k: P[k] for k in sorted(P)},
        "judge_criteria": {"flat_min": q.get("flat_min", 0.55),
                           "margin_min": q.get("margin_min", 50), "tol": q.get("tol", 50)},
        "metrics": {"R1": sec["R1"], "R2": sec["R2"], "R2p": sec["R2p"],
                    "R3": sec["R3"], "R3p": sec["R3p"],
                    "width": round(sec["width"], 1), "height": round(sec["height"], 1),
                    "area_m2": round(sec["area_m2"], 4), "exc_m2": round(sec["exc_m2"], 4),
                    "flat": round(sec["flat"], 6), "margin_mm": round(sec["margin"], 2)},
        "inner_arcs": arcs(0.0),
        "bottom": {"p_start": [round(b_r[0], 3), round(b_r[1], 3)],
                   "p_end": [round(inner[-1][4][0], 3), round(inner[-1][4][1], 3)]},
        "rings": [{"name": l["name"], "t": l["t"], "offset": l["offset"],
                   "area_m2": round(l["area_m2"], 4), "arcs": arcs(l["offset"])}
                  for l in sec.get("layers", [])],
        "clearance": [[round(x, 2), round(y, 2)] for x, y in sec["clr"]],
        "clearance_offset": [[round(x, 2), round(y, 2)] for x, y in sec["clr_off"]],
        "ducts": [{"side": x["side"], "pts": [[round(a, 2), round(b, 2)] for a, b in x["pts"]]}
                  for x in sec["ducts"]],
        "extras": [{k: v for k, v in e.items() if k != "pts"} |
                   ({"pts": [[round(a, 2), round(b, 2)] for a, b in e["pts"]]} if e.get("pts") else {})
                   for e in sec.get("extras", [])],
        "notes": [
            "R1 = 시설한계+시공오차를 감싸는 최소 반지름(5mm 격자). 원본 60행 중 56행 일치.",
            "R2/R2'(및 R3/R3')는 표준 구성으로 신규 정의한 값이다. 원본 산정식은 자료에 없어 재현하지 않았다.",
            "판정 기준(편평률·여유폭)은 자료에 없어 잠정값이다.",
        ],
    }
    if path:
        with io.open(path, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
    return d


CSV_COLS = ["cc", "s", "EL1", "theta", "R1", "R2", "R2p", "R3", "R3p",
            "width", "height", "area_m2", "exc_m2", "flat", "margin", "jf", "jm", "jc", "j"]


def to_csv(rows, path):
    with io.open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["도로중심거리(m)", "편경사(%)", "중심높이(m)", "중심각(°)",
                    "R1(mm)", "R2(mm)", "R2'(mm)", "R3(mm)", "R3'(mm)",
                    "내공폭(mm)", "내공높이(mm)", "내공단면적(㎡)", "굴착단면적(㎡)",
                    "편평률", "여유폭(mm)", "편평률판정", "여유폭판정", "포함판정", "종합"])
        for r in rows:
            w.writerow([r.get(c, "") for c in CSV_COLS])
    return path
