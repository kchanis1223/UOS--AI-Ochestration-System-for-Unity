# Plan: oh-my-unity 리브랜딩 (opencode.ai 네이티브 이식) — FINAL v3 [pending approval]

**Source spec:** `.omc/specs/deep-interview-oh-my-unity-rebrand.md` (ambiguity 17%, PASSED)
**Mode:** consensus / short / non-interactive
**Consensus reached:** iter 2 — Architect APPROVE_WITH_IMPROVEMENTS, Critic APPROVE_WITH_IMPROVEMENTS
**Status:** pending approval

---

## Changelog

### v3 (final, post-consensus minor merges)
- A.0.10: ADR-0001 status는 Phase A.0 종료 시 `APPROVED` 또는 `REJECTED-FALLBACK`로 확정. **TBD 상태로 Phase B 진입 금지.**
- A.0.7: agent placeholder는 "최소 valid frontmatter + 1줄 body" — opencode CLI 파싱 에러 방지
- A.1.2: localHandler tool 카운트 명시화 — "A.0에서 1개(list_planning_materials) 완료 + 나머지 3개"
- A.0.4 백프레셔 축: **검증 only**(현 `bridgeClient.ts`는 명시적 backpressure 코드 없음 → 새 기능 요구 아님, scope creep 방지)
- A.1.1에 correlator/reconnect 로직 이식 명시 — `bridgeClient.ts:74` `correlator.rejectAll`, `bridgeClient.ts:132` `scheduleReconnect` 동등 기능
- A.1.2 stub shape 잠금 — `pptxToImagesNotImplemented`/`preprocessImageNotImplemented`는 **동일 stub로 이식, 구현은 Non-Goal**
- AC10 환경 메모 — 동일 OS/Unity 버전 가정, 별도 머신은 over-spec
- Risks 1행 추가 — ajv → Zod nested schema 변환 비용
- V3 메모 — `opencode config validate` 실제 명령 존재 여부는 A.0 산출물

### v2 (iter-1 mandatory 반영)
1. Option B → Option A + Phase A.0 smoke gate
2. Phase A.0 hello-world 검증 게이트 신설
3. Phase C asmdef rename 절차 재작성 (name-based + rootNamespace + atomic)
4. AC1 → 13개 filename set equality
5. `_bridge.ts` ADR화 (4축 reject criteria)
6. Risks 4건 추가
7. `mcp-server/src/tools/definitions.ts` 사실 보정 (localHandler 4개 분류)

---

## Requirements Summary

현 `unity-conv-mcp` 프로젝트를 opencode.ai 호스트의 **oh-my-unity**로 리브랜딩. 본인 1인 사용 1차 타깃, 메인 워크플로우 "PPTX/이미지 기획서 → Unity 화면 자동 생성".

- `mcp-server/` (Node stdio MCP, 13 tool) **폐기** → `.opencode/tools/*.ts` (Bun 네이티브) **통째 이식**
- `Packages/com.lyx.unity-conv-mcp` **리네이밍만** → `Packages/com.lyx.oh-my-unity` (로직 무변경)
- WebSocket bridge 프로토콜 **무수정 재사용**
- opencode.json + `.opencode/agents/planner-to-screen.md` 신규
- README + 설치 가이드 (재설치 가능 수준)

**우선순위 잠금 (Round 7 simplifier):** ① Bun 이식 → ② E2E 데모 → ③ README. 인터리브 금지(smoke gate는 게이트일 뿐 E2E 아님).

---

## RALPLAN-DR Short Summary

### Principles
1. **opencode 네이티브 우선** — MCP 레이어 제거, `.opencode/tools/*.ts` 직접 사용
2. **Unity Editor Bridge 무수정 재사용** — WebSocket 프로토콜은 호스트 비종속
3. **본인 1인 정밀도** — 외부 노출 미정. README는 재설치 가능 수준까지만
4. **우선순위 위반 금지** — 13 tool 전부 이식 동작 전엔 본격 E2E·README 시작 금지
5. **GUID 보존, name-reference atomic 업데이트** — `.asmdef.meta` GUID 보존, asmdef cross-reference는 name-based라 atomic 일괄 변경

### Decision Drivers (top 3)
1. opencode 호스트 통합도 (context.directory 직접 주입, hot-reload, permission 세밀화)
2. 본인 1인 사용 시나리오 정밀도 (PPTX → Unity 화면 N개 E2E 작동)
3. API 가정 위험 vs 검증 시점 (`@opencode-ai/plugin`/`context` shape은 사전조사 기준)

### Viable Options (final)
- **Option A + Phase A.0 smoke gate** ✅ APPROVED
- **Option B (슬라이스 우선)** — invalidated: Principle 4 위반(Round 7 잠금 reinterpret)
- **Option C (hybrid 2단계)** — invalidated: Round 5 Contrarian에서 사용자 명시적 거절

---

## Acceptance Criteria

| ID | Criterion | Verification |
|---|---|---|
| AC1 | `.opencode/tools/` 디렉토리에 정확히 다음 13개 `.ts` 파일이 존재 (set equality): `create_ui_screen.ts`, `add_ui_element.ts`, `update_ui_element.ts`, `delete_ui_element.ts`, `move_ui_element.ts`, `create_screen_transition.ts`, `list_screens.ts`, `get_scene_hierarchy.ts`, `capture_preview.ts`, `preprocess_image.ts`, `pptx_to_images.ts`, `list_planning_materials.ts`, `read_planning_material.ts`. 보조 파일은 `_*` prefix만 허용 | 스크립트로 set equality 검증 |
| AC2 | 각 tool 파일이 `import { tool } from "@opencode-ai/plugin"` 포함, `export default tool({...})` 사용, Zod 또는 `tool.schema.*` 입력 스키마 존재 | grep + AST 검증 |
| AC3 | `.opencode/tools/_bridge.ts`가 EditorBridgeServer.cs와 4축(connect, ping/pong, close-frame, error 전파) 정상 동작 | `bun test .opencode/tools/_bridge.test.ts` 통과 |
| AC4 | `.opencode/agents/planner-to-screen.md` 존재, frontmatter `description`/`mode: primary`/`model`/`permission` 4개 필드 모두 채워짐 | yaml parse + 필드 존재 검증 |
| AC5 | `opencode.json`: `$schema: "https://opencode.ai/config.json"`, `default_agent: "planner-to-screen"`, `model`, `permission` 4개 키 존재 | `opencode config validate` (CLI 실명령은 A.0 산출) — fallback: 4키 grep |
| AC6 | opencode 실행 후 "이 PPTX로 화면 만들어줘" → Unity Editor에 화면 ≥3 자동 생성 | 수동 시연 + 스크린샷/영상 1개 첨부 (`docs/demo-e2e/`) |
| AC7 | `Packages/com.lyx.oh-my-unity/` 디렉토리, package.json `name` 변경, asmdef 3개 모두 `name`/`rootNamespace`/`references[]` atomic 변경, `.asmdef.meta` GUID 보존 | 1) 디렉토리 존재 2) 3개 asmdef `Lyx.OhMyUnity.*` 3) `git diff '*.asmdef.meta'` = 0 |
| AC8 | Editor 메뉴 라벨 "Unity Conv MCP" 흔적 0 | `grep '\[MenuItem(".*Unity Conv MCP.*")\]'` → 0건 |
| AC9 | `README.md` + `INSTALL.md`, 재설치 4단계(Bun 설치, `bun install`, opencode 등록, Unity import) 모두 명시 | 마크다운 + 키워드 4개 grep |
| AC10 | 본인이 다른 디스크에서 INSTALL.md만 보고 AC6 재현 (동일 OS/Unity 버전 가정) | 본인 1회 검증 + 메모 1개 |

---

## Implementation Steps

### Phase A.0 — Smoke Gate (1 tool only, 검증 게이트)

> 목적: `@opencode-ai/plugin` API · `context.directory` shape · Bun 런타임 · `_bridge.ts` 4축을 1 tool로 실측. 통과 전 bulk port 금지.

A.0.1. `bun --version` 출력 캡처
A.0.2. `.opencode/{tools,agents}/` 골격 생성
A.0.3. `@opencode-ai/plugin` 의존성 추가 (`package.json`, **버전 pin**)
A.0.4. **`_bridge.ts` 초안 작성** — `mcp-server/src/bridge/bridgeClient.ts:74,132` 참고. 4축 명시:
   - **connect**: `localhost:<port>` 핸드셰이크
   - **ping/pong**: application-level (현 코드 `kind:"ping"/"pong"` JSON 메시지)
   - **close-frame**: 정상 close 처리
   - **error propagation**: server-side error → throw 변환
   - **(backpressure: 검증 only — 새 기능 구현 아님)**
A.0.5. `list_planning_materials.ts` 단일 tool 작성 (localHandler 유형, no Unity proxy). `ctx.directory` 사용
A.0.6. **`opencode.json` 최소 버전** — `$schema`, `model`, `default_agent: "planner-to-screen"`, `permission: { *: "ask" }`
A.0.7. **`.opencode/agents/planner-to-screen.md` placeholder** — frontmatter 필수 필드만 + body는 1줄 (`"TBD: PPTX → Unity 화면 생성 워크플로우. Phase B에서 본격 작성."`). opencode CLI 파싱 에러 회피
A.0.8. Smoke 실행 — `opencode` CLI 시작, `list_planning_materials` 호출 → 정상 응답
A.0.9. `_bridge.test.ts` 4축 통과 → AC3
A.0.10. **ADR-0001 작성 + status 확정** — `APPROVED` (Bun native) 또는 `REJECTED-FALLBACK` (Node `ws`) 둘 중 하나. **TBD 상태로 Phase B 진입 금지.**

**Smoke gate 종료 조건:**
- [x] AC2(1 tool), AC3(4축), AC4(placeholder), AC5(4 키)
- [x] ADR-0001 status = APPROVED or REJECTED-FALLBACK (not TBD)

### Phase A.1 — 나머지 12 tool bulk port

A.1.1. **bridge proxy 유형 tool 9개** — `_bridge.call(toolName, args)`:
- `create_ui_screen.ts`, `add_ui_element.ts`, `update_ui_element.ts`, `delete_ui_element.ts`, `move_ui_element.ts`, `create_screen_transition.ts`, `list_screens.ts`, `get_scene_hierarchy.ts`, `capture_preview.ts`
- **correlator/reconnect 이식**: `bridgeClient.ts:74` `correlator.rejectAll`, `bridgeClient.ts:132` `scheduleReconnect` 동등 기능을 `_bridge.ts`에 포함 (long-lived 단일 인스턴스로 multi-tool 호출 처리)

A.1.2. **localHandler 유형 tool 3개 추가** (A.0에서 1개 완료 + 나머지 3개 = 총 4개):
- `read_planning_material.ts`
- `pptx_to_images.ts` — **stub 이식, 구현은 Non-Goal**
- `preprocess_image.ts` — **stub 이식, 구현은 Non-Goal**
- stub shape: 현 `pptxToImagesNotImplemented`/`preprocessImageNotImplemented` 동등 동작 유지

A.1.3. **schema migration** — `mcp-server/src/tools/definitions.ts` ajv JSON Schema → Zod 1:1 변환. nested 객체(`planningIntentInputSchema`, `elementInputSchema`) 재구조화.

A.1.4. **preflight 이식** — `validatePlanningIntentSchema`, `validateIntentTree` 등을 tool 함수 내부로 이동

A.1.5. AC1, AC2 통과

### Phase B — agent + opencode.json 본격

B.1. `opencode.json` 본격 — model(`anthropic/claude-sonnet-4-x`), permission 정책, `instructions` 배열
B.2. `planner-to-screen.md` 본문 — PPTX → 화면 N개 워크플로우 system prompt, tool 사용 우선순위 명시
B.3. AC4, AC5 통과

### Phase C — Unity 패키지 atomic rename

> **사실 (코드 검증):** Editor.asmdef references `["Lyx.UnityConvMcp.Runtime", "UnityEngine.UI"]`, Runtime.asmdef references `[]`, Tests.Editor.asmdef references `["Lyx.UnityConvMcp.Runtime", "Lyx.UnityConvMcp.Editor", ...]`. 모두 **name-based**.

**Atomic update — 단일 커밋:**

C.1. `git tag pre-rename-checkpoint` (rollback)
C.2. `git mv Packages/com.lyx.unity-conv-mcp Packages/com.lyx.oh-my-unity` (.meta 동반)
C.3. `package.json` (패키지 내) name/displayName/description 업데이트
C.4. **asmdef 3개 atomic 업데이트:**
   - `Lyx.UnityConvMcp.Editor.asmdef` → `Lyx.OhMyUnity.Editor.asmdef`. 내부: `name: "Lyx.OhMyUnity.Editor"`, `rootNamespace: "Lyx.OhMyUnity.Editor"`, `references: ["Lyx.OhMyUnity.Runtime", "UnityEngine.UI"]`
   - `Lyx.UnityConvMcp.Runtime.asmdef` → `Lyx.OhMyUnity.Runtime.asmdef`. 내부: `name: "Lyx.OhMyUnity.Runtime"`, `rootNamespace: "Lyx.OhMyUnity"`
   - `Lyx.UnityConvMcp.Tests.Editor.asmdef` → `Lyx.OhMyUnity.Tests.Editor.asmdef`. 내부: `name: "Lyx.OhMyUnity.Tests.Editor"`, `rootNamespace: "Lyx.OhMyUnity.Tests"`, `references: ["Lyx.OhMyUnity.Runtime", "Lyx.OhMyUnity.Editor", ...]`
   - **`.asmdef.meta` 변경 0**
C.5. C# 일괄 변경 — `Lyx.UnityConvMcp` → `Lyx.OhMyUnity` (namespace/using/MenuItem 문자열 포함)
C.6. Unity Editor 재컴파일 — 콘솔 에러 0, `git diff '*.asmdef.meta'` 0건
C.7. rollback 절차 메모 (실행 안 함)
C.8. AC7, AC8 통과

### Phase D — E2E 데모

D.1. 본인 PPTX 1개 시연 → 화면 ≥3 자동 생성
D.2. `docs/demo-e2e/` 저장 (스크린샷/영상 + 입력)
D.3. AC6 통과

### Phase E — Distribution + Cleanup

E.1. README.md (정체성, 워크플로우, 데모, 라이선스 placeholder)
E.2. INSTALL.md 4단계
E.3. `mcp-server/` → `_archive/mcp-server-node/`, archive README "deprecated"
E.4. 기존 vitest 테스트는 archive로 이동(마이그레이션 없음). `_bridge.test.ts`만 Bun test
E.5. AC10 본인 재설치 검증 (다른 디스크, 동일 OS/Unity)
E.6. AC9, AC10 통과

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Bun `WebSocket`이 EditorBridgeServer.cs ping/pong/close와 불일치 | Medium | High | Phase A.0.4 4축 + A.0.9 smoke gate. ADR-0001 reject criteria로 fallback 자동화 |
| `@opencode-ai/plugin` `tool()`/`context` shape 미일치 | Medium | Medium | Phase A.0.5 hello-world 실측 |
| asmdef name-based reference 누락 컴파일 깨짐 | Medium | High | C.4 atomic 단일 커밋. C.6 즉시 재컴파일 검증. C.1 git tag rollback |
| `.asmdef.meta` GUID 우발 변경 | Low | High | C.6 `git diff '*.asmdef.meta'` 0 확인 |
| vitest → Bun test 마이그레이션 비용 미지수 | Medium | Low-Medium | E.4: 마이그레이션 안 함, archive로 격리 |
| `opencode.json` permission 패턴 문법 미일치 | Medium | Medium | A.0.6 최소 키만 + B.1 본격 정책 시 `opencode config validate` |
| localHandler tool fs 경로 해석 실패 | Low | Medium | A.0.5 `list_planning_materials`로 자연 노출 |
| `pptx_to_images`/`preprocess_image` NotImplemented stub | Confirmed | Medium | A.1.2 동일 stub 이식, 본격 구현은 Non-Goal |
| `mcp-server/` 참조 손실 | Low | Low | E.3 `_archive/`로 보존 |
| **ajv → Zod nested schema 변환 비용 미지수** | Medium | Low-Medium | A.1.3에서 nested 객체 우선 변환. 차이 발견 시 ADR 추가 |
| correlator/reconnect long-lived 인스턴스가 multi-tool 호출 환경에서 동작 안 함 | Medium | Medium | A.1.1에서 명시 이식. A.0 통과 후 첫 multi-tool 시나리오에서 검증 |

---

## Verification Steps

V1. **Smoke gate (A.0):** `bun test .opencode/tools/_bridge.test.ts` 4축 통과 + hello-world 응답
V2. **AC1/AC2 자동:** 13 파일 set equality + `import { tool } from "@opencode-ai/plugin"` grep
V3. **opencode config 검증:** `opencode config validate` 또는 동등 CLI 명령 사용 (**실제 명령은 Phase A.0.8 산출물** — `opencode --help` 확인 후 INSTALL.md에 기록)
V4. **Unity 재컴파일:** C.6 Unity Editor 콘솔 에러 0 + `.asmdef.meta` diff 0
V5. **E2E 시연:** D.1 PPTX 1개 → 화면 ≥3 영상 1개
V6. **재설치:** E.5 다른 디스크에서 INSTALL.md만으로 V5 재현 (동일 OS/Unity)

---

## ADR

### ADR-0001: `_bridge.ts` 구현 선택
- **Status:** TBD (Phase A.0.10에서 APPROVED 또는 REJECTED-FALLBACK으로 확정. 이 status 확정 전 Phase B 진입 금지)
- **Decision:** TBD — Bun 네이티브 `WebSocket` (Web API) 또는 Node `ws` 패키지
- **Drivers:** ping/pong heartbeat, close-frame, error propagation 호환성 (backpressure는 검증 only)
- **Alternatives considered:** (1) Bun native `WebSocket`, (2) Node `ws` Bun import
- **Reject criteria:** 다음 중 1개 실패 시 fallback to `ws`:
  - EditorBridgeServer.cs application-level ping(`{kind:"ping"}`)에 pong(`{kind:"pong"}`) JSON 회신 불가
  - close-frame 처리 시 에러 던짐
  - 서버 측 error를 client에서 throw로 잡지 못함
- **Consequences:** TBD
- **Follow-ups:** A.0 완료 후 작성

### ADR-0002: Option A + Phase A.0 smoke gate
- **Status:** APPROVED
- **Decision:** Option A + Phase A.0 smoke gate
- **Drivers:** Principle 4 (우선순위 잠금) 준수, API 가정 조기 검증, 13 tool deliverable 단일성
- **Alternatives considered:** Option B (슬라이스 — Round 7 잠금 reinterpret로 reject), Option C (Round 5 사용자 거절)
- **Why chosen:** Phase A.0 smoke gate가 Option B의 risk-discovery 효과 ~80%를 회수하면서 우선순위 위반 없음
- **Consequences:** A.0 phase 추가, 후속 재작업 리스크 감소
- **Follow-ups:** Option B 재고는 사용자 명시적 요청 시에만

---

## Non-Goals (from spec)

- 다른 MCP 호스트(Claude Code/Cursor 등) 호환
- 기존 `mcp-server/` 유지보수 (archive만)
- `pptx_to_images`/`preprocess_image` 본격 구현 (stub 유지)
- Unity Asset Store 배포
- 다국어 README
- CI/CD
- Unity 6 외 버전 호환

---

## Consensus Trail

- **iter 1 Architect:** APPROVE_WITH_IMPROVEMENTS (6건)
- **iter 1 Critic:** REJECT (mandatory 6건, asmdef name-based 신규 발견)
- **iter 2 Architect:** APPROVE_WITH_IMPROVEMENTS (비차단 3건)
- **iter 2 Critic:** APPROVE_WITH_IMPROVEMENTS (mandatory 6건 RESOLVED, minor 권고)
- **v3 (이 문서):** Critic minor 권고 + Architect 비차단 3건 모두 머지

---

## Status

**pending approval** — 별도 실행 승인이 있어야 ralph/team/autopilot으로 진행. plan-only 단계 종료.
