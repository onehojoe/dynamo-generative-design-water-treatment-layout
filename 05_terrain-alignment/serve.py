# -*- coding: utf-8 -*-
"""KH 선형 GD 워크벤치 — 로컬 서버.

  python serve.py            기본 포트(8811)부터 빈 포트를 찾아 띄우고 브라우저를 연다
  python serve.py 9000       포트 지정
  python serve.py 9000 --no-open   브라우저 안 열기

외부로 나가지 않는다. 127.0.0.1 에만 바인딩한다.
"""
import sys

# ── 버전 가드 ──────────────────────────────────────────────
# SimpleHTTPRequestHandler(directory=...) 는 Python 3.7+ 에서만 된다.
# 가드가 없으면 알아보기 힘든 TypeError 로 죽는다.
if sys.version_info < (3, 7):
    sys.stderr.write(
        "\n[오류] Python 3.7 이상이 필요합니다.\n"
        "       현재 버전: %s\n\n"
        "       https://www.python.org/downloads/ 에서 최신 Python 3 를 설치하고\n"
        "       설치 화면에서 \"Add Python to PATH\" 를 체크하세요.\n\n"
        % sys.version.split()[0])
    try:
        input("Enter 를 누르면 종료합니다...")
    except Exception:
        pass
    sys.exit(1)

import os, socket, threading, webbrowser
import http.server
import socketserver

ROOT = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PORT = 8811
TRIES = 20


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        # 개발 중 캐시 때문에 옛 JS가 남는 사고를 막는다
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def guess_type(self, path):
        t = super().guess_type(path)
        # 한글이 깨지지 않도록 텍스트 계열엔 charset 명시
        if t in ("application/json", "text/html", "text/css", "application/javascript",
                 "text/javascript", "text/plain", "text/markdown"):
            return t + "; charset=utf-8"
        return t

    def log_message(self, fmt, *args):
        pass  # 조용히


def free_port(start):
    for p in range(start, start + TRIES):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    return None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    want = int(args[0]) if args else DEFAULT_PORT
    do_open = "--no-open" not in sys.argv

    # 필수 파일 점검 — 없으면 화면이 비어 나오므로 여기서 잡는다
    need = ["web/index.html", "web/js/app.js", "data/site.json"]
    missing = [n for n in need if not os.path.exists(os.path.join(ROOT, n.replace("/", os.sep)))]
    if missing:
        print("[오류] 필수 파일이 없습니다:")
        for m in missing:
            print("   -", m)
        print("\n압축을 푼 폴더 안에서 실행했는지 확인하세요.")
        input("\nEnter 를 누르면 종료합니다...")
        return 1

    port = free_port(want)
    if port is None:
        print("[오류] %d~%d 포트가 모두 사용 중입니다." % (want, want + TRIES - 1))
        input("\nEnter 를 누르면 종료합니다...")
        return 1

    url = "http://127.0.0.1:%d/web/index.html" % port
    if port != want:
        print("[알림] %d 포트가 사용 중이라 %d 로 띄웁니다." % (want, port))

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", port), Handler)

    print("=" * 58)
    print("  KH 선형 GD 워크벤치")
    print("  " + url)
    print("=" * 58)
    print("  창을 닫거나 Ctrl+C 를 누르면 종료됩니다.")
    print("  화면이 옛날 것으로 보이면 Ctrl+F5 (강력 새로고침).")
    sys.stdout.flush()

    if do_open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n종료합니다.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
