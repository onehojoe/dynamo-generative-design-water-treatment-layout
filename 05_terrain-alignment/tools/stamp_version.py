# -*- coding: utf-8 -*-
"""index.html 의 캐시버스트(?v=)를 MANIFEST 버전으로 일괄 도장.

왜 자동화하나: 2026-08-25 에 app.js·ga.js 를 고치고도 ?v= 를 안 올려서,
사용자가 F5 를 눌러도 브라우저가 캐시된 옛 코드를 계속 썼다. 버튼이 고쳐졌는데도
"안 된다" 가 이어졌다. 사람이 기억할 일이 아니라 빌드가 할 일이다.

  · ?v= 가 없는 로컬 script/link 에는 새로 붙인다
  · 이미 있으면 값을 갈아 끼운다
  · http(s):// 로 시작하는 외부 주소는 건드리지 않는다
"""
import io
import json
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def main():
    mp = os.path.join(ROOT, "MANIFEST.json")
    ver = "0"
    if os.path.exists(mp):
        mf = json.load(io.open(mp, encoding="utf-8"))
        ver = str(mf.get("version", "0"))
    idx = os.path.join(ROOT, "web", "index.html")
    s = io.open(idx, encoding="utf-8").read()

    n = [0]

    def fix(m):
        attr, url = m.group(1), m.group(2)
        if url.startswith(("http://", "https://", "//", "data:")):
            return m.group(0)
        base = url.split("?", 1)[0]
        n[0] += 1
        return '%s="%s?v=%s"' % (attr, base, ver)

    s2 = re.sub(r'(src|href)="([^"?]+\.(?:js|css))(?:\?[^"]*)?"', fix, s)
    if s2 != s:
        io.open(idx, "w", encoding="utf-8").write(s2)
    print("   캐시버스트 ?v=%s → %d개 자산" % (ver, n[0]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
