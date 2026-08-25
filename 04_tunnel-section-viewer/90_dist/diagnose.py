# -*- coding: utf-8 -*-
"""배포판 자가진단 — 남의 PC 에서 "안 돌아요" 를 추측 없이 잡기 위한 스크립트.

검사: 파이썬 버전 / 인코딩 / 필수 파일 / 엔진 계산 / DXF 작성 / 포트 / 쓰기 권한.
결과는 화면과 진단결과.txt 에 동시에 남긴다(창이 닫혀도 파일이 남게).
"""
import io
import os
import socket
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE) if os.path.basename(HERE).lower() in ("90_dist", "tools") else HERE
LOG = []


def say(ok, name, msg=""):
    mark = "[ OK ]" if ok is True else ("[FAIL]" if ok is False else "[    ]")
    line = "%s %-22s %s" % (mark, name, msg)
    LOG.append(line)
    print(line)
    return ok


def main():
    say(None, "진단 시작", "폴더 = %s" % ROOT)

    v = sys.version_info
    say(v >= (3, 8), "파이썬 버전", "%d.%d.%d  (3.8 이상 필요)  %s" % (v[0], v[1], v[2], sys.executable))

    enc = (sys.stdout.encoding or "?")
    say(True, "콘솔 인코딩", "%s  (한글이 깨져 보여도 동작에는 지장 없음)" % enc)

    need = [
        os.path.join(ROOT, "04_engine", "section_engine.py"),
        os.path.join(ROOT, "04_engine", "report.py"),
        os.path.join(ROOT, "04_engine", "export.py"),
        os.path.join(ROOT, "05_web_viewer", "server.py"),
        os.path.join(ROOT, "05_web_viewer", "index.html"),
        os.path.join(ROOT, "05_web_viewer", "app.js"),
        os.path.join(ROOT, "05_web_viewer", "style.css"),
        os.path.join(ROOT, "03_data", "inputs_and_results.json"),
    ]
    miss = [os.path.relpath(p, ROOT) for p in need if not os.path.isfile(p)]
    say(not miss, "필수 파일", "%d/%d 존재%s" % (len(need) - len(miss), len(need),
                                            "" if not miss else "  누락: " + ", ".join(miss)))

    ok_engine = False
    try:
        sys.path.insert(0, os.path.join(ROOT, "04_engine"))
        import section_engine as E
        sec = E.build_section(dict(E.DEFAULT_PARAMS), -900, -2, 300, 100)
        ok_engine = abs(sec["R1"] - 6860) < 1e-6 and abs(sec["area_m2"] - 76.28) < 0.05
        say(ok_engine, "엔진 계산", "R1=%.0f 내공=%.2f㎡ 굴착=%.2f㎡  (기준값 R1 6860 / 76.28㎡)"
            % (sec["R1"], sec["area_m2"], sec["exc_m2"]))
    except Exception:                                          # noqa: BLE001
        say(False, "엔진 계산", "예외 발생 — 아래 상세")
        LOG.append(traceback.format_exc())
        print(traceback.format_exc())

    try:
        import export as X
        import tempfile
        sec2 = E.build_section(dict(E.DEFAULT_PARAMS), -900, -2, 300, 100)
        t = os.path.join(tempfile.gettempdir(), "_tn_diag.dxf")
        X.to_dxf(sec2, t)
        n = os.path.getsize(t)
        os.remove(t)
        say(n > 1000, "DXF 내보내기", "직접 작성 %d bytes (외부 라이브러리 불필요)" % n)
    except Exception as ex:                                    # noqa: BLE001
        say(False, "DXF 내보내기", str(ex))

    free = None
    for p in range(8801, 8821):
        # SO_REUSEADDR 은 켜지 않는다 — Windows 에서 사용 중 포트도 bind 되어 오판한다
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sk:
            try:
                sk.bind(("127.0.0.1", p))
                free = p
                break
            except OSError:
                continue
    say(free is not None, "포트", ("%d 사용 가능" % free) if free else "8801~8820 전부 사용 중")

    wr = True
    for d in ("07_report", "08_export"):
        try:
            os.makedirs(os.path.join(ROOT, d), exist_ok=True)
            t = os.path.join(ROOT, d, "_write_test.tmp")
            with io.open(t, "w", encoding="utf-8") as f:
                f.write("ok")
            os.remove(t)
        except Exception as ex:                                # noqa: BLE001
            wr = False
            say(False, "쓰기 권한", "%s : %s" % (d, ex))
    if wr:
        say(True, "쓰기 권한", "07_report / 08_export 생성·기록 가능")

    fails = [x for x in LOG if x.startswith("[FAIL]")]
    tail = "=" * 60
    LOG.append(tail)
    LOG.append("결과: %s" % ("정상 — RUN.bat 으로 실행하면 된다." if not fails
                           else "문제 %d건. 위 [FAIL] 줄을 그대로 전달할 것." % len(fails)))
    print(tail)
    print(LOG[-1])
    try:
        with io.open(os.path.join(ROOT, "CHECK_RESULT.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(LOG) + "\n")
        print("CHECK_RESULT.txt 에 저장했다. 문제가 있으면 이 파일을 그대로 전달할 것.")
    except Exception:                                          # noqa: BLE001
        pass
    return 1 if fails else 0


if __name__ == "__main__":
    for st in (sys.stdout, sys.stderr):
        try:
            st.reconfigure(encoding="utf-8", errors="replace")
        except Exception:                                      # noqa: BLE001
            pass
    sys.exit(main())
