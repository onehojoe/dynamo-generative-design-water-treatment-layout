# API — HTTP 계약 · 함수 시그니처 · 데이터 스키마

> 이 문서는 **기계가 읽는 계약**이다. 사람용 설명은 `docs/사용자_설명서.html`, 수정 규칙은 `AI_GUIDE.md`.
> 서버는 `127.0.0.1` 에만 바인딩한다(외부 노출 없음). 포트는 8801 부터 자동 선택.

## 0. 단위·좌표계 (전 API 공통)

| 항목 | 값 |
|---|---|
| 길이 단위 | **mm** (화면 입력만 m, 서버 전달 시 ×1000) |
| 각도 | 도(°) 로 주고받고 내부는 rad |
| 원점 | 터널 중심축의 **노면 레벨** |
| 축 | +x 우, +y 상 |
| 편경사 | 도로·시설한계·공동구·부대공만 회전. **라이닝은 연직 유지** |
| 노면선 | 원점을 지나고 방향 `(cos s, sin s)` 인 직선 = **라이닝 하단 기준** |

---

## 1. HTTP API

### `POST /api/section` — 단면 1개

요청

```json
{
  "cc": -900, "s": -2, "EL1": 300, "theta": 100,
  "tol": 50, "grid": 5,
  "flat_min": 0.55, "margin_min": 50,
  "params": { "lane_L": 3000, "duct_LW": 800, "lining_t": 300, "five_center": 0 },
  "show_walk": true, "show_jet": false,
  "bind_walk": false, "bind_jet": false
}
```

| 키 | 의미 |
|---|---|
| `cc` | 도로 중심거리 (mm, 음수 = 도로가 터널 중심 왼쪽) |
| `s` | 편경사 (%) |
| `EL1` | R1 원 중심 높이 (mm) |
| `theta` | 중심각 (°) |
| `tol` | 시공오차 (mm) · `grid` R1 격자 (mm) |
| `params` | `DEFAULT_PARAMS` 를 덮어쓸 항목만. **mm 단위** |
| `show_*` | 화면 표시만 (산정 미반영) |
| `bind_*` | **산정 제약에 실제 반영** |

응답 (주요 키)

| 키 | 타입 | 의미 |
|---|---|---|
| `R1`,`R2`,`R2p`,`R3`,`R3p` | number | 반지름(mm). `R2`=좌, `R2p`=우. 3심원이면 `R3*`=`R2*` |
| `O1`,`O2L`,`O2R`,`O3L`,`O3R` | [x,y] | 각 원 중심 |
| `SL`,`SR`,`TL`,`TR`,`BL`,`BR` | [x,y] | 스프링잉 / 2단 접점 / 바닥 종결점 |
| `poly` | [[x,y]…] | 내공선 폴리곤(호를 조밀화한 점열) |
| `layers` | [{name,t,offset,poly,area_m2}] | `lining`→`shotcrete`→`overbreak` 순 동심 링 |
| `clr`,`clr_off` | [[x,y]×8] | 시설한계 / 시공오차 오프셋 |
| `ducts` | [{side,pts}] | 공동구 사각형 |
| `extras` | [{kind,binding,…}] | `walk`(pts) / `jetfan`(c,r,gap) |
| `area`,`area_m2`,`exc_m2` | number | 내공단면적(mm², ㎡) / 굴착단면적(㎡) |
| `width`,`height` | number | 내공 폭·높이 (**노면 좌표계**에서 측정) |
| `flat` | number | 편평률 = height / width |
| `margin`,`margin_side`,`contain` | number | 시설한계 여유(mm) / 측벽 여유 / 포함 여유 |
| `u_road`,`n_road` | [x,y] | 노면 방향·법선 단위벡터 |
| `in` | object | 입력 에코 + `five`(5심원 성립 여부) + `note`(불성립 사유) |
| `judge` | {flat,margin,contain,all} | `"OK"` / `"NG"` |

### `POST /api/sweep` — 조합 스윕

요청 = `/api/section` + `"sweep": {"cc":[-0.9,-0.5,0.05], "s":[-2,2,1], "EL1":[0.3,0.5,0.05], "theta":[100,130,10]}`
(스윕 범위만 **m·%·°** 단위. `[시작, 끝, 간격]`)

응답 `{"rows":[…], "shape":[9,5,5,4], "n":900}` · 행 스키마

```
cc s EL1 theta R1 R2 R2p R3 R3p width height area_m2 exc_m2 flat margin margin_side jf jm jc j
```

`jf`=편평률 판정, `jm`=여유폭, `jc`=포함, `j`=종합. 900조합에 약 0.2초.

### `POST /api/report` — 검토보고서

요청 = `/api/section` + `"rows"`(선택, 대안 비교표에 쓰임)
응답 `{"file":"검토보고서_YYMMDD_HHMM.html","url":"/report/latest","dir":"07_report"}`
→ `GET /report/latest` 로 열람. 파일은 `07_report/` 에 남는다.

### `POST /api/export` — 내보내기

요청 = `/api/section` + `"kind": "dxf" | "json" | "csv"` (csv 는 `"rows"` 필수)
응답 `{"file":"…","url":"/export/…","dir":"08_export"}` → `GET /export/<파일명>` 다운로드.
`kind=dxf` 인데 `ezdxf` 가 없으면 **400 + 안내 메시지**(다른 기능은 영향 없음).

### `GET /api/legacy` · `GET /api/defaults` · `GET /api/env`

| 경로 | 응답 |
|---|---|
| `/api/legacy` | 발주처 원본 `{rows:[60행], short:[10행], input4:{project,tunnel,section}}` — **참조 전용** |
| `/api/defaults` | `{params: DEFAULT_PARAMS, sweep: DEFAULT_SWEEP}` |
| `/api/env` | `{python, ezdxf(bool), legacy_rows, port}` — 환경 확인용 |

---

## 2. 내보내기 JSON 계약 `tn_section/1.0`

`POST /api/export {kind:"json"}` 또는 `export.to_json()` 의 산출. **이 한 파일이면 단면을 재구성할 수 있다.**

```jsonc
{
  "schema": "tn_section/1.0",
  "unit": "mm",
  "datum": "원점 = 터널 중심축의 노면 레벨, +x 우 / +y 상 …",
  "input":  { "cc": -900, "s_pct": -2, "EL1": 300, "theta": 100, "tol": 50,
              "five": false, "theta3": null, "note": "" },
  "params": { /* 제원 전체, mm */ },
  "judge_criteria": { "flat_min": 0.55, "margin_min": 50, "tol": 50 },
  "metrics": { "R1":6860, "R2":4375, "R2p":6470, "R3":…, "R3p":…,
               "width":13074, "height":7160, "area_m2":76.28, "exc_m2":94.47,
               "flat":0.5477, "margin_mm":55.1 },
  "inner_arcs": [ { "name":"R1", "center":[0,300], "r":6860,
                    "p_start":[…], "p_end":[…], "deg_ccw":[40.0,140.0] }, … ],
  "bottom":  { "p_start":[…], "p_end":[…] },
  "rings":   [ { "name":"lining", "t":300, "offset":300, "area_m2":86.99, "arcs":[…] }, … ],
  "clearance": [[x,y]×8], "clearance_offset": [[x,y]×8],
  "ducts": [ {"side":"R","pts":[[x,y]×4]}, … ],
  "extras": [ {"kind":"walk","binding":true,"pts":[…]}, {"kind":"jetfan","c":[…],"r":750,"gap":450} ],
  "notes": [ "R1 = …", "R2/R2'는 신규 정의 …", "판정 기준은 잠정 …" ]
}
```

**재구성 방법**: `inner_arcs` 를 순서대로 `deg_ccw[0] → deg_ccw[1]` 반시계 원호로 그리고,
마지막에 `bottom.p_start → bottom.p_end` 직선으로 닫는다. `rings` 도 같은 방식이다.
각도는 **도(°), 반시계, x축 기준**이다.

---

## 3. DXF 레이어

| 레이어 | 색 | 내용 | 엔티티 |
|---|---:|---|---|
| `TN_INNER` | 7 | 내공선(3심원) | ARC ×3(5심원이면 5) + LINE |
| `TN_LINING` | 3 | 라이닝 외면 | 동일 |
| `TN_SHOT` | 4 | 숏크리트 외면 | 동일 |
| `TN_EXC` | 1 | 굴착선 | 동일 |
| `TN_CLEAR` / `TN_CLEAR_OFF` | 2 | 시설한계 / +시공오차 | LWPOLYLINE |
| `TN_DUCT` | 6 | 공동구 | LWPOLYLINE |
| `TN_EXTRA` | 5 | 검사원통로·제트팬 | LWPOLYLINE / CIRCLE |
| `TN_CENTER` | 8 | 중심점·라벨·노면선 | POINT / TEXT / LINE |

`$INSUNITS = 4`(mm). **폴리라인 근사가 아니라 실제 ARC** 이므로 CAD 에서 반지름·중심이 그대로 살아 있다.

---

## 4. 엔진 함수 (`04_engine/section_engine.py`)

```python
build_section(P, cc, s_pct, EL1, theta_deg, tol=50.0, grid=5.0,
              use_walk=False, use_jet=False) -> dict
judge(sec, flat_min=0.55, margin_min=50.0) -> {"flat","margin","contain","all"}
sweep(P, sw, tol=50.0, grid=5.0, flat_min=0.55, margin_min=50.0,
      limit=4000, use_walk=False, use_jet=False) -> (rows, shape)

clearance_polygon(P, cc, s) -> [ (x,y) ×8 ]      # 원본 .dyn 이식분
offset_miter(P, t) -> [(x,y)…]                    # 바깥 평행 오프셋(마이터)
solve_R1(pts, O1, grid) -> (R1, need)
solve_side(C, R, half_ang, side, constraints, grid) -> (R2, O2, u, T)
extra_shapes(P, cc, s, use_walk, use_jet) -> [ {kind,binding,…} ]
arc_points(C, R, a0, a1, n, ccw) -> [(x,y)…]
circle_line(C, R, u, side, off=0.0) -> (x,y) | None
```

`DEFAULT_PARAMS` 키(전부 mm, 단 비율·플래그 제외)

```
lane_L shoulder_L lane_R shoulder_R H ha hb
duct_LW duct_LH duct_RW duct_RH
jetfan_d walk_w walk_h drain_b1
walk_side("L"|"R")  jet_dx  jet_gap_ratio(비율)
lining_t shot_t overbreak
five_center(0|1)  theta3(°)
```

## 5. 내보내기 함수 (`04_engine/export.py`)

```python
have_ezdxf() -> bool          # 없으면 DXF 만 비활성
to_dxf(sec, path) -> path     # RuntimeError 가능(ezdxf 부재)
to_json(sec, P, q, path=None) -> dict
to_csv(rows, path) -> path    # UTF-8 BOM
```
