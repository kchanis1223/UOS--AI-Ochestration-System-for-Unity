import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Bot,
  Check,
  ExternalLink,
  FileUp,
  FolderOpen,
  MessageSquare,
  Play,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import "./styles.css";

const tabs = [
  { id: "projects", label: "Projects", icon: FolderOpen },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "blueprint", label: "Blueprint", icon: ShieldCheck },
  { id: "assets", label: "Assets", icon: FileUp },
  { id: "activity", label: "Activity", icon: Activity },
];

const examples = [
  "첨부한 기획 자료를 읽고 제작 의도를 정리해줘.",
  "현재 Unity 화면 상태를 확인하고 다음 제작 단계를 제안해줘.",
  "승인 가능한 Production Blueprint 초안을 만들어줘.",
];

function App() {
  const [tab, setTab] = useState("projects");
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(undefined);
  const [session, setSession] = useState(undefined);
  const [events, setEvents] = useState([]);
  const [message, setMessage] = useState("");
  const [blueprints, setBlueprints] = useState(undefined);
  const [activity, setActivity] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [unityPath, setUnityPath] = useState("");
  const wsRef = useRef(undefined);

  const chatReady = selectedProject?.status === "connected" && selectedProject?.connection?.status === "connected";
  const chatAvailable = Boolean(session && selectedProject);

  useEffect(() => {
    refreshProjects();
  }, []);

  useEffect(() => {
    if (!session?.guiSessionId) return;
    const timer = setInterval(() => {
      refreshActivity(session.guiSessionId);
      refreshProjects();
    }, 4000);
    return () => clearInterval(timer);
  }, [session?.guiSessionId]);

  useEffect(() => {
    if (!session?.guiSessionId) return;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/api/sessions/${session.guiSessionId}/events`);
    wsRef.current = ws;
    ws.onmessage = (event) => {
      const parsed = JSON.parse(event.data);
      setEvents((items) => [...items, parsed].slice(-300));
    };
    return () => ws.close();
  }, [session?.guiSessionId]);

  async function refreshProjects() {
    const data = await api("/api/projects");
    const nextProjects = data.projects ?? [];
    setProjects(nextProjects);
    setSelectedProject((current) => current
      ? nextProjects.find((project) => project.projectId === current.projectId) ?? current
      : current);
  }

  async function selectProject(project) {
    setBusy(true);
    try {
      const data = await api("/api/sessions", {
        method: "POST",
        body: { projectId: project.projectId },
      });
      setSelectedProject(project);
      setSession(data.session);
      setEvents([]);
      setTab("chat");
      setNotice(project.status === "connected"
        ? `${project.projectName} 프로젝트에 연결했습니다.`
        : "가벼운 질문은 바로 가능하며, Unity 제작/수정 작업은 Connected 상태에서 진행됩니다.");
      await refreshBlueprints(data.session.guiSessionId);
      await refreshActivity(data.session.guiSessionId);
    } finally {
      setBusy(false);
    }
  }

  async function projectAction(project, action, body) {
    setBusy(true);
    try {
      const data = await api(`/api/projects/${project.projectId}/${action}`, { method: "POST", body });
      setNotice(action === "open-unity"
        ? "Unity를 열었습니다. Connected가 표시될 때까지 잠시 기다린 뒤 새로고침하세요."
        : data.result?.error ?? "요청을 처리했습니다.");
      setSelectedProject(project);
      await refreshProjects();
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(text = message) {
    if (!session || !text.trim()) return;
    setMessage("");
    setEvents((items) => [
      ...items,
      { type: "user", text, ts: new Date().toISOString() },
      { type: "queued", text: "요청을 분류하고 있습니다. 가벼운 대화는 즉시 처리하고, 제작 작업만 Ochestrator로 넘깁니다.", ts: new Date().toISOString() },
    ]);
    await api(`/api/sessions/${session.guiSessionId}/messages`, {
      method: "POST",
      body: { message: text },
    });
    setTab("chat");
  }

  async function uploadFiles(files) {
    if (!session || files.length === 0) return;
    setBusy(true);
    try {
      const encoded = await Promise.all(Array.from(files).map(async (file) => ({
        name: file.name,
        dataBase64: await fileToBase64(file),
      })));
      const data = await api(`/api/sessions/${session.guiSessionId}/files`, {
        method: "POST",
        body: { files: encoded },
      });
      setSession((current) => ({
        ...current,
        attachedFiles: [...new Set([...(current?.attachedFiles ?? []), ...(data.files ?? []).map((file) => file.path)])],
      }));
      setNotice(`${data.files?.length ?? 0}개 파일을 첨부했습니다.`);
    } finally {
      setBusy(false);
    }
  }

  async function refreshBlueprints(id = session?.guiSessionId) {
    if (!id) return;
    setBlueprints(await api(`/api/sessions/${id}/blueprints`));
  }

  async function refreshActivity(id = session?.guiSessionId) {
    if (!id) return;
    setActivity(await api(`/api/sessions/${id}/activity`));
  }

  async function approveBlueprint() {
    if (!session || !chatReady) return;
    const latest = blueprints?.latest?.blueprint ?? blueprints?.latest;
    await api(`/api/sessions/${session.guiSessionId}/approvals`, {
      method: "POST",
      body: {
        type: "blueprint",
        source: {
          blueprintId: latest?.id,
          blueprintPath: blueprints?.latest?.path,
        },
      },
    });
    setNotice("승인을 저장했습니다. 다음 메시지에서 제작을 진행할 수 있습니다.");
    await sendMessage("승인하고 제작 진행");
  }

  const presentedEvents = useMemo(() => {
    return events.map((event, index) => presentGuiEvent(event, index)).filter(Boolean);
  }, [events]);
  const chatItems = compactChatItems(presentedEvents.filter((item) => item.surface === "chat"));
  const lastUserIndex = [...presentedEvents].reverse().find((item) => item.source?.type === "user")?.index ?? -1;
  const currentProgressItems = compactTimelineItems(presentedEvents
    .filter((item) => item.surface === "progress" && item.index >= lastUserIndex))
    .slice(-30);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">UOS</div>
          <div>
            <strong>Unity Orchestration System</strong>
            <span>AI 제작 워크벤치</span>
          </div>
        </div>
        <nav>
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="sessionBox">
          <span>선택 프로젝트</span>
          <strong>{selectedProject?.projectName ?? "없음"}</strong>
          <small>{chatReady ? "Connected" : "Unity 연결 대기"}</small>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{tabs.find((item) => item.id === tab)?.label}</h1>
            <p>{notice || "프로젝트를 선택하고 UOS GUI에서 Unity를 연 뒤 Ochestrator와 대화하세요."}</p>
          </div>
          <button className="iconButton" onClick={() => { refreshProjects(); refreshBlueprints(); refreshActivity(); }} disabled={busy} title="새로고침">
            <RefreshCw size={18} />
          </button>
        </header>

        {tab === "projects" && (
          <section className="panel">
            <div className="panelHeader">
              <h2>Unity 프로젝트</h2>
              <button onClick={refreshProjects}><RefreshCw size={16} />새로고침</button>
            </div>
            <div className="projectGrid">
              {projects.map((project) => (
                <article key={project.projectId} className={selectedProject?.projectId === project.projectId ? "project selected" : "project"}>
                  <div>
                    <span className={`status ${statusTone(project.status)}`}>{statusLabel(project)}</span>
                    <h3>{project.projectName}</h3>
                    <p>{project.projectPath}</p>
                  </div>
                  <dl>
                    <div><dt>Unity</dt><dd>{project.unityVersion ?? "-"}</dd></div>
                    <div><dt>UOS</dt><dd>{project.uos?.installed ? project.uos?.installKind ?? "linked" : "not linked"}</dd></div>
                    <div><dt>Bridge</dt><dd>{bridgeLabel(project)}</dd></div>
                  </dl>
                  <div className="actions">
                    <button onClick={() => selectProject(project)}><MessageSquare size={16} />진입</button>
                    <button onClick={() => projectAction(project, project.uos?.installed ? "uninstall" : "install")}>
                      <Wrench size={16} />{project.uos?.installed ? "해제" : "설치"}
                    </button>
                    <button onClick={() => projectAction(project, "open-unity", unityPath ? { unityExecutable: unityPath } : {})}>
                      <ExternalLink size={16} />Unity 열기
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <div className="inlineForm">
              <label>Unity.exe 경로</label>
              <input value={unityPath} onChange={(event) => setUnityPath(event.target.value)} placeholder="C:/Program Files/Unity/Hub/Editor/.../Unity.exe" />
              <button disabled={!selectedProject || !unityPath} onClick={() => projectAction(selectedProject, "unity-executable", { unityExecutable: unityPath })}>저장</button>
            </div>
          </section>
        )}

        {tab === "chat" && (
          <section className="chatLayout">
            <div className="conversation">
              {chatItems.length === 0 && (
                <div className="emptyState">
                  <Bot size={26} />
                  <strong>Ochestrator와 대화를 시작하세요.</strong>
                  <span>{chatReady ? "기획 자료를 첨부한 뒤 제작 의도와 화면 구성을 함께 정리할 수 있습니다." : "가벼운 질문은 바로 가능하지만, Unity 제작/수정 작업은 Connected 상태가 필요합니다."}</span>
                </div>
              )}
              {chatItems.map((item) => (
                <ChatBubble key={`${item.source?.ts ?? "event"}-${item.index}`} item={item} onChoice={sendMessage} />
              ))}
              {currentProgressItems.length > 0 && <ProgressStrip items={currentProgressItems} />}
            </div>
            <div className="promptBar">
              <div className="choices">
                {examples.map((item) => <button key={item} disabled={!chatAvailable} onClick={() => sendMessage(item)}>{item}</button>)}
              </div>
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} disabled={!chatAvailable} placeholder={chatAvailable ? "무엇을 물어보거나 만들까요?" : "먼저 Projects에서 프로젝트를 선택하세요."} />
              <button className="primary" disabled={!session || !message.trim()} onClick={() => sendMessage()}>
                <Play size={17} />보내기
              </button>
            </div>
          </section>
        )}

        {tab === "blueprint" && (
          <section className="panel">
            <div className="panelHeader">
              <h2>Production Blueprint</h2>
              <button onClick={() => refreshBlueprints()}><RefreshCw size={16} />새로고침</button>
            </div>
            <BlueprintView
              data={blueprints}
              canApprove={chatReady}
              onApprove={approveBlueprint}
              onRevise={() => { setTab("chat"); setMessage("Blueprint에서 다음 부분을 수정하고 싶습니다: "); }}
            />
          </section>
        )}

        {tab === "assets" && (
          <section className="panel">
            <div className="panelHeader">
              <h2>첨부 자료</h2>
              <label className="uploadButton">
                <FileUp size={16} />파일 첨부
                <input type="file" multiple onChange={(event) => uploadFiles(event.target.files ?? [])} />
              </label>
            </div>
            <ul className="fileList">
              {(session?.attachedFiles ?? []).map((file) => <li key={file}>{file}</li>)}
            </ul>
            <p className="hint">이미지, PPTX, PDF, DOCX는 해석 대상입니다. 비디오는 Unity 화면에 배치/재생할 미디어로 취급합니다.</p>
          </section>
        )}

        {tab === "activity" && (
          <section className="panel">
            <div className="panelHeader">
              <h2>진행 상태</h2>
              <button onClick={() => refreshActivity()}><RefreshCw size={16} />새로고침</button>
            </div>
            <ActivityView activity={activity} events={events} presentedEvents={presentedEvents} />
          </section>
        )}
      </main>
    </div>
  );
}

function BlueprintView({ data, canApprove, onApprove, onRevise }) {
  const latest = data?.latest?.blueprint ?? data?.latest;
  if (!latest) return <div className="emptyLine">아직 Blueprint가 없습니다.</div>;
  return (
    <div className="blueprint">
      <div className="summaryLine">
        <span className={`status ${latest.status === "approved" ? "good" : "warn"}`}>{latest.status}</span>
        <strong>{latest.title ?? latest.id}</strong>
      </div>
      <p>{latest.goal}</p>
      <div className="columns">
        <Block title="Screens" items={latest.screens} />
        <Block title="Interactions" items={latest.interactions} />
        <Block title="Risks" items={latest.risks} />
      </div>
      <div className="actions">
        <button className="primary" disabled={!canApprove} onClick={onApprove}><Check size={16} />승인하고 제작 진행</button>
        <button onClick={onRevise}>일부 수정</button>
      </div>
    </div>
  );
}

function Block({ title, items }) {
  const values = Array.isArray(items) ? items : [];
  return (
    <div className="block">
      <h3>{title}</h3>
      {values.length === 0 ? <p>없음</p> : values.slice(0, 6).map((item, index) => <p key={index}>{item.title ?? item.id ?? item.description ?? JSON.stringify(item)}</p>)}
    </div>
  );
}

function ChatBubble({ item, onChoice }) {
  return (
    <div className={`bubble ${item.role ?? "assistant"} ${item.severity ?? ""}`}>
      <span>{item.label}</span>
      <MessageContent text={item.text} />
      {Array.isArray(item.choices) && item.choices.length > 0 && (
        <div className="bubbleChoices">
          {item.choices.map((choice) => (
            <button key={choice} onClick={() => onChoice(choice)}>{choice}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageContent({ text }) {
  const blocks = parseMessageBlocks(text);
  return (
    <div className="messageBody">
      {blocks.map((block, index) => {
        if (block.type === "heading") return <h4 key={index}>{block.text}</h4>;
        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={index}>
              {block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
            </ListTag>
          );
        }
        if (block.type === "code") return <pre key={index}><code>{block.text}</code></pre>;
        return <p key={index}>{block.text}</p>;
      })}
    </div>
  );
}

function ProgressStrip({ items }) {
  const latest = items[items.length - 1];
  const busy = latest?.busy === true;
  return (
    <section className="progressStrip" aria-live="polite" aria-label="진행 상황">
      <div className="progressCurrent">
        {busy ? <span className="loader" aria-hidden="true" /> : <span className={`dot ${latest?.tone ?? "info"}`} />}
        <div>
          <strong>{latest?.label ?? "진행 중"}</strong>
          {latest?.meta && <small>{latest.meta}</small>}
        </div>
      </div>
      <div className="progressTimeline" role="list">
        {items.map((item) => (
          <div key={`${item.source?.ts ?? "progress"}-${item.index}`} className="progressTimelineItem" role="listitem">
            <time>[{formatEventTime(item.source?.ts)}]</time>
            <span>{item.label}</span>
            {item.meta && <small>{item.meta}</small>}
          </div>
        ))}
      </div>
    </section>
  );
}

function ActivityView({ activity, events, presentedEvents }) {
  const connection = activity?.activity?.connection ?? {};
  const progress = activity?.activity?.progress ?? {};
  const timeline = compactTimelineItems(presentedEvents
    .filter((item) => item.surface === "progress" || item.surface === "activity" || item.surface === "debug"))
    .slice(-30);
  return (
    <div className="activityGrid">
      <div className="activityCard">
        <h3>Connection</h3>
        <dl className="summaryList">
          <div><dt>상태</dt><dd>{connection.status ?? "unknown"}</dd></div>
          <div><dt>프로젝트</dt><dd>{connection.projectName ?? activity?.activity?.project?.name ?? "-"}</dd></div>
          <div><dt>Bridge</dt><dd>{connection.host && connection.port ? `${connection.host}:${connection.port}` : "-"}</dd></div>
        </dl>
      </div>
      <div className="activityCard">
        <h3>Progress</h3>
        <dl className="summaryList">
          <div><dt>상태</dt><dd>{progress.status ?? "none"}</dd></div>
          <div><dt>현재 단계</dt><dd>{progress.currentStep ?? "-"}</dd></div>
          <div><dt>다음 행동</dt><dd>{progress.nextAction ?? "-"}</dd></div>
        </dl>
      </div>
      <div className="activityCard wide">
        <h3>Timeline</h3>
        {timeline.length === 0 ? (
          <p className="hint">아직 표시할 진행 기록이 없습니다.</p>
        ) : (
          <ol className="timeline">
            {timeline.map((item) => (
              <li key={`${item.source?.ts ?? "activity"}-${item.index}`}>
                <span>[{formatEventTime(item.source?.ts)}]</span>
                <strong>{item.label}</strong>
                {item.meta && <small>{item.meta}</small>}
              </li>
            ))}
          </ol>
        )}
      </div>
      <details className="developerLog">
        <summary>개발자 로그 보기</summary>
        <pre>{JSON.stringify(events.slice(-40), null, 2)}</pre>
      </details>
    </div>
  );
}

function presentGuiEvent(event, index) {
  const base = { index, source: event };
  switch (event?.type) {
    case "user":
      return { ...base, surface: "chat", role: "user", label: "나", text: event.text ?? "" };
    case "text":
    case "message":
      return {
        ...base,
        surface: "chat",
        role: event.fallback ? "system" : "assistant",
        severity: event.fallback ? "warn" : undefined,
        label: event.fallback ? "안내" : "Ochestrator",
        text: friendlyText(event.text),
        choices: event.choices,
      };
    case "full-blocked":
    case "bridge-blocked":
      return { ...base, surface: "chat", role: "system", severity: "warn", label: "확인 필요", text: friendlyText(event.text) };
    case "run-error":
    case "run-failed":
    case "opencode-timeout":
      return { ...base, surface: "chat", role: "system", severity: "error", label: "작업 중단", text: friendlyError(event) };
    case "queued":
      return { ...base, surface: "progress", label: "요청을 접수했습니다.", tone: "info", busy: true };
    case "chat-route":
      return { ...base, surface: "progress", label: routeLabel(event.route), meta: routeMeta(event.route), tone: "info", busy: event.route !== "light-local" };
    case "light-model-start":
      return { ...base, surface: "progress", label: "빠른 답변을 생성하는 중입니다.", meta: modelMeta(event), tone: "info", busy: true };
    case "light-model-complete":
      return { ...base, surface: "progress", label: "빠른 답변이 준비됐습니다.", meta: elapsedMeta(event), tone: "good" };
    case "light-model-error":
      return { ...base, surface: "debug", label: "빠른 답변 오류", meta: friendlyText(event.text), tone: "warn" };
    case "run-start":
      return { ...base, surface: "progress", label: "작업을 시작했습니다.", tone: "info", busy: true };
    case "bridge-preflight":
      return { ...base, surface: "progress", label: "Unity 연결을 확인하는 중입니다.", tone: "info", busy: true };
    case "bridge-ready":
      return { ...base, surface: "progress", label: "Unity 연결을 확인했습니다.", meta: event.projectInfo?.projectName, tone: "good" };
    case "approval-prepared":
      return { ...base, surface: "progress", label: "이번 작업 권한을 준비했습니다.", meta: "Unity 수정 실행 가능", tone: "good" };
    case "opencode-start":
      return { ...base, surface: "progress", label: "Ochestrator를 실행하는 중입니다.", tone: "info", busy: true };
    case "provider-overloaded":
      return { ...base, surface: "progress", label: "모델 제공자가 과부하 상태라 재시도 중입니다.", meta: modelMeta(event), tone: "warn", busy: true, compactKey: "provider-overloaded" };
    case "opencode-waiting":
      return { ...base, surface: "progress", label: waitingLabel(event.elapsedSeconds), meta: event.elapsedSeconds ? `경과 ${formatDuration(event.elapsedSeconds * 1000)}` : undefined, tone: "info", busy: true, compactKey: "opencode-waiting" };
    case "run-complete":
      return { ...base, surface: "progress", label: "작업이 완료됐습니다.", tone: "good" };
    case "files":
      return { ...base, surface: "activity", label: "파일을 첨부했습니다.", meta: `${event.files?.length ?? 0}개`, tone: "good" };
    case "approval":
      return { ...base, surface: "activity", label: "승인을 저장했습니다.", tone: "good" };
    case "tool":
      return { ...base, surface: "debug", label: `도구 실행: ${event.tool ?? "unknown"}` };
    case "log":
      return { ...base, surface: "debug", label: "실행 로그", meta: event.text };
    default:
      return { ...base, surface: "debug", label: event?.type ?? "event", meta: event?.text ?? event?.tool };
  }
}

function routeLabel(route) {
  switch (route) {
    case "light-local": return "즉시 답변으로 처리합니다.";
    case "light-model": return "빠른 답변으로 처리합니다.";
    case "full-ochestrator": return "Unity 제작 작업으로 처리합니다.";
    default: return "요청을 분류했습니다.";
  }
}

function routeMeta(route) {
  switch (route) {
    case "light-local": return "로컬 상태로 응답";
    case "light-model": return "작은 모델 사용";
    case "full-ochestrator": return "Unity 연결 필요";
    default: return undefined;
  }
}

function modelMeta(event) {
  return [event.provider, event.model].filter(Boolean).join(" / ") || undefined;
}

function elapsedMeta(event) {
  return typeof event.elapsedMs === "number" ? `${Math.max(0, event.elapsedMs / 1000).toFixed(1)}초` : undefined;
}

function waitingLabel(elapsedSeconds) {
  const seconds = Number(elapsedSeconds ?? 0);
  if (seconds >= 120) return "Ochestrator가 제작 작업을 계속 처리 중입니다. 자료 해석이나 Unity 변경에는 시간이 더 걸릴 수 있습니다.";
  if (seconds >= 30) return "Ochestrator가 처리 중입니다. 일정 시간 소요가 예상됩니다.";
  return "Ochestrator가 처리 중입니다.";
}

function friendlyText(value) {
  return String(value ?? "").trim();
}

function friendlyError(event) {
  if (event.type === "opencode-timeout") {
    const duration = formatOptionalDuration(event.timeoutMs);
    return `Ochestrator 실행 제한 시간${duration ? `(${duration})` : ""}을 초과해 작업을 중단했습니다. Activity에서 마지막 진행 단계와 개발자 로그를 확인한 뒤 다시 시도해 주세요.`;
  }
  if (event.type === "run-failed") return "작업이 완료되지 않았습니다. Activity에서 세부 로그를 확인할 수 있습니다.";
  return friendlyText(event.text) || "작업 중 문제가 발생했습니다.";
}

function formatEventTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const yy = String(date.getFullYear()).slice(-2);
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${yy}.${mm}.${dd} ${hh}:${mi}:${ss}`;
}

function formatDuration(valueMs) {
  const totalSeconds = Math.max(0, Math.round(Number(valueMs ?? 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}초`;
  if (seconds === 0) return `${minutes}분`;
  return `${minutes}분 ${seconds}초`;
}

function formatOptionalDuration(valueMs) {
  const value = Number(valueMs);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return formatDuration(value);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function compactTimelineItems(items) {
  const compacted = [];
  for (const item of items) {
    const last = compacted[compacted.length - 1];
    if (item.compactKey && last?.compactKey === item.compactKey) {
      compacted[compacted.length - 1] = item;
    } else {
      compacted.push(item);
    }
  }
  return compacted;
}

function compactChatItems(items) {
  const compacted = [];
  for (const item of items) {
    const previous = compacted[compacted.length - 1];
    if (
      item.source?.type === "run-failed"
      && previous?.source?.type === "opencode-timeout"
    ) {
      continue;
    }
    compacted.push(item);
  }
  return compacted;
}

function parseMessageBlocks(value) {
  const text = friendlyText(value);
  if (!text) return [{ type: "paragraph", text: "" }];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = undefined;
  let code = undefined;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushList = () => {
    if (list === undefined) return;
    blocks.push(list);
    list = undefined;
  };
  const flushCode = () => {
    if (code === undefined) return;
    blocks.push({ type: "code", text: code.join("\n") });
    code = undefined;
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (code === undefined) {
        flushParagraph();
        flushList();
        code = [];
      } else {
        flushCode();
      }
      continue;
    }
    if (code !== undefined) {
      code.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", text: heading[1] });
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    if (ordered || unordered) {
      flushParagraph();
      const nextOrdered = Boolean(ordered);
      if (list === undefined || list.ordered !== nextOrdered) {
        flushList();
        list = { type: "list", ordered: nextOrdered, items: [] };
      }
      list.items.push((ordered?.[1] ?? unordered?.[1] ?? "").trim());
      continue;
    }

    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  flushCode();
  return blocks.length > 0 ? blocks : [{ type: "paragraph", text }];
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error ?? `Request failed: ${response.status}`);
  return data;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

function statusLabel(project) {
  switch (project?.status) {
    case "connected": return "Connected";
    case "waiting-bridge": return "Waiting for Bridge";
    case "external": return "External Unity";
    case "bridge-error": return "Bridge Error";
    case "installed": return "Open Unity";
    case "not-installed": return "Install UOS";
    case "needs-attention": return "Check UOS";
    case "live-needs-attention": return "Bridge Issue";
    default: return "Unknown";
  }
}

function bridgeLabel(project) {
  if (project?.status === "connected") return "GUI-managed";
  if (project?.status === "external") return "External";
  if (project?.connection?.status) return project.connection.status;
  return "Waiting";
}

function statusTone(status) {
  if (status === "connected") return "good";
  if (status === "installed" || status === "waiting-bridge") return "info";
  if (status === "not-installed" || status === "external") return "warn";
  return "bad";
}

createRoot(document.getElementById("root")).render(<App />);
