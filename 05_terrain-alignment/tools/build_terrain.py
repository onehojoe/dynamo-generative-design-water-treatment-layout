# -*- coding: utf-8 -*-
"""지형 생성기 — site.json → data/terrain.json

  ① 대지 경계 — 기본 bbox(직사각형). 도로망 외곽 모드도 남겨 둔다(--boundary road)
     ★260825 결정: 대지 외곽을 도로망 형상으로 따지 않고 BBOX 직사각형으로 — 합성 지형에
       유기적 외곽은 의미가 없고, 시·종점이 대지 밖으로 빠지는 부작용만 생겼다.
  ② 지형 필드 z(x,y) = 기저경사 + 산(가우시안) − 하천 절개 + fBm 노이즈
  ③ 등고선 = 필드에서 추출 (정본)

원본 site.json 에는 Z 가 없다. 지형은 전량 합성이며 실제 지형과 무관하다.
사용: python 20_TOOLS/build_terrain.py [--cell 20] [--interval 5]
"""
import argparse, json, os, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import numpy as np
from scipy import ndimage


def _find_wb(here):
    """data 폴더를 가진 워크벤치 루트를 찾는다.
    tools/ 안에 있든(배포본) 별도 20_TOOLS 에 있든(개발본) 둘 다 동작해야 한다."""
    import os as _os
    cand = [_os.path.dirname(here),                                   # tools/ → 워크벤치
            _os.path.join(_os.path.dirname(here), "10_WORKBENCH")]    # 20_TOOLS/ → 워크벤치
    for c in cand:
        if _os.path.isdir(_os.path.join(c, "data")):
            return c
    return cand[0]

HERE = os.path.dirname(os.path.abspath(__file__))
WB = _find_wb(HERE)
ROOT = os.path.dirname(WB)
SITE = os.path.join(WB, "data", "site.json")
OUT = os.path.join(WB, "data", "terrain.json")

# ── 지형 변수 (1단 GD 변수. 뷰어 슬라이더가 이 값을 바꾼다) ────────────────
PARAMS = {
    "base_el": 80.0,            # 기준표고 m — bbox 확대로 하천 절개가 깊어져 음수가 나와 올려 잡았다
    "slope_dir_deg": 210.0,     # 전체 경사 방향
    "slope_pct": 0.8,           # 전체 경사율 %
    "peaks": [                  # (u, v, 높이 m, 반경 m, 첨예도)
        [0.28, 0.72, 95.0, 900.0, 1.7],
        [0.74, 0.30, 70.0, 1100.0, 1.4],
        [0.55, 0.86, 45.0, 700.0, 2.1],
    ],
    "river": [[0.06, 0.92], [0.30, 0.62], [0.44, 0.40], [0.62, 0.24], [0.90, 0.06]],
    "river_depth": 22.0,
    "river_width": 260.0,
    "noise_amp": 7.0,
    "noise_octaves": 4,
    "seed": 7,
}
CLOSE_M, OPEN_M = 450.0, 80.0


def rasterize(tris, x0, y0, cell, nx, ny, X, Y):
    occ = np.zeros((ny, nx), dtype=bool)
    for t in tris:
        p = np.asarray(t, dtype=float)
        if len(p) < 3:
            continue
        i0 = max(0, int((p[:, 0].min() - x0) / cell))
        i1 = min(nx - 1, int((p[:, 0].max() - x0) / cell) + 1)
        j0 = max(0, int((p[:, 1].min() - y0) / cell))
        j1 = min(ny - 1, int((p[:, 1].max() - y0) / cell) + 1)
        if i1 < i0 or j1 < j0:
            continue
        A, B = np.meshgrid(X[i0:i1 + 1], Y[j0:j1 + 1])
        a, b, c = p[0], p[1], p[2]
        v0, v1 = b - a, c - a
        den = v0[0] * v1[1] - v1[0] * v0[1]
        if abs(den) < 1e-9:
            continue
        wx, wy = A - a[0], B - a[1]
        s = (wx * v1[1] - v1[0] * wy) / den
        tt = (v0[0] * wy - wx * v0[1]) / den
        occ[j0:j1 + 1, i0:i1 + 1] |= (s >= 0) & (tt >= 0) & (s + tt <= 1)
    return occ


def disk(radius_m, cell):
    r = max(1, int(radius_m / cell))
    yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
    return xx * xx + yy * yy <= r * r


def fbm(shape, octaves, seed):
    rng = np.random.default_rng(seed)
    out = np.zeros(shape)
    amp, freq = 1.0, 2
    for _ in range(octaves):
        small = rng.normal(size=(max(2, freq), max(2, freq)))
        z = ndimage.zoom(small, (shape[0] / small.shape[0], shape[1] / small.shape[1]), order=3)
        out += amp * z[:shape[0], :shape[1]]
        amp *= 0.5
        freq *= 2
    return out / max(1e-9, np.abs(out).max())


def trace_rings(mask, X, Y):
    """경계 마스크 → 닫힌 링 좌표. marching squares 를 0.5 레벨에 적용."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig = plt.figure()
    cs = fig.gca().contour(X, Y, mask.astype(float), levels=[0.5])
    rings = [np.asarray(s).tolist() for segs in cs.allsegs for s in segs if len(s) >= 4]
    plt.close(fig)
    rings.sort(key=len, reverse=True)
    return rings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cell", type=float, default=20.0)
    ap.add_argument("--interval", type=float, default=5.0)
    ap.add_argument("--boundary", choices=["bbox", "road"], default="bbox")
    ap.add_argument("--margin", type=float, default=150.0, help="bbox 여유 m")
    a = ap.parse_args()

    d = json.load(open(SITE, encoding="utf-8"))
    bx0, by0, bx1, by1 = d["bounds"]
    # 시·종점을 반드시 대지 안에 넣는다 — 밖으로 나가면 토공 계산이 비어 버린다
    xs = [bx0, bx1, d["start"][0], d["end"][0]]
    ys = [by0, by1, d["start"][1], d["end"][1]]
    mg = a.margin
    x0, y0 = min(xs) - mg, min(ys) - mg
    x1, y1 = max(xs) + mg, max(ys) + mg
    cell = a.cell
    nx, ny = int((x1 - x0) / cell) + 1, int((y1 - y0) / cell) + 1
    X = x0 + (np.arange(nx) + 0.5) * cell
    Y = y0 + (np.arange(ny) + 0.5) * cell
    GX, GY = np.meshgrid(X, Y)

    # ① 경계
    if a.boundary == "bbox":
        site = np.ones((ny, nx), dtype=bool)
        boundary = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
        bmode = "bbox 직사각형 (여유 %.0f m)" % mg
    else:
        road = rasterize(d["road"], x0, y0, cell, nx, ny, X, Y)
        g = ndimage.binary_closing(road, structure=disk(CLOSE_M, cell))
        g = ndimage.binary_fill_holes(g)
        lab, n = ndimage.label(g)
        if n > 1:
            sizes = ndimage.sum(g, lab, range(1, n + 1))
            g = lab == (int(np.argmax(sizes)) + 1)
        site = ndimage.binary_opening(g, structure=disk(OPEN_M, cell))
        rings = trace_rings(site, X, Y)
        boundary = rings[0] if rings else []
        bmode = "도로망 외곽 (닫힘 %.0f / 정리 %.0f m)" % (CLOSE_M, OPEN_M)
    site_area = site.sum() * cell * cell

    # ② 필드
    P = PARAMS
    th = np.deg2rad(P["slope_dir_deg"])
    Z = P["base_el"] + (np.cos(th) * (GX - x0) + np.sin(th) * (GY - y0)) * P["slope_pct"] / 100.0
    for u, v, h, rad, sharp in P["peaks"]:
        px, py = x0 + u * (x1 - x0), y0 + v * (y1 - y0)
        Z += h * np.exp(-((np.hypot(GX - px, GY - py) / rad) ** 2) * sharp)
    pts = np.array([[x0 + u * (x1 - x0), y0 + v * (y1 - y0)] for u, v in P["river"]])
    dmin = np.full(GX.shape, np.inf)
    for i in range(len(pts) - 1):
        p, q = pts[i], pts[i + 1]
        ab = q - p
        t = np.clip(((GX - p[0]) * ab[0] + (GY - p[1]) * ab[1]) / (ab @ ab), 0, 1)
        dmin = np.minimum(dmin, np.hypot(GX - (p[0] + t * ab[0]), GY - (p[1] + t * ab[1])))
    Z -= P["river_depth"] * np.exp(-(dmin / P["river_width"]) ** 2)
    Z += P["noise_amp"] * fbm(GX.shape, P["noise_octaves"], P["seed"])

    Zin = np.where(site, Z, np.nan)
    zmin, zmax = float(np.nanmin(Zin)), float(np.nanmax(Zin))

    # ③ 등고선
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    iv = a.interval
    lo = np.floor(zmin / iv) * iv
    hi = np.ceil(zmax / iv) * iv
    levels = np.arange(lo, hi + iv, iv)
    fig = plt.figure()
    cs = fig.gca().contour(GX, GY, Zin, levels=levels)
    contours = []
    nvert = 0
    for lv, segs in zip(cs.levels, cs.allsegs):
        rr = [np.round(np.asarray(s), 2).tolist() for s in segs if len(s) >= 2]
        nvert += sum(len(s) for s in rr)
        if rr:
            contours.append({"el": float(lv), "rings": rr})
    plt.close(fig)

    out = {
        "mode": "procedural",
        "params": PARAMS,
        "boundary": [[round(p[0], 2), round(p[1], 2)] for p in boundary],
        "grid": {
            "x0": x0, "y0": y0, "cell": cell, "nx": nx, "ny": ny,
            "z": [round(float(v), 3) for v in np.where(site, Z, np.nan).ravel(order="C")],
        },
        "contours": contours,
        "meta": {
            "interval": iv, "datum": "local", "crs": None,
            "z_min": round(zmin, 2), "z_max": round(zmax, 2),
            "site_area_m2": round(float(site_area), 1),
            "boundary_mode": a.boundary, "boundary_note": bmode,
            "source": "site.json 범위 + 절차적 지형(합성)",
            "honest": "원본에 Z 없음 — 지형은 전량 합성이며 실제 지형과 무관",
        },
    }
    # NaN 은 JSON 표준이 아니다 → null 로
    out["grid"]["z"] = [None if (v != v) else v for v in out["grid"]["z"]]
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    print(f"격자 {nx}×{ny} @ {cell:.0f} m")
    print(f"대지 경계 [{bmode}] 링 {len(boundary):,}점 · 면적 {site_area/1e6:,.2f} km²")
    print(f"범위 x {x0:,.0f}~{x1:,.0f} · y {y0:,.0f}~{y1:,.0f} "
          f"({(x1-x0):,.0f} × {(y1-y0):,.0f} m) — 시·종점 포함")
    print(f"표고 {zmin:.1f} ~ {zmax:.1f} m (기복 {zmax-zmin:.1f} m)")
    print(f"등고선 {len(contours)}레벨 (EL {lo:.0f}~{hi:.0f}, 간격 {iv:.0f} m) · 정점 {nvert:,}")
    print(f"저장 {OUT}  ({os.path.getsize(OUT)/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
