# Plan: oh-my-unity 리브랜딩 (opencode.ai 네이티브 이식) — DRAFT v2

**Source spec:** `.omc/specs/deep-interview-oh-my-unity-rebrand.md` (ambiguity 17%, PASSED)
**Mode:** consensus / short / non-interactive
**Iteration:** v2 (반영: Architect APPROVE_WITH_IMPROVEMENTS + Critic REJECT mandatory 6건)

---

## Changelog v2

1. **Option B → Option A + Phase A.0 smoke gate** — Round 7 우선순위 잠금 준수, Principle 4 위반 제거
2. **Phase A.0 hello-world 검증 게이트 신설** — `@opencode-ai/plugin` API + `context.directory` 실측
3. **Phase C asmdef rename 절차 재작성** — name-based references 정확히 반영 (codebase 직접 확인: `Editor.asmdef` references `Lyx.UnityConvMcp.Runtime`, `Tests.Editor.asmdef` references Runtime+Editor). `rootNamespace` 필드 추가 변경 대상으로 명시
4. **AC1 → 13개 filename set equality** — `wc -l ≥ 13` 폐기
5. **`_bridge.ts` ADR화** — ping/pong, close-frame, backpressure, error propagation 4축 reject criteria
6. **Risks 4건 추가** — vitest 마이그레이션, GUID 복구, opencode permission 문법, localHandler tool 분류
7. **사실 보정**: `mcp-server/src/tools/definitions.ts:16-30` 확인 결과 일부 tool은 `localHandler`로 Unity로 proxy 안 함 (sidecar fs only). `list_planning_materials`/`read_planning_material`/`pptx_to_images`/`preprocess_image` 4개. 이식 시 `_bridge.call` 통하지 않음

---

## Requirements Summary

현 `unity-conv-mcp` 프로젝트를 opencode.ai 호스트의 **oh-my-unity**로 리브랜딩. 본인 1인 사용 1차 타깃, 메인 워크플로우 "PPTX/이미지 기획서 → Unity 화면 자동 생성". 핵심 변경:

- `mcp-server/` (Node stdio MCP, 13 tool) **폐기** → `.opencode/tools/*.ts` (Bun 네이티브) **통째 이식**
- `Packages/com.lyx.unity-conv-mcp` **리네이밍만** → `Packages/com.lyx.oh-my-unity` (로직 무변경)
- WebSocket bridge 프로토콜 **무수정 재사용**
- opencode.json + `.opencode/agents/planner-to-screen.md` 신규
- README + 설치 가이드 (재설치 가능 수준)

**우선순위 잠금 (Round 7 simplifier):** ① Bun 이식 → ② E2E 데모 → ③ README. 인터리브 금지.

---

## RALPLAN-DR Short Summary

### Principles
1. **opencode 네이티브 우선** — MCP 레이어 제거, `.opencode/tools/*.ts` 직접 사용
2. **Unity Editor Bridge 무수정 재사용** — WebSocket 프로토콜은 호스트 비종속
3. **본인 1인 정밀도** — 외부 노출 미정. README는 재설치 가능 수준까지만
4. **우선순위 위반 금지** — 13 tool 전부 이식 동작 전엔 E2E·README 시작 금지 (smoke gate는 게이트일 뿐 § 본격 E2E 아님)
5. **GUID 보존, name-reference atomic 업데이트** — `.asmdef.meta` GUID는 보존, 그러나 asmdef cross-reference는 **name-based**라 atomic 일괄 변경 필요

### Decision Drivers (top 3)
1. **opencode 호스트 통합도** — `context.directory`/`worktree` 직접 주입, hot-reload, permission 세밀화
2. **본인 1인 사용 시나리오 정밀도** — PPTX → Unity 화면 N개 E2E 작동
3. **API 가정 위험 vs 검증 시점** — `@opencode-ai/plugin`/`context` shape은 사전조사 기준, 코드 작성 전 실측 필수

### Viable Options

#### Option A + Phase A.0 smoke gate (선택)
**Approach:** 13 tool을 일자형 통째 이식. **단, Phase A.0**에서 `_bridge.ts` + 단일 hello-world tool 1개(`list_planning_materials` — read-only, no Unity)로 `@opencode-ai/plugin` API와 `context.directory` 실측. smoke gate 통과 후 나머지 12 tool bulk port → Phase C unity rename → Phase D E2E → Phase E distribution.
**Pros:**
- spec §Constraints 우선순위 잠금(① Bun 이식 → ② E2E → ③ README) 정확 준수
- API 가정 리스크를 1개 tool로 조기 노출 (Option B의 검증 효과 ~80% 회수)
- 13 tool 모두 이식 완료 후 한 번에 E2E 시연 → 합격선이 흔들리지 않음
**Cons:**
- WebSocket 호환성 이슈는 smoke gate 통과해도 12 tool 작성 후 발견될 가능성 잔존(low — `_bridge.ts`가 공통 모듈이므로 1 tool 통과하면 나머지도 통과 가능성 높음)

#### Option B — 슬라이스 우선 (rejected)
Round 7에서 사용자가 `"Bun 이식 먼저"`로 우선순위를 잠갔는데, 슬라이스 우선은 Bun 이식과 E2E를 인터리브한다. **Principle 4 위반.** 사용자 재승인 없이 채택 불가 — invalidated.

#### Option C — Hybrid 2단계 (rejected)
Round 5 Contrarian에서 사용자가 명시적으로 거절. invalidated.

### Recommended Option
**Option A + Phase A.0 smoke gate** (위 단일 후보)

---

## Acceptance Criteria (testable)

| ID | Criterion | Verification |
|---|---|---|
| AC1 | `.opencode/tools/` 디렉토리에 정확히 다음 13개 `.ts` 파일이 존재 (set equality): `create_ui_screen.ts`, `add_ui_element.ts`, `update_ui_element.ts`, `delete_ui_element.ts`, `move_ui_element.ts`, `create_screen_transition.ts`, `list_screens.ts`, `get_scene_hierarchy.ts`, `capture_preview.ts`, `preprocess_image.ts`, `pptx_to_images.ts`, `list_planning_materials.ts`, `read_planning_material.ts`. (보조 파일 `_bridge.ts` 외 다른 `.ts` 없음.) | 스크립트: 위 13개 정확히 존재 + 나열 외 파일은 `_*` prefix만 허용 |
| AC2 | 각 tool 파일이 `import { tool } from "@opencode-ai/plugin"`를 포함하고 `export default tool({...})`를 사용. Zod 또는 `tool.schema.*` 입력 스키마 존재 | grep `^import { tool } from "@opencode-ai/plugin"$` + AST: default export가 `tool()` 호출 |
| AC3 | `.opencode/tools/_bridge.ts`가 EditorBridgeServer.cs와 핸드셰이크/ping-pong/close 정상 동작 | Bun 단위 테스트 `.opencode/tools/_bridge.test.ts` 통과 (4축: connect, ping/pong, close-frame, error 전파) |
| AC4 | `.opencode/agents/planner-to-screen.md` 1개 존재, frontmatter 필드 `description`, `mode: primary`, `model`, `permission` 4개 모두 채워짐 | yaml-front-matter parse → 필드 존재 검증 |
| AC5 | `opencode.json` 작성: `$schema: "https://opencode.ai/config.json"`, `default_agent: "planner-to-screen"`, `model`, `permission` 4개 키 존재 | `opencode config validate` (실제 CLI 명령은 Phase A.0에서 확인) — fallback: 4개 키 grep |
| AC6 | opencode 실행 후 "이 PPTX로 화면 만들어줘" 입력 → Unity Editor에 화면 ≥3 자동 생성 | 수동 시연: 입력 PPTX 1개 + Unity 콘솔 로그 + 결과 스크린샷 또는 영상 1개 첨부 (`docs/demo-e2e/`) |
| AC7 | Unity 패키지 디렉토리 `Packages/com.lyx.oh-my-unity/` 존재, package.json `name` 변경, asmdef 3개 파일 모두 `name`/`rootNamespace`/`references[]` atomic 변경, **`.asmdef.meta` GUID 동일 보존** | 1) `Packages/com.lyx.oh-my-unity/package.json` name 검증 2) 3개 asmdef 모두 `Lyx.OhMyUnity.*` 사용 3) git diff 결과 `.asmdef.meta` 파일은 변경 0 |
| AC8 | Editor 메뉴 라벨에 "Unity Conv MCP" 흔적 없음, "Oh My Unity" 또는 유사 사용 | grep `\[MenuItem\(".*Unity Conv MCP.*"\)\]` 결과 0건 |
| AC9 | `README.md` + `INSTALL.md` 작성, 재설치 단계(① Bun 설치, ② `bun install`, ③ opencode.json 등록, ④ Unity 패키지 import) 모두 명시 | 마크다운 파일 존재 + 4단계 키워드 모두 존재 |
| AC10 | 본인이 다른 머신/디스크에서 INSTALL.md만 보고 §6 E2E 시나리오(AC6) 재현 | 본인 1회 검증 + 시간/이슈 메모 1개 첨부 |

---

## Implementation Steps

### Phase A.0 — Smoke Gate (검증 게이트, 1 tool only) [신설]

> 목적: `@opencode-ai/plugin` API · `context.directory` shape · `bun` 런타임 호환성 · `_bridge.ts` 4축 동작을 단일 tool로 실측. 통과 전엔 bulk port 금지.

A.0.1. **Bun 런타임 설치 확인** — `bun --version` 출력 캡처
A.0.2. **`.opencode/` 디렉토리 골격 생성** — `tools/`, `agents/`
A.0.3. **`@opencode-ai/plugin` 패키지 의존성 추가** — `package.json` (프로젝트 루트, 또는 `.opencode/package.json`) — 버전 pin
A.0.4. **`_bridge.ts` 초안 작성** — `mcp-server/src/bridge/bridgeClient.ts` 참고. 4축 명시:
   - **connect**: WebSocket(`localhost:<port>`) 핸드셰이크
   - **ping/pong**: keepalive heartbeat (EditorBridgeServer.cs가 보내는 ping에 pong 회신)
   - **close-frame**: opcode 0x8 정상 close 처리
   - **error propagation**: server-side error를 throw로 변환
A.0.5. **`list_planning_materials.ts` 단일 tool 작성** — `localHandler` 유형(Unity proxy 불필요, fs only). `tool.schema` 또는 Zod로 input schema 정의. `execute(args, ctx)`에서 `ctx.directory` 사용 검증
A.0.6. **`opencode.json` 최소 버전 작성** — `$schema`, `model`, `default_agent: "planner-to-screen"`(아직 미존재, placeholder), `permission: { *: "ask" }`
A.0.7. **`.opencode/agents/planner-to-screen.md` placeholder** — frontmatter만, body는 "TBD"
A.0.8. **Smoke 실행** — `opencode` CLI 시작, `list_planning_materials` 호출 → 정상 응답 확인
A.0.9. **`_bridge.test.ts` 작성 + 4축 통과** — AC3 통과
A.0.10. **ADR 작성** — `docs/adr/0001-bridge-implementation.md` (Bun `WebSocket` vs Node `ws` 선택 사유)

**Smoke gate 종료 조건 (모두 충족 시에만 Phase A.1 진입):**
- [x] AC2 (1 tool에 대해), AC3 (4축), AC4 (placeholder), AC5 (최소 키 4개)
- [x] ADR 0001 작성

---

### Phase A.1 — 나머지 12 tool bulk port

> 우선순위 잠금 ①에 해당. 13 tool 모두 이식 완료까지 E2E·README 시작 금지.

A.1.1. **bridge proxy 유형 tool 8개** — `_bridge.call(toolName, args)` 호출만 함:
- `create_ui_screen.ts`, `add_ui_element.ts`, `update_ui_element.ts`, `delete_ui_element.ts`, `move_ui_element.ts`, `create_screen_transition.ts`, `list_screens.ts`, `get_scene_hierarchy.ts`, `capture_preview.ts`

A.1.2. **localHandler 유형 tool 3개 추가** — Unity proxy 없이 fs 직접:
- `read_planning_material.ts`, `pptx_to_images.ts`, `preprocess_image.ts`
- (참고: `mcp-server/src/tools/definitions.ts:1-9` import에서 `pptxToImagesNotImplemented`/`preprocessImageNotImplemented` 확인 — 현재 미구현 상태. 이식 시 동일한 stub 또는 구현 결정)

A.1.3. **schema migration** — 기존 `mcp-server/src/tools/definitions.ts`의 ajv JSON Schema → Zod (또는 `tool.schema.*`) 1:1 변환. `planningIntentInputSchema`, `elementInputSchema` 등 nested 객체 재구조화.

A.1.4. **preflight 로직 이식** — `validatePlanningIntentSchema`, `validateIntentTree` 등 sidecar-local validation을 tool 함수 내부로 이동.

A.1.5. **AC1, AC2 통과 확인** — 13개 파일 set equality + import 패턴 검증

---

### Phase B — agent + opencode.json 본격 작성

B.1. **`opencode.json` 본격 작성** — model 결정(default: `anthropic/claude-sonnet-4-x`), `permission` 정책 본인 신뢰 기준 정의, `instructions` 배열에 `docs/agents-context.md` 등 포함

B.2. **`.opencode/agents/planner-to-screen.md` 본문 작성** — system prompt: "PPTX/이미지 기획서 → Unity 화면 N개 자동 생성" 워크플로우. tool 사용 우선순위 명시(`read_planning_material` → `pptx_to_images` → `preprocess_image` → `create_ui_screen` → `add_ui_element` 반복 → `capture_preview`)

B.3. **AC4, AC5 통과**

---

### Phase C — Unity 패키지 atomic rename [재작성, name-based references 정확 반영]

> **사실 (코드 확인):**
> - `Editor.asmdef` (line 2-5): `name: "Lyx.UnityConvMcp.Editor"`, `rootNamespace: "Lyx.UnityConvMcp.Editor"`, `references: ["Lyx.UnityConvMcp.Runtime", "UnityEngine.UI"]`
> - `Runtime.asmdef`: `name: "Lyx.UnityConvMcp.Runtime"`, `rootNamespace: "Lyx.UnityConvMcp"`, `references: []`
> - `Tests.Editor.asmdef`: `name: "Lyx.UnityConvMcp.Tests.Editor"`, `rootNamespace: "Lyx.UnityConvMcp.Tests"`, `references: ["Lyx.UnityConvMcp.Runtime", "Lyx.UnityConvMcp.Editor", ...]`
> - asmdef cross-reference는 **name-based**. `.asmdef.meta`는 GUID 보존.

**Atomic update sequence (한 커밋 안에서 전체 처리 — 중간 상태 컴파일 불가):**

C.1. **git tag 생성** — `git tag pre-rename-checkpoint` (rollback용)

C.2. **디렉토리 이동** — `Packages/com.lyx.unity-conv-mcp/` → `Packages/com.lyx.oh-my-unity/` (git mv 사용, .meta 함께 이동)

C.3. **`package.json` 변경** (패키지 디렉토리 내) — `name`, `displayName`, `description`, optional `author`/`repository` 업데이트

C.4. **asmdef 3개 파일 atomic 업데이트** — 한 커밋에 다음 모두:
   - `Lyx.UnityConvMcp.Editor.asmdef` → `Lyx.OhMyUnity.Editor.asmdef` (파일 이름)
     - 내부: `name: "Lyx.OhMyUnity.Editor"`, `rootNamespace: "Lyx.OhMyUnity.Editor"`, `references: ["Lyx.OhMyUnity.Runtime", "UnityEngine.UI"]`
   - `Lyx.UnityConvMcp.Runtime.asmdef` → `Lyx.OhMyUnity.Runtime.asmdef`
     - 내부: `name: "Lyx.OhMyUnity.Runtime"`, `rootNamespace: "Lyx.OhMyUnity"` (Runtime은 `Lyx.UnityConvMcp` 그대로 → `Lyx.OhMyUnity`)
   - `Lyx.UnityConvMcp.Tests.Editor.asmdef` → `Lyx.OhMyUnity.Tests.Editor.asmdef`
     - 내부: `name: "Lyx.OhMyUnity.Tests.Editor"`, `rootNamespace: "Lyx.OhMyUnity.Tests"`, `references: ["Lyx.OhMyUnity.Runtime", "Lyx.OhMyUnity.Editor", ...]`
   - **`.asmdef.meta` 파일은 변경 0** (git diff 확인)

C.5. **C# 네임스페이스 일괄 변경** — `Lyx.UnityConvMcp` → `Lyx.OhMyUnity` (모든 `.cs` 파일의 `namespace` 선언 + `using` 구문). Editor 메뉴 라벨 문자열도 함께 변경

C.6. **Unity Editor 재컴파일 확인** — 본인 기존 Unity 프로젝트(이 repo 자체)에서 콘솔 에러 0, `.meta` 파일 변경 git diff 0건

C.7. **rollback 시나리오 검증** — git tag 기반 복구 가능 확인 (실행 안 함, 절차만 메모)

C.8. **AC7, AC8 통과**

---

### Phase D — E2E 데모 검증

D.1. **본인 PPTX 1개로 시연** — opencode CLI 실행 → "이 기획서로 화면 만들어줘" → 화면 ≥3 자동 생성 확인

D.2. **시연 자료 저장** — `docs/demo-e2e/` 아래 스크린샷 또는 짧은 영상 1개 + 입력 PPTX 1개 (또는 redacted 버전)

D.3. **AC6 통과**

---

### Phase E — Distribution + Cleanup

E.1. **`README.md` 작성** — 프로젝트 정체성, 메인 워크플로우, 데모 스크린샷, 라이선스(미정 시 placeholder)

E.2. **`INSTALL.md` 작성** — 4단계:
   1. Bun 설치(공식 가이드 링크)
   2. `bun install` (의존성)
   3. opencode 등록 (`opencode.json` 위치/내용 복사 방법)
   4. Unity 패키지 import (UPM Git URL 또는 local path)

E.3. **`mcp-server/` archive** — `_archive/mcp-server-node/`로 이동, 디렉토리 내 README에 "deprecated, 참고용" 명시

E.4. **vitest 처리** — 기존 `mcp-server/test/*.test.ts`는 archive 안으로 이동(별도 마이그레이션 안 함). `.opencode/tools/`의 새 테스트는 Bun test만 사용

E.5. **AC10 본인 재설치 검증** — 다른 디스크에서 git clone → INSTALL.md만 보고 §6 시나리오 재현

E.6. **AC9, AC10 통과**

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Bun `WebSocket`이 EditorBridgeServer.cs가 보내는 ping/pong/close-frame과 불일치 | Medium | High | Phase A.0.4 4축 명시 + A.0.9 `_bridge.test.ts` smoke gate에서 발견. fallback: Node `ws` 패키지 import 결정 규칙 ADR화 |
| `@opencode-ai/plugin` `tool()`/`context` shape이 사전조사와 다름 | Medium | Medium | Phase A.0.5 hello-world 1 tool로 실측. 차이 발견 시 spec §Technical Context 갱신 후 계속 |
| asmdef name-based reference 누락으로 컴파일 깨짐 | Medium | High | C.4를 atomic 단일 커밋으로 처리. C.6에서 Unity 재컴파일 즉시 검증. C.1 git tag로 rollback |
| `.asmdef.meta` GUID 우발적 변경 | Low | High | C.6에서 `git diff '*.asmdef.meta'` 결과 0건 확인. C.7 rollback 절차 메모 |
| **[신규]** vitest → Bun test 마이그레이션 비용(미지수) | Medium | Low-Medium | E.4에서 마이그레이션 안 하고 archive로 격리. Bun test는 신규 `_bridge.test.ts`만 |
| **[신규]** `opencode.json` permission 패턴 문법이 사전조사와 다름 | Medium | Medium | Phase A.0.6에서 최소 키만(`* : ask`) 사용해 검증. B.1에서 본격 정책 작성 시 `opencode config validate`로 확인 |
| **[신규]** localHandler tool 4개의 fs 경로 해석이 `ctx.directory` 기반으로 동작 안 함 | Low | Medium | Phase A.0.5에서 `list_planning_materials`로 직접 검증 (이 tool이 localHandler 케이스라 자연스럽게 노출됨) |
| **[신규]** `pptx_to_images`/`preprocess_image`가 현재 mcp-server에서 NotImplemented 상태 | Confirmed | Medium | A.1.2에서 동일 stub로 이식. 본격 구현은 §Non-Goals 처리 (별도 작업) |
| `mcp-server/` 완전 삭제 시 이전 동작 참조 불가 | Low | Low | E.3에서 `_archive/`로 보존 |

---

## Verification Steps

V1. **Smoke gate (Phase A.0):** `bun test .opencode/tools/_bridge.test.ts` 통과 (4축 모두 pass) + 1 tool hello-world 응답 확인
V2. **AC1/AC2 자동 검사:** 스크립트로 13 파일 set equality + import 패턴 grep
V3. **opencode config 검증:** Phase A.0.6에서 사용 가능한 CLI 명령 확인 후 그 명령으로 `opencode.json` 유효성 확인 (구체 명령은 Phase A.0 결과에 따라 INSTALL.md에 기록)
V4. **Unity 재컴파일:** Phase C.6에서 Unity Editor 콘솔 에러 0 + `.asmdef.meta` git diff 0
V5. **E2E 시연:** Phase D.1에서 PPTX 1개 → 화면 ≥3 생성 영상/스크린샷 1개 `docs/demo-e2e/`
V6. **재설치 검증:** Phase E.5에서 본인이 다른 디스크에서 INSTALL.md만으로 V5 재현

---

## ADR (Architecture Decision Record) — 최종 합의 후

### ADR-0001: `_bridge.ts` 구현 선택 (Phase A.0 산출)

- **Status:** TBD (Phase A.0.10에서 작성)
- **Decision:** TBD — Bun 네이티브 `WebSocket` (Web API) 또는 Node `ws` 패키지
- **Drivers:** ping/pong heartbeat 호환성, close-frame 처리, backpressure, error propagation 4축
- **Alternatives considered:** (1) Bun native `WebSocket`, (2) Node `ws` 패키지 import via Bun
- **Reject criteria (사전 정의):** 다음 중 1개라도 실패 시 fallback:
   - EditorBridgeServer.cs가 보내는 ping frame에 자동/수동 pong 회신 불가
   - close-frame opcode 0x8 정상 처리 불가
   - 큰 페이로드 backpressure 누락
   - 서버 측 error를 client에서 throw로 잡지 못함
- **Consequences:** TBD
- **Follow-ups:** TBD

### ADR-0002: Option A + Phase A.0 smoke gate vs Option B (슬라이스)

- **Status:** APPROVED (v2 반영)
- **Decision:** Option A + Phase A.0 smoke gate
- **Drivers:** spec §Constraints 우선순위 잠금 준수, API 가정 조기 검증, 13 tool deliverable 단일성
- **Alternatives considered:** Option B (슬라이스 우선) — Round 7 잠금 reinterpret로 인해 reject. Option C (hybrid) — Round 5에서 사용자 거절
- **Why chosen:** Phase A.0 smoke gate가 Option B의 risk-discovery 효과 ~80%를 회수하면서 Principle 4를 준수
- **Consequences:** A.0가 추가 phase로 1단계 늘어남. 그러나 후속 단계의 재작업 리스크가 크게 감소
- **Follow-ups:** A.0 완료 후 ADR-0001 작성. Option B 재고는 사용자 명시적 요청 시에만

---

## Non-Goals (from spec)

- 다른 MCP 호스트 호환
- 기존 `mcp-server/` 유지보수 (archive만)
- `pptx_to_images`/`preprocess_image`의 본격 구현 (현재 NotImplemented stub 유지)
- Unity Asset Store 배포
- 다국어 README
- CI/CD
- Unity 6 외 버전 호환
