# -*- coding: utf-8 -*-
"""배포본 굽기 — 순서가 중요하다.

  ① 데이터 굽기 (JSON → JS)
  ② 설명자료 HTML 생성
  ③ MANIFEST 갱신          ← 반드시 마지막. 앞 단계가 파일을 바꾸므로.
  ④ 자가검사

★ ③을 먼저 하면 ②가 만든 HTML 의 해시가 어긋나 자가검사가 FAIL 한다(실제로 겪음).

사용: python tools/build_release.py
"""
import datetime
import hashlib
import io
import json
import os
import subprocess
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PY = sys.executable


def run(script, label):
    print("\n── " + label + " ──")
    r = subprocess.run([PY, os.path.join(HERE, script)], cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (r.stdout or "").strip().splitlines()
    for l in out[-4:]:
        print("   " + l)
    if r.returncode != 0:
        print("   [실패] " + (r.stderr or "").strip()[:400])
    return r.returncode


def manifest():
    print("\n── ③ MANIFEST ──")
    files = {}
    for base, dirs, fs in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in {"__pycache__", ".git"}]
        for fn in fs:
            if fn.endswith((".pyc", ".log")):
                continue
            p = os.path.join(base, fn)
            rel = os.path.relpath(p, ROOT).replace(os.sep, "/")
            if rel == "MANIFEST.json":
                continue
            raw = open(p, "rb").read()
            # selfcheck.sha() 와 같은 규칙 — 텍스트는 LF 로 정규화해 해싱
            if rel.lower().endswith((".md", ".txt", ".json", ".html", ".js", ".py", ".bat", ".css")):
                raw = raw.replace(b"\r\n", b"\n")
            files[rel] = {"bytes": os.path.getsize(p),
                          "sha256": hashlib.sha256(raw).hexdigest()}
    mp = os.path.join(ROOT, "MANIFEST.json")
    mf = json.load(io.open(mp, encoding="utf-8")) if os.path.exists(mp) else {}
    mf["files"] = dict(sorted(files.items()))
    mf["built"] = datetime.date.today().isoformat()
    io.open(mp, "w", encoding="utf-8").write(json.dumps(mf, ensure_ascii=False, indent=1))
    print("   %d 파일 · %.2f MB" % (len(files), sum(v["bytes"] for v in files.values()) / 1e6))


def main():
    run("pack_data.py", "① 데이터 굽기")
    run("make_docs.py", "② 설명자료")
    manifest()
    print("\n── ④ 자가검사 ──")
    r = subprocess.run([PY, os.path.join(HERE, "selfcheck.py")], cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    for l in (r.stdout or "").strip().splitlines()[-6:]:
        print("   " + l)
    return r.returncode


if __name__ == "__main__":
    sys.exit(main())
