# -*- coding: utf-8 -*-
"""설명서 도판 자동 촬영 — 화면이 바뀌면 이 스크립트를 다시 돌린다.

헤드리스 크롬으로 워크벤치를 열어 캡처하고 필요한 부분을 잘라 docs/img/ 에 넣는다.
손으로 찍지 않는 이유: UI 가 바뀌면 문서의 그림이 조용히 낡는다. 다시 돌릴 수 있어야 한다.

  python tools/make_guide_shots.py [--browser <chrome.exe 경로>]

크롬/엣지가 없으면 아무것도 하지 않고 종료한다(빌드를 막지 않는다).
"""
import argparse
import glob
import io
import os
import subprocess
import sys
import urllib.parse

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
IMG = os.path.join(ROOT, "docs", "img")
PAGE = os.path.join(ROOT, "web", "index.html")

W, H = 1600, 1000          # 촬영 창 크기 — 크롭 좌표가 여기에 묶인다

# (파일명, URL 질의, 크롭 상자 or None, 설명)
SHOTS = [
    ("01_overview", "", None, "실행 직후 전체 화면"),
    ("02_plan", "", (300, 40, 1180, 780), "평면 — 등고선·도로·장애물·선형"),
    ("03_terrain_panel", "", (1240, 75, 1600, 600), "지형 · 지형 변수 패널"),
    ("04_terrain_seed7", "", (330, 60, 1150, 760), "지형 시드 7 (기본)"),
    ("05_terrain_alt", "tgen=1&tsd=4242&tnp=5&tph=1.6&trd=40",
     (330, 60, 1150, 760), "산 5개·높이 1.6배·하천 40 m 로 재생성"),
    # 크롭 좌표는 CSS 에서 계산한다 — 좌영역 = 창폭 − 패널 360 − 스플리터 6 = 1234,
    # 종단 패널 높이 216 → 상단 y = 1000 − 216 = 784, 횡단 캔버스 폭 300 → x 934~1234.
    ("06_profile", "", (0, 784, 934, 1000), "종단면 — 지반고·계획고·절성토·터널/교량"),
    ("07_section", "", (934, 784, 1234, 1000), "횡단면 — 노면·비탈면·비탈끝"),
    ("08_struct_panel", "", (1240, 575, 1600, 905), "구조물 판정 · 설계기준 등록부"),
    ("09_gallery", "auto=1&sync=1&pop=20&gens=12&gallery=1", None, "최적화 후 대안 갤러리"),
]


def find_browser(explicit):
    if explicit and os.path.exists(explicit):
        return explicit
    pf = os.environ.get("ProgramFiles", r"C:\Program Files")
    pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    la = os.environ.get("LocalAppData", "")
    for p in [os.path.join(pf, r"Google\Chrome\Application\chrome.exe"),
              os.path.join(pf86, r"Google\Chrome\Application\chrome.exe"),
              os.path.join(la, r"Google\Chrome\Application\chrome.exe"),
              os.path.join(pf86, r"Microsoft\Edge\Application\msedge.exe"),
              os.path.join(pf, r"Microsoft\Edge\Application\msedge.exe")]:
        if os.path.exists(p):
            return p
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--browser", default=None)
    a = ap.parse_args()

    br = find_browser(a.browser)
    if not br:
        print("크롬/엣지를 찾지 못했다 — 도판 촬영을 건너뛴다(빌드는 계속된다).")
        return 0
    if not os.path.exists(PAGE):
        print("web/index.html 이 없다."); return 1

    os.makedirs(IMG, exist_ok=True)
    try:
        from PIL import Image
    except ImportError:
        Image = None
        print("Pillow 가 없어 크롭 없이 전체 화면만 저장한다.")

    url0 = "file:///" + urllib.parse.quote(os.path.abspath(PAGE).replace(os.sep, "/"))
    made = 0
    for name, q, crop, desc in SHOTS:
        raw = os.path.join(IMG, "_raw.png")
        url = url0 + ("?" + q if q else "")
        budget = "150000" if "auto=1" in q else ("40000" if "tgen" in q else "25000")
        r = subprocess.run(
            [br, "--headless=new", "--disable-gpu", "--hide-scrollbars",
             "--window-size=%d,%d" % (W, H), "--screenshot=" + raw,
             "--virtual-time-budget=" + budget, url],
            capture_output=True, text=True, encoding="utf-8", errors="replace")
        if not os.path.exists(raw):
            print("  실패: %s (%s)" % (name, (r.stderr or "")[:90])); continue
        out = os.path.join(IMG, name + ".png")
        if crop and Image:
            im = Image.open(raw).convert("RGB")
            sx, sy = im.width / W, im.height / H       # DPR 보정
            bx = (int(crop[0] * sx), int(crop[1] * sy), int(crop[2] * sx), int(crop[3] * sy))
            im.crop(bx).save(out)
        else:
            os.replace(raw, out)
        if os.path.exists(raw):
            os.remove(raw)
        print("  %-20s %-46s %6.1f KB" % (name + ".png", desc, os.path.getsize(out) / 1024))
        made += 1

    for f in glob.glob(os.path.join(IMG, "_raw*")):
        os.remove(f)
    print("도판 %d장 → docs/img/" % made)
    return 0


if __name__ == "__main__":
    sys.exit(main())
