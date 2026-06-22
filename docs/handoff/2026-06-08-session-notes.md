# UOS 세션 노트 — 2026-06-08

UOS를 테스트·완성하는 세션. 라이브 Unity 프로젝트(`D:\UnityProject\UOS_Test`, URP, Unity 6000.3.3f1)로 검증하며 발견한 이슈를 수정했고, 폴더→키오스크 구조 기능(Stage 1)을 추가했다.

## 1) 버그 수정 — 부모-자식 좌표 (parent-relative nesting)

### 증상
스모크(`uos smoke --write --preview`)로 생성한 화면에서 **자식 요소(타이틀/버튼/입력/토글/슬라이더)가 부모 패널 밖·화면 밖으로 튕겨나감.** props(색/텍스트/폰트)는 정상 렌더(=v0.1.1 props 수정은 동작).

### 근본 원인
`UguiBackend`가 **모든 요소에 캔버스 치수(referenceCanvas)** 로 normalized rect를 환산. 자식은 부모 코너에 앵커되지만 size/offset이 캔버스 기준이라 부모 밖으로 나감. (JangHeung 1차 피드백의 Category C "부모-자식 좌표"; v0.1.1 Tier 0에서 보류됐던 항목.)

### 수정
`Packages/com.lyx.oh-my-unity/Editor/Generation/UguiBackend.cs` 3곳:
- `CreateScreen`: 새 로컬 함수 `ParentFrameSize(el)`로 **자식 rect를 부모 박스 기준**으로 환산(최상위만 캔버스). 임의 깊이 중첩 지원, cycle guard 포함.
- `AddElement`: 동적 추가 시 부모가 요소면 부모 `sizeDelta`(=부모 px 박스)를 프레임으로 사용.
- `UpdateElement`: 업데이트 시에도 부모 박스 기준으로 해석(부모가 Canvas면 캔버스).

최상위 요소(부모=Canvas)는 기존 동작과 동일 → 기존 계약/테스트 유지.

### 검증
- 스모크 재실행(재컴파일 후): 타이틀/버튼/입력/토글/슬라이더가 **모두 패널 내부**로 정상 배치됨(프리뷰 PNG로 확인).
- 회귀 테스트 추가: `Packages/com.lyx.oh-my-unity/Tests/Editor/UguiBackendTests.cs` →
  `CreateScreen_ChildRect_IsRelativeToParentBox_NotCanvas` (자식(0,0,1,1)이 부모 500px를 채우는지 검증).
- ⏳ **남은 확인**: Unity EditMode 전체 실행(Window > Test Runner > EditMode). 기존 54 + 신규 1 = **55개 통과** 기대.

> 운영 팁: 이 패키지는 `file:` 로컬 링크라 외부 드라이브 변경을 Unity가 포커스만으로는 감지 못 함. **Unity 재시작**(또는 Reimport)해야 재컴파일됨.

## 2) 기능 추가 — 폴더 중첩 → 키오스크 구조 플래너 (Stage 1)

폴더 구조(예: `Ref/main/장흥9경/천관산/랜드마크/억새능선`)를 읽어 화면 트리 + 내비게이션 계획(사이트맵)을 결정적으로 산출. **모든 폴더=화면**(자식 있으면 menu, leaf는 detail), 내비는 드릴다운+뒤로+홈.

- `bin/kiosk-core.js` (신규) — 순수 JS 플래너 코어(node/bun 공용, Unity·AI 불필요).
- `bin/uos.js` — `uos kiosk-plan <dir>` CLI 추가(즉시 프리뷰; `--json/--no-back/--no-home/--linear/--max-depth/--back-label/--home-label`).
- `.opencode/tools/plan_kiosk_structure.ts` (신규) — opencode 세션용 동일 로직 도구.
- `tests/kiosk.test.ts` (신규) — 단위테스트 14개(결정성·역할·내비·명명충돌·자연정렬), **전부 통과**(bun). `package.json` 테스트 스크립트에 등록.

**Stage 2(미구현)**: 승인된 계획으로 화면 생성(메뉴=자식 버튼, 상세=자료 라우팅) + 전환 자동 배선 `build_kiosk_from_plan`. 기획 분석상 각 폴더의 `화면 구성.png`(레이아웃 시안)·콘텐츠 사진·기획서 텍스트를 구분/매칭하도록 정교화 예정.

## 3) 신규 문서
- `docs/uos-newproject-test-guide.md` — 새 프로젝트 설치~실행 가이드(+kiosk-plan).
- `docs/kiosk-content-analysis.md` — UOS_Test 기획서/시안 분석(키오스크 사양, 화면 5유형, 폴더 매핑).
- `docs/handoff/2026-06-08-session-notes.md` — 본 문서.

## 4) 이번 세션이 만진 파일
```
M  Packages/com.lyx.oh-my-unity/Editor/Generation/UguiBackend.cs   (좌표 수정)
?? Packages/com.lyx.oh-my-unity/Tests/Editor/UguiBackendTests.cs   (중첩 회귀 테스트; 파일 자체 untracked)
M  bin/uos.js                                                       (kiosk-plan CLI)
?? bin/kiosk-core.js                                                (플래너 코어)
?? .opencode/tools/plan_kiosk_structure.ts                         (플래너 도구)
?? tests/kiosk.test.ts                                             (플래너 테스트)
M  package.json                                                     (테스트 등록)
?? docs/uos-newproject-test-guide.md
?? docs/kiosk-content-analysis.md
?? docs/handoff/2026-06-08-session-notes.md
```

## 5) 커밋 방법 (동찬님 PC에서 실행)

워킹트리에 미커밋 변경이 144개(과거 v0.1.1 등 + 이번 세션) **혼재**돼 있고, crashed git이 남긴 stale lock이 있다. 먼저 lock 제거 후 커밋:

```powershell
cd C:\Users\lyx\MCP_for_Unity_LYX
Remove-Item .git\index.lock        # crashed git이 남긴 0바이트 stale lock 제거
git status                          # 무엇이 커밋될지 검토 (.uos 프리뷰 등 산출물 포함 여부 확인)
```

이번 세션 변경만 따로 묶고 싶다면(과거 미커밋 작업과 파일이 섞인 UguiBackend.cs/uos.js는 통째로 들어감):

```powershell
git add bin/kiosk-core.js bin/uos.js package.json tests/kiosk.test.ts `
        .opencode/tools/plan_kiosk_structure.ts `
        Packages/com.lyx.oh-my-unity/Editor/Generation/UguiBackend.cs `
        Packages/com.lyx.oh-my-unity/Tests/Editor/UguiBackendTests.cs `
        docs/uos-newproject-test-guide.md docs/kiosk-content-analysis.md docs/handoff/2026-06-08-session-notes.md
git commit -m "fix(ugui): parent-relative nested element coords; feat(uos): kiosk structure planner (Stage 1) + docs"
```

또는 누적된 전체 작업을 체크포인트로 한 번에:

```powershell
git add -A
git commit -m "checkpoint: v0.1.1 carryover + nested-coords fix + kiosk planner (Stage 1)"
```

## 6) 다음 단계
1. EditMode 55개 통과 확인.
2. AI 자료→화면 경로 검증(`uos run`/`uos chat`, 실제 Ref 콘텐츠) — opencode 대화형 경로(인증/모델 관여). `uos doctor --runtime` 선확인.
3. (Ref 준비 후) 키오스크 Stage 2 `build_kiosk_from_plan` 구현.
