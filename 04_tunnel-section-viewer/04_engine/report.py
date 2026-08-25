# -*- coding: utf-8 -*-
"""내공단면 검토보고서 생성 (P4).

원본 엑셀 `검토보고서` 시트의 항목 구성을 따르되, 원본에서 깨져 있던 #REF! 6칸을
실제 값으로 채운다. 산정 근거와 한계는 마지막 절에 그대로 적는다(CLAUDE.md §4-1).
"""
import html
import math


def _f(v, n=0):
    return ("%%.%df" % n) % v


def _svg(sec, w=760, h=470, pad=46):
    """단면도 SVG. 라이닝 + 시설한계 + 공동구 + 부대공 + 치수."""
    pts = list(sec["poly"]) + list(sec["clr"])
    for d in sec["ducts"]:
        pts += d["pts"]
    for e in sec.get("extras", []):
        pts += e.get("pts", [])
        if e.get("c"):
            pts += [(e["c"][0] - e["r"], e["c"][1] - e["r"]), (e["c"][0] + e["r"], e["c"][1] + e["r"])]
    x0 = min(p[0] for p in pts); x1 = max(p[0] for p in pts)
    y0 = min(p[1] for p in pts); y1 = max(p[1] for p in pts)
    sc = min((w - pad * 2) / (x1 - x0 or 1), (h - pad * 2) / (y1 - y0 or 1))
    X = lambda x: pad + (x - x0) * sc                              # noqa: E731
    Y = lambda y: h - pad - (y - y0) * sc                          # noqa: E731
    P = lambda pl: " ".join("%.1f,%.1f" % (X(p[0]), Y(p[1])) for p in pl)   # noqa: E731

    o = ['<svg viewBox="0 0 %d %d" width="100%%" xmlns="http://www.w3.org/2000/svg" '
         'style="background:#fff;border:1px solid #ccc">' % (w, h)]
    o.append('<polygon points="%s" fill="#eef5ff" stroke="#222" stroke-width="1.8"/>' % P(sec["poly"]))
    o.append('<polygon points="%s" fill="none" stroke="#1a7f37" stroke-width="1.2"/>' % P(sec["clr"]))
    o.append('<polygon points="%s" fill="none" stroke="#1a7f37" stroke-width=".7" '
             'stroke-dasharray="5 3"/>' % P(sec["clr_off"]))
    for d in sec["ducts"]:
        o.append('<polygon points="%s" fill="#fff3cd" stroke="#b58900" stroke-width="1"/>' % P(d["pts"]))
    for e in sec.get("extras", []):
        st = "1.4" if e.get("binding") else "0.9"
        da = "" if e.get("binding") else ' stroke-dasharray="4 3"'
        if e["kind"] == "jetfan":
            o.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="none" stroke="#6b46c1" '
                     'stroke-width="%s"%s/>' % (X(e["c"][0]), Y(e["c"][1]), e["r"] * sc, st, da))
        else:
            o.append('<polygon points="%s" fill="none" stroke="#6b46c1" stroke-width="%s"%s/>'
                     % (P(e["pts"]), st, da))
    for c, lab, col in ((sec["O1"], "O1", "#1f6feb"), (sec["O2L"], "O2", "#b58900"),
                        (sec["O2R"], "O2'", "#d63384")):
        o.append('<circle cx="%.1f" cy="%.1f" r="2.6" fill="%s"/>' % (X(c[0]), Y(c[1]), col))
        o.append('<text x="%.1f" y="%.1f" font-size="10" fill="%s">%s</text>'
                 % (X(c[0]) + 5, Y(c[1]) - 4, col, lab))
    yb = h - pad + 18
    o.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="#555"/>'
             % (X(x0), yb, X(x1), yb))
    o.append('<text x="%.1f" y="%.1f" font-size="11" text-anchor="middle" fill="#333">'
             '내공 폭 %s mm</text>' % ((X(x0) + X(x1)) / 2, yb - 4, _f(sec["width"])))
    o.append('<text x="%.1f" y="%.1f" font-size="11" fill="#333">내공 높이 %s mm</text>'
             % (pad, pad - 16, _f(sec["height"])))
    o.append('</svg>')
    return "".join(o)


def build(sec, judge, P, q, meta, rows=None, top=10):
    """sec/judge = 선정안, P = 제원, q = 판정기준·시공오차, meta = 프로젝트 정보."""
    e = html.escape
    walk = next((x for x in sec.get("extras", []) if x["kind"] == "walk"), None)
    jet = next((x for x in sec.get("extras", []) if x["kind"] == "jetfan"), None)

    def row(a, b, c=""):
        return "<tr><th>%s</th><td>%s</td><td class='rm'>%s</td></tr>" % (a, b, c)

    inp = [
        row("차로폭원", "좌 %s + 우 %s mm" % (_f(P["lane_L"]), _f(P["lane_R"])),
            "도로의 구조·시설 기준에 관한 규칙"),
        row("측방 여유폭", "좌 %s / 우 %s mm" % (_f(P["shoulder_L"]), _f(P["shoulder_R"]))),
        row("시설한계 높이 H", "%s mm" % _f(P["H"])),
        row("헌치 규격 a × b", "%s × %s mm" % (_f(P["ha"]), _f(P["hb"]))),
        row("시공오차(시설한계)", "%s mm" % _f(q.get("tol", 50)), "단면최적화 방안 준용"),
        row("공동구 규격", "좌 %s×%s / 우 %s×%s mm" % (_f(P["duct_LW"]), _f(P["duct_LH"]),
                                                  _f(P["duct_RW"]), _f(P["duct_RH"])),
            "기계·전기 설비 고려"),
    ]
    mech = [
        row("제트팬 직경", "Φ%s mm" % _f(P["jetfan_d"]),
            ("제약 반영" if jet and jet.get("binding") else "표시만(제약 미반영)")),
        row("제트팬 이격", "%.2f D" % P.get("jet_gap_ratio", 0.3)),
        row("검사원 통로", "%s × %s mm" % (_f(P["walk_w"]), _f(P["walk_h"])),
            ("제약 반영" if walk and walk.get("binding") else "표시만(제약 미반영)")),
    ]
    res = [
        row("도로 중심 거리", "%.2f m" % (sec["in"]["cc"] / 1000.0)),
        row("편경사", "%+g %%" % sec["in"]["s_pct"]),
        row("중심 높이 EL1", "%.2f m" % (sec["in"]["EL1"] / 1000.0)),
        row("중심각 θ", "%g °" % sec["in"]["theta"]),
        row("내공 반지름 R1", "%s mm" % _f(sec["R1"])),
        row("내공 반지름 R2 (좌)", "%s mm" % _f(sec["R2"])),
        row("내공 반지름 R2' (우)", "%s mm" % _f(sec["R2p"])),
        row("내공 폭 × 높이", "%s × %s mm" % (_f(sec["width"]), _f(sec["height"]))),
        row("내공단면적", "%.2f ㎡" % sec["area_m2"], "= %s mm²" % _f(sec["area"])),
        row("굴착단면적", "%.2f ㎡" % sec["exc_m2"],
            " / ".join("%s t%s → %.2f㎡" % ({"lining": "라이닝", "shotcrete": "숏크리트",
                                            "overbreak": "여굴"}[l["name"]], _f(l["t"]), l["area_m2"])
                       for l in sec.get("layers", [])) or "층 미설정"),
        row("심원 구성", ("5심원(R3 %s / R3' %s)" % (_f(sec["R3"]), _f(sec["R3p"])))
            if sec["in"].get("five") else "3심원",
            sec["in"].get("note") or ""),
        row("편평률", "%.4f" % sec["flat"],
            "기준 %.3f 이상 → <b>%s</b>" % (q.get("flat_min", .55), judge["flat"])),
        row("시설한계 여유폭", "%.1f mm" % sec["margin"],
            "기준 %s mm 이상 → <b>%s</b>" % (_f(q.get("margin_min", 50)), judge["margin"])),
        row("종합 판정", "<b>%s</b>" % judge["all"]),
    ]

    alt = ""
    if rows:
        ok = sorted([r for r in rows if r["j"] == "OK"], key=lambda r: r["area_m2"])[:top]
        if ok:
            body = "".join(
                "<tr><td>%d</td><td>%.2f</td><td>%+g</td><td>%.2f</td><td>%g</td>"
                "<td>%s</td><td>%s</td><td>%s</td><td>%.2f</td><td>%.4f</td><td>%s</td></tr>"
                % (i + 1, r["cc"], r["s"], r["EL1"], r["theta"], _f(r["R1"]), _f(r["R2"]),
                   _f(r["R2p"]), r["area_m2"], r["flat"], _f(r["margin"], 1))
                for i, r in enumerate(ok))
            alt = ("<h2>4. 대안 비교 (판정 OK 중 내공단면적 오름차순 상위 %d)</h2>"
                   "<table class='g'><tr><th>#</th><th>중심거리(m)</th><th>편경사(%%)</th>"
                   "<th>EL1(m)</th><th>θ(°)</th><th>R1</th><th>R2</th><th>R2'</th>"
                   "<th>면적(㎡)</th><th>편평률</th><th>여유(mm)</th></tr>%s</table>"
                   "<p class='n'>전체 %d조합 중 판정 OK %d조합.</p>"
                   % (len(ok), body, len(rows), sum(1 for r in rows if r["j"] == "OK")))

    css = """body{font-family:'Malgun Gothic',sans-serif;color:#111;max-width:900px;margin:0 auto;padding:28px 32px;line-height:1.55}
h1{font-size:21px;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:4px}
.meta{color:#555;font-size:12.5px;margin-bottom:18px}
h2{font-size:15px;margin:22px 0 8px;border-left:4px solid #1f6feb;padding-left:9px}
table{width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:6px}
th,td{border:1px solid #bbb;padding:5px 8px;text-align:left;vertical-align:top}
th{background:#f1f4f8;width:190px;font-weight:600}
table.g th{background:#f1f4f8;width:auto;text-align:center;font-size:11.5px}
table.g td{text-align:right;font-size:11.5px}
td.rm{color:#666;width:250px;font-size:11.5px}
.n{font-size:11.5px;color:#555;margin:4px 0 0}
.lim{background:#fff8e6;border:1px solid #e0c46c;border-radius:6px;padding:11px 14px;font-size:12px}
.lim li{margin-bottom:5px}
@media print{body{padding:0}.noprint{display:none}}
"""
    return """<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>내공단면 검토보고서</title><style>%s</style></head><body>
<h1>NATM 터널 내공단면 검토보고서</h1>
<div class="meta">프로젝트 : %s &nbsp;|&nbsp; 터널 : %s &nbsp;|&nbsp; 단면 : %s &nbsp;|&nbsp; 작성 : %s</div>

<h2>1. 내공단면 선정 입력값</h2><table>%s</table>
<h2>2. 기계환기 터널 입력값</h2><table>%s</table>
<h2>3. 내공단면 선정 결과</h2><table>%s</table>
<h2>단면도</h2>%s
%s
<h2>5. 산정 근거와 한계</h2>
<div class="lim"><ul>
<li><b>R1</b> = 시설한계를 시공오차만큼 바깥 오프셋한 형상을 감싸는 최소 반지름(5mm 격자 올림).
 이 규칙은 발주처 원본 결과 60행 중 <b>56행과 정확히 일치</b>한다. 미일치 4행(도로중심거리 −0.9m·편경사 +2%%)은
 원본이 9~14mm 크게 잡았으며 <b>원인은 확인되지 않았다</b>.</li>
<li><b>R2 / R2'</b> 는 스프링잉에서 R1에 접선 연속으로 내접시키고 그 측 제약(시설한계·공동구·부대공)을 품는
 최소 반지름으로 <b>새로 정의</b>한 값이다. 원본 R2/R2' 산정식은 제공 자료에 없어
 <b>재현하지 않았다</b>(통과점 후보 7종·접점각 역산 모두 불일치).</li>
<li><b>판정 기준은 제공 자료에 없다.</b> 편평률 하한 %.3f 은 원본 결과에서 OK로 표기된 행의 값으로부터
 역산한 <b>추정치</b>이고, 여유폭 하한 %s mm 는 시공오차를 <b>잠정</b> 적용한 값이다. 확인 후 갱신해야 한다.</li>
<li><b>부대공 배치 기준도 자료에 없다.</b> 검사원통로는 공동구 뚜껑 위, 제트팬은 시설한계 상단에 접하도록 둔
 <b>가정</b>이며, 위 표의 "제약 반영" 여부에 따라 산정에 포함되거나 표시만 된다.</li>
<li>라이닝·숏크리트·여굴은 <b>동심 오프셋</b>으로 산출한 값이다(굴착선까지). 지보패턴·록볼트·배수는 미반영.</li>
<li>5심원(R3/R3')은 구현했으나, 공동구·시설한계 하단이 노면 레벨에서 최대폭을 규정하면 <b>R3 ≤ R2 로 성립하지 않아 3심원으로 되돌린다</b>(위 "심원 구성" 칸에 사유 표기).</li>
</ul></div>
<p class="n">생성 = 23번 TN_SECTION_VIEWER 엔진(04_engine/section_engine.py) · 검증 게이트 7종 통과분.</p>
</body></html>""" % (css, e(meta.get("project", "-")), e(meta.get("tunnel", "-")),
                     e(meta.get("section", "-")), e(meta.get("date", "-")),
                     "".join(inp), "".join(mech), "".join(res), _svg(sec), alt,
                     q.get("flat_min", .55), _f(q.get("margin_min", 50)))
