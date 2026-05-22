<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Download,
  Image as ImageIcon,
  ImagePlus,
  Layers,
  LoaderCircle,
  LocateFixed,
  Minus,
  MousePointer2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-vue-next";

import {
  createDefaultImageConfigs,
  DEFAULT_IMAGE_MODEL_ID,
  IMAGE_MODELS,
  IMAGE_UPLOAD_LIMITS,
} from "@/data/image-models";
import {
  CODEX_IMAGE_API_BASE_URL,
  createImageTask,
  generateImage,
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
  status?: CanvasNodeStatus;
  error?: string;
}

interface Viewport {
  x: number;
  y: number;
  scale: number;
}

interface PersistedCanvas {
  nodes: CanvasNode[];
  viewport: Viewport;
}

interface DragState {
  type: "pan" | "node";
  nodeId?: string;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
}

const store = useAppStore();
const defaultImageConfigs = createDefaultImageConfigs();
const STORAGE_KEY = "art-workshop-infinite-canvas-v1";
const HIDDEN_CANVAS_MODEL_IDS = new Set<ImageModelId>(["qwen-image-edit-multiple-angles"]);
const MIN_ZOOM = 0.28;
const MAX_ZOOM = 2.2;

const boardRef = ref<HTMLElement | null>(null);
const imageInput = ref<HTMLInputElement | null>(null);
const nodes = ref<CanvasNode[]>([]);
const selectedIds = ref<string[]>([]);
const viewport = ref<Viewport>({ x: 0, y: 0, scale: 0.86 });
const dragState = ref<DragState | null>(null);
const savingFailed = ref(false);

let saveTimer: number | undefined;

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
const activePromptNode = computed(() => {
  const selectedPrompt = selectedNodes.value.find((node) => node.kind === "prompt");
  return selectedPrompt ?? nodes.value.find((node) => node.kind === "prompt") ?? null;
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

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  return Array.isArray(record.nodes) && Boolean(record.viewport);
}

function loadCanvas() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (isPersistedCanvas(parsed)) {
        nodes.value = parsed.nodes.filter((node) => node.kind === "image" || node.kind === "prompt");
        viewport.value = {
          x: Number(parsed.viewport.x || 0),
          y: Number(parsed.viewport.y || 0),
          scale: clampNumber(Number(parsed.viewport.scale || 0.86), MIN_ZOOM, MAX_ZOOM),
        };
      }
    }
  } catch {
    nodes.value = [];
  }

  if (nodes.value.length === 0) {
    nodes.value = [createPromptNode(-170, -110)];
  }
}

function saveCanvas() {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;

  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        nodes: nodes.value,
        viewport: viewport.value,
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

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function nodeStyle(node: CanvasNode) {
  return {
    left: `${node.x}px`,
    top: `${node.y}px`,
    width: `${node.width}px`,
    minHeight: `${node.height}px`,
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
  selectedIds.value = selectedIds.value.filter((id) => id !== nodeId);

  if (nodes.value.length === 0) {
    addPromptNode();
  }

  scheduleSave();
}

function clearCanvas() {
  const center = boardCenterWorld();
  const node = createPromptNode(center.x - 165, center.y - 114);
  nodes.value = [node];
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

function setImageModel(value: string) {
  const model = selectableImageModels.find((item) => item.id === value);
  if (model) {
    store.setSelectedImageModel(model.id);
  }
}

function setImageConfig(field: ImageModelField, rawValue: string) {
  const option = field.options.find((item) => String(item.value) === rawValue);
  store.setImageModelConfig(
    activeImageModelId.value,
    field.key,
    (option?.value ?? rawValue) as ImageConfigValue,
  );
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

async function handlePaste(event: ClipboardEvent) {
  if (!event.clipboardData) {
    return;
  }

  const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
  if (!files.length) {
    return;
  }

  if (document.activeElement && ["TEXTAREA", "INPUT"].includes(document.activeElement.tagName)) {
    return;
  }

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
  dragState.value = {
    type: "node",
    nodeId: node.id,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: node.x,
    startY: node.y,
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

  node.x = Math.round(state.startX + dx / viewport.value.scale);
  node.y = Math.round(state.startY + dy / viewport.value.scale);
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
  const sources = selectedImageNodes.value
    .filter((sourceNode) => sourceNode.id !== node.id)
    .slice(0, activeUploadLimit.value)
    .map((sourceNode) => sourceNode.src || "");

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
): ImageTask {
  return createImageTask({
    createdAt: startedAt,
    status: "generating",
    sourceImages,
    prompt,
    model,
    modelConfig: { ...config },
    resultImages: [],
    generationTime: 0,
  });
}

async function runPromptNode(node: CanvasNode) {
  const prompt = String(node.prompt || "").trim();
  if (!prompt || node.status === "generating") {
    return;
  }

  const startedAt = Date.now();
  node.status = "generating";
  node.error = "";
  scheduleSave();

  try {
    const model = activeImageModelId.value;
    const config = { ...activeImageConfig.value };
    const sourceImages = await buildSourceImages(node);
    const task = buildCanvasImageTask(prompt, model, config, sourceImages, startedAt);
    const usesCodexImageKey = model === "codex-image-2";
    const result = await generateImage({
      model,
      prompt,
      sourceImages,
      config,
      apiBaseUrl: usesCodexImageKey ? CODEX_IMAGE_API_BASE_URL : store.apiBaseUrl,
      apiKey: usesCodexImageKey ? store.codexApiKey : store.apiKey,
    });

    const resultImages = result.images.filter(Boolean);
    resultImages.forEach((source, index) => {
      addImageNode(
        source,
        `生成结果 ${index + 1}`,
        node.x + node.width + 56 + index * 38,
        node.y + index * 38,
      );
    });

    const finalTask: ImageTask = {
      ...task,
      status: "success",
      resultImages,
      generationTime: Date.now() - startedAt,
    };
    await store.addHistoryTask(finalTask);
    node.status = "success";
  } catch (error) {
    node.status = "error";
    node.error = error instanceof Error ? error.message : "生成失败";
  } finally {
    scheduleSave();
  }
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
  if (node.src) {
    window.open(node.src, "_blank", "noopener,noreferrer");
  }
}

onMounted(async () => {
  loadCanvas();
  await nextTick();
  if (!localStorage.getItem(STORAGE_KEY)) {
    fitView();
  }
  window.addEventListener("paste", handlePaste);
});

onBeforeUnmount(() => {
  window.clearTimeout(saveTimer);
  window.removeEventListener("paste", handlePaste);
  window.removeEventListener("pointermove", handlePointerMove);
});

watch(nodes, scheduleSave, { deep: true });
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

    <div class="canvas-toolbar">
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
      <label class="canvas-select-label">
        <Layers class="h-4 w-4" />
        <select
          :value="activeImageModelId"
          class="canvas-select"
          title="模型"
          @change="setImageModel(($event.target as HTMLSelectElement).value)"
        >
          <option
            v-for="model in selectableImageModels"
            :key="model.id"
            :value="model.id"
          >
            {{ model.name }}
          </option>
        </select>
      </label>
      <label
        v-for="field in activeImageModel.options"
        :key="field.key"
        class="canvas-select-label canvas-select-label--compact"
      >
        <select
          :value="String(activeImageConfig[field.key] ?? field.default)"
          class="canvas-select"
          :title="field.label"
          @change="setImageConfig(field, ($event.target as HTMLSelectElement).value)"
        >
          <option
            v-for="option in field.options"
            :key="String(option.value)"
            :value="String(option.value)"
          >
            {{ option.label }}
          </option>
        </select>
      </label>
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
    </div>

    <div class="canvas-status">
      <MousePointer2 class="h-3.5 w-3.5" />
      <span>{{ selectionLabel }}</span>
      <span class="canvas-status-dot" />
      <span>{{ Math.round(viewport.scale * 100) }}%</span>
      <template v-if="savingFailed">
        <span class="canvas-status-dot" />
        <span class="canvas-status-error">保存失败</span>
      </template>
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
              placeholder="输入提示词，生成图片..."
              @input="updateNodePrompt(node, ($event.target as HTMLTextAreaElement).value)"
              @pointerdown.stop
            />
            <div class="canvas-prompt-footer">
              <span class="canvas-reference-pill">{{ selectedImageNodes.length }} 张参考</span>
              <button
                type="button"
                class="canvas-generate-button"
                :disabled="!String(node.prompt || '').trim() || node.status === 'generating'"
                title="生成图片"
                @click.stop="runPromptNode(node)"
              >
                <LoaderCircle
                  v-if="node.status === 'generating'"
                  class="h-4 w-4 animate-spin"
                />
                <Sparkles
                  v-else
                  class="h-4 w-4"
                />
                <span>{{ node.status === "generating" ? "生成中" : "生成" }}</span>
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
        </article>
      </div>
    </div>

    <button
      v-if="activePromptNode"
      type="button"
      class="canvas-floating-generate"
      :disabled="!String(activePromptNode.prompt || '').trim() || activePromptNode.status === 'generating'"
      title="运行当前提示词"
      @click="runPromptNode(activePromptNode)"
    >
      <LoaderCircle
        v-if="activePromptNode.status === 'generating'"
        class="h-4 w-4 animate-spin"
      />
      <Sparkles
        v-else
        class="h-4 w-4"
      />
      <span>{{ activePromptNode.status === "generating" ? "生成中" : "生成" }}</span>
    </button>

    <button
      type="button"
      class="canvas-floating-upload"
      title="上传图片"
      @click="pickImageFiles"
    >
      <ImagePlus class="h-5 w-5" />
    </button>
  </section>
</template>

<style scoped>
.infinite-canvas {
  position: relative;
  height: calc(100dvh - 10.25rem);
  min-height: 34rem;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--background));
  color: hsl(var(--foreground));
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

.canvas-icon-button--danger:hover {
  border-color: hsl(var(--destructive) / 0.45);
  color: hsl(var(--destructive));
}

.canvas-toolbar-separator {
  height: 1.5rem;
  width: 1px;
  background: hsl(var(--border));
}

.canvas-select-label {
  display: inline-flex;
  height: 2rem;
  min-width: 0;
  align-items: center;
  gap: 0.375rem;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--background));
  padding: 0 0.5rem;
  color: hsl(var(--muted-foreground));
}

.canvas-select-label--compact {
  padding-right: 0.25rem;
}

.canvas-select {
  min-width: 0;
  max-width: 11rem;
  border: 0;
  background: transparent;
  color: hsl(var(--foreground));
  font-size: 0.8125rem;
  font-weight: 600;
  outline: none;
}

.canvas-select-label--compact .canvas-select {
  max-width: 8rem;
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

.canvas-node {
  position: absolute;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--card));
  box-shadow: 0 10px 28px hsl(0 0% 0% / 0.12);
  cursor: move;
  user-select: none;
}

.canvas-node--selected {
  border-color: hsl(var(--foreground) / 0.7);
  box-shadow:
    0 0 0 1px hsl(var(--foreground) / 0.5),
    0 14px 34px hsl(0 0% 0% / 0.16);
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

.canvas-prompt-body {
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
  min-height: 14.75rem;
  object-fit: contain;
}

.canvas-floating-generate,
.canvas-floating-upload {
  position: absolute;
  z-index: 11;
  border-radius: 9999px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  box-shadow: 0 10px 24px hsl(0 0% 0% / 0.2);
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

@media (max-width: 860px) {
  .infinite-canvas {
    height: calc(100dvh - 9rem);
    min-height: 32rem;
  }

  .canvas-toolbar {
    max-height: 8.25rem;
    overflow-y: auto;
  }

  .canvas-select {
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
