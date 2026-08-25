# CODE_MAP — 파일·함수 지도

> `python 90_dist/make_codemap.py` 로 재생성한다(손으로 고치지 말 것).
> 줄번호는 생성 시점 기준이라 참고용이다. 함수 이름으로 찾아라.

## `04_engine/section_engine.py`

기하·판정·스윕 (단일 진실 원천) · 442줄

| 줄 | 정의 | 한 줄 설명 |
|---:|---|---|
| 28 | `GRID_DEFAULT` | ---------------------------------------------------------------- 기본 유틸 |
| 32 | `rot` |  |
| 37 | `shoelace` |  |
| 46 | `offset_miter` | CCW 폴리곤을 바깥으로 t 평행 오프셋(마이터 조인). |
| 72 | `clearance_polygon` | .dyn Python 노드와 동일한 8점 폴리곤. 검산: 10800x4800, 51.040㎡. |
| 82 | `extra_shapes` | 부대공 형상. binding=True 면 R1/R2 산정 제약에 실제로 들어간다. |
| 110 | `duct_rects` | 공동구 사각형(좌/우). 시설한계 바깥에 접해 노면 위에 놓인다. |
| 124 | `solve_R1` |  |
| 129 | `_R2_through` | 접점방향 u 로 내접하는 원이 점 Q 를 정확히 지나게 하는 R2. |
| 139 | `solve_side` | 부모 원(C,R)에 연직기준 half_ang 방향 접점에서 내접하는 자식 원. |
| 161 | `arc_points` | ccw=True 반시계 / False 시계 / None 짧은쪽. |
| 179 | `circle_line` | 원과 노면선의 교점. 노면선 = 원점을 지나는 방향 u 의 직선을 법선쪽으로 off 만큼 평행이동. |
| 195 | `build_section` |  |
| 382 | `judge` | 판정 기준은 자료에 없다(M3). 아래 기본값은 잠정 — 파라미터로 노출한다. |
| 395 | `frange` |  |
| 403 | `sweep` |  |
| 431 | `DEFAULT_PARAMS` |  |
| 440 | `DEFAULT_SWEEP` |  |

## `04_engine/report.py`

검토보고서 HTML 생성 · 177줄

| 줄 | 정의 | 한 줄 설명 |
|---:|---|---|
| 11 | `_f` |  |
| 15 | `_svg` | 단면도 SVG. 라이닝 + 시설한계 + 공동구 + 부대공 + 치수. |
| 64 | `build` | sec/judge = 선정안, P = 제원, q = 판정기준·시공오차, meta = 프로젝트 정보. |

## `04_engine/export.py`

DXF / JSON 계약 / CSV · 248줄

| 줄 | 정의 | 한 줄 설명 |
|---:|---|---|
| 13 | `LAYERS` |  |
| 26 | `_ang` |  |
| 30 | `_ccw_pair` | CCW 스윕이 180도 미만이 되도록 (시작각, 끝각) 순서를 정한다. |
| 36 | `_arcs_of` | 오프셋 t 인 링을 구성하는 원호 목록. 중심은 그대로, 반지름 +t. |
| 59 | `_bottom_hit` |  |
| 73 | `have_ezdxf` | ezdxf 는 DXF 내보내기에만 쓴다. 없어도 뷰어·JSON·CSV·보고서는 전부 돈다. |
| 87 | `_g` |  |
| 91 | `_num` |  |
| 95 | `_e_line` |  |
| 100 | `_e_arc` |  |
| 105 | `_e_circle` |  |
| 110 | `_e_poly` |  |
| 119 | `_e_point` |  |
| 123 | `_e_text` |  |
| 128 | `to_dxf` | R12 ASCII DXF 를 직접 쓴다. 외부 라이브러리 없음. |
| 177 | `have_ezdxf` | 더 이상 필수가 아니다. 게이트에서 되읽기 검증에만 쓴다. |
| 186 | `to_json` | BIM 핸드오프 계약. Dynamo/애드인은 이 파일만 읽으면 단면을 재구성한다. |
| 234 | `CSV_COLS` |  |
| 238 | `to_csv` |  |

## `04_engine/gate_check.py`

게이트 9종 · 224줄

| 줄 | 정의 | 한 줄 설명 |
|---:|---|---|
| 25 | `ROOT` |  |
| 26 | `DATA` |  |
| 27 | `RES` |  |
| 30 | `rec` |  |
| 35 | `inside` | 단면 내부 판정 = 각 구간 원의 반경 이내. |
| 49 | `segs_cross` |  |
| 56 | `main` | G1 ------------------------------------------------------------- |

## `05_web_viewer/server.py`

HTTP API · 정적 서빙 · 포트 자동선택 · 258줄

| 줄 | 정의 | 한 줄 설명 |
|---:|---|---|
| 9 | `HERE` |  |
| 10 | `ROOT` |  |
| 17 | `LATEST_REPORT` | 설명서는 배포판에서 docs/, 개발트리에서 06_docs/ 에 있다 |
| 18 | `OUTDIR` | 설명서는 배포판에서 docs/, 개발트리에서 06_docs/ 에 있다 |
| 19 | `EXPDIR` | 설명서는 배포판에서 docs/, 개발트리에서 06_docs/ 에 있다 |
| 21 | `DOCDIR` |  |
| 24 | `PORT_DEFAULT` |  |
| 25 | `LEGACY` |  |
| 28 | `load_legacy` |  |
| 39 | `pick_port` | 포트가 물려 있으면 다음 번호로 옮긴다 — 남의 PC 에서 8801 이 비어 있으리란 보장이 없다. |
| 55 | `Server` |  |
| 60 | `H` |  |

## `90_dist/build_dist.py`

배포 빌드 (+ RUN/CHECK.bat 생성) · 247줄

| 줄 | 정의 | 한 줄 설명 |
|---:|---|---|
| 21 | `HERE` |  |
| 22 | `ROOT` |  |
| 23 | `VER` |  |
| 24 | `STAMP` |  |
| 25 | `NAME` |  |
| 27 | `FILES` |  |
| 51 | `EMPTY_DIRS` |  |
| 53 | `README` |  |
| 126 | `PY_LICENSE_NOTE` |  |
| 133 | `BUNDLE_NOTE` |  |
| 149 | `_force_rm` | Windows 는 ReadOnly 속성이 붙은 폴더/파일을 rmtree 로 못 지운다 — |
| 160 | `rmtree_safe` |  |
| 169 | `main` |  |

## `90_dist/diagnose.py`

자가진단 · 123줄

| 줄 | 정의 | 한 줄 설명 |
|---:|---|---|
| 13 | `HERE` |  |
| 14 | `ROOT` |  |
| 15 | `LOG` |  |
| 18 | `say` |  |
| 26 | `main` |  |

## `90_dist/make_figures.py`

설명서 그림 생성 · 386줄

| 줄 | 정의 | 한 줄 설명 |
|---:|---|---|
| 19 | `HERE` |  |
| 20 | `ROOT` |  |
| 21 | `IMG` |  |
| 22 | `PORT` |  |
| 24 | `FONT_CANDIDATES` |  |
| 26 | `CHROME` |  |
| 31 | `DIM` |  |
| 34 | `font` |  |
| 44 | `badge` |  |
| 53 | `box` |  |
| 57 | `legend` |  |
| 77 | `side_by_side` |  |
| 91 | `split_columns` | 세로로 긴 그림을 n 단으로 잘라 가로로 편다 — 폭 좁은 이미지는 문서에서 글씨가 안 보인다. |
| 106 | `shot` |  |
| 122 | `api` |  |
| 132 | `fig1_screen` |  |
| 155 | `fig2_section` |  |
| 171 | `fig3_input` |  |
| 188 | `fig4_pareto` |  |
| 204 | `fig5_grid` |  |
| 218 | `_crop_canvas` |  |
| 222 | `fig6_extras` |  |
| 233 | `fig7_layers` |  |
| 243 | `fig8_legacy` |  |
| 256 | `fig9_report` |  |
| 268 | `LAYER_COLOR` |  |
| 275 | `fig10_dxf` | 내보낸 DXF 를 ezdxf 로 되읽어 그린다 — 실제로 엔티티가 들어 있다는 증거. |
| 333 | `main` |  |

## `90_dist/make_codemap.py`

이 지도 자체를 생성 · 85줄

| 줄 | 정의 | 한 줄 설명 |
|---:|---|---|
| 11 | `HERE` |  |
| 12 | `ROOT` |  |
| 13 | `OUT` |  |
| 15 | `PY_SRC` |  |
| 28 | `first_doc` |  |
| 38 | `main` |  |

## `05_web_viewer/app.js`

화면·상호작용 (계산은 하지 않는다) · 445줄

| 줄 | 정의 | 한 줄 설명 |
|---:|---|---|
| 6 | `PKEYS` |  |
| 9 | `PRAW` | mm 환산하지 않는 값(비율·각도) |
| 16 | `view` |  |
| 19 | `params` |  |
| 25 | `query` |  |
| 42 | `sweepDef` |  |
| 49 | `nCombo` |  |
| 59 | `post` |  |
| 68 | `refresh` |  |
| 81 | `runSweep` |  |
| 98 | `drawCards` |  |
| 114 | `fitView` |  |
| 122 | `draw` |  |
| 254 | `fillTable` |  |
| 268 | `applyRow` |  |
| 274 | `drawScatter` |  |
| 306 | `buildThumbs` |  |
| 334 | `loadLegacy` |  |
| 347 | `syncLabels` |  |
| 368 | `exportAs` |  |
| 418 | `boot` |  |

