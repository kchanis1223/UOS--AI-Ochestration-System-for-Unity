# 2026-09-04 UOS macOS MVP 복구·점검 핸드오프

## 배경

- 마지막 커밋(`9ea4008 "260625 update"`, 2026-06-25) 이후 약 2개월 중단.
- 개발 환경이 Windows(`C:\Users\lyx\MCP_for_Unity_LYX`)에서 macOS
  (`/Users/p178/UOS--AI-Ochestration-System-for-Unity`)로 이동됨.
- "추가기능 구현·리팩토링 후 오류가 있는 상태"로 보고되어 전체 재점검 수행.
- 목표: 이 맥북에서 GUI 중심 MVP가 실행 가능하도록 복구하고 마무리.

## 진단 결과

워킹트리는 clean이었고, 오류의 실체는 다음과 같이 확인됨.

1. **제품 로직은 건강함.** bin 스크립트 전체 `node --check` 통과, opencode
   도구 63종 bun 빌드 통과, GUI 프론트엔드 vite 빌드 통과, GUI 서버 기동 및
   REST API 응답 정상 (POSIX 환경에서 확인).
2. **테스트 스위트가 Windows에 결합되어 있었음.** 355개 중 9개 실패 — 전부
   `D:/`·`C:/` 드라이브 픽스처(POSIX에서는 절대경로가 아님), 백슬래시 경로
   문자열 기대, 옛 저장소 폴더명 `MCP_for_Unity_LYX` 기대, PowerPoint 감지
   (Windows 전용)를 플랫폼 구분 없이 기대한 테스트 이식성 문제. 제품 버그
   아님.
3. **크로스 플랫폼 지원은 이미 구현되어 있음.** 레지스트리 경로
   (`~/.local/share/oh-my-unity/editors` — Unity Mono의 LocalApplicationData와
   일치), macOS Unity Hub 실행 파일 탐색(`/Applications/Unity/Hub/Editor/...`),
   `open`을 통한 브라우저 실행, opencode auth 파일 탐색 모두 darwin 분기 존재.

## 이번 세션에서 수정·추가한 것

1. `tests/uos-core.test.ts` — 플랫폼 이식성 수정:
   - `dabs()`/`cabs()` 헬퍼 추가: win32에서는 `D:/`·`C:/`, POSIX에서는 `/`
     루트로 절대경로 픽스처 생성.
   - 실패하던 9개 테스트의 드라이브 경로 픽스처를 헬퍼로 교체.
   - doctor 테스트에 `platform: "win32"` 옵션 주입(모의 reg.exe/PowerPoint
     경로와 일치), 로컬 플러그인 경로 단언을 `join()` 기반으로 변경.
   - `inspectOpencodeRuntime` 중복 플러그인 픽스처를 `pathToFileURL` 기반으로
     플랫폼 독립화. 옛 폴더명(`MCP_for_Unity_LYX`) 의존 단언을 실제 repo
     루트 비교로 교체.
2. `tests/uos-gui-server.test.ts` — **신규 GUI 서버 E2E 테스트** (mocked
   bridge + mocked opencode):
   - 프로젝트 카탈로그의 connected 판정, 세션 생성, 풀 오케스트레이터 채팅
     라우팅, 턴 승인 준비, 브리지 preflight, headless opencode 인자 구성
     (`run --format json --agent ochestrator`), 이벤트 스트림, opencode 세션
     ID 지속, 토큰 미노출(redaction), light-local 라우트까지 검증.
   - `package.json` 테스트 스크립트에 등록.
3. `README.md` — 상태 문구 갱신 + **macOS Quickstart** 섹션 추가 + 테스트
   베이스라인 갱신(359 pass / 20 files).

검증 결과: **`bun run test` 359 pass / 0 fail** (Linux 컨테이너, POSIX 경로).

## 이 맥북에서 MVP 실행 준비 (사용자 확인 필요)

코드가 아닌 호스트 환경 요건. README Quickstart(macOS) 참고:

1. `brew install oven-sh/bun/bun`, `npm install -g opencode-ai` (또는 brew).
2. 저장소 루트와 `.opencode/` 모두 의존성 설치.
3. `npm link`로 `uos` 명령 노출 → `uos setup --unity-projects <폴더> --language ko`.
4. `uos doctor`에서 node/bun/opencode `[ok]` 확인, `uos doctor --runtime`으로
   opencode 인증·모델 확인 (`opencode.json`은 `anthropic/claude-opus-4-8`
   고정 — 필요 시 갱신).
5. Unity 6 프로젝트에 `uos install-unity <프로젝트>` 후 Unity를 열고
   `Window > Oh My Unity > Monitor`에서 브리지 확인.
6. `uos gui`로 브라우저 워크벤치 진입 → Projects에서 연결 → Chat에서 기획서
   기반 화면 생성 요청.

## 남은 작업 (미완)

- 이 맥북의 실제 Unity 프로젝트로 사용자 주도 라이브 검증
  (`docs/handoff/2026-06-05-uos-completion-audit.md`의 7개 수용 게이트).
- Unity EditMode 테스트를 macOS Unity에서 재실행 (기존 54+1개 기대).
- `.mcp.json`은 레거시(옛 Windows 경로의 mcp-server + 하드코딩 토큰 참조) —
  `_archive/`로 이동 권장. UOS 런타임은 이 파일을 사용하지 않음.
- PPTX 렌더링 슬라이드는 LibreOffice 설치 시 활성화(`brew install --cask
  libreoffice`); 미설치여도 텍스트/레이아웃 추출 경로는 동작.
