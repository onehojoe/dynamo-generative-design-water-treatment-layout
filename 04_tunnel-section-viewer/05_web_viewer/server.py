# -*- coding: utf-8 -*-
"""내공단면 뷰어 서버 (포트 8801) — 3번 portal_viewer(8799)와 분리 운영."""
import json
import os
import sys
import io
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "04_engine"))
import section_engine as E          # noqa: E402
import report as RP                 # noqa: E402
import export as XP                 # noqa: E402
import time

LATEST_REPORT = {"html": None, "file": None}
OUTDIR = os.path.join(ROOT, "07_report")
EXPDIR = os.path.join(ROOT, "08_export")
# 설명서는 배포판에서 docs/, 개발트리에서 06_docs/ 에 있다
DOCDIR = next((d for d in (os.path.join(ROOT, "docs"), os.path.join(ROOT, "06_docs"))
               if os.path.isdir(d)), os.path.join(ROOT, "docs"))

PORT_DEFAULT = 8801
LEGACY = os.path.join(ROOT, "03_data", "inputs_and_results.json")


def load_legacy():
    try:
        with io.open(LEGACY, encoding="utf-8") as f:
            d = json.load(f)
        return {"rows": d.get("result_최적단면검토", []),
                "short": d.get("result_최소단면리스트", []),
                "input4": d.get("Input4_부대공", {})}
    except Exception as ex:                                   # noqa: BLE001
        return {"rows": [], "short": [], "error": str(ex)}


def pick_port(start=PORT_DEFAULT, tries=20):
    """포트가 물려 있으면 다음 번호로 옮긴다 — 남의 PC 에서 8801 이 비어 있으리란 보장이 없다."""
    import socket
    for i in range(tries):
        p = start + i
        # ★SO_REUSEADDR 을 켜면 Windows 에서는 이미 쓰는 포트에도 bind 가 성공한다.
        #   그래서 여기서는 절대 켜지 않는다(켜면 사용 중 포트를 빈 것으로 오판).
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sk:
            try:
                sk.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    return None


class Server(ThreadingHTTPServer):
    allow_reuse_address = False        # 같은 포트 이중 기동 방지(위와 같은 이유)
    daemon_threads = True


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    def _json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}

    def do_POST(self):
        try:
            if self.path.startswith("/api/section"):
                q = self._body()
                P = dict(E.DEFAULT_PARAMS)
                P.update(q.get("params") or {})
                sec = E.build_section(P, float(q["cc"]), float(q["s"]), float(q["EL1"]),
                                      float(q["theta"]), float(q.get("tol", 50)),
                                      float(q.get("grid", 5)),
                                      bool(q.get("bind_walk")), bool(q.get("bind_jet")))
                sec["judge"] = E.judge(sec, float(q.get("flat_min", 0.55)),
                                       float(q.get("margin_min", 50)))
                # 제약을 끈 상태에서도 화면에는 보여준다(표시 전용 = binding False)
                if q.get("show_walk") and not q.get("bind_walk"):
                    sec["extras"] += [dict(e, binding=False) for e in
                                      E.extra_shapes(P, float(q["cc"]), float(q["s"]) / 100.0, True, False)]
                if q.get("show_jet") and not q.get("bind_jet"):
                    sec["extras"] += [dict(e, binding=False) for e in
                                      E.extra_shapes(P, float(q["cc"]), float(q["s"]) / 100.0, False, True)]
                return self._json(sec)

            if self.path.startswith("/api/report"):
                q = self._body()
                P = dict(E.DEFAULT_PARAMS)
                P.update(q.get("params") or {})
                sec = E.build_section(P, float(q["cc"]), float(q["s"]), float(q["EL1"]),
                                      float(q["theta"]), float(q.get("tol", 50)),
                                      float(q.get("grid", 5)),
                                      bool(q.get("bind_walk")), bool(q.get("bind_jet")))
                jd = E.judge(sec, float(q.get("flat_min", 0.55)), float(q.get("margin_min", 50)))
                meta = dict(load_legacy().get("input4") or {})
                meta = {"project": (meta.get("project") or "-").strip(),
                        "tunnel": (meta.get("tunnel") or "-").strip(),
                        "section": (meta.get("section") or "-").strip(),
                        "date": time.strftime("%Y-%m-%d %H:%M")}
                htm = RP.build(sec, jd, P, q, meta, q.get("rows"))
                os.makedirs(OUTDIR, exist_ok=True)
                fn = time.strftime("검토보고서_%y%m%d_%H%M.html")
                with io.open(os.path.join(OUTDIR, fn), "w", encoding="utf-8") as f:
                    f.write(htm)
                LATEST_REPORT["html"] = htm
                LATEST_REPORT["file"] = fn
                return self._json({"file": fn, "url": "/report/latest",
                                   "dir": os.path.relpath(OUTDIR, ROOT)})

            if self.path.startswith("/api/export"):
                q = self._body()
                kind = (q.get("kind") or "dxf").lower()
                P = dict(E.DEFAULT_PARAMS)
                P.update(q.get("params") or {})
                os.makedirs(EXPDIR, exist_ok=True)
                stamp = time.strftime("%y%m%d_%H%M%S")
                if kind == "csv":
                    rows = q.get("rows") or []
                    if not rows:
                        return self._json({"error": "스윕 결과가 없다. 먼저 스윕을 실행할 것."}, 400)
                    fn = "스윕결과_%s.csv" % stamp
                    XP.to_csv(rows, os.path.join(EXPDIR, fn))
                else:
                    sec = E.build_section(P, float(q["cc"]), float(q["s"]), float(q["EL1"]),
                                          float(q["theta"]), float(q.get("tol", 50)),
                                          float(q.get("grid", 5)),
                                          bool(q.get("bind_walk")), bool(q.get("bind_jet")))
                    if kind == "json":
                        fn = "단면_%s.json" % stamp
                        XP.to_json(sec, P, q, os.path.join(EXPDIR, fn))
                    else:
                        fn = "단면_%s.dxf" % stamp
                        XP.to_dxf(sec, os.path.join(EXPDIR, fn))
                return self._json({"file": fn, "url": "/export/" + fn,
                                   "dir": os.path.relpath(EXPDIR, ROOT)})

            if self.path.startswith("/api/sweep"):
                q = self._body()
                P = dict(E.DEFAULT_PARAMS)
                P.update(q.get("params") or {})
                sw = q.get("sweep") or E.DEFAULT_SWEEP
                rows, shape = E.sweep(P, sw, float(q.get("tol", 50)), float(q.get("grid", 5)),
                                      float(q.get("flat_min", 0.55)), float(q.get("margin_min", 50)),
                                      use_walk=bool(q.get("bind_walk")), use_jet=bool(q.get("bind_jet")))
                return self._json({"rows": rows, "shape": shape, "n": len(rows)})
        except Exception as ex:                               # noqa: BLE001
            import traceback
            return self._json({"error": str(ex), "trace": traceback.format_exc()}, 500)
        self.send_error(404)

    def do_GET(self):
        if self.path.startswith("/report/latest"):
            if not LATEST_REPORT["html"]:
                return self._json({"error": "보고서가 아직 생성되지 않았다"}, 404)
            b = LATEST_REPORT["html"].encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(b)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(b)
            return
        if self.path.startswith("/docs/"):
            import urllib.parse
            rel = urllib.parse.unquote(self.path[len("/docs/"):]).split("?")[0]
            fp = os.path.normpath(os.path.join(DOCDIR, rel))
            if not fp.startswith(os.path.normpath(DOCDIR)) or not os.path.isfile(fp):
                return self._json({"error": "문서 없음: %s" % rel}, 404)
            ct = {".html": "text/html; charset=utf-8", ".md": "text/plain; charset=utf-8",
                  ".png": "image/png", ".svg": "image/svg+xml"}.get(
                os.path.splitext(fp)[1].lower(), "application/octet-stream")
            b = io.open(fp, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", ct)
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
            return
        if self.path.startswith("/export/"):
            import urllib.parse
            name = os.path.basename(urllib.parse.unquote(self.path[len("/export/"):]))
            fp = os.path.join(EXPDIR, name)
            if not os.path.isfile(fp):
                return self._json({"error": "파일 없음: %s" % name}, 404)
            b = io.open(fp, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(b)))
            self.send_header("Content-Disposition",
                             "attachment; filename*=UTF-8''" + urllib.parse.quote(name))
            self.end_headers()
            self.wfile.write(b)
            return
        if self.path.startswith("/api/legacy"):
            return self._json(load_legacy())
        if self.path.startswith("/api/defaults"):
            return self._json({"params": E.DEFAULT_PARAMS, "sweep": E.DEFAULT_SWEEP})
        if self.path.startswith("/api/env"):
            return self._json({"python": sys.version.split()[0],
                               "dxf": True, "ezdxf": XP.have_ezdxf(),
                               "legacy_rows": len(load_legacy().get("rows") or []),
                               "port": getattr(self.server, "server_port", None)})
        return super().do_GET()


if __name__ == "__main__":
    # 콘솔 인코딩(cp949) 때문에 죽지 않게 — 남의 PC 배포 함정 1번
    for st in (sys.stdout, sys.stderr):
        try:
            st.reconfigure(encoding="utf-8", errors="replace")
        except Exception:                                     # noqa: BLE001
            pass
    os.chdir(HERE)
    want = PORT_DEFAULT
    for a in sys.argv[1:]:
        if a.isdigit():
            want = int(a)
    port = pick_port(want)
    if port is None:
        print("[오류] %d~%d 포트가 전부 사용 중이다. 다른 프로그램을 닫거나 RUN.bat 에 포트를 지정할 것."
              % (want, want + 19))
        sys.exit(2)
    print("=" * 64)
    print(" NATM 내공단면 뷰어   http://localhost:%d/" % port)
    if port != want:
        print(" (%d 번이 사용 중이라 %d 번으로 옮겼다)" % (want, port))
    print(" python %s / 원본참조 %d행 / 내보내기 DXF·JSON·CSV 모두 사용 가능"
          % (sys.version.split()[0], len(load_legacy().get("rows") or [])))
    print(" 종료: 이 창에서 Ctrl+C  또는 창 닫기")
    print("=" * 64)
    url = "http://localhost:%d/" % port
    if "noopen" not in sys.argv:
        import threading
        import webbrowser
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    srv = Server(("127.0.0.1", port), H)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print(chr(10) + "종료합니다.")
    finally:
        srv.server_close()
