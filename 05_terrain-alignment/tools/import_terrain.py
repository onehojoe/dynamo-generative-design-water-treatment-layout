# -*- coding: utf-8 -*-
"""외부 지형 파일 → data/terrain.json (합성 지형을 실지형으로 갈아끼운다)

지원 형식
  .asc / .txt   ESRI ASCII Grid (ncols nrows xllcorner yllcorner cellsize NODATA_value)
  .xyz / .csv   점군 (x y z 또는 x,y,z). 헤더 있으면 자동 건너뜀
  .xml          LandXML — <Pnts>/<P> 점 + <Faces>/<F> 면 (TIN Surface)
  .dxf          등고선 폴리라인 (LWPOLYLINE/POLYLINE 의 elevation 또는 정점 Z)

출력은 build_terrain.py 와 동일한 계약(terrain.json)이라 뷰어·GD·애드인이 그대로 돈다.
  { mode:"file", boundary, grid{x0,y0,cell,nx,ny,z[]}, contours[{el,rings}], meta }

사용:
  python 20_TOOLS/import_terrain.py <파일> [--cell 20] [--interval 5]
                                    [--clip site]   대지(site.json bounds)로 자르기
                                    [--out data/terrain.json]

★ 좌표계 변환은 하지 않는다. 파일의 좌표가 site.json 과 같은 계라고 가정한다.
  다르면 meta.crs 에 적고 사전에 변환해서 넣을 것 — 여기서 추측하지 않는다.
"""
import argparse, json, os, re, sys, io, math

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import numpy as np


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


# ────────────────────────────────────────────────────────────── 읽기
def read_asc(path):
    """ESRI ASCII Grid → (points ndarray Nx3, header dict)"""
    hdr, vals = {}, []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            t = line.split()
            if not t:
                continue
            k = t[0].lower()
            if k in ("ncols", "nrows", "xllcorner", "yllcorner", "xllcenter",
                     "yllcenter", "cellsize", "nodata_value") and len(t) >= 2:
                hdr[k] = float(t[1])
            else:
                vals.extend(float(x) for x in t)
    n, m = int(hdr["ncols"]), int(hdr["nrows"])
    cs = hdr["cellsize"]
    x0 = hdr.get("xllcorner", hdr.get("xllcenter", 0.0))
    y0 = hdr.get("yllcorner", hdr.get("yllcenter", 0.0))
    nod = hdr.get("nodata_value", -9999.0)
    z = np.array(vals[: n * m], dtype=float).reshape(m, n)
    z = np.where(np.isclose(z, nod), np.nan, z)
    z = z[::-1, :]                                     # ASC 는 위에서 아래로 쓴다
    xs = x0 + (np.arange(n) + 0.5) * cs
    ys = y0 + (np.arange(m) + 0.5) * cs
    GX, GY = np.meshgrid(xs, ys)
    ok = ~np.isnan(z)
    pts = np.column_stack([GX[ok], GY[ok], z[ok]])
    return pts, "ESRI ASCII Grid %dx%d @ %.2f" % (n, m, cs)


def read_xyz(path):
    pts = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            t = re.split(r"[,\s;]+", line.strip())
            t = [x for x in t if x]
            if len(t) < 3:
                continue
            try:
                pts.append([float(t[0]), float(t[1]), float(t[2])])
            except ValueError:
                continue                               # 헤더 줄
    return np.asarray(pts, dtype=float), "점군 %d점" % len(pts)


def read_landxml(path):
    import xml.etree.ElementTree as ET
    root = ET.parse(path).getroot()
    ns = {"l": root.tag.split("}")[0].strip("{")} if "}" in root.tag else {}
    def find(tag):
        return root.iter("{%s}%s" % (ns["l"], tag)) if ns else root.iter(tag)
    pts = []
    for p in find("P"):
        t = (p.text or "").split()
        if len(t) >= 3:
            # LandXML 은 보통 "북(Y) 동(X) 표고" 순서다
            pts.append([float(t[1]), float(t[0]), float(t[2])])
    return np.asarray(pts, dtype=float), "LandXML %d점" % len(pts)


def read_dxf_contours(path):
    """등고선 폴리라인 — LWPOLYLINE 의 elevation(38) 또는 정점 Z(30)"""
    pts = []
    try:
        import ezdxf
    except ImportError:
        raise SystemExit("ezdxf 가 필요하다:  pip install ezdxf")
    doc = ezdxf.readfile(path)
    for sp in (doc.modelspace(), *[l for l in doc.layouts if l.name != "Model"]):
        for e in sp:
            t = e.dxftype()
            if t == "LWPOLYLINE":
                el = float(getattr(e.dxf, "elevation", 0.0) or 0.0)
                for x, y, *_ in e.get_points("xy"):
                    pts.append([x, y, el])
            elif t == "POLYLINE":
                for v in e.vertices:
                    p = v.dxf.location
                    pts.append([p.x, p.y, p.z])
            elif t in ("LINE",):
                for p in (e.dxf.start, e.dxf.end):
                    pts.append([p.x, p.y, p.z])
        break                                           # modelspace 만
    return np.asarray(pts, dtype=float), "DXF 등고선 %d정점" % len(pts)


READERS = {".asc": read_asc, ".txt": read_asc, ".xyz": read_xyz, ".csv": read_xyz,
           ".xml": read_landxml, ".dxf": read_dxf_contours}


# ────────────────────────────────────────────────────── 격자화 · 등고선
def to_grid(pts, x0, y0, x1, y1, cell):
    """점군 → 정규격자. 셀 평균 후 빈 셀은 최근접 유효값으로 채운다(외삽 표시 반환)."""
    nx = int((x1 - x0) / cell) + 1
    ny = int((y1 - y0) / cell) + 1
    acc = np.zeros((ny, nx)); cnt = np.zeros((ny, nx))
    i = ((pts[:, 0] - x0) / cell).astype(int)
    j = ((pts[:, 1] - y0) / cell).astype(int)
    ok = (i >= 0) & (j >= 0) & (i < nx) & (j < ny)
    np.add.at(acc, (j[ok], i[ok]), pts[ok, 2])
    np.add.at(cnt, (j[ok], i[ok]), 1)
    z = np.where(cnt > 0, acc / np.maximum(cnt, 1), np.nan)
    filled = int(np.isnan(z).sum())
    if filled:
        from scipy import ndimage
        idx = ndimage.distance_transform_edt(np.isnan(z), return_distances=False,
                                             return_indices=True)
        z = z[tuple(idx)]
    return z, nx, ny, filled


def contours_from(z, x0, y0, cell, nx, ny, interval):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    X = x0 + (np.arange(nx) + 0.5) * cell
    Y = y0 + (np.arange(ny) + 0.5) * cell
    GX, GY = np.meshgrid(X, Y)
    lo = math.floor(np.nanmin(z) / interval) * interval
    hi = math.ceil(np.nanmax(z) / interval) * interval
    fig = plt.figure()
    cs = fig.gca().contour(GX, GY, z, levels=np.arange(lo, hi + interval, interval))
    out, nv = [], 0
    for lv, segs in zip(cs.levels, cs.allsegs):
        rr = [np.round(np.asarray(s), 2).tolist() for s in segs if len(s) >= 2]
        nv += sum(len(r) for r in rr)
        if rr:
            out.append({"el": float(lv), "rings": rr})
    plt.close(fig)
    return out, nv, lo, hi


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--cell", type=float, default=20.0)
    ap.add_argument("--interval", type=float, default=5.0)
    ap.add_argument("--clip", choices=["site", "data"], default="site")
    ap.add_argument("--margin", type=float, default=150.0)
    ap.add_argument("--out", default=os.path.join(WB, "data", "terrain.json"))
    a = ap.parse_args()

    ext = os.path.splitext(a.src)[1].lower()
    if ext not in READERS:
        raise SystemExit("지원하지 않는 확장자: %s (지원: %s)" % (ext, ", ".join(READERS)))
    pts, note = READERS[ext](a.src)
    if len(pts) < 3:
        raise SystemExit("표고점이 3개 미만이다 — 파일을 확인할 것")
    print("읽음: %s · %s" % (os.path.basename(a.src), note))
    print("  좌표 x %.1f~%.1f · y %.1f~%.1f · z %.2f~%.2f"
          % (pts[:, 0].min(), pts[:, 0].max(), pts[:, 1].min(),
             pts[:, 1].max(), pts[:, 2].min(), pts[:, 2].max()))

    if a.clip == "site" and os.path.exists(SITE):
        d = json.load(open(SITE, encoding="utf-8"))
        bx0, by0, bx1, by1 = d["bounds"]
        xs = [bx0, bx1, d["start"][0], d["end"][0]]
        ys = [by0, by1, d["start"][1], d["end"][1]]
        x0, y0 = min(xs) - a.margin, min(ys) - a.margin
        x1, y1 = max(xs) + a.margin, max(ys) + a.margin
        clipnote = "대지(site.json + 여유 %.0f m)" % a.margin
        inb = ((pts[:, 0] >= x0) & (pts[:, 0] <= x1) &
               (pts[:, 1] >= y0) & (pts[:, 1] <= y1)).sum()
        print("  대지 범위 안 점 %d / %d (%.1f%%)" % (inb, len(pts), 100 * inb / len(pts)))
        if inb == 0:
            print("  ★경고: 대지 범위 안에 점이 하나도 없다. 좌표계가 다를 가능성이 크다.")
    else:
        x0, y0, x1, y1 = pts[:, 0].min(), pts[:, 1].min(), pts[:, 0].max(), pts[:, 1].max()
        clipnote = "파일 자체 범위"

    z, nx, ny, filled = to_grid(pts, x0, y0, x1, y1, a.cell)
    cont, nv, lo, hi = contours_from(z, x0, y0, a.cell, nx, ny, a.interval)

    out = {
        "mode": "file",
        "params": None,
        "boundary": [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]],
        "grid": {"x0": x0, "y0": y0, "cell": a.cell, "nx": nx, "ny": ny,
                 "z": [round(float(v), 3) for v in z.ravel(order="C")]},
        "contours": cont,
        "meta": {
            "interval": a.interval, "datum": "파일 그대로", "crs": None,
            "z_min": round(float(np.nanmin(z)), 2), "z_max": round(float(np.nanmax(z)), 2),
            "site_area_m2": round((x1 - x0) * (y1 - y0), 1),
            "boundary_mode": "bbox", "boundary_note": clipnote,
            "source": "%s (%s)" % (os.path.basename(a.src), note),
            "honest": ("실측 지형 파일. 빈 셀 %d개는 최근접 유효값으로 채움(외삽). "
                       "좌표계 변환 없음 — 입력 좌표를 그대로 썼다." % filled),
        },
    }
    json.dump(out, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("격자 %d×%d @ %.0f m · 빈 셀 %d 채움" % (nx, ny, a.cell, filled))
    print("표고 %.1f ~ %.1f m · 등고선 %d레벨 · 정점 %d" % (out["meta"]["z_min"], out["meta"]["z_max"], len(cont), nv))
    print("저장 %s (%.2f MB)" % (a.out, os.path.getsize(a.out) / 1e6))


if __name__ == "__main__":
    main()
