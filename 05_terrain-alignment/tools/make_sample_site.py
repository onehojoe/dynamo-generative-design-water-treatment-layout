# -*- coding: utf-8 -*-
"""공개 배포용 «합성 부지» 생성 — 실제 프로젝트 데이터를 대신한다.

왜 필요한가: 원본 `site.json` 은 실제 프로젝트의 도로·구조물 배치다.
공개 리포에는 올릴 수 없다. 그런데 도구는 부지 데이터가 있어야 돌아간다.
→ 같은 스키마로 «있을 법한» 부지를 만들어 넣는다. 특정 시설을 나타내지 않는다.

만드는 것 (site.json 과 동일 스키마 · 단위 m)
  road            격자형 도로망 + 사행 간선 → 폭을 가진 띠를 삼각형으로
  obstacle        건물 블록 (사각형 → 삼각형 2장)
  obstacle_extra  보전구역 같은 큰 다각형
  start / end     선형 시·종점
  bounds          전체 범위

사용: python tools/make_sample_site.py [--seed 11] [--out data/site.json]
"""
import argparse
import io
import json
import math
import os
import random
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
WB = os.path.dirname(HERE)

W, H = 5200.0, 6800.0          # 부지 폭·높이 (m)
X0, Y0 = -W / 2, -H / 2


def strip(pts, width, out):
    """폴리라인 → 폭을 가진 띠 → 삼각형 2장씩"""
    for i in range(len(pts) - 1):
        (x1, y1), (x2, y2) = pts[i], pts[i + 1]
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L * width / 2, dx / L * width / 2
        a = [x1 + nx, y1 + ny]; b = [x2 + nx, y2 + ny]
        c = [x2 - nx, y2 - ny]; d = [x1 - nx, y1 - ny]
        out.append([a, b, c])
        out.append([a, c, d])


def box(cx, cy, w, h, rot, out):
    ca, sa = math.cos(rot), math.sin(rot)
    p = []
    for ox, oy in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
        p.append([cx + ox * ca - oy * sa, cy + ox * sa + oy * ca])
    out.append([p[0], p[1], p[2]])
    out.append([p[0], p[2], p[3]])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--out", default=os.path.join(WB, "data", "site.json"))
    a = ap.parse_args()
    rnd = random.Random(a.seed)

    road, obs, extra = [], [], []

    # 간선 2개 — 완만한 사행
    for k, (base, amp, wid) in enumerate([(-0.22, 420, 34), (0.30, 300, 26)]):
        pts = []
        for t in range(0, 41):
            u = t / 40
            x = X0 + W * u
            y = Y0 + H * (0.5 + base) + amp * math.sin(u * math.pi * 1.7 + k)
            pts.append((x, y))
        strip(pts, wid, road)

    # 격자 지선
    for i in range(1, 7):
        x = X0 + W * i / 7
        strip([(x, Y0 + H * 0.12), (x + rnd.uniform(-90, 90), Y0 + H * 0.88)], 14, road)
    for j in range(1, 8):
        y = Y0 + H * j / 8
        strip([(X0 + W * 0.10, y), (X0 + W * 0.90, y + rnd.uniform(-70, 70))], 12, road)

    # 하천을 낀 사선 진입로
    strip([(X0 + W * 0.06, Y0 + H * 0.92), (X0 + W * 0.42, Y0 + H * 0.55),
           (X0 + W * 0.70, Y0 + H * 0.28), (X0 + W * 0.94, Y0 + H * 0.08)], 20, road)

    # 건물 블록
    for _ in range(140):
        cx = X0 + W * rnd.uniform(0.10, 0.90)
        cy = Y0 + H * rnd.uniform(0.10, 0.90)
        w = rnd.uniform(24, 90); h = rnd.uniform(18, 70)
        box(cx, cy, w, h, rnd.uniform(0, math.pi), obs)

    # 군집(취락) 3곳
    for _ in range(3):
        gx = X0 + W * rnd.uniform(0.15, 0.85)
        gy = Y0 + H * rnd.uniform(0.15, 0.85)
        for _ in range(22):
            box(gx + rnd.uniform(-260, 260), gy + rnd.uniform(-260, 260),
                rnd.uniform(14, 40), rnd.uniform(12, 34), rnd.uniform(0, math.pi), obs)

    # 보전구역 2곳 (큰 다각형)
    for cx, cy, r in ((X0 + W * 0.30, Y0 + H * 0.42, 520), (X0 + W * 0.66, Y0 + H * 0.70, 380)):
        n = 11
        ring = [[cx + r * (0.6 + 0.4 * rnd.random()) * math.cos(2 * math.pi * i / n),
                 cy + r * (0.6 + 0.4 * rnd.random()) * math.sin(2 * math.pi * i / n)]
                for i in range(n)]
        for i in range(1, n - 1):
            extra.append([ring[0], ring[i], ring[i + 1]])

    rnd2 = 2
    R = lambda v: round(v, rnd2)
    conv = lambda tris: [[[R(p[0]), R(p[1])] for p in t] for t in tris]

    xs = [p[0] for t in road + obs + extra for p in t]
    ys = [p[1] for t in road + obs + extra for p in t]

    site = {
        "obstacle": conv(obs),
        "obstacle_extra": conv(extra),
        "road": conv(road),
        "start": [R(X0 + W * 0.04), R(Y0 + H * 0.93), 0.0],
        "end": [R(X0 + W * 0.96), R(Y0 + H * 0.07), 0.0],
        "bounds": [R(min(xs)), R(min(ys)), R(max(xs)), R(max(ys))],
        "units": {"model_units_per_meter": 1.0},
        "source": "합성 샘플 (tools/make_sample_site.py, seed=%d) — 특정 시설을 나타내지 않는다" % a.seed,
    }
    json.dump(site, io.open(a.out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("합성 부지 생성 — 도로 %d · 장애물 %d · 추가장애물 %d 삼각형"
          % (len(road), len(obs), len(extra)))
    print("범위 %.0f × %.0f m · start %s · end %s"
          % (site["bounds"][2] - site["bounds"][0], site["bounds"][3] - site["bounds"][1],
             site["start"][:2], site["end"][:2]))
    print("저장 %s (%.2f MB)" % (a.out, os.path.getsize(a.out) / 1e6))
    print("\n다음: python tools/build_terrain.py  →  python tools/pack_data.py")


if __name__ == "__main__":
    main()
