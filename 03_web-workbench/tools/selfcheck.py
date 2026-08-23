# -*- coding: utf-8 -*-
"""오프라인 자가검사 — 남의 PC에서 받은 직후 실행하는 용도.
사용: python tools/selfcheck.py   (워크벤치 폴더 어디서 실행해도 됨)
검사: 파일 존재 / data.js 스키마 / RUN.bat ASCII·CRLF / 엔진 결정성(node 있으면)
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
required = ["index.html", "RUN.bat", "js/data.js", "js/engine.js", "js/app.js"]
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
const { runPlacement } = require(path + '/js/engine.js');
const seeds = [59,59,45,0,0,0,0,0,0,0,0];
const o = {gridN:51, clearance:10000, costRate:1};
const a = runPlacement(SITE_DATA, seeds, o);
const b = runPlacement(SITE_DATA, seeds, o);
const same = JSON.stringify(a.placed) === JSON.stringify(b.placed);
console.log(JSON.stringify({same, count:a.count, lengthM:a.lengthM}));
"""
try:
    env = dict(os.environ, WB_ROOT=ROOT.replace("\\", "/"))
    r = subprocess.run(["node", "-e", node_js], env=env,
                       capture_output=True, text=True, timeout=60)
    if r.returncode == 0:
        out = json.loads(r.stdout.strip().splitlines()[-1])
        check("엔진 결정성(node)", out["same"] and out["count"] >= 1,
              f"count {out['count']} · length {out['lengthM']}m")
    else:
        check("엔진 결정성(node)", False, r.stderr.strip()[:200])
except FileNotFoundError:
    print("[SKIP] 엔진 결정성 — node 미설치 (브라우저에서 같은 시드 2회 실행으로 대체 확인 가능)")
except Exception as e:  # noqa: BLE001
    check("엔진 결정성(node)", False, str(e))

fails = [n for n, ok, _ in results if not ok]
print(f"\n결과: PASS {len(results) - len(fails)} · FAIL {len(fails)}")
print("확인하지 못하는 것: Dynamo/Revit 실행값과의 일치, 비용 단가의 진위.")
sys.exit(1 if fails else 0)
