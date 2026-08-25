# -*- coding: utf-8 -*-
"""배포본 자가검사 — 받은 사람이 «제대로 받았는지» 를 혼자 확인한다.

검사 8종
  1 파일 존재      MANIFEST.json 에 적힌 파일이 다 있는가
  2 무결성         SHA-256 이 맞는가 (전달 중 깨짐·부분압축 해제 검출)
  3 데이터 스키마  site/terrain 이 기대한 모양인가
  4 격자 정합      nx*ny 와 z 길이가 맞는가
  5 등고선         레벨·정점이 있는가, 좌표가 격자 범위 안인가
  6 실행 진입      RUN.bat 이 ASCII·CRLF 인가 (한글 .bat 은 반드시 깨진다)
  7 스크립트 로드  index.html 이 참조하는 js/데이터가 실재하는가
  8 기준 등록부    미검증 항목이 몇 개인지 (실패가 아니라 고지)

파이썬 3.8+ 만 있으면 되고 외부 패키지는 쓰지 않는다.
★워크벤치 자체는 파이썬이 필요 없다. 이 검사기만 쓴다.
"""
import hashlib
import io
import json
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FAIL, WARN, OK = [], [], []


def ok(m):
    OK.append(m)
    print("  OK   " + m)


def warn(m):
    WARN.append(m)
    print("  WARN " + m)


def bad(m):
    FAIL.append(m)
    print("  FAIL " + m)


TEXT_HASH_EXT = (".md", ".txt", ".json", ".html", ".js", ".py", ".bat", ".css")


def sha(path):
    """텍스트 파일은 줄바꿈을 LF 로 맞춰 해싱한다.
    git·압축·메일을 거치며 CRLF↔LF 가 바뀌어도 «내용은 같다» 를 유지하려는 것.
    .bat 의 줄바꿈 자체는 [6] 검사에서 따로 본다."""
    h = hashlib.sha256()
    if path.lower().endswith(TEXT_HASH_EXT):
        b = open(path, "rb").read().replace(b"\r\n", b"\n")
        h.update(b)
        return h.hexdigest()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def read_js_payload(path, var):
    """data/*.js 에서 window.… = {...}; 부분만 떼어 JSON 으로 판다."""
    s = io.open(path, encoding="utf-8").read()
    i = s.find(var)
    if i < 0:
        return None
    j = s.find("=", i)
    k = s.rfind(";")
    return json.loads(s[j + 1:k].strip())


def main():
    print("=" * 62)
    print(" 지형·선형 GD 워크벤치 — 자가검사")
    print("=" * 62)

    mf_path = os.path.join(ROOT, "MANIFEST.json")

    # 1·2 파일 존재 · 무결성
    print("\n[1·2] 파일 존재 · SHA-256")
    if not os.path.exists(mf_path):
        bad("MANIFEST.json 이 없다 — 배포본이 아니거나 압축이 덜 풀렸다")
        mf = {"files": {}}
    else:
        mf = json.load(io.open(mf_path, encoding="utf-8"))
        miss = mismatch = 0
        for rel, meta in mf.get("files", {}).items():
            p = os.path.join(ROOT, rel.replace("/", os.sep))
            if not os.path.exists(p):
                bad("없음: " + rel)
                miss += 1
                continue
            if meta.get("sha256") and sha(p) != meta["sha256"]:
                bad("변조/손상: " + rel)
                mismatch += 1
        if miss == 0 and mismatch == 0:
            ok("%d개 파일 전부 존재하고 해시 일치" % len(mf.get("files", {})))

    # 3·4 데이터
    print("\n[3·4] 데이터 스키마 · 격자 정합")
    site_js = os.path.join(ROOT, "data", "site.js")
    terr_js = os.path.join(ROOT, "data", "terrain.js")
    site = terr = None
    try:
        site = read_js_payload(site_js, "window.KH_DATA.site")
        need = ["obstacle", "obstacle_extra", "road", "start", "end", "bounds"]
        lack = [k for k in need if k not in site]
        if lack:
            bad("site 키 누락: " + ", ".join(lack))
        else:
            ok("site — 장애물 %d · 추가 %d · 도로 %d"
               % (len(site["obstacle"]), len(site["obstacle_extra"]), len(site["road"])))
    except Exception as e:
        bad("site.js 판독 실패: %s" % e)

    try:
        terr = read_js_payload(terr_js, "window.KH_DATA.terrain")
        g = terr["grid"]
        if g["nx"] * g["ny"] != len(g["z"]):
            bad("격자 불일치 — nx*ny=%d, z=%d" % (g["nx"] * g["ny"], len(g["z"])))
        else:
            ok("terrain — 격자 %d×%d @ %g m · EL %g~%g"
               % (g["nx"], g["ny"], g["cell"], terr["meta"]["z_min"], terr["meta"]["z_max"]))
    except Exception as e:
        bad("terrain.js 판독 실패: %s" % e)

    # 5 등고선
    print("\n[5] 등고선")
    if terr:
        cs = terr.get("contours", [])
        nv = sum(len(r) for c in cs for r in c["rings"])
        if not cs:
            bad("등고선이 비어 있다")
        else:
            g = terr["grid"]
            x0, y0 = g["x0"], g["y0"]
            x1, y1 = x0 + g["nx"] * g["cell"], y0 + g["ny"] * g["cell"]
            outside = 0
            for c in cs:
                for r in c["rings"]:
                    for p in r:
                        if not (x0 - 1 <= p[0] <= x1 + 1 and y0 - 1 <= p[1] <= y1 + 1):
                            outside += 1
            if outside:
                bad("등고선 정점 %d개가 격자 밖에 있다" % outside)
            else:
                ok("등고선 %d레벨 · 정점 %d · 전부 격자 안" % (len(cs), nv))

    # 6 실행 진입
    print("\n[6] 실행 진입 (.bat 은 ASCII·CRLF 여야 한다)")
    for name in ("RUN.bat", "TEST.bat"):
        p = os.path.join(ROOT, name)
        if not os.path.exists(p):
            bad(name + " 없음")
            continue
        b = open(p, "rb").read()
        non_ascii = [c for c in b if c > 127]
        if non_ascii:
            bad("%s 에 비ASCII 바이트 %d개 — cmd 가 깨뜨린다" % (name, len(non_ascii)))
        elif b.count(b"\n") != b.count(b"\r\n"):
            bad("%s 줄바꿈이 CRLF 가 아니다" % name)
        else:
            ok("%s — ASCII · CRLF (%d bytes)" % (name, len(b)))

    # 7 스크립트 참조
    print("\n[7] index.html 이 부르는 파일")
    idx = os.path.join(ROOT, "web", "index.html")
    if not os.path.exists(idx):
        bad("web/index.html 없음")
    else:
        s = io.open(idx, encoding="utf-8").read()
        srcs = re.findall(r'<script src="([^"?]+)', s)
        missing = []
        for r in srcs:
            p = os.path.normpath(os.path.join(os.path.dirname(idx), r))
            if not os.path.exists(p):
                missing.append(r)
        if missing:
            bad("참조하는데 없는 파일: " + ", ".join(missing))
        else:
            ok("스크립트 %d개 전부 존재" % len(srcs))
        # 데이터가 <script> 로 실려야 file:// 에서 서버 없이 열린다
        packed = [r for r in srcs if r.replace("\\", "/").endswith(("data/site.js", "data/terrain.js"))]
        if len(packed) < 2:
            bad("데이터가 <script> 로 안 실렸다 — file:// 로는 안 열린다"
                " (tools/pack_data.py 를 돌리고 index.html 에 걸 것)")
        else:
            ok("데이터가 <script> 로 실려 있다 — 서버 없이 열린다")

    # 8 기준 등록부
    print("\n[8] 설계기준 등록부")
    try:
        aux = read_js_payload(os.path.join(ROOT, "data", "_aux.js"), "window.KH_DATA.aux")
        reg = aux.get("standards_registry")
        n = len(reg["items"])
        v = sum(1 for i in reg["items"] if i.get("verified"))
        warn("수치 %d/%d 검증 — 나머지는 법령 원문 대조 전이다(설계 근거로 쓰지 말 것)" % (v, n))
    except Exception as e:
        warn("등록부를 읽지 못했다: %s" % e)

    print("\n" + "=" * 62)
    print(" 결과: PASS %d / FAIL %d / WARN %d" % (len(OK), len(FAIL), len(WARN)))
    print("=" * 62)
    if FAIL:
        print("\n FAIL 이 있으면 압축을 다시 풀거나 배포자에게 알릴 것.")
    else:
        print("\n 정상. RUN.bat 을 더블클릭하면 된다(파이썬 불필요).")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
