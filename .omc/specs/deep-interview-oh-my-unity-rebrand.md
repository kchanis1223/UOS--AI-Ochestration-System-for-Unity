# Deep Interview Spec: oh-my-unity 리브랜딩 (opencode.ai 호스트 이식)

## Metadata
- Interview ID: di-oh-my-unity-001
- Rounds: 7 (+ Round 0 topology gate)
- Final Ambiguity Score: 17%
- Type: brownfield
- Generated: 2026-06-02
- Threshold: 0.20
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.80 | 35% | 0.28 |
| Constraint Clarity | 0.90 | 25% | 0.23 |
| Success Criteria | 0.80 | 25% | 0.20 |
| Context Clarity | 0.80 | 15% | 0.12 |
| **Total Clarity** | | | **0.83** |
| **Ambiguity** | | | **0.17** |

## Topology
| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| host-config | active | opencode.json 작성 (모델, default_agent, permission, instructions) | AC §1, §3, §4 |
| agent-catalog | active | `.opencode/agents/*.md` 도메인 에이전트 | AC §2 (1차: primary 1개) |
| mcp-server-rebrand | active | `mcp-server/` → `.opencode/tools/*.ts` Bun 네이티브 이식 (13 tool) | AC §1 (최우선) |
| unity-package-rebrand | active | `Packages/com.lyx.unity-conv-mcp` → `com.lyx.oh-my-unity` | AC §5 |
| distribution-surface | active | README + 설치 가이드 (재설치 가능 수준) | AC §6 (최후순위) |

## Goal
opencode.ai 호스트에서 동작하는 **oh-my-unity** 패키지를 만든다. 본인이 직접 사용하는 시나리오를 1차 타깃으로 하며, 메인 워크플로우는 **"PPTX/이미지 기획서를 입력하면 Unity 안에 화면 여러 개가 자동 생성"** 이다. 현 `unity-conv-mcp`의 13개 tool과 Unity Editor Bridge를 활용하되, MCP 서버 레이어는 폐기하고 opencode 네이티브 tool(`.opencode/tools/*.ts`, Bun 런타임)로 통째 이식한다.

## Constraints
- **런타임:** Bun (네이티브 tool 강제). Node mcp-server는 폐기 또는 archive.
- **호스트:** opencode.ai 단일. 다른 MCP 호스트(Claude Code 등) 호환은 비목표.
- **Unity Editor Bridge(WebSocket)는 무수정 재사용** — 호스트 비종속이므로 그대로.
- **개발 우선순위(simplifier에서 잠금):** 1) Bun 네이티브 이식 → 2) E2E 데모 검증 → 3) README.
- **사용 대상:** 본인 1인. 미래 사용자(팀/OSS)는 미정 — 구조는 확장 가능하게 두되 1차 산출물은 본인용 정밀도.
- **외부 노출 범위:** 미정. repo 이름/GitHub 공개 여부는 1차 출시 후 결정 (Non-Goal로 격리).

## Non-Goals
- Claude Code, Cursor, Continue 등 다른 MCP 호스트 호환 유지.
- 기존 `mcp-server/` Node 코드의 유지보수.
- Unity Asset Store 배포 또는 상용화.
- 다국어 README (한국어 1종만, 본인용).
- CI/CD 파이프라인 구축, 자동 릴리즈.
- Unity 6 외 Unity 버전(2022 LTS 등) 동작 보장.

## Acceptance Criteria
- [ ] **§1 [P1]** `.opencode/tools/` 아래에 기존 13개 tool 전부 이식 완료 (`create_ui_screen`, `add_ui_element`, `update_ui_element`, `delete_ui_element`, `move_ui_element`, `create_screen_transition`, `list_screens`, `get_scene_hierarchy`, `capture_preview`, `preprocess_image`, `pptx_to_images`, `list_planning_materials`, `read_planning_material`).
- [ ] **§1.1** 각 tool은 `@opencode-ai/plugin`의 `tool()`로 정의, Zod 스키마, `context.directory`/`worktree` 직접 사용.
- [ ] **§1.2** WebSocket 클라이언트(`bridgeClient.ts`)가 Bun 런타임에서 동작 — Node `ws` 패키지 또는 Bun 기본 WebSocket으로 선택, 결과는 ADR로 기록.
- [ ] **§2 [P1]** `.opencode/agents/planner-to-screen.md` 1개 정의 — 기획 자료 읽기 + 이미지 분석 + 화면 자동 생성 + 검수 캡처 권한.
- [ ] **§3 [P1]** `opencode.json` 작성: `$schema`, `default_agent=planner-to-screen`, 모델(기본 anthropic/claude-sonnet-4-x), `permission` 정책.
- [ ] **§4 [P2, E2E]** opencode 실행 후 "이 PPTX/이미지로 화면을 만들어줘" 입력 시 Unity Editor에 화면 3~5개가 실제로 생성됨 (수동 시연 가능).
- [ ] **§5 [P2]** Unity 패키지 리브랜딩: `Packages/com.lyx.unity-conv-mcp` → `com.lyx.oh-my-unity`, asmdef 이름 변경(`Lyx.UnityConvMcp.*` → `Lyx.OhMyUnity.*`), Editor 메뉴 라벨 변경. GUID는 보존(본인 프로젝트 호환).
- [ ] **§6 [P3]** README 1개 + 설치 가이드 1개 작성. 재설치 가능한 수준(Bun 설치 → 의존성 → opencode 등록 → Unity 패키지 import 단계).
- [ ] **§7 [E2E 검증선]** 본인 1인이 다른 머신에서 가이드만 보고 처음부터 재설치하여 §4 시나리오가 동작.

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| 미래 사용자(팀/OSS)부터 정해야 한다 | Round 1 "아직 모르겠음" | 본인 1인 사용으로 1차 타깃 좁힘, OSS 여부는 Non-Goal |
| Bun 이식은 cost가 너무 크다 | Round 5 Contrarian — 13 tool 재작성 + vitest 폐기 vs 이름만 변경 | 이점(context 직접 주입, hot-reload, permission 세밀화)이 충분 — 통째 이식 유지 |
| 3개 합격선을 모두 동시 추진 | Round 7 Simplifier — 시간 한정 시 1개만 살린다면? | 우선순위 1.Bun 이식 → 2.E2E → 3.README (구조 우선) |
| 현 mcp-server는 stdio MCP다 | 코드 검증 (`mcp-server/src/index.ts:19`) | 확인 — `StdioServerTransport` 사용, opencode `mcp.local`로도 등록 가능했음. 그러나 폐기 결정 |
| cwd 의존성 점검 필요 | 사전조사 메모 | Bun 이식 시 `context.directory`/`worktree`로 자동 해결 — 별도 점검 불필요 |

## Technical Context
**현 자산 (재사용/폐기 분류)**
- 재사용: `Packages/com.lyx.unity-conv-mcp/` (Editor Bridge, ScreenFlow, UGUI 백엔드, WebSocket) — 리네이밍만 적용
- 재사용: WebSocket 프로토콜 (`EditorBridgeServer.cs` ↔ `bridgeClient.ts`)
- 폐기: `mcp-server/src/server.ts`, `tools/dispatch.ts`, `tools/definitions.ts` — `.opencode/tools/*.ts`로 재작성
- 폐기 후보: `mcp-server/test/*.test.ts` (vitest) — Bun test로 재작성 또는 삭제

**opencode 통합 표면 (사전조사 기준)**
- `opencode.json` 최상위 필드: `model`, `default_agent`, `permission`, `agent`, `command`, `instructions`, `formatter`, `lsp`, `mcp(불필요)`, `plugin`
- `.opencode/tools/*.ts` — Bun 런타임, `tool.schema` Zod, `context.{directory,worktree,sessionID,agent}` 주입
- `.opencode/agents/*.md` — frontmatter(`description`, `mode`, `model`, `permission{...}`)
- Permission patterns: `<servername>_*` (이번엔 MCP 미사용이라 builtin + native tool 이름 와일드카드)

## Ontology (Key Entities)
*Note: 본 인터뷰는 라운드별 ontology snapshot을 미수집했으므로 final 상태만 기록.*

| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| Tool | core domain | name, schema, execute, context | Tool ∈ Agent.permission |
| Agent | core domain | name, mode, model, permission, prompt | Agent uses Tool |
| Screen | domain (Unity) | id, elements[], transitions[] | Screen has many Element |
| Element | domain (Unity) | id, type, parent, rect | Element belongs to Screen |
| PlanningMaterial | input | path, kind(pptx/image), pages[] | Material → Screen[] (generation) |
| EditorBridge | infra | host, port, protocol(ws) | Tool ↔ Bridge ↔ Unity Editor |
| OpencodeConfig | infra | model, default_agent, permission | Config orchestrates Agent/Tool |

## Ontology Convergence
*Round별 추적 미수행 — single-shot ontology만 추출.*

| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1-7 | 7 (final) | N/A | N/A | N/A | N/A |

## Interview Transcript
<details>
<summary>Full Q&A (7 rounds + Round 0)</summary>

### Round 0 — Topology
**Q:** 최상위 컴포넌트 5개(host-config, agent-catalog, mcp-server-rebrand, unity-package-rebrand, distribution-surface) 토폴로지 확인
**A:** "5개 다 맞아"
**Outcome:** 5/5 active, topology locked

### Round 1 — distribution-surface / Goal
**Q:** 가장 먼저 oh-my-unity를 설치해서 쓰는 사람은 누구?
**A:** "아직 모르겠음"
**Ambiguity:** ~95%

### Round 2 — distribution-surface / Goal (재시도)
**Q:** 본인이 직접 oh-my-unity를 설치해서 Unity 작업에 쓸 계획?
**A:** "응, 바로 내가 쓸 거야"
**Ambiguity:** ~73% (Goal 0.40)

### Round 3 — agent-catalog / Goal
**Q:** 본인이 처음 켜서 주로 시키고 싶은 일?
**A:** "기획서를 통째 화면으로"
**Ambiguity:** ~58% (Goal 0.75)

### Round 4 — mcp-server-rebrand / Constraints
**Q:** mcp-server 코드를 어느 수준으로 건드릴지? (이름만/Bun 이식/하이브리드)
**A:** "Bun 네이티브로 통째 이식"
**Ambiguity:** ~45% (Constraints 0.55)

### Round 5 — Contrarian challenge (mcp-server-rebrand / Constraints 재검증)
**Q:** Bun 이식 비용/리스크 상세 제시 후 재고
**A:** "이점이 충분 — Bun 이식"
**Ambiguity:** ~40% (Constraints 0.70)

### Round 6 — 전체 / Success Criteria
**Q:** "끝났다"의 가장 명확한 장면?
**A:** "위 둘 다 + README/설치 가이드 완성"
**Ambiguity:** ~22% (Criteria 0.80)

### Round 7 — Simplifier challenge (전체 / Constraints 우선순위)
**Q:** 시간 한정 시 1개만 살린다면?
**A:** "Bun 이식 먼저"
**Ambiguity:** ~17% (Constraints 0.90) — threshold 통과
</details>
