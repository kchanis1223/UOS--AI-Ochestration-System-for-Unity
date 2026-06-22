# UOS 새 프로젝트 테스트 가이드 — 억새능선 템플릿 (2026-06-08)

동찬님이 직접 실행하실 수 있도록, **새 Unity 프로젝트 생성 → UOS 설치 → Ref 폴더 구성 → 억새능선 화면 1개 생성 → 결과 확인**까지의 정확한 절차를 정리했습니다. 모든 명령은 PowerShell 기준입니다. 경로(`D:\Unity\JangHeungKiosk` 등)는 예시이니 실제 경로로 바꿔주세요.

---

## 0. 전체 흐름 한눈에

```
[1] UOS 로컬 링크 확인  →  [2] 새 Unity 프로젝트 생성  →  [3] UOS 패키지 설치(file: 링크)
   →  [4] 브리지 시작·확인  →  [5] uos가 프로젝트 인식 확인  →  [6] Ref 폴더 구성(+샘플)
   →  [7] 자료→화면 실행(dry-run → 실제)  →  [8] 결과 확인 & 저에게 공유
```

핵심: 이번 테스트의 목적은 **v0.1.1에서 고친 4가지(props 렌더링 / rect 정합 / preview 비전 / ID 매핑)** 가 실제 화면에서 제대로 동작하는지 회귀 확인하는 것입니다.

---

## 1. UOS 로컬 링크 확인 (이미 했으면 건너뛰기)

handoff(06-05)에서 `bun link`까지 끝나 있어 보통은 그대로 동작합니다. 새 터미널에서:

```powershell
uos --version
```

`uos`를 못 찾으면 한 번만 재설정:

```powershell
cd C:\Users\lyx\MCP_for_Unity_LYX
bun install
cd .opencode
npm install
cd ..
bun link
```

> `.opencode` 의 `npm install` 은 opencode 플러그인(claude-auth 등) 자동 발견에 필요합니다.

opencode 인증/모델 확인 (실제 AI 실행 전 권장):

```powershell
opencode auth list
uos doctor --runtime
```

---

## 2. 새 Unity 프로젝트 생성

Unity Hub에서:

- 에디터: **6000.3.3f1** (이미 설치돼 있음)
- 템플릿: **2D** (또는 아무 템플릿이나 무방 — UGUI만 있으면 됨)
- 이름/경로 예: `JangHeungKiosk` / `D:\Unity\JangHeungKiosk`

생성 후 컴파일 에러 없이 열리는 것까지 확인.

---

## 3. UOS 패키지 설치 (중요: 기본 file: 링크 사용)

```powershell
# 먼저 무엇이 바뀌는지 미리보기
uos install-unity D:\Unity\JangHeungKiosk --dry-run

# 실제 설치
uos install-unity D:\Unity\JangHeungKiosk

# 설치 검증 (패키지/의존성 점검)
uos doctor --project D:\Unity\JangHeungKiosk
```

기본 설치는 프로젝트의 `Packages/manifest.json` 에 아래처럼 **이 저장소의 패키지를 file: 링크**로 걸어줍니다.

```json
"com.lyx.oh-my-unity": "file:C:/Users/lyx/MCP_for_Unity_LYX/Packages/com.lyx.oh-my-unity"
```

> ⚠️ 이번엔 **`--embed` 를 쓰지 마세요.** file: 링크여야 제가 저장소 패키지 코드(C#)를 고치면 **새 프로젝트에 즉시 반영**됩니다. embed는 복사본이라 후속 개발 루프가 끊깁니다.

설치 후 Unity로 돌아가 프로젝트를 새로고침(포커스만 줘도 됨)하면 Package Manager에 in-project 패키지로 보입니다.

---

## 4. 브리지 시작·확인

패키지가 로드되면 브리지는 **자동 시작**됩니다. 수동 확인:

1. Unity 상단 메뉴 `Window > Oh My Unity > Monitor`
2. `Auto start bridge when this Unity project opens` 체크 확인
3. 서버가 listening 인지, 아니면 `Start` 클릭

---

## 5. uos가 프로젝트를 인식하는지 확인

```powershell
uos doctor
uos projects
uos ready --wait --unity-project JangHeungKiosk
```

기대 출력(예):

```
[uos] connected Unity projects:
  1. JangHeungKiosk - D:/Unity/JangHeungKiosk (127.0.0.1:178xx, Unity 6000.x) id=...
```

안 보이면 → 7번 트러블슈팅 참고 (`uos doctor --clean-stale` 등).

---

## 6. Ref 폴더 구성

새 프로젝트 폴더 안에 Ref 폴더를 둡니다. (예시 경로)

```
D:\Unity\JangHeungKiosk\
└─ Ref\
   ├─ 기획서.pdf                ← 전체 기획서(있으면 여기)
   └─ main\장흥9경\천관산\랜드마크\억새능선\
        ├─ screen.md            ← 이 화면의 스펙(아래 샘플)
        └─ ref.png (선택)        ← 이 화면의 참고 목업/사진(있으면)
```

### UOS가 폴더를 읽는 방식 (꼭 알아두기)

- UOS는 `--uos-materials <폴더>` 로 지정한 폴더를 스캔해 지원 파일을 읽습니다.
  지원 형식: **이미지(png/jpg/webp/gif/bmp), pdf, pptx, docx, txt, md, csv, json**
- 재귀 스캔도 가능하지만(`recursive`, 기본 깊이 4), `Library/Temp/.uos/.git/node_modules` 등은 자동 제외.
- **중요한 한계:** UOS는 아직 *폴더 중첩 구조(main→장흥9경→…→억새능선)를 키오스크 내비게이션 플로우로 자동 해석하지 않습니다.* 즉 "폴더=화면, 중첩=화면 이동"은 지금은 자동이 아니며, **한 번에 한 화면(리프 폴더)** 단위로 생성하는 게 정석입니다. (이 자동화는 제가 만들 후속 개발 1순위 후보 — 10번 참고.)

### 각 화면 폴더에 무엇을 넣으면 가장 잘 되나

가장 안정적인 입력은 **(a) 화면 스펙 텍스트(.md/.txt) + (b) 참고 이미지(png)** 조합입니다.
스펙에는 제목/본문/항목/버튼을 적고, 폼 컨트롤이 필요하면 아래 줄 형식을 그대로 쓰면 UOS가 **실제 UGUI 컨트롤**로 만들어 줍니다.

```
Input: 이름 = 홍길동
Toggle: 음성안내 = on
Slider: 글자크기 [0-100] = 60
Dropdown: 언어 [한국어, English, 日本語, 中文] = 한국어
```

### 억새능선 샘플 스펙 (그대로 복사 → `screen.md` 로 저장)

자료가 아직 준비 중이니, 우선 이 샘플로 파이프라인을 바로 돌려볼 수 있습니다.

```text
# 억새능선

위치: 전남 장흥군 천관산
구분: 랜드마크 / 장흥9경 > 천관산

## 소개
천관산 정상부 능선을 따라 가을이면 은빛 억새가 장관을 이루는 대표 명소입니다.
탐방로는 천관산 자연휴양림에서 시작하며 능선까지 왕복 약 3시간이 소요됩니다.

## 탐방 안내
- 추천 시기: 9월 말 ~ 11월 초
- 난이도: 중
- 코스 거리: 약 4.5km (왕복)
- 주차: 천관산 자연휴양림 주차장 이용

## 화면 동작 (버튼)
- 길찾기
- 사진 더보기
- 이전 화면
- 처음으로

## 옵션
Dropdown: 언어 [한국어, English, 日本語] = 한국어
Toggle: 음성안내 = off
```

---

## 7. 첫 테스트 실행 (dry-run → 실제)

먼저 **dry-run**으로 프로젝트 선택/자료 전달이 맞는지 확인 (opencode를 실제로 띄우지 않음):

```powershell
uos --unity-project JangHeungKiosk `
    --uos-materials "D:\Unity\JangHeungKiosk\Ref\main\장흥9경\천관산\랜드마크\억새능선" `
    --uos-dry-run run "Ref 폴더의 억새능선 화면 자료를 읽고 편집 가능한 Unity 화면을 생성한 뒤 미리보기를 캡처하고 무엇이 만들어졌는지 요약해줘."
```

출력에 선택된 프로젝트와 자료 경로가 맞게 찍히면, **실제 실행**:

```powershell
uos --unity-project JangHeungKiosk `
    --uos-materials "D:\Unity\JangHeungKiosk\Ref\main\장흥9경\천관산\랜드마크\억새능선" `
    run "Ref 폴더의 억새능선 화면 자료를 읽고 편집 가능한 Unity 화면을 생성해줘. 제목/본문/버튼을 화면에 배치하고, 텍스트·색이 실제로 보이게 한 뒤 capture_preview로 미리보기를 캡처하고, 생성된 화면 이름과 요소 id 매핑을 요약해줘."
```

참고 이미지(`ref.png`)도 함께 검증하려면 명시 첨부:

```powershell
uos --unity-project JangHeungKiosk `
    --uos-materials "D:\Unity\JangHeungKiosk\Ref\main\장흥9경\천관산\랜드마크\억새능선" `
    --uos-file "ref.png" `
    run "screen.md 스펙과 ref.png 목업을 참고해 억새능선 화면을 만들고, 미리보기를 캡처해 목업과 얼마나 비슷한지 요약해줘."
```

대화형으로 이어서 수정하려면:

```powershell
uos chat --unity-project JangHeungKiosk --continue
```

---

## 8. 결과 확인 & 저에게 공유할 것

Unity에서:
- Hierarchy/Scene/Game 뷰에 Canvas 아래 억새능선 화면이 생겼는지
- **텍스트·색이 실제로 보이는지** (← v0.1.1 핵심 회귀 포인트, 1차 때는 "빈 와이어프레임"이었음)
- 요소 배치(rect/anchor)가 화면 안에 정상적으로 들어왔는지

파일로 남는 증거 (새 프로젝트 폴더 안):
- `D:\Unity\JangHeungKiosk\.uos\work-journal.jsonl` — 어떤 도구를 어떤 순서로 호출했는지(read_planning_material → create_*…)
- `D:\Unity\JangHeungKiosk\.uos\previews\*.png` — 캡처된 미리보기
- `uos context --unity-project JangHeungKiosk` 출력 — 저장된 화면/요소 컨텍스트

**저에게 보내주실 것 (이게 있으면 후속 개발 진단이 정확해집니다):**
1. 터미널의 run 출력 전체(에이전트 요약 + 에러 메시지)
2. `.uos\work-journal.jsonl` 내용
3. `.uos\previews\` 의 최신 PNG (또는 Unity Game 뷰 스크린샷)
4. 한 줄 평: props(텍스트/색)·배치·이미지가 의도대로 나왔는지, 안 나온 건 무엇인지

---

## 9. 키오스크 구조 자동 구성 (폴더 중첩 → 화면 + 내비게이션)

**[NEW]** Ref 폴더 중첩 구조를 그대로 읽어 키오스크 화면 구조를 잡아주는 기능을 추가했습니다.
규칙: **모든 폴더 = 화면**, 자식 폴더가 있으면 메뉴 화면(자식 목록), 리프는 상세 화면. 내비게이션은 **드릴다운(부모→자식) + 뒤로 + 홈**.

### Stage 1 — 구조 미리보기 (지금 사용 가능, Unity·AI 불필요)

```powershell
uos kiosk-plan "D:\Unity\JangHeungKiosk\Ref\main"
# JSON으로:  uos kiosk-plan "D:\Unity\JangHeungKiosk\Ref\main" --json
# 옵션: --no-home, --no-back, --linear, --max-depth N, --back-label 뒤로, --home-label 홈
```

폴더 트리를 사이트맵(화면 트리 + 드릴다운/뒤로/홈 내비 계획)으로 출력합니다. **이 출력이 의도한 구조와 맞는지 먼저 확인**해 주세요. 자료 없는 상세 폴더는 경고로 표시됩니다. opencode 세션 안에서는 동일 로직을 `plan_kiosk_structure` 도구로도 호출할 수 있습니다.

출력 예시:

```text
Kiosk plan: .../Ref/main
Screens: 10 (menu 6, detail 4) · Navigation edges: 27 · mode: tree

[menu]   main
├─ [menu]   장흥9경
│   ├─ [menu]   천관산
│   │   ├─ [menu]   랜드마크
│   │   │   └─ [detail] 억새능선  · 자료: ref.png, screen.md
│   │   └─ [detail] 탐방로  · (자료 없음)
│   └─ ...
└─ [menu]   편의
    └─ [detail] 화장실  · (자료 없음)

Navigation: drilldown 9, back 9, home 9
```

### Stage 2 — 실제 생성 (구현 예정)

승인된 계획대로 화면을 생성(메뉴=자식 버튼 목록, 상세=폴더 자료 라우팅)하고 드릴다운/뒤로/홈 전환을 자동 배선하는 `build_kiosk_from_plan`. **Stage 1 출력이 의도와 맞다고 확인되면 이어서 구현**합니다.

### 수동 대안 (지금도 가능)

리프 폴더별 화면 생성 후 대화로 전환 연결:
`"억새능선 화면의 '이전 화면' 버튼을 누르면 랜드마크 화면으로 가는 전환을 추가해줘"` (내부적으로 `create_screen_transition`).

---

## 10. 자주 막히는 곳

| 증상 | 조치 |
|---|---|
| `uos` 명령을 못 찾음 | 1번 재설정(`bun link`) 후 새 터미널 |
| `uos projects` 에 프로젝트 안 보임 | Unity Monitor에서 브리지 Start, `uos doctor`, 그래도 안 되면 `uos doctor --clean-stale` |
| 강제 종료 후 옛 항목 남음 | `uos doctor --clean-stale` |
| AI 세션이 auth/모델에서 막힘 | `opencode auth list`, `uos doctor --runtime` |
| 화면은 생기는데 텍스트/색이 안 보임 | **즉시 저에게 공유** — v0.1.1 props 회귀일 수 있음 (최우선 수정 대상) |
| 이미지가 "could not be resized…" 로 누락 | 1차 피드백의 알려진 이슈 — 발생 시 공유, preprocess/리사이즈 경로 점검 |

---

준비되면 6~7번까지 진행해 보시고, 8번의 4가지를 공유해 주세요. 결과를 보고 막히는 지점부터 코드(저장소)에서 바로 수정하겠습니다.
