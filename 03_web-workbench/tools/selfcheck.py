# -*- coding: utf-8 -*-
"""오프라인 자가검사 — 남의 PC에서 받은 직후 실행하는 용도.
사용: python tools/selfcheck.py   (워크벤치 폴더 어디서 실행해도 됨)
검사: 파일 존재 / data.js·network.js 스키마 / RUN.bat ASCII·CRLF / 엔진 결정성(시드·UV) /
      버전 일관성 / 로직 회귀(node 있으면)
"""
import json
import os
import subprocess
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


# 1. 파일 존재
required = ["index.html", "RUN.bat", "js/data.js", "js/network.js", "js/engine.js",
            "js/score.js", "js/reason.js", "js/app.js", "tools/qa_logic.js"]
missing = [f for f in required if not os.path.exists(os.path.join(ROOT, f))]
check("필수 파일 존재", not missing, f"누락 {missing}" if missing else f"{len(required)}개 전부")

# 2. data.js 스키마
try:
    txt = open(os.path.join(ROOT, "js", "data.js"), encoding="utf-8").read()
    data = json.loads(txt[txt.index("{"):txt.rindex("}") + 1])
    ok = (len(data["boundary"]) >= 3 and len(data["boxes"]) == 11
          and len(data["placeOrder"]) == 11 and len(data["connections"]) == 8
          and all(b["w"] > 0 and b["h"] > 0 for b in data["boxes"]))
    check("data.js 스키마", ok,
          f"boundary {len(data['boundary'])}pt · boxes {len(data['boxes'])} · conn {len(data['connections'])}")
except Exception as e:  # noqa: BLE001
    check("data.js 스키마", False, str(e))

# 2-b. network.js 스키마 — 계통 v2가 11개 시설을 전부 덮는가 (v0.4 신설)
try:
    import re as _re
    ntxt = open(os.path.join(ROOT, "js", "network.js"), encoding="utf-8").read()
    links = _re.findall(r'\{ id: "(L\d+)",\s+a: "([^"]+)",\s+b: "([^"]+)",\s+system: "(\w+)"', ntxt)
    acc = _re.findall(r'\{ id: "(D\d+)", facility: "([^"]+)"', ntxt)
    covered = set()
    for _, a, b, _sys in links:
        covered.add(a); covered.add(b)
    for _, f in acc:
        covered.add(f)
    facs = set()
    for b in data["boxes"]:
        for f in b["label"].split(","):
            facs.add(f.strip())
    orphan = [b["label"] for b in data["boxes"]
              if not any(f.strip() in covered for f in b["label"].split(","))]
    ok = len(links) == 12 and len(acc) == 2 and not orphan
    check("network.js 계통 v2 — 링크 12 · 동선 2 · 무기여 시설 0", ok,
          f"links {len(links)} · access {len(acc)} · 빠진 시설 {orphan if orphan else '없음'}")
except Exception as e:  # noqa: BLE001
    check("network.js 계통 v2", False, str(e))

# 3. RUN.bat ASCII·CRLF (cmd가 .bat을 OEM 코드페이지로 읽는 함정 차단)
try:
    b = open(os.path.join(ROOT, "RUN.bat"), "rb").read()
    non_ascii = sum(1 for x in b if x > 127)
    crlf_ok = b"\r\n" in b and b.replace(b"\r\n", b"").find(b"\n") == -1
    check("RUN.bat ASCII+CRLF", non_ascii == 0 and crlf_ok,
          f"nonASCII {non_ascii} · CRLF {'OK' if crlf_ok else 'NG'}")
except Exception as e:  # noqa: BLE001
    check("RUN.bat ASCII+CRLF", False, str(e))

# 4. 엔진 결정성 (node 있으면 실측, 없으면 SKIP)
node_js = r"""
const path = process.env.WB_ROOT;
const fs = require('fs');
const txt = fs.readFileSync(path + '/js/data.js', 'utf-8');
global.SITE_DATA = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
const E = require(path + '/js/engine.js');
const seeds = [59,59,45,0,0,0,0,0,0,0,0];
const o = {gridN:51, clearance:10000, costRate:1};
const a = E.runPlacement(SITE_DATA, seeds, o);
const b = E.runPlacement(SITE_DATA, seeds, o);
const same = JSON.stringify(a.placed) === JSON.stringify(b.placed);
// UV 판도 같은 입력 → 같은 배치인가
const uv = E.uvFromResult(SITE_DATA, a);
const c = E.runPlacementUV(SITE_DATA, uv, o);
const d = E.runPlacementUV(SITE_DATA, uv, o);
const sameUv = JSON.stringify(c.placed) === JSON.stringify(d.placed);
// UV 왕복: 시드 배치를 UV로 옮겨도 같은 자리인가
const roundtrip = a.placed.every(p => {
  const q = c.placed.find(x => x.idx === p.idx);
  return q && Math.abs(q.cx - p.cx) < 1 && Math.abs(q.cy - p.cy) < 1;
});
console.log(JSON.stringify({same, sameUv, roundtrip, count:a.count, lengthM:a.lengthM, uvCount:c.count}));
"""
try:
    env = dict(os.environ, WB_ROOT=ROOT.replace("\\", "/"))
    r = subprocess.run(["node", "-e", node_js], env=env, capture_output=True,
                       text=True, encoding="utf-8", errors="replace", timeout=60)
    if r.returncode == 0:
        out = json.loads(r.stdout.strip().splitlines()[-1])
        check("엔진 결정성(node) — 시드·UV 양쪽",
              out["same"] and out["sameUv"] and out["count"] >= 1,
              f"시드 count {out['count']} · {out['lengthM']}m / UV count {out['uvCount']}")
        check("모드 전환 왕복(node) — 시드 배치 → UV → 같은 자리", out["roundtrip"],
              "11개 좌표 1mm 이내" if out["roundtrip"] else "불일치")
    else:
        check("엔진 결정성(node)", False, r.stderr.strip()[:200])
except FileNotFoundError:
    print("[SKIP] 엔진 결정성 — node 미설치 (브라우저에서 같은 시드 2회 실행으로 대체 확인 가능)")
except Exception as e:  # noqa: BLE001
    check("엔진 결정성(node)", False, str(e))

# 5. 버전 표기 일관성 (제목·헤더·캐시버스트가 따로 놀면 사용자가 구버전을 보게 된다)
try:
    html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    import re
    vers = set(re.findall(r"워크벤치 <span[^>]*>v([0-9.]+)</span>", html))
    vers |= set(re.findall(r"워크벤치 v([0-9.]+) —", html))
    busts = set(re.findall(r"\.js\?v=([0-9.]+)", html))
    ok = len(vers) == 1 and len(busts) == 1 and vers == busts
    check("버전 표기 일관성", ok, f"표기 {sorted(vers)} · 캐시버스트 {sorted(busts)}")
except Exception as e:  # noqa: BLE001
    check("버전 표기 일관성", False, str(e))

# 6. 로직 회귀검사 (node 있으면 실측)
qa = os.path.join(HERE, "qa_logic.js")
try:
    # node는 UTF-8로 출력한다 — 인코딩을 명시하지 않으면 Windows에서 cp949로 읽다 깨진다
    r = subprocess.run(["node", qa], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=120)
    last = [l for l in r.stdout.strip().splitlines() if l.startswith("결과:")]
    check("로직 회귀검사(qa_logic)", r.returncode == 0,
          last[-1] if last else r.stderr.strip()[:200])
except FileNotFoundError:
    print("[SKIP] 로직 회귀검사 — node 미설치")
except Exception as e:  # noqa: BLE001
    check("로직 회귀검사(qa_logic)", False, str(e))

fails = [n for n, ok, _ in results if not ok]
print(f"\n결과: PASS {len(results) - len(fails)} · FAIL {len(fails)}")
print("확인하지 못하는 것: Dynamo/Revit 실행값과의 일치 · 관로 단가의 진위 ·")
print("                  계통 가중(가정) · 최소이격/안전이격 규정 수치 · 화면 렌더링 픽셀.")
sys.exit(1 if fails else 0)
