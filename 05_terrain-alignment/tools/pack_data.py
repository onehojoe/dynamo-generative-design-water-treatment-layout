# -*- coding: utf-8 -*-
"""데이터 JSON → JS 로 굽는다 (의존성 0 배포용).

왜: 브라우저는 `file://` 에서 fetch() 를 막는다. 데이터를 <script> 로 실으면
파이썬·서버 없이 index.html 더블클릭만으로 돌아간다. 받는 사람 환경을 하나도
안 믿어도 되는 상태가 목표다.

  data/site.json  → data/site.js   window.KH_DATA.site
  data/terrain.json  → data/terrain.js   window.KH_DATA.terrain
  data/*.json (나머지)→ data/_aux.js      window.KH_DATA.aux[이름]

사용: python tools/pack_data.py        (10_WORKBENCH 에서)
"""
import io
import json
import os
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
WB = os.path.dirname(HERE)
DATA = os.path.join(WB, "data")

HEAD = "/* 자동 생성 — tools/pack_data.py. 직접 고치지 말 것(원본은 %s). */\n"


def dump(name, obj, var):
    js = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    out = os.path.join(DATA, name + ".js")
    with io.open(out, "w", encoding="utf-8") as f:
        f.write(HEAD % (name + ".json"))
        f.write("window.KH_DATA = window.KH_DATA || {aux:{}};\n")
        f.write("%s = %s;\n" % (var, js))
    return out, os.path.getsize(out)


def main():
    if not os.path.isdir(DATA):
        raise SystemExit("data 폴더가 없다: " + DATA)
    total = 0
    made = []

    for name, var in (("site", "window.KH_DATA.site"), ("terrain", "window.KH_DATA.terrain")):
        src = os.path.join(DATA, name + ".json")
        if not os.path.exists(src):
            print("건너뜀(없음): " + name + ".json")
            continue
        obj = json.load(io.open(src, encoding="utf-8"))
        out, sz = dump(name, obj, var)
        made.append((os.path.basename(out), sz))
        total += sz

    aux = {}
    for fn in sorted(os.listdir(DATA)):
        if not fn.endswith(".json") or fn in ("site.json", "terrain.json"):
            continue
        aux[fn[:-5]] = json.load(io.open(os.path.join(DATA, fn), encoding="utf-8"))
    if aux:
        out = os.path.join(DATA, "_aux.js")
        with io.open(out, "w", encoding="utf-8") as f:
            f.write(HEAD % "data/*.json")
            f.write("window.KH_DATA = window.KH_DATA || {aux:{}};\n")
            f.write("window.KH_DATA.aux = %s;\n" % json.dumps(aux, ensure_ascii=False, separators=(",", ":")))
        made.append(("_aux.js", os.path.getsize(out)))
        total += os.path.getsize(out)
        print("보조 데이터 %d종: %s" % (len(aux), ", ".join(sorted(aux))))

    for n, sz in made:
        print("  %-16s %8.2f MB" % (n, sz / 1e6))
    print("합계 %.2f MB — 이제 서버 없이 index.html 로 열린다." % (total / 1e6))


if __name__ == "__main__":
    main()
