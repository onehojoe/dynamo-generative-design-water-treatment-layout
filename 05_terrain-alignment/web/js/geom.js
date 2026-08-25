/* geom.js — 공간 인덱스 + 히트 테스트
 *
 * v7 GD02/03 판정 규칙을 그대로 옮긴다:
 *   point.DoesIntersect(solid)  →  점이 폴리곤 내부
 *   point.DistanceTo(solid) <= tol → 폴리곤 경계까지 거리 <= tol
 * 둘 중 하나면 hit. (장애물 tol=0 → 사실상 내부판정, 도로 tol=15m)
 */
(function (global) {
  'use strict';

  function polyBBox(poly) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      if (p[0] < minx) minx = p[0];
      if (p[0] > maxx) maxx = p[0];
      if (p[1] < miny) miny = p[1];
      if (p[1] > maxy) maxy = p[1];
    }
    return [minx, miny, maxx, maxy];
  }

  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  function distToPolyEdge(x, y, poly) {
    let best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const d = distToSeg(x, y, poly[j][0], poly[j][1], poly[i][0], poly[i][1]);
      if (d < best) best = d;
    }
    return best;
  }

  /* 균일 격자 인덱스. 폴리곤 bbox를 셀에 등록해 후보만 검사. */
  class Grid {
    constructor(polys, cell) {
      this.polys = polys;
      this.bbox = polys.map(polyBBox);
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const b of this.bbox) {
        if (b[0] < minx) minx = b[0];
        if (b[1] < miny) miny = b[1];
        if (b[2] > maxx) maxx = b[2];
        if (b[3] > maxy) maxy = b[3];
      }
      if (!isFinite(minx)) { minx = miny = 0; maxx = maxy = 1; }
      this.minx = minx; this.miny = miny;
      this.cell = cell || 120;
      this.nx = Math.max(1, Math.ceil((maxx - minx) / this.cell));
      this.ny = Math.max(1, Math.ceil((maxy - miny) / this.cell));
      this.cells = new Array(this.nx * this.ny);
      for (let k = 0; k < this.bbox.length; k++) {
        const b = this.bbox[k];
        const i0 = this._cx(b[0]), i1 = this._cx(b[2]);
        const j0 = this._cy(b[1]), j1 = this._cy(b[3]);
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const idx = j * this.nx + i;
            (this.cells[idx] || (this.cells[idx] = [])).push(k);
          }
        }
      }
    }
    _cx(x) { return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.minx) / this.cell))); }
    _cy(y) { return Math.min(this.ny - 1, Math.max(0, Math.floor((y - this.miny) / this.cell))); }

    /* v7 판정과 동일: 내부거나 tol 이내면 true */
    hit(x, y, tol) {
      const i0 = this._cx(x - tol), i1 = this._cx(x + tol);
      const j0 = this._cy(y - tol), j1 = this._cy(y + tol);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const list = this.cells[j * this.nx + i];
          if (!list) continue;
          for (let n = 0; n < list.length; n++) {
            const k = list[n];
            const b = this.bbox[k];
            if (x < b[0] - tol || x > b[2] + tol || y < b[1] - tol || y > b[3] + tol) continue;
            const poly = this.polys[k];
            if (pointInPoly(x, y, poly)) return true;
            if (tol > 0 && distToPolyEdge(x, y, poly) <= tol) return true;
          }
        }
      }
      return false;
    }
  }

  global.KHGeom = { Grid, polyBBox, pointInPoly, distToPolyEdge, distToSeg };
})(typeof self !== 'undefined' ? self : this);
