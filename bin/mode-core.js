/**
 * mode-core - UOS orchestration mode registry and deterministic selector.
 *
 * Modes describe user intent routing. They are not opencode agents, and they
 * are not necessarily submodels. A mode may compose one or more functional
 * submodels plus an optional domain recipe. The Editor remains the only layer
 * that applies actual Unity mutations.
 */

export const UOS_MODES = [
  {
    id: "kiosk-content",
    title: "Kiosk Content Builder",
    summary:
      "Build structured kiosk experiences from nested planning folders, layout references, content media, and navigation rules.",
    specialist: "ui-screen-builder",
    submodels: ["material-understanding", "ui-screen-builder", "visual-verification"],
    submodelFiles: [
      ".opencode/submodels/material-understanding.md",
      ".opencode/submodels/ui-screen-builder.md",
      ".opencode/submodels/visual-verification.md",
    ],
    recipe: "kiosk",
    recipeFile: ".opencode/recipes/kiosk.md",
    handoffFile: ".opencode/submodels/ui-screen-builder.md",
    planArtifact: "KioskPlan",
    buildArtifact: "EditorChangeSet",
    editorRole: "Apply approved screens, transitions, previews, and saves through Unity bridge tools.",
    primaryTools: [
      "plan_kiosk_structure",
      "build_kiosk_from_plan",
      "read_planning_material",
      "create_screen_from_material",
      "create_screen_transition",
      "verify_screen_against_reference",
    ],
    signals: [
      "kiosk", "키오스크", "folder tree", "folder=screen", "folder", "폴더",
      "drilldown", "드릴다운", "home", "back", "처음으로", "뒤로", "sitemap",
      "ref/main", "화면 구성", "화면구성", "전시", "홍보관",
    ],
  },
  {
    id: "screen-from-material",
    title: "Screen From Material",
    summary:
      "Create or revise one or more Unity UI screens from images, video files, PPTX, PDF, DOCX, Markdown, text, CSV, or JSON materials.",
    specialist: "material-understanding",
    submodels: ["material-understanding", "ui-screen-builder", "visual-verification"],
    submodelFiles: [
      ".opencode/submodels/material-understanding.md",
      ".opencode/submodels/ui-screen-builder.md",
      ".opencode/submodels/visual-verification.md",
    ],
    handoffFile: ".opencode/submodels/material-understanding.md",
    planArtifact: "PlanningIntent",
    buildArtifact: "EditorChangeSet",
    editorRole: "Create/update UGUI elements and capture previews through Unity bridge tools.",
    primaryTools: [
      "analyze_planning_materials",
      "read_planning_material",
      "draft_planning_intent_from_document",
      "create_screen_from_material",
      "import_asset",
      "capture_preview",
    ],
    signals: [
      "video", "mp4", "mov", "webm", "m4v", "동영상", "영상", "비디오",
      "screen", "ui", "ugui", "mockup", "wireframe", "pptx", "pdf", "docx",
      "markdown", "image", "reference", "화면", "목업", "시안", "이미지",
      "문서", "슬라이드", "생성",
    ],
  },
  {
    id: "scene-object",
    title: "Scene Object Editor",
    summary:
      "Create, inspect, update, or delete non-UI Unity scene objects such as primitives, cameras, lights, and empty objects.",
    specialist: "scene-object-editor",
    submodels: ["scene-object-editor"],
    submodelFiles: [".opencode/submodels/scene-object-editor.md"],
    handoffFile: ".opencode/submodels/scene-object-editor.md",
    planArtifact: "SceneObjectPlan",
    buildArtifact: "EditorCommandBatch",
    editorRole: "Apply scene object create/list/update/delete calls through Unity bridge tools.",
    primaryTools: [
      "create_scene_object",
      "list_scene_objects",
      "update_scene_object",
      "delete_scene_object",
    ],
    signals: [
      "scene object", "gameobject", "cube", "sphere", "camera", "light",
      "primitive", "transform", "scene", "오브젝트", "게임오브젝트", "큐브",
      "카메라", "조명", "배치", "씬",
    ],
  },
  {
    id: "visual-repair",
    title: "Visual Verification And Repair",
    summary:
      "Compare generated screens against references, diagnose layout/asset mismatches, and perform targeted repair loops.",
    specialist: "visual-verification",
    submodels: ["visual-verification"],
    submodelFiles: [".opencode/submodels/visual-verification.md"],
    handoffFile: ".opencode/submodels/visual-verification.md",
    planArtifact: "VisualRepairPlan",
    buildArtifact: "EditorCommandBatch",
    editorRole: "Capture previews, compare references, and apply targeted UI edits through Unity bridge tools.",
    primaryTools: [
      "capture_preview",
      "compare_images",
      "verify_screen_against_reference",
      "inspect_screen_feedback_from_context",
      "update_ui_element_from_context",
    ],
    signals: [
      "verify", "compare", "diff", "preview", "screenshot", "mismatch",
      "repair", "검증", "비교", "프리뷰", "미리보기", "차이", "수정",
      "맞춰", "비슷하게",
    ],
  },
  {
    id: "unity-inspection",
    title: "Unity Project Inspector",
    summary:
      "Inspect selected Unity project state, bridge capabilities, screens, hierarchy, scene objects, and persisted UOS context without mutating Unity.",
    specialist: "unity-inspection",
    submodels: ["unity-inspection"],
    submodelFiles: [".opencode/submodels/unity-inspection.md"],
    handoffFile: ".opencode/submodels/unity-inspection.md",
    planArtifact: "InspectionPlan",
    buildArtifact: "InspectionReport",
    editorRole: "Read project info, hierarchy, screens, and context through bridge/read-only tools.",
    primaryTools: [
      "list_unity_projects",
      "select_unity_project",
      "get_uos_context",
      "get_project_info",
      "list_screens",
      "get_scene_hierarchy",
      "list_scene_objects",
    ],
    signals: [
      "inspect", "list", "status", "context", "hierarchy", "project info",
      "확인", "목록", "상태", "컨텍스트", "하이어라키", "정보", "읽어",
    ],
  },
  {
    id: "code-editor",
    title: "Code And Project File Editor",
    summary:
      "Modify Unity scripts, Editor scripts, asmdefs, package metadata, text configuration, tests, or UOS helper code when bridge tools are insufficient.",
    specialist: "code-editor",
    submodels: ["code-editor"],
    submodelFiles: [".opencode/submodels/code-editor.md"],
    handoffFile: ".opencode/submodels/code-editor.md",
    planArtifact: "CodeEditPlan",
    buildArtifact: "CodeEditReport",
    editorRole: "Apply explicit file/code edits after Ochestrator approval; do not mutate Unity through bridge tools.",
    primaryTools: [
      "get_uos_context",
      "rg",
      "apply_patch",
      "project tests",
    ],
    signals: [
      "code", "script", "c#", ".cs", "monobehaviour", "component",
      "editor script", "asmdef", "asmref", "namespace", "serializedfield",
      "serialized field", "compile error", "compiler error", "build error",
      "unity console", "stack trace", "exception", "package", "manifest.json",
      "packages-lock", "projectsettings", "project settings", "test", "typecheck",
      "lint", "코드", "스크립트", "컴파일", "빌드 오류", "패키지", "설정",
    ],
  },
  {
    id: "general-editor",
    title: "General Unity Editor Task",
    summary:
      "Constrained fallback executor for small approved Unity tasks that do not yet have a specialized method.",
    specialist: "general-editor",
    submodels: ["general-editor"],
    submodelFiles: [".opencode/submodels/general-editor.md"],
    handoffFile: ".opencode/submodels/general-editor.md",
    planArtifact: "WorkPlan",
    buildArtifact: "EditorCommandBatch",
    editorRole: "Apply only approved fallback commands after Ochestrator records why no specialist submodel owns the task.",
    primaryTools: [
      "get_uos_context",
      "get_project_info",
      "list_screens",
      "get_scene_hierarchy",
      "list_scene_objects",
      "save_scene",
    ],
    signals: [],
  },
];

const MATERIAL_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
  ".mp4", ".mov", ".webm", ".m4v",
  ".pdf", ".pptx", ".docx", ".txt", ".md", ".markdown", ".csv", ".json",
]);

const CODE_EXTENSIONS = new Set([
  ".cs", ".asmdef", ".asmref", ".sln", ".csproj", ".props", ".targets",
  ".uxml", ".uss", ".shader", ".cginc", ".hlsl",
]);

export function listUosModes() {
  return UOS_MODES.map((mode) => ({
    ...mode,
    signals: [...mode.signals],
    primaryTools: [...mode.primaryTools],
    submodels: [...mode.submodels],
    submodelFiles: [...mode.submodelFiles],
  }));
}

export function getUosMode(id) {
  return UOS_MODES.find((mode) => mode.id === id);
}

export function selectUosMode(input = {}) {
  const request = stringValue(input.request).toLowerCase();
  const materialsDir = stringValue(input.materialsDir).toLowerCase();
  const attachedFiles = Array.isArray(input.attachedFiles) ? input.attachedFiles.map((v) => String(v)) : [];
  const contextSummary = stringValue(input.contextSummary).toLowerCase();
  const haystack = [request, materialsDir, contextSummary, ...attachedFiles.map((f) => f.toLowerCase())].join("\n");
  const candidates = UOS_MODES
    .filter((mode) => mode.id !== "general-editor")
    .map((mode) => scoreMode(mode, haystack, attachedFiles))
    .sort((a, b) => b.score - a.score || a.modeId.localeCompare(b.modeId));

  const best = candidates[0];
  const fallback = getUosMode("general-editor");
  const selected = best !== undefined && best.score > 0 ? getUosMode(best.modeId) : fallback;
  const score = best !== undefined && best.score > 0 ? best.score : 0;
  const confidence = confidenceForScore(score);

  return {
    selectedMode: selected,
    confidence,
    score,
    reasons: best !== undefined && best.score > 0 ? best.reasons : ["No specialized mode signals matched; using general editor mode."],
    candidates,
    nextActions: nextActionsForMode(selected),
  };
}

function scoreMode(mode, haystack, attachedFiles) {
  const reasons = [];
  let score = 0;
  for (const signal of mode.signals) {
    if (signal.length === 0) continue;
    if (haystack.includes(signal.toLowerCase())) {
      score += signal.length > 5 ? 3 : 2;
      if (reasons.length < 6) reasons.push(`Matched signal "${signal}".`);
    }
  }

  if (mode.id === "kiosk-content") {
    if (haystack.includes("ref/main") || haystack.includes("화면 구성") || haystack.includes("화면구성")) {
      score += 5;
      reasons.push("Detected kiosk-style Ref/main or layout-reference naming.");
    }
    if (haystack.includes("drilldown") || haystack.includes("드릴다운")) {
      score += 3;
      reasons.push("Detected hierarchical drilldown navigation.");
    }
  }

  if (mode.id === "screen-from-material" && attachedFiles.some((file) => MATERIAL_EXTENSIONS.has(extensionOf(file)))) {
    score += 4;
    reasons.push("Detected supported planning material attachment.");
  }

  if (mode.id === "code-editor" && attachedFiles.some((file) => CODE_EXTENSIONS.has(extensionOf(file)))) {
    score += 5;
    reasons.push("Detected code or Unity project-file attachment.");
  }

  if (mode.id === "code-editor") {
    if (haystack.includes("projectsettings") || haystack.includes("project settings") || haystack.includes("manifest.json")) {
      score += 4;
      reasons.push("Detected Unity project configuration edit signal.");
    }
    if (haystack.includes("compile error") || haystack.includes("compiler error") || haystack.includes("stack trace")) {
      score += 4;
      reasons.push("Detected diagnostics requiring code investigation.");
    }
  }

  if (mode.id === "visual-repair" && (haystack.includes("reference") || haystack.includes("레퍼런스")) && haystack.includes("preview")) {
    score += 4;
    reasons.push("Detected reference/preview comparison workflow.");
  }

  return { modeId: mode.id, score, reasons };
}

function nextActionsForMode(mode) {
  if (mode.id === "kiosk-content") {
    return [
      "Load selected Unity/project context.",
      "Read the whole kiosk recipe and split the work into Ochestrator-owned Task Packets sized by context and handoff overhead.",
      "Run material-understanding with the relevant recipe slice to draft KioskStructurePlan and Main folder candidates.",
      "Review FolderStructurePlan and MaterialPlacementPlan before creating folders or placing materials.",
      "Produce or reuse KioskPlan from the approved Main folder structure.",
      "Build through the Editor layer only after plan and EditorCommandBatch approval.",
    ];
  }
  if (mode.id === "screen-from-material") {
    return [
      "Load selected Unity/project context.",
      "Run material-understanding on the supplied planning materials.",
      "Route approved intent to ui-screen-builder.",
      "Capture preview and report element ids.",
    ];
  }
  if (mode.id === "scene-object") {
    return [
      "Inspect existing scene objects when editing an existing target.",
      "Apply create/update/delete through scene object bridge tools.",
      "List scene objects after mutation to verify result.",
    ];
  }
  if (mode.id === "visual-repair") {
    return [
      "Load latest persisted preview/comparison context.",
      "Capture or compare against the reference.",
      "Apply targeted UI edits through context-resolved tools.",
      "Re-run verification and summarize residual mismatch.",
    ];
  }
  if (mode.id === "unity-inspection") {
    return [
      "Load context and bridge project info.",
      "Use read-only list/hierarchy tools.",
      "Report findings without mutating Unity.",
    ];
  }
  if (mode.id === "code-editor") {
    return [
      "Load selected Unity/project context when the edit targets a Unity project.",
      "Read relevant files, diagnostics, and tests before editing.",
      "Use code-editor handoff boundaries and apply minimal patches.",
      "Run the narrowest meaningful validation and report residual risk.",
    ];
  }
  return [
    "Load selected Unity/project context.",
    "Confirm why no specialist submodel owns this request.",
    "Use general-editor only as a constrained fallback executor after approval.",
    "Record repeated fallback patterns as promotion candidates.",
  ];
}

function confidenceForScore(score) {
  if (score >= 12) return "high";
  if (score >= 5) return "medium";
  if (score > 0) return "low";
  return "fallback";
}

function extensionOf(file) {
  const match = String(file).toLowerCase().match(/(\.[^./\\]+)$/);
  return match ? match[1] : "";
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
