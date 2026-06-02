# First E2E Feedback — D:/UnityProject/JangHeung (2026-06-02)

This is the user's verbatim feedback from the first real PPTX/PDF → screen run, captured here so the v0.1.1 sprint and any follow-on (v0.2 spec) can trace decisions back to source observations rather than my paraphrase.

Project: D:/UnityProject/JangHeung (kiosk-style UI authoring)
Inputs encountered: 8 PNG screens (1920×1080, 466KB–1.5MB) + one 116MB / 42-page PDF
Outcome at runtime: 11/11 elements created in Unity, but only a "blank wireframe" — props, text, color, sprite, font, anchor all ignored.

## Top 3 (시급)

1. 🔴 **props가 렌더링되지 않음** — 텍스트·색·이미지·폰트가 전부 무시되어 결과물이 "빈 와이어프레임"에 그침. 도구의 핵심 산출물 품질을 좌우.
2. 🟠 **에이전트가 결과를 볼 수 없음** — `capture_preview`는 base64만 반환(에이전트 비가시), 자료 이미지/PDF도 dedicated 도구로 못 읽음. "생성→검증→수정" 자율 루프가 끊김.
3. 🟠 **계약/문서 불일치** — rect 단위(픽셀 vs 정규화), props 수용하지만 무시, anchor 무시. 문서대로 하면 화면이 깨짐.

## Category A — 자료 분석 단계

- 🟠 `read_planning_material`가 일반 크기 이미지를 못 넘김. 현상: 키오스크 PNG 8장(466KB–1.5MB, 1920×1080) 전부 *"could not be resized below the image size limit"* 으로 omit. 정작 범용 Read 도구로는 정상. 영향: 기획서 이미지를 전용 도구로 시각 분석 불가. 제안: 캡 상향 / 동적 다운스케일 내장 / 캡 초과 시 자동 리사이즈 / 범용 Read와 동일 처리량 보장.
- 🔴 `preprocess_image` NotImplemented → 캡 초과 이미지를 toolchain 내에서 줄일 방법이 없음. 제안: 최소한의 downscale/crop만이라도 구현(sharp/jimp 미존재 시 .NET System.Drawing/Windows.Graphics 폴백).
- 🔴 `pptx_to_images` NotImplemented + PDF 래스터화 부재. 현상: 116MB·42p PDF를 읽을 경로가 없어 PowerShell + Windows.Data.Pdf로 42p PNG 렌더링 외부 스크립트를 직접 작성해야 했음. 영향: "PPTX/PDF 기획서 → 화면" 표방 워크플로우의 입력 단계가 사실상 수동. 제안: Windows 환경 한정이라도 Windows.Data.Pdf(PDF) 페이지 래스터화 내장 + PPTX 동일 경로.
- 🟡 멀티페이지/대용량 페이지네이션 부재. `read_planning_material`에 page range / thumbnail index 개념 없음. 제안: `{path, pageRange, dpi}` 옵션과 페이지별 리소스 반환.

## Category B — 외부 처리 우회 부수 문제

- 🟡 한글 파일경로 인코딩. 한글 PDF명 하드코딩 → mojibake "파일 없음" 예외 → 런타임 `Get-ChildItem`으로 우회. 제안: UTF-8/`-LiteralPath` 일관, 콘솔 codepage 명시.
- ⚪ 콘솔 한글 출력 깨짐 (기능 무해, 로그 가독성).

## Category C — PlanningIntent / create_ui_screen 계약

- 🔴 props 전면 무시. `IntentElementData`에 `props` 필드 자체가 없음 + `JsonUtility`가 미지 필드 폐기. `UguiBackend`는 type+rect만 적용. → text/color/sprite/fontSize/align 전무. 제안: `IntentElementData.props` (직렬화 가능 맵) 추가 + 백엔드에서 최소 text/color/fontSize/sprite/align 처리. `JsonUtility` 한계상 Newtonsoft 또는 명시 필드 셋 도입.
- 🟠 Zod 스키마가 `props`를 받지만 무용. `create_ui_screen.ts`가 `props: z.record(...)` 허용 → 거짓 affordance. 제안: 백엔드 지원까지 경고 또는 동기화.
- 🟠 rect 단위 계약 불일치. 에이전트 prompt = "create는 픽셀" / `CoordinateMapper.NormRectToPx`·`IntentParser.ValidateRect` = 정규화 0..1 (범위 밖 reject). 영향: 문서대로 픽셀(예 x:960) 입력 시 오프스크린. 제안: prompt/스키마/설명을 정규화로 통일 + `RectSchema.min(0).max(1)` 강제.
- 🟡 anchor 무시. `ApplyRectTransform`이 `anchorMin/Max/pivot=(0,1)` 고정, `el.anchor` 미반영 (코드 주석에 "follow-up"). 제안: 9-프리셋 anchor 매핑 (이미 `CoordinateMapper.AnchorReferencePoint` 존재).
- 🟡 부모-자식 좌표 의미 비직관. 자식 rect도 캔버스 dims로 환산 + 부모 좌상단 앵커 기준. 그룹/카드 내부 배치 까다로워 이번엔 플랫 계층으로 회피. 제안: 자식은 부모 rect 기준 상대 정규화로 해석하는 옵션.
- ⚪ z-order = 형제 순서뿐. 제안: 선택적 `order`/`zIndex`.

## Category D — 편집·상태 조회

- 🟠 요소 상태 read-back 부재. `get_scene_hierarchy`는 `name/elementId/children`만 → 현재 `rect/anchor/type/props` 없음. 좌표 적용 결과 프로그램적 검증 불가. 제안: 노드에 `type, rect(px+norm), anchor` 포함.
- 🟡 `update_ui_element` props-only 불가. `rect(w,h>0)` 필수, props만 수정 거부 ("not supported in v1 backbone"). 제안: props 지원과 함께 부분 업데이트 허용.
- ⚪ 반복 화면용 배치/템플릿 부재. 동형 화면 매번 풀 intent. 제안: 템플릿+데이터 바인딩 또는 `add_ui_elements`(복수).

## Category E — 검증 / ID 매핑 가시성

- 🟠 `capture_preview`를 agent가 못 봄. 백엔드는 1920×1080 PNG를 base64로 인라인 반환만, 파일 미저장. 툴 래퍼는 base64를 metadata에 담아 agent에는 요약 텍스트("size=38662b")만. 자율 시각 검증 불가. 제안: PNG를 임시파일로 저장하고 경로/viewable image 반환, 또는 항상 uri 제공.
- 🟡 프리뷰 가독성. props 미스타일 + 기본 Image=흰색 → 흰 배경 위 흰 컨테이너로 요소 구분 어려움. 제안: 디버그 외곽선 / 타입별 색 오버레이.
- 🟠 `create_ui_screen` ID 매핑이 output에 없음. 반환 output은 요약 문자열만, 핵심 `clientHintId→elementId`는 metadata에만. 전환 연결용 canonical ID를 `get_scene_hierarchy`로 재조회해야 했고, 그나마 `clientHintId==name` 덕에 매칭. 제안: 매핑을 output에 노출.

## Category F — 검증 계층 일관성

- 🟡 sidecar Zod는 rect 범위(0..1)를 검사하지 않고, `ExecuteCreateScreen`도 `IntentParser.Validate` 미호출 → 잘못된 rect가 에러 없이 오프스크린 렌더로 빠짐. 실패 silent → 디버깅 어려움. 제안: 양쪽 동일 규칙 + 위반 시 명시 에러.

## 회귀 방지용 — 정상 동작 확인된 것

- 구조 생성 (타입별 컴포넌트)
- 정규화→px 좌표 수학
- 서버 canonical ID 민팅
- `get_scene_hierarchy` 계층 조회 (children 트리)
- 화면 생성 (11/11 요소)
- `list_screens`

→ "구조/배치 골격" 파이프라인은 견고. 한계는 ① 입력(자료 로딩), ② 스타일(props), ③ 검증 가시성에 집중.

## v0.1.1 Tier 0 sprint scope (이 sprint에서 해결)

- T0-1 props 렌더링 (Category C, Top #1)
- T0-2 rect 단위 정합 (Category C)
- T0-3 capture_preview attachment (Category E, Top #2)
- T0-4 create_ui_screen ID 매핑 output (Category E)

Tier 1/2는 별도 v0.2 spec 시점에 처리 (preprocess_image, pdf 래스터화, anchor 9-프리셋, get_scene_hierarchy read-back 확장 등).
