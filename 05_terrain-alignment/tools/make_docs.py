# -*- coding: utf-8 -*-
"""USAGE.md + AI_GUIDE.md + CHANGELOG.md → docs/설명자료.html (한 장으로 읽기)

외부 패키지를 쓰지 않는다. 마크다운의 일부(제목·표·목록·코드·인용·강조·링크)만
다루는 최소 변환기다 — 우리 문서가 그 범위 안에서 쓰였기 때문이다.
스타일은 워크벤치와 같은 «측량 제도지».
"""
import html
import io
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
WB = os.path.dirname(HERE)
OUT = os.path.join(WB, "docs", "설명자료.html")

DOCS = [("USAGE.md", "사용 설명서"),
        ("AI_GUIDE.md", "AI 인계 문서"),
        ("CHANGELOG.md", "변경 이력")]

CSS = """
:root{--bg:#EFEAE0;--paper:#FBF9F4;--line:#D9D0BE;--line2:#EAE3D6;--ink:#2E2A24;
      --dim:#7A7264;--acc:#8C5A2B;--acc2:#B07A3E;--bad:#B0432F;--ok:#2E7D5B}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
     font:15px/1.75 "Malgun Gothic","Segoe UI",system-ui,sans-serif}
#wrap{display:flex;min-height:100vh}
nav{width:250px;flex:none;background:var(--paper);border-right:1px solid var(--line);
    padding:20px 0;position:sticky;top:0;height:100vh;overflow-y:auto}
nav h1{font-size:14px;margin:0 20px 14px;padding-bottom:12px;border-bottom:2px solid var(--acc)}
nav h1 small{display:block;color:var(--dim);font-weight:400;font-size:11px;margin-top:4px}
nav a{display:block;padding:4px 20px;color:var(--dim);text-decoration:none;font-size:12.5px;
      border-left:3px solid transparent}
nav a:hover{color:var(--acc);background:#F3EDE2}
nav a.h1{color:var(--ink);font-weight:700;margin-top:10px;border-left-color:var(--acc)}
nav a.h3{padding-left:34px;font-size:12px}
main{flex:1;min-width:0;padding:34px 46px 90px;max-width:960px}
h1,h2,h3{line-height:1.4}
h1{font-size:25px;margin:46px 0 6px;padding-bottom:10px;border-bottom:2px solid var(--acc)}
h1:first-child{margin-top:0}
h2{font-size:18px;margin:34px 0 10px;color:var(--acc);padding-bottom:5px;
   border-bottom:1px dashed var(--line)}
h3{font-size:15px;margin:22px 0 6px}
p{margin:9px 0}
code{background:#F2EBDD;border:1px solid var(--line2);border-radius:2px;padding:1px 5px;
     font:12.5px Consolas,monospace}
pre{background:#F5F0E4;border:1px solid var(--line);border-left:3px solid var(--acc2);
    border-radius:3px;padding:12px 14px;overflow-x:auto;margin:12px 0}
pre code{background:none;border:0;padding:0;font-size:12.5px;line-height:1.6}
table{border-collapse:collapse;margin:14px 0;font-size:13.5px;width:100%}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
th{background:#F0E9DA;font-weight:700;color:var(--acc)}
tr:nth-child(even) td{background:#FAF7F0}
blockquote{margin:12px 0;padding:9px 14px;background:#F5EFE3;border-left:3px solid var(--acc2);
           color:#4A4238}
ul,ol{margin:9px 0;padding-left:24px}
li{margin:3px 0}
hr{border:0;border-top:1px solid var(--line);margin:30px 0}
a{color:var(--acc)}
figure{margin:16px 0;padding:0}
figure img{max-width:100%;display:block;border:1px solid var(--line);border-radius:3px;
           background:#fff;box-shadow:0 1px 4px rgba(60,50,35,.10)}
figcaption{font-size:12px;color:var(--dim);margin-top:5px}
p>img,li>img{max-width:100%;border:1px solid var(--line);border-radius:3px}
strong{color:#1F1B16}
.warnbox{background:#F8EEE9;border:1px solid #E0BFB6;border-left:3px solid var(--bad);
         border-radius:3px;padding:12px 15px;margin:16px 0}
.warnbox b{color:var(--bad)}
"""


def inline(t):
    t = html.escape(t)
    # ![대체문구](경로) → 그림 + 캡션
    t = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)",
               r'<figure><img src="\g<2>" alt="\g<1>"><figcaption>\g<1></figcaption></figure>', t)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', t)
    return t


def convert(md, prefix):
    out, toc = [], []
    lines = md.split("\n")
    i = 0
    in_pre = False
    lst = None
    while i < len(lines):
        ln = lines[i]
        if ln.strip().startswith("```"):
            if in_pre:
                out.append("</code></pre>"); in_pre = False
            else:
                out.append("<pre><code>"); in_pre = True
            i += 1
            continue
        if in_pre:
            out.append(html.escape(ln)); i += 1; continue

        if lst and not re.match(r"^\s*([-*]|\d+\.)\s", ln):
            out.append("</%s>" % lst); lst = None

        m = re.match(r"^(#{1,4})\s+(.*)$", ln)
        if m:
            lv, txt = len(m.group(1)), m.group(2)
            aid = "%s-%d" % (prefix, len(toc))
            toc.append((lv, re.sub(r"[`*]", "", txt), aid))
            tag = "h%d" % min(3, lv)
            out.append('<%s id="%s">%s</%s>' % (tag, aid, inline(txt), tag))
            i += 1; continue

        if ln.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|$", lines[i + 1].strip()):
            hdr = [c.strip() for c in ln.strip().strip("|").split("|")]
            out.append("<table><thead><tr>" + "".join("<th>%s</th>" % inline(c) for c in hdr) +
                       "</tr></thead><tbody>")
            i += 2
            while i < len(lines) and lines[i].startswith("|"):
                cs = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                out.append("<tr>" + "".join("<td>%s</td>" % inline(c) for c in cs) + "</tr>")
                i += 1
            out.append("</tbody></table>")
            continue

        if ln.strip().startswith(">"):
            out.append("<blockquote>%s</blockquote>" % inline(ln.strip().lstrip("> ")))
            i += 1; continue
        if re.match(r"^\s*---+\s*$", ln):
            out.append("<hr>"); i += 1; continue

        m = re.match(r"^\s*([-*])\s+(.*)$", ln)
        if m:
            if lst != "ul":
                out.append("<ul>"); lst = "ul"
            out.append("<li>%s</li>" % inline(m.group(2))); i += 1; continue
        m = re.match(r"^\s*\d+\.\s+(.*)$", ln)
        if m:
            if lst != "ol":
                out.append("<ol>"); lst = "ol"
            out.append("<li>%s</li>" % inline(m.group(1))); i += 1; continue

        if ln.strip():
            out.append("<p>%s</p>" % inline(ln))
        i += 1
    if lst:
        out.append("</%s>" % lst)
    if in_pre:
        out.append("</code></pre>")
    return "\n".join(out), toc


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    body, nav = [], []
    for fn, label in DOCS:
        p = os.path.join(WB, fn)
        if not os.path.exists(p):
            print("건너뜀(없음):", fn); continue
        h, toc = convert(io.open(p, encoding="utf-8").read(), fn.split(".")[0])
        body.append('<section id="%s">%s</section>' % (fn, h))
        for lv, txt, aid in toc:
            if lv <= 3:
                nav.append('<a class="h%d" href="#%s">%s</a>' % (lv, aid, html.escape(txt)))

    warn = ("""<div class="warnbox"><b>먼저 알아 둘 것</b><br>
지형은 전량 <b>합성</b>이다(원본에 표고 없음) · 설계기준 수치 <b>12개 중 11개가 법령 원문 대조 전</b> ·
터널·교량은 <b>높이 임계값 판정</b>(경제성 비교 아님) · 대지는 데이터 범위 + 여유 150 m <b>사각형</b>.
그대로 설계 근거로 옮기지 말 것.</div>""")

    doc = ("<!doctype html><html lang=ko><meta charset=utf-8>"
           "<meta name=viewport content='width=device-width,initial-scale=1'>"
           "<title>지형·선형 GD 워크벤치 — 설명자료</title><style>%s</style>"
           "<div id=wrap><nav><h1>지형·선형 GD 워크벤치<small>v1.7 설명자료</small></h1>%s</nav>"
           "<main>%s%s</main></div></html>"
           % (CSS, "\n".join(nav), warn, "\n".join(body)))
    io.open(OUT, "w", encoding="utf-8").write(doc)
    print("생성: %s (%.1f KB · 목차 %d)" % (OUT, os.path.getsize(OUT) / 1024, len(nav)))


if __name__ == "__main__":
    main()
