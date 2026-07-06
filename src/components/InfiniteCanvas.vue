<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Check,
  ChevronDown,
  Clipboard,
  Copy,
  Download,
  FileDown,
  FileUp,
  FolderOpen,
  History,
  Image as ImageIcon,
  ImagePlus,
  Layers,
  Library,
  Link as LinkIcon,
  LoaderCircle,
  LocateFixed,
  Maximize2,
  Minus,
  MousePointer2,
  PanelRightOpen,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Unlink,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-vue-next";

import GoogleIcon from "@/components/icons/GoogleIcon.vue";
import OpenAiIcon from "@/components/icons/OpenAiIcon.vue";
import SeedreamIcon from "@/components/icons/SeedreamIcon.vue";
import WanIcon from "@/components/icons/WanIcon.vue";
import {
  createDefaultImageConfigs,
  DEFAULT_IMAGE_MODEL_ID,
  IMAGE_MODELS,
  IMAGE_UPLOAD_LIMITS,
} from "@/data/image-models";
import {
  CODEX_IMAGE_API_BASE_URL,
  createImageTask,
  createImageRequestFingerprint,
  generateImage,
  imageJobToTask,
  isWaveSpeedImageModel,
  listImageJobs,
  pollImageJob,
  type ImageJobStatus,
} from "@/lib/api";
import { useAppStore } from "@/stores/app";
import type {
  ImageConfigRecord,
  ImageConfigValue,
  ImageModelField,
  ImageModelId,
  ImageTask,
} from "@/types";

type CanvasNodeKind = "image" | "prompt";
type CanvasNodeStatus = "idle" | "generating" | "success" | "error";

interface CanvasNode {
  id: string;
  kind: CanvasNodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  createdAt: number;
  src?: string;
  prompt?: string;
  generatedPrompt?: string;
  status?: CanvasNodeStatus;
  error?: string;
  serverJobId?: string;
  clientRequestId?: string;
  requestFingerprint?: string;
  generationStartedAt?: number;
  generationModel?: ImageModelId;
  generationConfig?: ImageConfigRecord;
  generationPrompt?: string;
  generationSourceCount?: number;
}

interface Viewport {
  x: number;
  y: number;
  scale: number;
}

interface CanvasWorkspace {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  nodes: CanvasNode[];
  links: CanvasLink[];
  viewport: Viewport;
}

interface CanvasLink {
  id: string;
  fromNodeId: string;
  toNodeId: string;
}

interface CanvasAssetCategory {
  id: string;
  name: string;
}

interface CanvasAsset {
  id: string;
  title: string;
  src: string;
  categoryId: string;
  createdAt: number;
}

interface CanvasLogEntry {
  id: string;
  prompt: string;
  model: ImageModelId;
  sourceCount: number;
  createdAt: number;
  generationTime: number;
  status: "success" | "failed";
  resultImages: string[];
  error?: string;
}

interface PersistedCanvas {
  version?: number;
  workspaces?: CanvasWorkspace[];
  activeWorkspaceId?: string;
  nodes?: CanvasNode[];
  links?: CanvasLink[];
  viewport?: Viewport;
  assets?: CanvasAsset[];
  assetCategories?: CanvasAssetCategory[];
  logs?: CanvasLogEntry[];
}

interface DragState {
  type: "pan" | "node" | "resize";
  nodeId?: string;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startWidth?: number;
  startHeight?: number;
  nodeStartPositions?: Record<string, { x: number; y: number }>;
}

interface MentionState {
  nodeId: string;
  query: string;
  start: number;
  end: number;
}

interface MentionCandidate {
  id: string;
  title: string;
  src: string;
  source: "canvas" | "asset";
}

const store = useAppStore();
const defaultImageConfigs = createDefaultImageConfigs();
const STORAGE_KEY = "art-workshop-infinite-canvas-v1";
const HIDDEN_CANVAS_MODEL_IDS = new Set<ImageModelId>(["qwen-image-edit-multiple-angles"]);
const MIN_ZOOM = 0.28;
const MAX_ZOOM = 2.2;

const boardRef = ref<HTMLElement | null>(null);
const imageInput = ref<HTMLInputElement | null>(null);
const importInput = ref<HTMLInputElement | null>(null);
const nodes = ref<CanvasNode[]>([]);
const links = ref<CanvasLink[]>([]);
const selectedIds = ref<string[]>([]);
const viewport = ref<Viewport>({ x: 0, y: 0, scale: 0.86 });
const dragState = ref<DragState | null>(null);
const savingFailed = ref(false);
const workspaces = ref<CanvasWorkspace[]>([]);
const activeWorkspaceId = ref("");
const assets = ref<CanvasAsset[]>([]);
const assetCategories = ref<CanvasAssetCategory[]>([
  { id: "library", name: "资产库" },
  { id: "references", name: "参考图" },
]);
const activeAssetCategoryId = ref("library");
const logs = ref<CanvasLogEntry[]>([]);
const showCanvasPanel = ref(false);
const showAssetPanel = ref(true);
const showLogPanel = ref(false);
const previewNode = ref<CanvasNode | null>(null);
const mentionState = ref<MentionState | null>(null);
const nodeClipboard = ref<CanvasNode[]>([]);
const openDropdown = ref("");
const assetCategoryDialogOpen = ref(false);
const assetCategoryDraft = ref("新文件夹");

let saveTimer: number | undefined;
let canvasPollTimer: number | undefined;
const activeRuns = new Map<string, string>();

const selectableImageModels = IMAGE_MODELS.filter((model) => !HIDDEN_CANVAS_MODEL_IDS.has(model.id));
const activeImageModelId = computed<ImageModelId>(() =>
  HIDDEN_CANVAS_MODEL_IDS.has(store.selectedImageModel)
    ? DEFAULT_IMAGE_MODEL_ID
    : store.selectedImageModel,
);
const activeImageModel = computed(
  () => selectableImageModels.find((model) => model.id === activeImageModelId.value) ?? selectableImageModels[0],
);
const activeImageConfig = computed<ImageConfigRecord>(() => ({
  ...defaultImageConfigs[activeImageModelId.value],
  ...store.imageModelConfigs[activeImageModelId.value],
}));
const activeUploadLimit = computed(() => IMAGE_UPLOAD_LIMITS[activeImageModelId.value] ?? 1);
const selectedNodes = computed(() => nodes.value.filter((node) => selectedIds.value.includes(node.id)));
const selectedImageNodes = computed(() => selectedNodes.value.filter((node) => node.kind === "image" && node.src));
const activeWorkspace = computed(
  () => workspaces.value.find((workspace) => workspace.id === activeWorkspaceId.value) ?? workspaces.value[0] ?? null,
);
const visibleAssets = computed(() =>
  assets.value.filter((asset) => asset.categoryId === activeAssetCategoryId.value),
);
const mentionCandidates = computed<MentionCandidate[]>(() => {
  const query = mentionState.value?.query.trim().toLowerCase() ?? "";
  const canvasItems = nodes.value
    .filter((node) => node.kind === "image" && node.src)
    .map((node) => ({
      id: node.id,
      title: node.title,
      src: node.src || "",
      source: "canvas" as const,
    }));
  const assetItems = assets.value.map((asset) => ({
    id: asset.id,
    title: asset.title,
    src: asset.src,
    source: "asset" as const,
  }));

  return [...canvasItems, ...assetItems]
    .filter((item) => !query || item.title.toLowerCase().includes(query))
    .slice(0, 8);
});
const activePromptNode = computed(() => {
  const selectedPrompt = selectedNodes.value.find((node) => node.kind === "prompt");
  return selectedPrompt ?? nodes.value.find((node) => node.kind === "prompt") ?? null;
});
const visibleLinks = computed(() => {
  const nodeIds = new Set(nodes.value.map((node) => node.id));
  return links.value.filter((link) => nodeIds.has(link.fromNodeId) && nodeIds.has(link.toNodeId));
});
const worldStyle = computed(() => ({
  transform: `translate(${viewport.value.x}px, ${viewport.value.y}px) scale(${viewport.value.scale})`,
}));
const selectionLabel = computed(() => {
  if (selectedImageNodes.value.length > 0) {
    return `参考图 ${selectedImageNodes.value.length}/${activeUploadLimit.value}`;
  }
  if (selectedNodes.value.length > 0) {
    return `已选 ${selectedNodes.value.length}`;
  }
  return "未选择";
});
const activeWorkspaceTitle = computed(() => activeWorkspace.value?.title ?? "无限画布");
const currentWorkspaceUpdatedAt = computed(() => formatTime(activeWorkspace.value?.updatedAt ?? Date.now()));
const activeModelLabel = computed(() => activeImageModel.value.name);
const activeAssetCategoryLabel = computed(
  () => assetCategories.value.find((category) => category.id === activeAssetCategoryId.value)?.name ?? "资产库",
);

function getImageModelIcon(modelId: string) {
  if (modelId === "gemini-3-pro-image-preview" || modelId === "nano-banana-2") {
    return GoogleIcon;
  }
  if (modelId === "seedream-4.5") {
    return SeedreamIcon;
  }
  if (modelId === "wan-2.7") {
    return WanIcon;
  }

  return OpenAiIcon;
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneNodes(value: CanvasNode[]) {
  return JSON.parse(JSON.stringify(value)) as CanvasNode[];
}

function normalizeNodes(value: CanvasNode[]) {
  return cloneNodes(value).map((node) => ({
    ...node,
    status:
      node.status === "generating" && !node.serverJobId && !node.clientRequestId
        ? "idle"
        : node.status,
    error: node.status === "generating" && !node.serverJobId && !node.clientRequestId ? "" : node.error,
  }));
}

function cloneLinks(value: CanvasLink[]) {
  return JSON.parse(JSON.stringify(value)) as CanvasLink[];
}

function cloneViewport(value: Viewport) {
  return { x: value.x, y: value.y, scale: value.scale };
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function createWorkspace(title = "无限画布", initialNodes?: CanvasNode[]): CanvasWorkspace {
  const now = Date.now();
  return {
    id: createId("canvas"),
    title,
    createdAt: now,
    updatedAt: now,
    nodes: normalizeNodes(initialNodes ?? [createPromptNode(-170, -110)]),
    links: [],
    viewport: { x: 0, y: 0, scale: 0.86 },
  };
}

function createPromptNode(x: number, y: number): CanvasNode {
  return {
    id: createId("prompt"),
    kind: "prompt",
    x,
    y,
    width: 330,
    height: 228,
    title: "提示词",
    prompt: "",
    status: "idle",
    createdAt: Date.now(),
  };
}

function createImageNode(src: string, title: string, x: number, y: number): CanvasNode {
  return {
    id: createId("image"),
    kind: "image",
    x,
    y,
    width: 300,
    height: 270,
    title,
    src,
    status: "success",
    createdAt: Date.now(),
  };
}

function isPersistedCanvas(value: unknown): value is PersistedCanvas {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<PersistedCanvas>;
  return Array.isArray(record.workspaces) || Array.isArray(record.nodes);
}

function loadCanvas() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (isPersistedCanvas(parsed)) {
        if (Array.isArray(parsed.workspaces) && parsed.workspaces.length > 0) {
          workspaces.value = parsed.workspaces.map((workspace) => ({
            ...workspace,
            nodes: normalizeNodes((workspace.nodes || []).filter((node) => node.kind === "image" || node.kind === "prompt")),
            links: Array.isArray(workspace.links) ? workspace.links : [],
            viewport: {
              x: Number(workspace.viewport?.x || 0),
              y: Number(workspace.viewport?.y || 0),
              scale: clampNumber(Number(workspace.viewport?.scale || 0.86), MIN_ZOOM, MAX_ZOOM),
            },
          }));
          activeWorkspaceId.value = parsed.activeWorkspaceId || workspaces.value[0].id;
        } else {
          const legacyNodes = (parsed.nodes || []).filter((node) => node.kind === "image" || node.kind === "prompt");
          const workspace = createWorkspace("无限画布", legacyNodes.length ? legacyNodes : undefined);
          workspace.links = Array.isArray(parsed.links) ? parsed.links : [];
          workspace.viewport = {
            x: Number(parsed.viewport?.x || 0),
            y: Number(parsed.viewport?.y || 0),
            scale: clampNumber(Number(parsed.viewport?.scale || 0.86), MIN_ZOOM, MAX_ZOOM),
          };
          workspaces.value = [workspace];
          activeWorkspaceId.value = workspace.id;
        }

        assets.value = Array.isArray(parsed.assets) ? parsed.assets.filter((asset) => asset.src) : [];
        if (Array.isArray(parsed.assetCategories) && parsed.assetCategories.length > 0) {
          assetCategories.value = parsed.assetCategories;
          activeAssetCategoryId.value = parsed.assetCategories[0].id;
        }
        logs.value = Array.isArray(parsed.logs) ? parsed.logs.slice(0, 100) : [];
      }
    }
  } catch {
    workspaces.value = [];
  }

  if (workspaces.value.length === 0) {
    const workspace = createWorkspace();
    workspaces.value = [workspace];
    activeWorkspaceId.value = workspace.id;
  }

  openWorkspace(activeWorkspaceId.value || workspaces.value[0].id, false);
}

function syncActiveWorkspace() {
  const workspace = activeWorkspace.value;
  if (!workspace) {
    return;
  }
  workspace.nodes = normalizeNodes(nodes.value);
  workspace.links = cloneLinks(visibleLinks.value);
  workspace.viewport = cloneViewport(viewport.value);
  workspace.updatedAt = Date.now();
}

function saveCanvas() {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  syncActiveWorkspace();

  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        workspaces: workspaces.value,
        activeWorkspaceId: activeWorkspaceId.value,
        assets: assets.value,
        assetCategories: assetCategories.value,
        logs: logs.value.slice(0, 100),
      } satisfies PersistedCanvas),
    );
    savingFailed.value = false;
  } catch {
    savingFailed.value = true;
  }
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveCanvas, 250);
}

function openWorkspace(workspaceId: string, shouldSync = true) {
  if (shouldSync) {
    syncActiveWorkspace();
  }
  const workspace = workspaces.value.find((item) => item.id === workspaceId) ?? workspaces.value[0];
  if (!workspace) {
    return;
  }
  activeWorkspaceId.value = workspace.id;
  nodes.value = normalizeNodes(workspace.nodes);
  links.value = cloneLinks(workspace.links || []);
  viewport.value = cloneViewport(workspace.viewport);
  selectedIds.value = [];
  mentionState.value = null;
  showCanvasPanel.value = false;
  scheduleSave();
}

function addWorkspace(kind: "classic" | "smart" = "smart") {
  syncActiveWorkspace();
  const title = kind === "smart" ? "智能画布" : "无限画布";
  const workspace = createWorkspace(`${title} ${workspaces.value.length + 1}`);
  workspaces.value = [workspace, ...workspaces.value];
  openWorkspace(workspace.id, false);
  nextTick(fitView);
}

function renameActiveWorkspace(value: string) {
  const workspace = activeWorkspace.value;
  if (!workspace) {
    return;
  }
  workspace.title = value.trim().slice(0, 80) || "未命名画布";
  scheduleSave();
}

function removeWorkspace(workspaceId: string) {
  const next = workspaces.value.filter((workspace) => workspace.id !== workspaceId);
  if (next.length === 0) {
    next.push(createWorkspace());
  }
  workspaces.value = next;
  if (activeWorkspaceId.value === workspaceId) {
    openWorkspace(next[0].id, false);
  } else {
    scheduleSave();
  }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function nodeStyle(node: CanvasNode) {
  return {
    left: `${node.x}px`,
    top: `${node.y}px`,
    width: `${node.width}px`,
    height: `${node.height}px`,
  };
}

function screenToWorld(clientX: number, clientY: number) {
  const rect = boardRef.value?.getBoundingClientRect();
  const left = rect?.left ?? 0;
  const top = rect?.top ?? 0;
  return {
    x: (clientX - left - viewport.value.x) / viewport.value.scale,
    y: (clientY - top - viewport.value.y) / viewport.value.scale,
  };
}

function boardCenterWorld() {
  const rect = boardRef.value?.getBoundingClientRect();
  if (!rect) {
    return { x: 0, y: 0 };
  }

  return screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function selectNode(nodeId: string, additive = false) {
  if (!additive) {
    selectedIds.value = [nodeId];
    return;
  }

  selectedIds.value = selectedIds.value.includes(nodeId)
    ? selectedIds.value.filter((id) => id !== nodeId)
    : [...selectedIds.value, nodeId];
}

function addPromptNode() {
  const center = boardCenterWorld();
  const node = createPromptNode(center.x - 165, center.y - 114);
  nodes.value = [...nodes.value, node];
  selectedIds.value = [node.id];
  scheduleSave();
}

function addImageNode(src: string, title: string, x: number, y: number) {
  const node = createImageNode(src, title, x, y);
  nodes.value = [...nodes.value, node];
  selectedIds.value = [node.id];
  scheduleSave();
  return node;
}

function removeNode(nodeId: string) {
  nodes.value = nodes.value.filter((node) => node.id !== nodeId);
  links.value = links.value.filter((link) => link.fromNodeId !== nodeId && link.toNodeId !== nodeId);
  selectedIds.value = selectedIds.value.filter((id) => id !== nodeId);

  if (nodes.value.length === 0) {
    addPromptNode();
  }

  scheduleSave();
}

function removeSelectedNodes() {
  if (selectedIds.value.length === 0) {
    return;
  }
  nodes.value = nodes.value.filter((node) => !selectedIds.value.includes(node.id));
  links.value = links.value.filter(
    (link) => !selectedIds.value.includes(link.fromNodeId) && !selectedIds.value.includes(link.toNodeId),
  );
  selectedIds.value = [];
  if (nodes.value.length === 0) {
    addPromptNode();
  }
  scheduleSave();
}

function duplicateSelectedNodes() {
  const selected = selectedNodes.value;
  if (!selected.length) {
    return;
  }
  const copies = selected.map((node) => ({
    ...JSON.parse(JSON.stringify(node)),
    id: createId(node.kind),
    x: node.x + 36,
    y: node.y + 36,
    title: `${node.title} 副本`,
    status: node.kind === "prompt" ? "idle" : node.status,
    error: "",
    createdAt: Date.now(),
  })) as CanvasNode[];
  nodes.value = [...nodes.value, ...copies];
  selectedIds.value = copies.map((node) => node.id);
  scheduleSave();
}

function copySelectedNodes() {
  nodeClipboard.value = cloneNodes(selectedNodes.value);
}

function pasteCopiedNodes() {
  if (!nodeClipboard.value.length) {
    return;
  }
  const center = boardCenterWorld();
  const minX = Math.min(...nodeClipboard.value.map((node) => node.x));
  const minY = Math.min(...nodeClipboard.value.map((node) => node.y));
  const copies = nodeClipboard.value.map((node) => ({
    ...JSON.parse(JSON.stringify(node)),
    id: createId(node.kind),
    x: Math.round(center.x + (node.x - minX)),
    y: Math.round(center.y + (node.y - minY)),
    status: node.kind === "prompt" ? "idle" : node.status,
    error: "",
    createdAt: Date.now(),
  })) as CanvasNode[];
  nodes.value = [...nodes.value, ...copies];
  selectedIds.value = copies.map((node) => node.id);
  scheduleSave();
}

function clearCanvas() {
  const center = boardCenterWorld();
  const node = createPromptNode(center.x - 165, center.y - 114);
  nodes.value = [node];
  links.value = [];
  selectedIds.value = [node.id];
  scheduleSave();
}

function updateNodePrompt(node: CanvasNode, value: string) {
  node.prompt = value;
  if (node.status === "error") {
    node.status = "idle";
    node.error = "";
  }
  scheduleSave();
}

function handlePromptInput(node: CanvasNode, event: Event) {
  const target = event.target as HTMLTextAreaElement;
  updateNodePrompt(node, target.value);
  const beforeCursor = target.value.slice(0, target.selectionStart ?? target.value.length);
  const match = beforeCursor.match(/(?:^|\s)@([^\s@\[\]]{0,32})$/);
  if (!match) {
    mentionState.value = null;
    return;
  }
  mentionState.value = {
    nodeId: node.id,
    query: match[1] || "",
    start: beforeCursor.length - (match[1] || "").length - 1,
    end: beforeCursor.length,
  };
}

function insertMention(node: CanvasNode, candidate: MentionCandidate) {
  const state = mentionState.value;
  if (!state || state.nodeId !== node.id) {
    node.prompt = `${node.prompt || ""} @[${candidate.title}] `;
    scheduleSave();
    return;
  }
  const prompt = node.prompt || "";
  node.prompt = `${prompt.slice(0, state.start)}@[${candidate.title}] ${prompt.slice(state.end)}`;
  mentionState.value = null;
  scheduleSave();
}

function normalizeMentionTitle(value: string) {
  return value.trim().toLowerCase();
}

function parseMentionTitles(prompt: string) {
  const titles = new Set<string>();
  for (const match of prompt.matchAll(/@\[([^\]]+)\]/g)) {
    titles.add(normalizeMentionTitle(match[1]));
  }
  for (const match of prompt.matchAll(/(?:^|\s)@([^\s@\[\]]+)/g)) {
    titles.add(normalizeMentionTitle(match[1]));
  }
  return titles;
}

function cleanPromptForGeneration(prompt: string) {
  return prompt.replace(/@\[([^\]]+)\]/g, "参考图").replace(/(?:^|\s)@([^\s@\[\]]+)/g, " 参考图").trim();
}

function setImageModel(value: string) {
  const model = selectableImageModels.find((item) => item.id === value);
  if (model) {
    store.setSelectedImageModel(model.id);
    openDropdown.value = "";
  }
}

function setImageConfig(field: ImageModelField, rawValue: string) {
  const option = field.options.find((item) => String(item.value) === rawValue);
  store.setImageModelConfig(
    activeImageModelId.value,
    field.key,
    (option?.value ?? rawValue) as ImageConfigValue,
  );
  openDropdown.value = "";
}

function setAssetCategory(categoryId: string) {
  activeAssetCategoryId.value = categoryId;
  openDropdown.value = "";
}

function toggleDropdown(key: string) {
  openDropdown.value = openDropdown.value === key ? "" : key;
}

function optionLabel(field: ImageModelField) {
  const value = String(activeImageConfig.value[field.key] ?? field.default);
  return field.options.find((option) => String(option.value) === value)?.label ?? value;
}

function getNode(nodeId: string) {
  return nodes.value.find((node) => node.id === nodeId) ?? null;
}

function isLinked(fromNodeId: string, toNodeId: string) {
  return links.value.some((link) => link.fromNodeId === fromNodeId && link.toNodeId === toNodeId);
}

function addLink(fromNodeId: string, toNodeId: string) {
  const from = getNode(fromNodeId);
  const to = getNode(toNodeId);
  if (!from || !to || from.kind !== "image" || to.kind !== "prompt" || isLinked(fromNodeId, toNodeId)) {
    return;
  }
  links.value = [...links.value, { id: createId("link"), fromNodeId, toNodeId }];
  scheduleSave();
}

function removeLink(linkId: string) {
  links.value = links.value.filter((link) => link.id !== linkId);
  scheduleSave();
}

function toggleImageLinkToPrompt(imageNode: CanvasNode, promptNode = activePromptNode.value) {
  if (!promptNode || imageNode.kind !== "image") {
    return;
  }
  const existing = links.value.find((link) => link.fromNodeId === imageNode.id && link.toNodeId === promptNode.id);
  if (existing) {
    removeLink(existing.id);
    return;
  }
  addLink(imageNode.id, promptNode.id);
}

function linkSelectedImagesToPrompt(promptNode = activePromptNode.value) {
  if (!promptNode) {
    return;
  }
  for (const node of selectedImageNodes.value) {
    addLink(node.id, promptNode.id);
  }
}

function unlinkPromptImages(promptNode: CanvasNode) {
  links.value = links.value.filter((link) => link.toNodeId !== promptNode.id);
  scheduleSave();
}

function nodeCenter(node: CanvasNode, side: "left" | "right") {
  return {
    x: side === "right" ? node.x + node.width : node.x,
    y: node.y + node.height / 2,
  };
}

function linkPath(link: CanvasLink) {
  const from = getNode(link.fromNodeId);
  const to = getNode(link.toNodeId);
  if (!from || !to) {
    return "";
  }
  const start = nodeCenter(from, "right");
  const end = nodeCenter(to, "left");
  const delta = Math.max(80, Math.abs(end.x - start.x) * 0.45);
  return `M ${start.x} ${start.y} C ${start.x + delta} ${start.y}, ${end.x - delta} ${end.y}, ${end.x} ${end.y}`;
}

function pickImageFiles() {
  imageInput.value?.click();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

async function addImageFiles(files: FileList | File[] | null, point = boardCenterWorld()) {
  const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
  if (!imageFiles.length) {
    return;
  }

  const createdIds: string[] = [];
  for (const [index, file] of imageFiles.entries()) {
    const src = await readFileAsDataUrl(file);
    const node = addImageNode(src, file.name || `图片 ${index + 1}`, point.x + index * 36, point.y + index * 36);
    createdIds.push(node.id);
  }
  selectedIds.value = createdIds;
  scheduleSave();
}

function addAsset(src: string, title: string, categoryId = activeAssetCategoryId.value) {
  const asset: CanvasAsset = {
    id: createId("asset"),
    title: title.trim() || `图片 ${assets.value.length + 1}`,
    src,
    categoryId,
    createdAt: Date.now(),
  };
  assets.value = [asset, ...assets.value];
  scheduleSave();
  return asset;
}

async function addAssetFiles(files: FileList | File[] | null) {
  const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
  for (const file of imageFiles) {
    addAsset(await readFileAsDataUrl(file), file.name || "粘贴图片");
  }
}

function addSelectedImagesToAssets() {
  for (const node of selectedImageNodes.value) {
    if (node.src) {
      addAsset(node.src, node.title, "references");
    }
  }
}

function removeAsset(assetId: string) {
  assets.value = assets.value.filter((asset) => asset.id !== assetId);
  scheduleSave();
}

function addAssetToCanvas(asset: CanvasAsset) {
  const center = boardCenterWorld();
  addImageNode(asset.src, asset.title, center.x - 150, center.y - 135);
}

function openAssetCategoryDialog() {
  assetCategoryDraft.value = "新文件夹";
  assetCategoryDialogOpen.value = true;
}

function confirmAssetCategory() {
  const name = assetCategoryDraft.value.trim();
  if (!name) {
    return;
  }
  const category = { id: createId("asset-category"), name: name.slice(0, 40) };
  assetCategories.value = [...assetCategories.value, category];
  activeAssetCategoryId.value = category.id;
  assetCategoryDialogOpen.value = false;
  scheduleSave();
}

async function handleImageInput(event: Event) {
  const target = event.target as HTMLInputElement;
  await addImageFiles(target.files);
  target.value = "";
}

function handleDragOver(event: DragEvent) {
  event.preventDefault();
}

async function handleDrop(event: DragEvent) {
  event.preventDefault();
  const point = screenToWorld(event.clientX, event.clientY);
  await addImageFiles(event.dataTransfer?.files ?? null, point);
}

async function handleAssetDrop(event: DragEvent) {
  event.preventDefault();
  await addAssetFiles(event.dataTransfer?.files ?? null);
}

async function handlePaste(event: ClipboardEvent) {
  if (!event.clipboardData) {
    return;
  }

  const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
  if (!files.length) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  await addImageFiles(files);
}

function startBoardPan(event: PointerEvent) {
  if (event.button !== 0) {
    return;
  }

  const target = event.target as HTMLElement;
  if (target.closest(".canvas-node") || target.closest(".canvas-toolbar")) {
    return;
  }

  selectedIds.value = [];
  dragState.value = {
    type: "pan",
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: viewport.value.x,
    startY: viewport.value.y,
  };
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", finishPointerAction, { once: true });
}

function startNodeDrag(event: PointerEvent, node: CanvasNode) {
  if (event.button !== 0) {
    return;
  }

  const target = event.target as HTMLElement;
  if (target.closest("button, textarea, input, select, a")) {
    return;
  }

  selectNode(node.id, event.shiftKey || event.ctrlKey || event.metaKey);
  const movingIds = selectedIds.value.includes(node.id) ? selectedIds.value : [node.id];
  dragState.value = {
    type: "node",
    nodeId: node.id,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: node.x,
    startY: node.y,
    nodeStartPositions: Object.fromEntries(
      nodes.value
        .filter((item) => movingIds.includes(item.id))
        .map((item) => [item.id, { x: item.x, y: item.y }]),
    ),
  };
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", finishPointerAction, { once: true });
}

function startNodeResize(event: PointerEvent, node: CanvasNode) {
  event.stopPropagation();
  event.preventDefault();
  selectNode(node.id);
  dragState.value = {
    type: "resize",
    nodeId: node.id,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: node.x,
    startY: node.y,
    startWidth: node.width,
    startHeight: node.height,
  };
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", finishPointerAction, { once: true });
}

function handlePointerMove(event: PointerEvent) {
  const state = dragState.value;
  if (!state) {
    return;
  }

  const dx = event.clientX - state.startClientX;
  const dy = event.clientY - state.startClientY;
  if (state.type === "pan") {
    viewport.value = {
      ...viewport.value,
      x: state.startX + dx,
      y: state.startY + dy,
    };
    return;
  }

  const node = nodes.value.find((item) => item.id === state.nodeId);
  if (!node) {
    return;
  }

  if (state.type === "resize") {
    node.width = Math.round(clampNumber((state.startWidth || node.width) + dx / viewport.value.scale, 220, 980));
    node.height = Math.round(clampNumber((state.startHeight || node.height) + dy / viewport.value.scale, 160, 860));
    return;
  }

  const startPositions = state.nodeStartPositions || { [node.id]: { x: state.startX, y: state.startY } };
  for (const item of nodes.value) {
    const start = startPositions[item.id];
    if (!start) {
      continue;
    }
    item.x = Math.round(start.x + dx / viewport.value.scale);
    item.y = Math.round(start.y + dy / viewport.value.scale);
  }
}

function finishPointerAction() {
  dragState.value = null;
  window.removeEventListener("pointermove", handlePointerMove);
  scheduleSave();
}

function zoomAt(clientX: number, clientY: number, nextScale: number) {
  const rect = boardRef.value?.getBoundingClientRect();
  if (!rect) {
    viewport.value = {
      ...viewport.value,
      scale: clampNumber(nextScale, MIN_ZOOM, MAX_ZOOM),
    };
    return;
  }

  const oldScale = viewport.value.scale;
  const scale = clampNumber(nextScale, MIN_ZOOM, MAX_ZOOM);
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const worldX = (localX - viewport.value.x) / oldScale;
  const worldY = (localY - viewport.value.y) / oldScale;

  viewport.value = {
    x: localX - worldX * scale,
    y: localY - worldY * scale,
    scale,
  };
}

function handleWheel(event: WheelEvent) {
  event.preventDefault();
  const factor = event.deltaY > 0 ? 0.9 : 1.1;
  zoomAt(event.clientX, event.clientY, viewport.value.scale * factor);
}

function zoomBy(factor: number) {
  const rect = boardRef.value?.getBoundingClientRect();
  if (!rect) {
    return;
  }
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, viewport.value.scale * factor);
}

function fitView() {
  const rect = boardRef.value?.getBoundingClientRect();
  if (!rect) {
    return;
  }

  const visibleNodes = nodes.value;
  if (!visibleNodes.length) {
    viewport.value = { x: rect.width / 2, y: rect.height / 2, scale: 0.9 };
    return;
  }

  const minX = Math.min(...visibleNodes.map((node) => node.x));
  const minY = Math.min(...visibleNodes.map((node) => node.y));
  const maxX = Math.max(...visibleNodes.map((node) => node.x + node.width));
  const maxY = Math.max(...visibleNodes.map((node) => node.y + node.height));
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const scale = clampNumber(Math.min((rect.width - 96) / width, (rect.height - 96) / height), 0.42, 1.2);

  viewport.value = {
    x: rect.width / 2 - (minX + width / 2) * scale,
    y: rect.height / 2 - (minY + height / 2) * scale,
    scale,
  };
}

async function sourceToDataUrl(source: string): Promise<string> {
  if (/^data:image\/[^;]+;base64,/i.test(source)) {
    return source;
  }

  const response = await fetch(source);
  if (!response.ok) {
    throw new Error("参考图片读取失败");
  }

  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("参考图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

async function buildSourceImages(node: CanvasNode) {
  const mentionTitles = parseMentionTitles(node.prompt || "");
  const mentionedNodeSources = nodes.value
    .filter((sourceNode) => sourceNode.kind === "image" && sourceNode.src && mentionTitles.has(normalizeMentionTitle(sourceNode.title)))
    .map((sourceNode) => sourceNode.src || "");
  const mentionedAssetSources = assets.value
    .filter((asset) => mentionTitles.has(normalizeMentionTitle(asset.title)))
    .map((asset) => asset.src);
  const linkedSources = links.value
    .filter((link) => link.toNodeId === node.id)
    .map((link) => getNode(link.fromNodeId))
    .filter((sourceNode): sourceNode is CanvasNode => Boolean(sourceNode?.src))
    .map((sourceNode) => sourceNode.src || "");
  const selectedSources = selectedImageNodes.value
    .filter((sourceNode) => sourceNode.id !== node.id)
    .map((sourceNode) => sourceNode.src || "");
  const sources = [...linkedSources, ...mentionedNodeSources, ...mentionedAssetSources, ...selectedSources]
    .filter((source, index, list) => Boolean(source) && list.indexOf(source) === index)
    .slice(0, activeUploadLimit.value);

  const resolved: string[] = [];
  for (const source of sources) {
    if (source) {
      resolved.push(await sourceToDataUrl(source));
    }
  }
  return resolved;
}

function buildCanvasImageTask(
  prompt: string,
  model: ImageModelId,
  config: ImageConfigRecord,
  sourceImages: string[],
  startedAt: number,
  clientRequestId?: string,
  requestFingerprint?: string,
): ImageTask {
  return createImageTask({
    createdAt: startedAt,
    updatedAt: startedAt,
    status: "generating",
    clientRequestId,
    requestFingerprint,
    progress: "",
    progressPercent: 1,
    sourceImages,
    prompt,
    model,
    modelConfig: { ...config },
    resultImages: [],
    generationTime: 0,
  });
}

function countNodeReferences(node: CanvasNode) {
  const mentionTitles = parseMentionTitles(node.prompt || "");
  const mentioned = [
    ...links.value
      .filter((link) => link.toNodeId === node.id)
      .map((link) => getNode(link.fromNodeId))
      .filter((sourceNode): sourceNode is CanvasNode => Boolean(sourceNode?.src))
      .map((sourceNode) => sourceNode.src || ""),
    ...nodes.value
      .filter((sourceNode) => sourceNode.kind === "image" && sourceNode.src && mentionTitles.has(normalizeMentionTitle(sourceNode.title)))
      .map((sourceNode) => sourceNode.src || ""),
    ...assets.value
      .filter((asset) => mentionTitles.has(normalizeMentionTitle(asset.title)))
      .map((asset) => asset.src),
  ];
  const selected = selectedImageNodes.value
    .filter((sourceNode) => sourceNode.id !== node.id)
    .map((sourceNode) => sourceNode.src || "");
  return [...mentioned, ...selected].filter((source, index, list) => Boolean(source) && list.indexOf(source) === index).length;
}

function createClientRequestId(prefix = "canvas-image") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hasResumableCanvasJob(node: CanvasNode) {
  return node.kind === "prompt" && node.status === "generating" && Boolean(node.serverJobId || node.clientRequestId);
}

function clearCanvasGenerationState(node: CanvasNode) {
  delete node.serverJobId;
  delete node.clientRequestId;
  delete node.requestFingerprint;
  delete node.generationStartedAt;
  delete node.generationModel;
  delete node.generationConfig;
  delete node.generationPrompt;
  delete node.generationSourceCount;
}

function updateNodeFromImageJob(node: CanvasNode, job: ImageJobStatus) {
  node.serverJobId = job.id || node.serverJobId;
  node.clientRequestId = job.clientRequestId || node.clientRequestId;
  node.requestFingerprint = job.requestFingerprint || node.requestFingerprint;
  node.generationStartedAt = node.generationStartedAt || job.createdAt;
  node.generationModel = node.generationModel || job.model;
  node.generationConfig = node.generationConfig || { ...(job.modelConfig || {}) };
  node.generationPrompt = node.generationPrompt || job.prompt;
  node.generationSourceCount = node.generationSourceCount ?? job.sourceImageCount ?? 0;
}

function createCanvasFallbackTask(node: CanvasNode, job: ImageJobStatus): ImageTask {
  const createdAt = Number(node.generationStartedAt || job.createdAt || Date.now());
  return {
    id: node.clientRequestId || node.serverJobId || job.id,
    createdAt,
    updatedAt: job.updatedAt || Date.now(),
    status: "generating",
    serverJobId: job.id || node.serverJobId,
    clientRequestId: job.clientRequestId || node.clientRequestId,
    requestFingerprint: job.requestFingerprint || node.requestFingerprint,
    remoteStatus: job.status,
    sourceImages: [],
    prompt: node.generationPrompt || job.prompt || node.prompt || "",
    model: node.generationModel || job.model,
    modelConfig: node.generationConfig || job.modelConfig || {},
    resultImages: [],
    generationTime: Date.now() - createdAt,
    error: node.error || job.error || "",
  };
}

function pushCanvasLog(entry: Omit<CanvasLogEntry, "id">) {
  logs.value = [{ id: createId("log"), ...entry }, ...logs.value].slice(0, 100);
}

async function applyCanvasImageJob(node: CanvasNode, job: ImageJobStatus) {
  updateNodeFromImageJob(node, job);

  const task = imageJobToTask(job, createCanvasFallbackTask(node, job));
  if (task.status === "generating") {
    node.status = "generating";
    node.error = job.progress || node.error || "";
    scheduleSave();
    return false;
  }

  activeRuns.delete(node.id);

  if (task.status === "success") {
    const resultImages = task.resultImages.filter(Boolean);
    if (resultImages.length === 0) {
      node.status = "error";
      node.error = "图像生成任务完成，但没有返回图片";
      pushCanvasLog({
        prompt: task.prompt,
        model: task.model,
        sourceCount: node.generationSourceCount || job.sourceImageCount || 0,
        createdAt: task.createdAt,
        generationTime: Date.now() - task.createdAt,
        status: "failed",
        resultImages: [],
        error: node.error,
      });
      clearCanvasGenerationState(node);
      scheduleSave();
      return true;
    }

    resultImages.forEach((source, index) => {
      addImageNode(
        source,
        `生成结果 ${index + 1}`,
        node.x + node.width + 56 + index * 38,
        node.y + index * 38,
      ).generatedPrompt = task.prompt;
    });

    const finalTask: ImageTask = {
      ...task,
      status: "success",
      resultImages,
      generationTime: task.generationTime || Date.now() - task.createdAt,
      updatedAt: Date.now(),
      error: "",
    };
    await store.addHistoryTask(finalTask);
    pushCanvasLog({
      prompt: task.prompt,
      model: task.model,
      sourceCount: node.generationSourceCount || job.sourceImageCount || 0,
      createdAt: task.createdAt,
      generationTime: finalTask.generationTime,
      status: "success",
      resultImages,
    });
    node.status = "success";
    node.error = "";
    node.generatedPrompt = task.prompt;
    clearCanvasGenerationState(node);
    scheduleSave();
    return true;
  }

  node.status = "error";
  node.error = task.error || "生成失败";
  pushCanvasLog({
    prompt: task.prompt,
    model: task.model,
    sourceCount: node.generationSourceCount || job.sourceImageCount || 0,
    createdAt: task.createdAt,
    generationTime: task.generationTime || Date.now() - task.createdAt,
    status: "failed",
    resultImages: [],
    error: node.error,
  });
  clearCanvasGenerationState(node);
  scheduleSave();
  return true;
}

function clearCanvasJobPolling() {
  if (canvasPollTimer) {
    window.clearTimeout(canvasPollTimer);
    canvasPollTimer = undefined;
  }
}

function scheduleCanvasJobPolling(delay = 1000) {
  clearCanvasJobPolling();
  if (document.visibilityState === "hidden" || !nodes.value.some(hasResumableCanvasJob)) {
    return;
  }

  canvasPollTimer = window.setTimeout(() => {
    void refreshCanvasJobs();
  }, delay);
}

async function refreshCanvasJobs(force = false) {
  if (document.visibilityState === "hidden" && !force) {
    return;
  }

  if (force) {
    clearCanvasJobPolling();
  }

  const pendingNodes = nodes.value.filter(hasResumableCanvasJob);
  if (pendingNodes.length === 0) {
    clearCanvasJobPolling();
    return;
  }

  let listedJobs: ImageJobStatus[] | null = null;
  for (const node of pendingNodes) {
    try {
      let job: ImageJobStatus | undefined;
      if (node.serverJobId) {
        job = await pollImageJob(node.serverJobId);
      } else if (node.clientRequestId) {
        listedJobs = listedJobs || (await listImageJobs(20));
        job = listedJobs.find((item) => item.clientRequestId === node.clientRequestId);
      }

      if (job) {
        await applyCanvasImageJob(node, job);
      }
    } catch (error) {
      node.error = error instanceof Error ? error.message : String(error);
      scheduleSave();
    }
  }

  if (nodes.value.some(hasResumableCanvasJob)) {
    scheduleCanvasJobPolling(5000);
  } else {
    clearCanvasJobPolling();
  }
}

function resumeCanvasImageWork() {
  if (document.visibilityState === "hidden") {
    return;
  }

  if (nodes.value.some(hasResumableCanvasJob)) {
    void refreshCanvasJobs(true);
  }
}

async function runPromptNode(node: CanvasNode) {
  const prompt = String(node.prompt || "").trim();
  if (!prompt || node.status === "generating") {
    return;
  }

  const startedAt = Date.now();
  const runId = createId("run");
  activeRuns.set(node.id, runId);
  node.status = "generating";
  node.error = "";
  scheduleSave();

  try {
    const model = activeImageModelId.value;
    const config = { ...activeImageConfig.value };
    const sourceImages = await buildSourceImages(node);
    const generationPrompt = cleanPromptForGeneration(prompt);
    const usesCodexImageKey = model === "codex-image-2";
    const usesWaveSpeedImageModel = isWaveSpeedImageModel(model);
    const apiBaseUrl = usesWaveSpeedImageModel ? "" : usesCodexImageKey ? CODEX_IMAGE_API_BASE_URL : store.apiBaseUrl;
    const apiKey = usesWaveSpeedImageModel ? "" : usesCodexImageKey ? store.codexApiKey : store.apiKey;
    const requestFingerprint = await createImageRequestFingerprint({
      model,
      prompt: generationPrompt,
      sourceImages,
      config,
      apiBaseUrl,
    });
    const clientRequestId = createClientRequestId();
    const task = buildCanvasImageTask(
      generationPrompt,
      model,
      config,
      sourceImages,
      startedAt,
      clientRequestId,
      requestFingerprint,
    );
    let latestTask = task;
    node.clientRequestId = clientRequestId;
    node.requestFingerprint = requestFingerprint;
    node.generationStartedAt = startedAt;
    node.generationModel = model;
    node.generationConfig = { ...config };
    node.generationPrompt = generationPrompt;
    node.generationSourceCount = sourceImages.length;
    scheduleSave();

    const result = await generateImage({
        model,
        prompt: generationPrompt,
        sourceImages,
        config,
        clientRequestId,
        requestFingerprint,
        onJobUpdate: (job) => {
          if (activeRuns.get(node.id) !== runId) {
            return;
          }
          latestTask = imageJobToTask(job, task);
          updateNodeFromImageJob(node, job);
          node.status = latestTask.status === "generating" ? "generating" : node.status;
          scheduleSave();
        },
        apiBaseUrl,
        apiKey,
      });

    if (activeRuns.get(node.id) !== runId) {
      return;
    }

    const resultImages = result.images.filter(Boolean);
    resultImages.forEach((source, index) => {
      addImageNode(
        source,
        `生成结果 ${index + 1}`,
        node.x + node.width + 56 + index * 38,
        node.y + index * 38,
      ).generatedPrompt = generationPrompt;
    });

    const finalTask: ImageTask = {
      ...latestTask,
      status: "success",
      resultImages,
      generationTime: Date.now() - startedAt,
      updatedAt: Date.now(),
      error: "",
    };
    await store.addHistoryTask(finalTask);
    pushCanvasLog({
      prompt: generationPrompt,
      model,
      sourceCount: sourceImages.length,
      createdAt: startedAt,
      generationTime: Date.now() - startedAt,
      status: "success",
      resultImages,
    });
    node.status = "success";
    node.error = "";
    node.generatedPrompt = generationPrompt;
    clearCanvasGenerationState(node);
  } catch (error) {
    if (activeRuns.get(node.id) !== runId) {
      return;
    }
    const message = error instanceof Error ? error.message : "生成失败";
    if (node.serverJobId && /仍在服务器运行/.test(message)) {
      node.status = "generating";
      node.error = message;
      scheduleCanvasJobPolling(10000);
      return;
    }

    node.status = "error";
    node.error = message;
    pushCanvasLog({
      prompt,
      model: activeImageModelId.value,
      sourceCount: node.generationSourceCount || 0,
      createdAt: startedAt,
      generationTime: Date.now() - startedAt,
      status: "failed",
      resultImages: [],
      error: node.error,
    });
    clearCanvasGenerationState(node);
  } finally {
    if (activeRuns.get(node.id) === runId) {
      activeRuns.delete(node.id);
    }
    scheduleSave();
  }
}

function stopPromptNode(node: CanvasNode) {
  activeRuns.delete(node.id);
  node.status = "idle";
  node.error = "";
  clearCanvasGenerationState(node);
  scheduleSave();
}

function downloadImage(node: CanvasNode) {
  if (!node.src) {
    return;
  }

  const anchor = document.createElement("a");
  anchor.href = node.src;
  anchor.download = `art-workshop-canvas-${Date.now()}.png`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function openImage(node: CanvasNode) {
  previewNode.value = node.src ? node : null;
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  URL.revokeObjectURL(anchor.href);
  anchor.remove();
}

function exportWorkspace() {
  syncActiveWorkspace();
  downloadJson(`art-workshop-canvas-${Date.now()}.json`, {
    version: 2,
    workspace: activeWorkspace.value,
    assets: assets.value,
    assetCategories: assetCategories.value,
  });
}

function exportAllCanvases() {
  syncActiveWorkspace();
  downloadJson(`art-workshop-canvas-backup-${Date.now()}.json`, {
    version: 2,
    workspaces: workspaces.value,
    activeWorkspaceId: activeWorkspaceId.value,
    assets: assets.value,
    assetCategories: assetCategories.value,
    logs: logs.value,
  });
}

function pickImportFile() {
  importInput.value?.click();
}

async function handleImportFile(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = "";
  if (!file) {
    return;
  }
  const raw = await file.text();
  const parsed = JSON.parse(raw) as PersistedCanvas & { workspace?: CanvasWorkspace };
  syncActiveWorkspace();

  if (parsed.workspace) {
    const workspace = {
      ...parsed.workspace,
      id: createId("canvas"),
      title: `${parsed.workspace.title || "导入画布"} 导入`,
      nodes: normalizeNodes(parsed.workspace.nodes || []),
      links: Array.isArray(parsed.workspace.links) ? parsed.workspace.links : [],
      updatedAt: Date.now(),
    };
    workspaces.value = [workspace, ...workspaces.value];
    openWorkspace(workspace.id, false);
  } else if (Array.isArray(parsed.workspaces) && parsed.workspaces.length) {
    workspaces.value = parsed.workspaces.map((workspace) => ({
      ...workspace,
      nodes: normalizeNodes(workspace.nodes || []),
      links: Array.isArray(workspace.links) ? workspace.links : [],
    }));
    activeWorkspaceId.value = parsed.activeWorkspaceId || parsed.workspaces[0].id;
    openWorkspace(activeWorkspaceId.value, false);
  }

  if (Array.isArray(parsed.assets)) {
    assets.value = parsed.assets;
  }
  if (Array.isArray(parsed.assetCategories) && parsed.assetCategories.length) {
    assetCategories.value = parsed.assetCategories;
    activeAssetCategoryId.value = parsed.assetCategories[0].id;
  }
  scheduleSave();
}

function rerunLog(entry: CanvasLogEntry) {
  const center = boardCenterWorld();
  const node = createPromptNode(center.x - 165, center.y - 114);
  node.prompt = entry.prompt;
  nodes.value = [...nodes.value, node];
  selectedIds.value = [node.id];
  void runPromptNode(node);
}

async function copyText(value: string) {
  await navigator.clipboard?.writeText(value);
}

function handleKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  const isEditing = Boolean(target?.closest("textarea,input,select,[contenteditable='true']"));
  if (event.key === "Escape") {
    previewNode.value = null;
    mentionState.value = null;
    openDropdown.value = "";
    showCanvasPanel.value = false;
    showLogPanel.value = false;
    return;
  }
  if (isEditing) {
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    removeSelectedNodes();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
    event.preventDefault();
    duplicateSelectedNodes();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
    copySelectedNodes();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
    pasteCopiedNodes();
  }
}

function handleCanvasPageActive() {
  resumeCanvasImageWork();
}

function handleCanvasVisibilityChange() {
  if (document.visibilityState !== "hidden") {
    resumeCanvasImageWork();
  }
}

onMounted(async () => {
  loadCanvas();
  await nextTick();
  if (!localStorage.getItem(STORAGE_KEY)) {
    fitView();
  }
  window.addEventListener("paste", handlePaste, { capture: true });
  window.addEventListener("keydown", handleKeydown);
  document.addEventListener("visibilitychange", handleCanvasVisibilityChange);
  window.addEventListener("pageshow", handleCanvasPageActive);
  window.addEventListener("focus", handleCanvasPageActive);
  window.addEventListener("online", handleCanvasPageActive);
  resumeCanvasImageWork();
});

onBeforeUnmount(() => {
  window.clearTimeout(saveTimer);
  clearCanvasJobPolling();
  window.removeEventListener("paste", handlePaste, { capture: true });
  window.removeEventListener("keydown", handleKeydown);
  document.removeEventListener("visibilitychange", handleCanvasVisibilityChange);
  window.removeEventListener("pageshow", handleCanvasPageActive);
  window.removeEventListener("focus", handleCanvasPageActive);
  window.removeEventListener("online", handleCanvasPageActive);
  window.removeEventListener("pointermove", handlePointerMove);
});

watch(nodes, scheduleSave, { deep: true });
watch(links, scheduleSave, { deep: true });
watch(viewport, scheduleSave, { deep: true });
</script>

<template>
  <section class="infinite-canvas">
    <input
      ref="imageInput"
      type="file"
      accept="image/*"
      multiple
      class="hidden"
      @change="handleImageInput"
    />
    <input
      ref="importInput"
      type="file"
      accept="application/json,.json"
      class="hidden"
      @change="handleImportFile"
    />

    <div class="canvas-toolbar">
      <button
        type="button"
        class="canvas-tool-button"
        :class="showCanvasPanel ? 'canvas-tool-button--active' : ''"
        title="画布管理"
        :aria-pressed="showCanvasPanel"
        @click="showCanvasPanel = !showCanvasPanel"
      >
        <FolderOpen class="h-4 w-4" />
        <span>{{ activeWorkspaceTitle }}</span>
      </button>
      <div class="canvas-toolbar-separator" />
      <button
        type="button"
        class="canvas-tool-button"
        title="新增提示词"
        @click="addPromptNode"
      >
        <Plus class="h-4 w-4" />
        <span>提示词</span>
      </button>
      <button
        type="button"
        class="canvas-tool-button"
        title="上传图片"
        @click="pickImageFiles"
      >
        <Upload class="h-4 w-4" />
        <span>图片</span>
      </button>
      <div class="canvas-toolbar-separator" />
      <div class="canvas-menu-wrap">
        <button
          type="button"
          class="canvas-menu-button"
          :class="openDropdown === 'model' ? 'canvas-menu-button--open' : ''"
          title="模型"
          aria-haspopup="listbox"
          :aria-expanded="openDropdown === 'model'"
          @click.stop="toggleDropdown('model')"
        >
          <Layers class="h-4 w-4" />
          <span>{{ activeModelLabel }}</span>
          <ChevronDown class="h-3.5 w-3.5 canvas-menu-chevron" />
        </button>
        <div
          v-if="openDropdown === 'model'"
          class="canvas-dropdown canvas-dropdown--wide"
          role="listbox"
          @pointerdown.stop
        >
          <button
            v-for="model in selectableImageModels"
            :key="model.id"
            type="button"
            class="canvas-dropdown-option"
            :class="model.id === activeImageModelId ? 'canvas-dropdown-option--selected' : ''"
            role="option"
            :aria-selected="model.id === activeImageModelId"
            @click="setImageModel(model.id)"
          >
            <span class="canvas-model-option-label">
              <component
                :is="getImageModelIcon(model.id)"
                class="h-3.5 w-3.5 shrink-0"
              />
              <span>{{ model.name }}</span>
            </span>
            <Check
              v-if="model.id === activeImageModelId"
              class="h-3.5 w-3.5"
            />
          </button>
        </div>
      </div>
      <div
        v-for="field in activeImageModel.options"
        :key="field.key"
        class="canvas-menu-wrap"
      >
        <button
          type="button"
          class="canvas-menu-button canvas-menu-button--compact"
          :class="openDropdown === `field-${field.key}` ? 'canvas-menu-button--open' : ''"
          :title="field.label"
          aria-haspopup="listbox"
          :aria-expanded="openDropdown === `field-${field.key}`"
          @click.stop="toggleDropdown(`field-${field.key}`)"
        >
          <span>{{ optionLabel(field) }}</span>
          <ChevronDown class="h-3.5 w-3.5 canvas-menu-chevron" />
        </button>
        <div
          v-if="openDropdown === `field-${field.key}`"
          class="canvas-dropdown"
          role="listbox"
          @pointerdown.stop
        >
          <button
            v-for="option in field.options"
            :key="String(option.value)"
            type="button"
            class="canvas-dropdown-option"
            :class="String(activeImageConfig[field.key] ?? field.default) === String(option.value) ? 'canvas-dropdown-option--selected' : ''"
            role="option"
            :aria-selected="String(activeImageConfig[field.key] ?? field.default) === String(option.value)"
            @click="setImageConfig(field, String(option.value))"
          >
            <span>{{ option.label }}</span>
            <Check
              v-if="String(activeImageConfig[field.key] ?? field.default) === String(option.value)"
              class="h-3.5 w-3.5"
            />
          </button>
        </div>
      </div>
      <div class="canvas-toolbar-separator" />
      <button
        type="button"
        class="canvas-icon-button"
        title="缩小"
        @click="zoomBy(0.88)"
      >
        <ZoomOut class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="canvas-icon-button"
        title="放大"
        @click="zoomBy(1.14)"
      >
        <ZoomIn class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="canvas-icon-button"
        title="适配画布"
        @click="fitView"
      >
        <LocateFixed class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="canvas-icon-button canvas-icon-button--danger"
        title="清空画布"
        @click="clearCanvas"
      >
        <Trash2 class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="canvas-icon-button"
        :class="showAssetPanel ? 'canvas-icon-button--active' : ''"
        title="资产库"
        :aria-pressed="showAssetPanel"
        @click="showAssetPanel = !showAssetPanel"
      >
        <Library class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="canvas-icon-button"
        :class="showLogPanel ? 'canvas-icon-button--active' : ''"
        title="生成日志"
        :aria-pressed="showLogPanel"
        @click="showLogPanel = !showLogPanel"
      >
        <History class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="canvas-icon-button"
        title="导入画布"
        @click="pickImportFile"
      >
        <FileUp class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="canvas-icon-button"
        title="导出画布"
        @click="exportWorkspace"
      >
        <FileDown class="h-4 w-4" />
      </button>
    </div>

    <div class="canvas-status">
      <MousePointer2 class="h-3.5 w-3.5" />
      <span>{{ selectionLabel }}</span>
      <span class="canvas-status-dot" />
      <span>{{ Math.round(viewport.scale * 100) }}%</span>
      <span class="canvas-status-dot" />
      <span>{{ currentWorkspaceUpdatedAt }}</span>
      <template v-if="savingFailed">
        <span class="canvas-status-dot" />
        <span class="canvas-status-error">保存失败</span>
      </template>
    </div>

    <aside
      v-if="showCanvasPanel"
      class="canvas-side-panel canvas-side-panel--left"
    >
      <header class="canvas-panel-head">
        <div>
          <div class="canvas-panel-title">画布</div>
          <div class="canvas-panel-subtitle">{{ workspaces.length }} 个工作区</div>
        </div>
        <button
          type="button"
          class="canvas-node-icon-button"
          title="关闭"
          @click="showCanvasPanel = false"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </header>
      <input
        :value="activeWorkspaceTitle"
        class="canvas-title-input"
        maxlength="80"
        @input="renameActiveWorkspace(($event.target as HTMLInputElement).value)"
      />
      <div class="canvas-panel-actions">
        <button
          type="button"
          class="canvas-tool-button"
          @click="addWorkspace('smart')"
        >
          <Sparkles class="h-4 w-4" />
          <span>新建智能画布</span>
        </button>
        <button
          type="button"
          class="canvas-tool-button"
          @click="exportAllCanvases"
        >
          <Save class="h-4 w-4" />
          <span>备份全部</span>
        </button>
      </div>
      <div class="canvas-workspace-list">
        <article
          v-for="workspace in workspaces"
          :key="workspace.id"
          class="canvas-workspace-card"
          :class="workspace.id === activeWorkspaceId ? 'canvas-workspace-card--active' : ''"
        >
          <button
            type="button"
            class="canvas-workspace-open"
            @click="openWorkspace(workspace.id)"
          >
            <Layers class="h-4 w-4" />
            <span class="canvas-workspace-card-title">{{ workspace.title }}</span>
            <span class="canvas-workspace-card-time">{{ formatTime(workspace.updatedAt) }}</span>
          </button>
          <button
            type="button"
            class="canvas-node-icon-button"
            title="删除画布"
            @click="removeWorkspace(workspace.id)"
          >
            <Trash2 class="h-3.5 w-3.5" />
          </button>
        </article>
      </div>
    </aside>

    <aside
      v-if="showAssetPanel"
      class="canvas-side-panel canvas-side-panel--right"
      @dragover.prevent
      @drop="handleAssetDrop"
    >
      <header class="canvas-panel-head">
        <div>
          <div class="canvas-panel-title">资产库</div>
          <div class="canvas-panel-subtitle">保存图片，输入 @ 可引用</div>
        </div>
        <button
          type="button"
          class="canvas-node-icon-button"
          title="关闭"
          @click="showAssetPanel = false"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </header>
      <div class="canvas-panel-actions">
        <div class="canvas-menu-wrap canvas-menu-wrap--asset">
          <button
            type="button"
            class="canvas-menu-button canvas-menu-button--asset"
            :class="openDropdown === 'asset-category' ? 'canvas-menu-button--open' : ''"
            aria-haspopup="listbox"
            :aria-expanded="openDropdown === 'asset-category'"
            @click.stop="toggleDropdown('asset-category')"
          >
            <span>{{ activeAssetCategoryLabel }}</span>
            <ChevronDown class="h-3.5 w-3.5 canvas-menu-chevron" />
          </button>
          <div
            v-if="openDropdown === 'asset-category'"
            class="canvas-dropdown"
            role="listbox"
            @pointerdown.stop
          >
            <button
              v-for="category in assetCategories"
              :key="category.id"
              type="button"
              class="canvas-dropdown-option"
              :class="category.id === activeAssetCategoryId ? 'canvas-dropdown-option--selected' : ''"
              role="option"
              :aria-selected="category.id === activeAssetCategoryId"
              @click="setAssetCategory(category.id)"
            >
              <span>{{ category.name }}</span>
              <Check
                v-if="category.id === activeAssetCategoryId"
                class="h-3.5 w-3.5"
              />
            </button>
          </div>
        </div>
        <button
          type="button"
          class="canvas-icon-button"
          title="新增文件夹"
          @click="openAssetCategoryDialog"
        >
          <Plus class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="canvas-icon-button"
          title="把选中图片保存为资产"
          :disabled="selectedImageNodes.length === 0"
          @click="addSelectedImagesToAssets"
        >
          <Clipboard class="h-4 w-4" />
        </button>
      </div>
      <div class="canvas-asset-drop">拖图片到这里保存，也可以粘贴到画布</div>
      <div class="canvas-asset-grid">
        <article
          v-for="asset in visibleAssets"
          :key="asset.id"
          class="canvas-asset-card"
        >
          <button
            type="button"
            class="canvas-asset-thumb"
            title="放到画布"
            @click="addAssetToCanvas(asset)"
          >
            <img
              :src="asset.src"
              :alt="asset.title"
            />
          </button>
          <div class="canvas-asset-meta">
            <span>{{ asset.title }}</span>
            <button
              type="button"
              class="canvas-node-icon-button"
              title="删除资产"
              @click="removeAsset(asset.id)"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            v-if="activePromptNode"
            type="button"
            class="canvas-asset-reference"
            @click="insertMention(activePromptNode, { id: asset.id, title: asset.title, src: asset.src, source: 'asset' })"
          >
            @图片
          </button>
        </article>
      </div>
    </aside>

    <aside
      v-if="showLogPanel"
      class="canvas-side-panel canvas-side-panel--logs"
    >
      <header class="canvas-panel-head">
        <div>
          <div class="canvas-panel-title">生成日志</div>
          <div class="canvas-panel-subtitle">{{ logs.length }} 条记录</div>
        </div>
        <button
          type="button"
          class="canvas-node-icon-button"
          title="关闭"
          @click="showLogPanel = false"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </header>
      <div class="canvas-log-list">
        <article
          v-for="entry in logs"
          :key="entry.id"
          class="canvas-log-card"
          :class="entry.status === 'failed' ? 'canvas-log-card--failed' : ''"
        >
          <div class="canvas-log-prompt">{{ entry.prompt }}</div>
          <div class="canvas-log-meta">
            <span>{{ formatTime(entry.createdAt) }}</span>
            <span>{{ entry.sourceCount }} 张参考</span>
            <span>{{ Math.round(entry.generationTime / 1000) }}s</span>
          </div>
          <div class="canvas-panel-actions">
            <button
              type="button"
              class="canvas-tool-button"
              @click="copyText(entry.prompt)"
            >
              <Copy class="h-4 w-4" />
              <span>复制</span>
            </button>
            <button
              type="button"
              class="canvas-tool-button"
              @click="rerunLog(entry)"
            >
              <Sparkles class="h-4 w-4" />
              <span>重跑</span>
            </button>
          </div>
          <p
            v-if="entry.error"
            class="canvas-node-error"
          >
            {{ entry.error }}
          </p>
        </article>
      </div>
    </aside>

    <div
      v-if="assetCategoryDialogOpen"
      class="canvas-dialog-backdrop"
      @click="assetCategoryDialogOpen = false"
    >
      <form
        class="canvas-dialog"
        @submit.prevent="confirmAssetCategory"
        @click.stop
      >
        <header class="canvas-dialog-head">
          <div>
            <div class="canvas-panel-title">新资产文件夹</div>
            <div class="canvas-panel-subtitle">用于整理资产库图片</div>
          </div>
          <button
            type="button"
            class="canvas-node-icon-button"
            title="关闭"
            @click="assetCategoryDialogOpen = false"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </header>
        <input
          v-model="assetCategoryDraft"
          class="canvas-dialog-input"
          maxlength="40"
          autofocus
        />
        <footer class="canvas-dialog-actions">
          <button
            type="button"
            class="canvas-tool-button"
            @click="assetCategoryDialogOpen = false"
          >
            取消
          </button>
          <button
            type="submit"
            class="canvas-generate-button"
          >
            确定
          </button>
        </footer>
      </form>
    </div>

    <div
      ref="boardRef"
      class="canvas-board"
      @pointerdown="startBoardPan"
      @wheel="handleWheel"
      @dragover="handleDragOver"
      @drop="handleDrop"
    >
      <div
        class="canvas-world"
        :style="worldStyle"
      >
        <svg
          class="canvas-links"
          viewBox="0 0 6000 4200"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="canvas-link-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path
                d="M 0 0 L 8 4 L 0 8 z"
                class="canvas-link-arrow"
              />
            </marker>
          </defs>
          <g
            v-for="link in visibleLinks"
            :key="link.id"
            class="canvas-link-group"
          >
            <path
              class="canvas-link-path"
              :d="linkPath(link)"
              marker-end="url(#canvas-link-arrow)"
            />
          </g>
        </svg>
        <article
          v-for="node in nodes"
          :key="node.id"
          class="canvas-node"
          :class="[
            `canvas-node--${node.kind}`,
            selectedIds.includes(node.id) ? 'canvas-node--selected' : '',
            node.status === 'generating' ? 'canvas-node--generating' : '',
            node.status === 'error' ? 'canvas-node--error' : '',
          ]"
          :style="nodeStyle(node)"
          @click.stop="selectNode(node.id, $event.shiftKey || $event.ctrlKey || $event.metaKey)"
          @pointerdown.stop="startNodeDrag($event, node)"
        >
          <header class="canvas-node-header">
            <span class="canvas-node-title">
              <Sparkles
                v-if="node.kind === 'prompt'"
                class="h-3.5 w-3.5"
              />
              <ImageIcon
                v-else
                class="h-3.5 w-3.5"
              />
              {{ node.title }}
            </span>
            <span class="canvas-node-actions">
              <button
                type="button"
                class="canvas-node-icon-button"
                title="复制节点"
                @click.stop="selectedIds = [node.id]; duplicateSelectedNodes()"
              >
                <Copy class="h-3.5 w-3.5" />
              </button>
              <button
                v-if="node.kind === 'image' && node.src"
                type="button"
                class="canvas-node-icon-button"
                :class="activePromptNode && isLinked(node.id, activePromptNode.id) ? 'canvas-node-icon-button--active' : ''"
                title="连接到当前提示词"
                @click.stop="toggleImageLinkToPrompt(node)"
              >
                <LinkIcon class="h-3.5 w-3.5" />
              </button>
              <button
                v-if="node.kind === 'image' && node.src"
                type="button"
                class="canvas-node-icon-button"
                title="存入资产库"
                @click.stop="addAsset(node.src, node.title, 'references')"
              >
                <Library class="h-3.5 w-3.5" />
              </button>
              <button
                v-if="node.kind === 'image'"
                type="button"
                class="canvas-node-icon-button"
                title="下载"
                @click.stop="downloadImage(node)"
              >
                <Download class="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                class="canvas-node-icon-button"
                title="删除"
                @click.stop="removeNode(node.id)"
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </span>
          </header>

          <div
            v-if="node.kind === 'prompt'"
            class="canvas-prompt-body"
          >
            <textarea
              :value="node.prompt"
              class="canvas-prompt-textarea"
              placeholder="输入提示词，生成图片；输入 @ 可引用画布图片或资产..."
              @input="handlePromptInput(node, $event)"
              @focus="handlePromptInput(node, $event)"
              @pointerdown.stop
            />
            <div
              v-if="mentionState?.nodeId === node.id && mentionCandidates.length > 0"
              class="canvas-mention-popover"
              @pointerdown.stop
            >
              <button
                v-for="candidate in mentionCandidates"
                :key="`${candidate.source}-${candidate.id}`"
                type="button"
                class="canvas-mention-item"
                @click.stop="insertMention(node, candidate)"
              >
                <img
                  :src="candidate.src"
                  :alt="candidate.title"
                />
                <span>{{ candidate.title }}</span>
                <small>{{ candidate.source === "asset" ? "资产" : "画布" }}</small>
              </button>
            </div>
            <div class="canvas-prompt-footer">
              <span class="canvas-reference-pill">{{ countNodeReferences(node) }} 张参考</span>
              <button
                type="button"
                class="canvas-node-icon-button"
                title="把选中图片连接到这个提示词"
                :disabled="selectedImageNodes.length === 0"
                @click.stop="linkSelectedImagesToPrompt(node)"
              >
                <LinkIcon class="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                class="canvas-node-icon-button"
                title="断开这个提示词的全部连线"
                @click.stop="unlinkPromptImages(node)"
              >
                <Unlink class="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                class="canvas-generate-button"
                :disabled="!String(node.prompt || '').trim() && node.status !== 'generating'"
                :title="node.status === 'generating' ? '停止生成' : '生成图片'"
                @click.stop="node.status === 'generating' ? stopPromptNode(node) : runPromptNode(node)"
              >
                <LoaderCircle
                  v-if="node.status === 'generating'"
                  class="h-4 w-4 animate-spin"
                />
                <Sparkles
                  v-else
                  class="h-4 w-4"
                />
                <span>{{ node.status === "generating" ? "停止" : "生成" }}</span>
              </button>
            </div>
            <p
              v-if="node.status === 'error' && node.error"
              class="canvas-node-error"
            >
              {{ node.error }}
            </p>
          </div>

          <button
            v-else
            type="button"
            class="canvas-image-button"
            title="打开图片"
            @dblclick.stop="openImage(node)"
          >
            <img
              v-if="node.src"
              :src="node.src"
              :alt="node.title"
              draggable="false"
              class="canvas-node-image"
            />
            <ImagePlus
              v-else
              class="h-8 w-8 text-muted-foreground/50"
            />
          </button>
          <button
            type="button"
            class="canvas-resize-handle"
            title="调整大小"
            @pointerdown="startNodeResize($event, node)"
          >
            <Maximize2 class="h-3.5 w-3.5" />
          </button>
        </article>
      </div>
    </div>

    <button
      v-if="activePromptNode"
      type="button"
      class="canvas-floating-generate"
      :disabled="!String(activePromptNode.prompt || '').trim() && activePromptNode.status !== 'generating'"
      :title="activePromptNode.status === 'generating' ? '停止生成' : '运行当前提示词'"
      @click="activePromptNode.status === 'generating' ? stopPromptNode(activePromptNode) : runPromptNode(activePromptNode)"
    >
      <LoaderCircle
        v-if="activePromptNode.status === 'generating'"
        class="h-4 w-4 animate-spin"
      />
      <Sparkles
        v-else
        class="h-4 w-4"
      />
      <span>{{ activePromptNode.status === "generating" ? "停止" : "生成" }}</span>
    </button>

    <button
      type="button"
      class="canvas-floating-upload"
      title="上传图片"
      @click="pickImageFiles"
    >
      <ImagePlus class="h-5 w-5" />
    </button>

    <div
      v-if="previewNode"
      class="canvas-preview-backdrop"
      @click="previewNode = null"
    >
      <div
        class="canvas-preview-panel"
        @click.stop
      >
        <header class="canvas-preview-head">
          <div>
            <div class="canvas-panel-title">{{ previewNode.title }}</div>
            <div
              v-if="previewNode.generatedPrompt"
              class="canvas-panel-subtitle"
            >
              {{ previewNode.generatedPrompt }}
            </div>
          </div>
          <div class="canvas-panel-actions">
            <button
              type="button"
              class="canvas-icon-button"
              title="下载"
              @click="downloadImage(previewNode)"
            >
              <Download class="h-4 w-4" />
            </button>
            <button
              type="button"
              class="canvas-icon-button"
              title="关闭"
              @click="previewNode = null"
            >
              <X class="h-4 w-4" />
            </button>
          </div>
        </header>
        <img
          :src="previewNode.src"
          :alt="previewNode.title"
          class="canvas-preview-image"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.infinite-canvas {
  --canvas-shadow-popover: 0 18px 44px hsl(0 0% 0% / 0.14);
  --canvas-shadow-panel: 0 18px 48px hsl(0 0% 0% / 0.14);
  --canvas-shadow-node: 0 10px 28px hsl(0 0% 0% / 0.1);
  --canvas-shadow-node-selected: 0 14px 34px hsl(0 0% 0% / 0.14);
  --canvas-shadow-floating: 0 10px 24px hsl(0 0% 0% / 0.16);
  --canvas-shadow-preview: 0 20px 64px hsl(0 0% 0% / 0.18);
  --canvas-shadow-dialog: 0 20px 60px hsl(0 0% 0% / 0.18);
  position: relative;
  height: calc(100dvh - 10.25rem);
  min-height: 34rem;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

.dark .infinite-canvas {
  --canvas-shadow-popover: 0 18px 44px hsl(0 0% 0% / 0.28);
  --canvas-shadow-panel: 0 18px 48px hsl(0 0% 0% / 0.24);
  --canvas-shadow-node: 0 10px 28px hsl(0 0% 0% / 0.18);
  --canvas-shadow-node-selected: 0 14px 34px hsl(0 0% 0% / 0.24);
  --canvas-shadow-floating: 0 10px 24px hsl(0 0% 0% / 0.28);
  --canvas-shadow-preview: 0 20px 64px hsl(0 0% 0% / 0.32);
  --canvas-shadow-dialog: 0 20px 60px hsl(0 0% 0% / 0.3);
}

.canvas-board {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background-color: hsl(var(--background));
  background-image: radial-gradient(hsl(var(--muted-foreground) / 0.22) 1px, transparent 1px);
  background-size: 24px 24px;
  cursor: grab;
  touch-action: none;
}

.canvas-board:active {
  cursor: grabbing;
}

.canvas-world {
  position: absolute;
  left: 0;
  top: 0;
  width: 6000px;
  height: 4200px;
  transform-origin: 0 0;
}

.canvas-toolbar {
  position: absolute;
  left: 1rem;
  right: 1rem;
  top: 1rem;
  z-index: 10;
  display: flex;
  max-width: min(100% - 2rem, 64rem);
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--card) / 0.92);
  padding: 0.375rem;
  backdrop-filter: blur(16px);
}

.canvas-tool-button,
.canvas-icon-button,
.canvas-floating-generate,
.canvas-floating-upload,
.canvas-node-icon-button,
.canvas-generate-button,
.canvas-image-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid hsl(var(--border));
  color: hsl(var(--foreground));
  transition:
    background-color 150ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 150ms cubic-bezier(0.4, 0, 0.2, 1),
    color 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.canvas-tool-button {
  height: 2rem;
  gap: 0.375rem;
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--background));
  padding: 0 0.625rem;
  font-size: 0.8125rem;
  font-weight: 600;
}

.canvas-icon-button {
  height: 2rem;
  width: 2rem;
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--background));
}

.canvas-tool-button:hover,
.canvas-icon-button:hover,
.canvas-node-icon-button:hover,
.canvas-image-button:hover,
.canvas-floating-upload:hover {
  border-color: hsl(var(--muted-foreground) / 0.5);
  background: hsl(var(--accent));
}

.canvas-tool-button--active,
.canvas-icon-button--active {
  border-color: hsl(var(--foreground) / 0.42);
  background: hsl(var(--selection));
  color: hsl(var(--foreground));
  box-shadow: inset 0 0 0 1px hsl(var(--foreground) / 0.08);
}

.canvas-icon-button--danger:hover {
  border-color: hsl(var(--destructive) / 0.45);
  color: hsl(var(--destructive));
}

.canvas-toolbar-separator {
  height: 1.5rem;
  width: 1px;
  background: hsl(var(--border));
}

.canvas-menu-wrap {
  position: relative;
  min-width: 0;
}

.canvas-menu-wrap--asset {
  flex: 1;
}

.canvas-menu-button {
  display: inline-flex;
  height: 2rem;
  min-width: 0;
  max-width: 12rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--background));
  padding: 0 0.625rem;
  color: hsl(var(--foreground));
  font-size: 0.8125rem;
  font-weight: 700;
  transition:
    background-color 150ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 150ms cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.canvas-menu-button:hover,
.canvas-menu-button--open {
  border-color: hsl(var(--muted-foreground) / 0.5);
  background: hsl(var(--accent));
}

.canvas-menu-button--open {
  box-shadow: inset 0 0 0 1px hsl(var(--foreground) / 0.08);
}

.canvas-menu-button span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.canvas-menu-button--compact {
  max-width: 9rem;
}

.canvas-menu-button--asset {
  width: 100%;
  max-width: none;
}

.canvas-menu-chevron {
  flex: 0 0 auto;
  color: hsl(var(--muted-foreground));
  transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.canvas-menu-button--open .canvas-menu-chevron {
  transform: rotate(180deg);
}

.canvas-dropdown {
  position: absolute;
  left: 0;
  top: calc(100% + 0.375rem);
  z-index: 40;
  display: grid;
  width: max-content;
  min-width: 100%;
  max-width: min(18rem, calc(100vw - 2rem));
  max-height: 18rem;
  gap: 0.25rem;
  overflow: auto;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--card));
  padding: 0.375rem;
  color: hsl(var(--foreground));
  box-shadow: var(--canvas-shadow-popover);
  backdrop-filter: blur(18px);
}

.canvas-dropdown--wide {
  min-width: 12rem;
}

.canvas-dropdown-option {
  display: flex;
  min-width: 0;
  height: 2rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-radius: calc(var(--radius) - 3px);
  padding: 0 0.5rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.8125rem;
  font-weight: 700;
  text-align: left;
  white-space: nowrap;
}

.canvas-dropdown-option:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.canvas-dropdown-option--selected {
  background: hsl(var(--selection));
  color: hsl(var(--foreground));
}

.canvas-dropdown-option span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.canvas-model-option-label {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.5rem;
}

.canvas-status {
  position: absolute;
  left: 1rem;
  bottom: 1rem;
  z-index: 10;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--card) / 0.88);
  padding: 0.375rem 0.625rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.75rem;
  font-weight: 600;
  backdrop-filter: blur(16px);
}

.canvas-status-dot {
  width: 0.25rem;
  height: 0.25rem;
  border-radius: 9999px;
  background: hsl(var(--muted-foreground) / 0.45);
}

.canvas-status-error {
  color: hsl(var(--destructive));
}

.canvas-side-panel {
  position: absolute;
  z-index: 12;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: min(20rem, calc(100% - 2rem));
  max-height: calc(100% - 7rem);
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--card) / 0.94);
  padding: 0.75rem;
  box-shadow: var(--canvas-shadow-panel);
  backdrop-filter: blur(18px);
}

.canvas-side-panel--left {
  left: 1rem;
  top: 4.25rem;
}

.canvas-side-panel--right {
  right: 1rem;
  top: 4.25rem;
  bottom: 4.5rem;
}

.canvas-side-panel--logs {
  right: 1rem;
  top: 4.25rem;
  bottom: 4.5rem;
}

.canvas-panel-head,
.canvas-panel-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.canvas-panel-title {
  color: hsl(var(--foreground));
  font-size: 0.875rem;
  font-weight: 800;
}

.canvas-panel-subtitle {
  margin-top: 0.125rem;
  max-width: 14rem;
  overflow: hidden;
  color: hsl(var(--muted-foreground));
  font-size: 0.75rem;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.canvas-title-input {
  height: 2.25rem;
  width: 100%;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--background));
  padding: 0 0.625rem;
  color: hsl(var(--foreground));
  font-size: 0.8125rem;
  font-weight: 700;
  outline: none;
}

.canvas-workspace-list,
.canvas-log-list {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 0.5rem;
  overflow: auto;
}

.canvas-workspace-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.375rem;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--background));
  padding: 0.375rem;
}

.canvas-workspace-card--active {
  border-color: hsl(var(--foreground) / 0.5);
}

.canvas-workspace-open {
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.125rem 0.5rem;
  text-align: left;
}

.canvas-workspace-open svg {
  grid-row: span 2;
  align-self: center;
  color: hsl(var(--muted-foreground));
}

.canvas-workspace-card-title,
.canvas-workspace-card-time {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.canvas-workspace-card-title {
  color: hsl(var(--foreground));
  font-size: 0.8125rem;
  font-weight: 750;
}

.canvas-workspace-card-time {
  color: hsl(var(--muted-foreground));
  font-size: 0.6875rem;
  font-weight: 600;
}

.canvas-asset-drop {
  display: flex;
  min-height: 3rem;
  align-items: center;
  justify-content: center;
  border: 1px dashed hsl(var(--border));
  border-radius: calc(var(--radius) - 2px);
  color: hsl(var(--muted-foreground));
  font-size: 0.75rem;
  font-weight: 700;
  text-align: center;
}

.canvas-asset-grid {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  overflow: auto;
}

.canvas-asset-card {
  position: relative;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--background));
}

.canvas-asset-thumb {
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1;
  background: hsl(var(--muted) / 0.35);
}

.canvas-asset-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.canvas-asset-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.25rem;
  padding: 0.375rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.6875rem;
  font-weight: 700;
}

.canvas-asset-meta span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.canvas-asset-reference {
  position: absolute;
  left: 0.375rem;
  top: 0.375rem;
  border: 1px solid hsl(var(--border));
  border-radius: 9999px;
  background: hsl(var(--card) / 0.9);
  padding: 0.1875rem 0.5rem;
  color: hsl(var(--foreground));
  font-size: 0.6875rem;
  font-weight: 800;
  backdrop-filter: blur(10px);
}

.canvas-log-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--background));
  padding: 0.625rem;
}

.canvas-log-card--failed {
  border-color: hsl(var(--destructive) / 0.45);
}

.canvas-log-prompt {
  max-height: 5rem;
  overflow: auto;
  color: hsl(var(--foreground));
  font-size: 0.75rem;
  line-height: 1.45;
  white-space: pre-wrap;
}

.canvas-log-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.6875rem;
  font-weight: 700;
}

.canvas-node {
  position: absolute;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--card));
  box-shadow: var(--canvas-shadow-node);
  cursor: move;
  user-select: none;
}

.canvas-node--selected {
  border-color: hsl(var(--foreground) / 0.7);
  box-shadow:
    0 0 0 1px hsl(var(--foreground) / 0.5),
    var(--canvas-shadow-node-selected);
}

.canvas-node--generating {
  border-color: hsl(var(--system) / 0.7);
}

.canvas-node--error {
  border-color: hsl(var(--destructive) / 0.65);
}

.canvas-node-header {
  display: flex;
  min-height: 2.125rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border-bottom: 1px solid hsl(var(--border));
  padding: 0 0.5rem 0 0.625rem;
}

.canvas-node-title {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 0.375rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: hsl(var(--muted-foreground));
  font-size: 0.75rem;
  font-weight: 700;
}

.canvas-node-actions {
  display: inline-flex;
  gap: 0.25rem;
}

.canvas-node-icon-button {
  height: 1.5rem;
  width: 1.5rem;
  border-radius: calc(var(--radius) - 3px);
  background: transparent;
  color: hsl(var(--muted-foreground));
}

.canvas-node-icon-button--active {
  border-color: hsl(var(--foreground) / 0.35);
  background: hsl(var(--selection));
  color: hsl(var(--foreground));
}

.canvas-node-icon-button:disabled {
  cursor: default;
  opacity: 0.42;
}

.canvas-links {
  position: absolute;
  inset: 0;
  width: 6000px;
  height: 4200px;
  overflow: visible;
  pointer-events: none;
}

.canvas-link-path {
  fill: none;
  stroke: hsl(var(--system));
  stroke-width: 2.5;
  stroke-linecap: round;
  opacity: 0.9;
  filter: drop-shadow(0 0 6px hsl(var(--system) / 0.28));
}

.canvas-link-arrow {
  fill: hsl(var(--system));
}

.canvas-prompt-body {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.625rem;
}

.canvas-prompt-textarea {
  flex: 1;
  min-height: 7.5rem;
  resize: none;
  border: 1px solid hsl(var(--input));
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--background));
  padding: 0.625rem;
  color: hsl(var(--foreground));
  font-size: 0.8125rem;
  line-height: 1.45;
  outline: none;
}

.canvas-prompt-textarea:focus {
  border-color: hsl(var(--ring) / 0.5);
}

.canvas-mention-popover {
  position: absolute;
  left: 0.625rem;
  right: 0.625rem;
  bottom: 3.25rem;
  z-index: 4;
  display: grid;
  max-height: 15rem;
  gap: 0.25rem;
  overflow: auto;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--card));
  padding: 0.375rem;
  color: hsl(var(--foreground));
  box-shadow: var(--canvas-shadow-popover);
}

.canvas-mention-item {
  display: grid;
  min-width: 0;
  grid-template-columns: 2rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem;
  border-radius: calc(var(--radius) - 4px);
  padding: 0.25rem;
  text-align: left;
}

.canvas-mention-item:hover {
  background: hsl(var(--accent));
}

.canvas-mention-item img {
  width: 2rem;
  height: 2rem;
  border-radius: 0.375rem;
  object-fit: cover;
}

.canvas-mention-item span {
  min-width: 0;
  overflow: hidden;
  color: hsl(var(--foreground));
  font-size: 0.75rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.canvas-mention-item small {
  color: hsl(var(--muted-foreground));
  font-size: 0.6875rem;
  font-weight: 700;
}

.canvas-prompt-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.canvas-reference-pill {
  display: inline-flex;
  height: 1.75rem;
  align-items: center;
  border: 1px solid hsl(var(--border));
  border-radius: 9999px;
  padding: 0 0.625rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.75rem;
  font-weight: 600;
}

.canvas-generate-button {
  height: 1.875rem;
  gap: 0.375rem;
  border-radius: 9999px;
  background: hsl(var(--primary));
  padding: 0 0.75rem;
  color: hsl(var(--primary-foreground));
  font-size: 0.75rem;
  font-weight: 700;
}

.canvas-generate-button:disabled,
.canvas-floating-generate:disabled {
  cursor: default;
  opacity: 0.48;
}

.canvas-node-error {
  color: hsl(var(--destructive));
  font-size: 0.75rem;
  line-height: 1.2;
}

.canvas-image-button {
  flex: 1;
  min-height: 14.75rem;
  border: 0;
  border-radius: 0;
  background: hsl(var(--muted) / 0.36);
  padding: 0;
  cursor: zoom-in;
}

.canvas-node-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.canvas-resize-handle {
  position: absolute;
  right: 0.25rem;
  bottom: 0.25rem;
  z-index: 3;
  display: inline-flex;
  height: 1.5rem;
  width: 1.5rem;
  align-items: center;
  justify-content: center;
  border: 1px solid hsl(var(--border));
  border-radius: 0.5rem;
  background: hsl(var(--card) / 0.86);
  color: hsl(var(--muted-foreground));
  cursor: nwse-resize;
  opacity: 0;
  backdrop-filter: blur(10px);
}

.canvas-node:hover .canvas-resize-handle,
.canvas-node--selected .canvas-resize-handle {
  opacity: 1;
}

.canvas-floating-generate,
.canvas-floating-upload {
  position: absolute;
  z-index: 11;
  border-radius: 9999px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  box-shadow: var(--canvas-shadow-floating);
}

.canvas-floating-generate {
  right: 1rem;
  bottom: 1rem;
  height: 2.5rem;
  gap: 0.5rem;
  padding: 0 1rem;
  font-size: 0.875rem;
  font-weight: 700;
}

.canvas-floating-upload {
  right: 1rem;
  top: 1rem;
  display: none;
  height: 2.5rem;
  width: 2.5rem;
}

.canvas-preview-backdrop {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  background: hsl(var(--background) / 0.38);
  padding: 1.5rem;
  backdrop-filter: blur(16px);
}

.canvas-preview-panel {
  display: flex;
  max-height: 100%;
  max-width: min(72rem, 100%);
  flex-direction: column;
  gap: 0.75rem;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--card));
  padding: 0.75rem;
  box-shadow: var(--canvas-shadow-preview);
}

.canvas-preview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.canvas-preview-image {
  display: block;
  max-height: calc(100dvh - 10rem);
  max-width: calc(100vw - 6rem);
  border-radius: calc(var(--radius) - 2px);
  object-fit: contain;
}

.canvas-dialog-backdrop {
  position: absolute;
  inset: 0;
  z-index: 35;
  display: flex;
  align-items: center;
  justify-content: center;
  background: hsl(var(--background) / 0.42);
  padding: 1rem;
  backdrop-filter: blur(14px);
}

.canvas-dialog {
  display: flex;
  width: min(26rem, 100%);
  flex-direction: column;
  gap: 0.875rem;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--card));
  padding: 0.875rem;
  box-shadow: var(--canvas-shadow-dialog);
}

.canvas-dialog-head,
.canvas-dialog-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.canvas-dialog-input {
  height: 2.5rem;
  width: 100%;
  border: 1px solid hsl(var(--input));
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--background));
  padding: 0 0.75rem;
  color: hsl(var(--foreground));
  font-size: 0.875rem;
  font-weight: 650;
  outline: none;
}

.canvas-dialog-input:focus {
  border-color: hsl(var(--ring) / 0.55);
  box-shadow: 0 0 0 3px hsl(var(--ring) / 0.12);
}

@media (max-width: 860px) {
  .infinite-canvas {
    height: calc(100dvh - 9rem);
    min-height: 32rem;
  }

  .canvas-toolbar {
    max-height: 8.25rem;
    overflow-y: auto;
  }

  .canvas-menu-button {
    max-width: 8rem;
  }

  .canvas-floating-upload {
    display: inline-flex;
    top: auto;
    bottom: 4rem;
  }
}

@media (max-width: 560px) {
  .canvas-toolbar {
    left: 0.5rem;
    right: 0.5rem;
    top: 0.5rem;
  }

  .canvas-tool-button span,
  .canvas-floating-generate span {
    display: none;
  }

  .canvas-status {
    left: 0.5rem;
    max-width: calc(100% - 5rem);
  }

  .canvas-floating-generate {
    right: 0.5rem;
  }
}
</style>
