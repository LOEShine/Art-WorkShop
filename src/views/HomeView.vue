<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  BookOpen,
  Bot,
  Clock,
  Copy,
  Cpu,
  Download,
  Image as ImageIcon,
  LoaderCircle,
  Pencil,
  Plus,
  Settings,
  Sparkles,
  StepForward,
  Trash2,
  Type as TypeIcon,
  Upload,
  Video,
  Volume2,
  WandSparkles,
  X,
} from "lucide-vue-next";

import OpenAiIcon from "@/components/icons/OpenAiIcon.vue";
import MediaModal from "@/components/MediaModal.vue";
import SettingsModal from "@/components/SettingsModal.vue";
import {
  createDefaultImageConfigs,
  IMAGE_MODELS,
  IMAGE_UPLOAD_LIMITS,
} from "@/data/image-models";
import { STARTER_PROMPTS } from "@/data/starter-prompts";
import {
  createDefaultVideoConfigs,
  getVeoReferenceImageNames,
  getVeoReferenceImages,
  getSoraDurationOptions,
  getVideoUploadLimit,
  isFirstLastFramesEnabled,
  MAX_VEO_REFERENCE_IMAGES,
  resolveVideoMode,
  supportsFirstLastFrames,
  VIDEO_MODELS,
} from "@/data/video-models";
import {
  createImageTask,
  generateImage,
  isErrorStatus,
  optimizeImagePrompt,
  pollVideoTask,
  submitVideoTask,
  submitVeoVideoExtension,
} from "@/lib/api";
import { useAppStore } from "@/stores/app";
import type {
  GalleryHistoryItem,
  ImageModelField,
  ImageTask,
  SelectOption,
  VideoTask,
} from "@/types";

interface DynamicField {
  key: string;
  label: string;
  type: "choice" | "text" | "textarea";
  options?: SelectOption[];
  columns?: string;
  placeholder?: string;
  preview?: boolean;
  compact?: boolean;
  buttonWidthPx?: number;
}

interface UploadPreviewItem {
  source: string;
  name: string;
}

interface VideoUploadSlot extends UploadPreviewItem {
  label: string;
  slotIndex: number;
}

const router = useRouter();
const store = useAppStore();
const defaultImageConfigs = createDefaultImageConfigs();
const defaultVideoConfigs = createDefaultVideoConfigs();

const imageInput = ref<HTMLInputElement | null>(null);
const videoInput = ref<HTMLInputElement | null>(null);
const settingsOpen = ref(false);
const previewImage = ref("");
const previewTitle = ref("");
const previewKind = ref<"image" | "video" | "prompt">("image");
const previewCanContinue = ref(false);
const currentImageElapsed = ref(0);
const currentVideoElapsed = ref(0);
const historyImageResolutionLabels = ref<Record<string, string>>({});
const historyVideoDurationLabels = ref<Record<string, string>>({});
const optimizingPrompt = ref(false);
const submittingVideo = ref(false);
const promptTextarea = ref<HTMLTextAreaElement | null>(null);
const draggingImageIndex = ref<number | null>(null);
const draggingVideoIndex = ref<number | null>(null);
const videoUploadTargetIndex = ref<number | null>(null);

let imageTimer: number | undefined;
let videoTimer: number | undefined;
let videoPollTimer: number | undefined;

function getImageModelIcon(modelId: string) {
  if (modelId === "gemini-3-pro-image-preview") {
    return null;
  }

  return OpenAiIcon;
}

function getVideoModelIcon(modelKey: string) {
  if (modelKey === "sora") {
    return OpenAiIcon;
  }

  return null;
}

function getVideoBadgeIcon(badge: string) {
  if (badge === "text") return TypeIcon;
  if (badge === "image") return ImageIcon;
  if (badge === "audio") return Volume2;
  if (badge === "first-last") return StepForward;
  return null;
}

function getVideoBadgeLabel(badge: string) {
  if (badge === "text") return "文生视频";
  if (badge === "image") return "图生视频";
  if (badge === "audio") return "音频";
  if (badge === "first-last") return "首尾帧";
  return badge;
}

const currentImageModel = computed(
  () => IMAGE_MODELS.find((model) => model.id === store.selectedImageModel) ?? IMAGE_MODELS[0],
);

const currentImageConfig = computed(() => ({
  ...defaultImageConfigs[store.selectedImageModel],
  ...store.imageModelConfigs[store.selectedImageModel],
}));

const currentVideoConfig = computed(() => ({
  ...defaultVideoConfigs[store.selectedVideoModel],
  ...store.videoConfigs[store.selectedVideoModel],
}));

const currentVideoMode = computed(() =>
  resolveVideoMode(store.selectedVideoModel, currentVideoConfig.value),
);

const currentVideoUploadLimit = computed(() =>
  getVideoUploadLimit(store.selectedVideoModel, currentVideoConfig.value),
);
const currentImageUploadLimit = computed(() => IMAGE_UPLOAD_LIMITS[store.selectedImageModel] ?? 1);
const canGenerateImage = computed(() => store.prompt.trim().length > 0 && !store.isGenerating);
const isVideoGenerating = computed(() => submittingVideo.value || store.videoTask?.phase === "pending");
const videoSupportsFirstLastFrames = computed(() =>
  supportsFirstLastFrames(store.selectedVideoModel),
);
const videoFirstLastEnabled = computed(() =>
  videoSupportsFirstLastFrames.value && isFirstLastFramesEnabled(currentVideoConfig.value),
);
const isVideoFirstLastMode = computed(() => currentVideoMode.value === "first-last");

const currentVideoFields = computed<DynamicField[]>(() => {
  const config = currentVideoConfig.value;

  if (store.selectedVideoModel === "veo3") {
    const aspectOptions = ["16:9", "9:16"];
    return [
      {
        key: "resolution",
        label: "分辨率",
        type: "choice",
        compact: true,
        buttonWidthPx: 92,
        options: [
          { value: "720p", label: "720p" },
          { value: "1080p", label: "1080p" },
          { value: "4k", label: "4K" },
        ],
      },
      {
        key: "aspectRatio",
        label: "比例",
        type: "choice",
        compact: true,
        preview: true,
        buttonWidthPx: 78,
        options: aspectOptions.map((value) => ({
          value,
          label: value,
        })),
      },
      {
        key: "generateAudio",
        label: "生成音频",
        type: "choice",
        compact: true,
        buttonWidthPx: 132,
        options: [
          { value: true, label: "开启" },
          { value: false, label: "关闭" },
        ],
      },
      {
        key: "prompt",
        label: "提示词",
        type: "textarea",
        placeholder: "输入视频提示词，生成视频...",
      },
    ];
  }

  if (store.selectedVideoModel === "hailuo") {
    return [
      {
        key: "duration",
        label: "时长",
        type: "choice",
        columns: "grid-cols-2",
        options: [
          { value: "6", label: "6" },
          { value: "10", label: "10" },
        ],
      },
      {
        key: "resolution",
        label: "分辨率",
        type: "choice",
        columns: "grid-cols-1",
        options: [{ value: "768P", label: "768P" }],
      },
      {
        key: "promptOptimizer",
        label: "提示词优化",
        type: "choice",
        columns: "grid-cols-2",
        options: [
          { value: true, label: "开启" },
          { value: false, label: "关闭" },
        ],
      },
      {
        key: "prompt",
        label: "提示词",
        type: "textarea",
        placeholder: "输入视频提示词，生成视频...",
      },
    ];
  }

  if (store.selectedVideoModel === "seedance") {
    return [
      ...(currentVideoMode.value !== "first-last"
        ? [
            {
              key: "ratio",
              label: "比例",
              type: "choice" as const,
              columns: "grid-cols-3",
              options: [
                { value: "21:9", label: "21:9" },
                { value: "16:9", label: "16:9" },
                { value: "4:3", label: "4:3" },
                { value: "1:1", label: "1:1" },
                { value: "3:4", label: "3:4" },
                { value: "9:16", label: "9:16" },
                { value: "9:21", label: "9:21" },
                { value: "keep_ratio", label: "保持原比例" },
                { value: "adaptive", label: "自适应" },
              ],
            },
            {
              key: "duration",
              label: "时长",
              type: "choice" as const,
              columns: "grid-cols-2",
              options: [
                { value: "5", label: "5" },
                { value: "10", label: "10" },
              ],
            },
            {
              key: "resolution",
              label: "分辨率",
              type: "choice" as const,
              columns: "grid-cols-3",
              options: [
                { value: "480p", label: "480p" },
                { value: "720p", label: "720p" },
                { value: "1080p", label: "1080p" },
              ],
            },
            {
              key: "framespersecond",
              label: "帧率",
              type: "choice" as const,
              columns: "grid-cols-2",
              options: [
                { value: "16", label: "16" },
                { value: "24", label: "24" },
              ],
            },
            {
              key: "seed",
              label: "随机种子",
              type: "text" as const,
              placeholder: "可选，整数 seed",
            },
            {
              key: "camerafixed",
              label: "固定镜头",
              type: "choice" as const,
              columns: "grid-cols-2",
              options: [
                { value: false, label: "关闭" },
                { value: true, label: "开启" },
              ],
            },
            {
              key: "watermark",
              label: "水印",
              type: "choice" as const,
              columns: "grid-cols-2",
              options: [
                { value: false, label: "关闭" },
                { value: true, label: "开启" },
              ],
            },
            {
              key: "generateAudio",
              label: "生成音频",
              type: "choice" as const,
              columns: "grid-cols-2",
              options: [
                { value: false, label: "关闭" },
                { value: true, label: "开启" },
              ],
            },
            {
              key: "returnLastFrame",
              label: "返回末帧",
              type: "choice" as const,
              columns: "grid-cols-2",
              options: [
                { value: false, label: "关闭" },
                { value: true, label: "开启" },
              ],
            },
          ]
        : []),
      {
        key: "prompt",
        label: "提示词",
        type: "textarea",
        placeholder: "输入视频提示词，生成视频...",
      },
    ];
  }

  return [
    {
      key: "orientation",
      label: "方向",
      type: "choice",
      columns: "grid-cols-2",
      options: [
        { value: "portrait", label: "竖屏" },
        { value: "landscape", label: "横屏" },
      ],
    },
    {
      key: "duration",
      label: "时长",
      type: "choice",
      columns: getSoraDurationOptions(config).length === 1 ? "grid-cols-1" : "grid-cols-2",
      options: getSoraDurationOptions(config).map((value) => ({ value, label: value })),
    },
    {
      key: "prompt",
      label: "提示词",
      type: "textarea",
      placeholder: "输入视频提示词，生成视频...",
    },
  ];
});

const currentVideoFieldRows = computed<DynamicField[][]>(() => {
  const fields = currentVideoFields.value;

  if (store.selectedVideoModel !== "veo3") {
    return fields.map((field) => [field]);
  }

  const resolutionField = fields.find((field) => field.key === "resolution");
  const aspectRatioField = fields.find((field) => field.key === "aspectRatio");

  if (!resolutionField || !aspectRatioField) {
    return fields.map((field) => [field]);
  }

  return [
    [resolutionField, aspectRatioField],
    ...fields
      .filter((field) => field.key !== "resolution" && field.key !== "aspectRatio")
      .map((field) => [field]),
  ];
});

const currentVideoUploadItems = computed<UploadPreviewItem[]>(() => {
  if (store.selectedVideoModel === "veo3" && !videoFirstLastEnabled.value) {
    const images = getVeoReferenceImages(currentVideoConfig.value);
    const names = getVeoReferenceImageNames(currentVideoConfig.value);
    return images.map((source, index) => ({
      source,
      name: names[index] || "",
    }));
  }

  const items: UploadPreviewItem[] = [];
  const primarySource = String(currentVideoConfig.value.primaryImageSource || "").trim();
  const primaryName = String(currentVideoConfig.value.primaryImageName || "").trim();
  const lastSource = String(currentVideoConfig.value.lastFrameSource || "").trim();
  const lastName = String(currentVideoConfig.value.lastFrameName || "").trim();

  if (primarySource) {
    items.push({ source: primarySource, name: primaryName });
  }

  if (lastSource && currentVideoUploadLimit.value > 1) {
    items.push({ source: lastSource, name: lastName });
  }

  return items;
});

const firstLastVideoUploadSlots = computed<VideoUploadSlot[]>(() => [
  {
    label: "首帧",
    slotIndex: 0,
    source: String(currentVideoConfig.value.primaryImageSource || "").trim(),
    name: String(currentVideoConfig.value.primaryImageName || "").trim(),
  },
  {
    label: "尾帧",
    slotIndex: 1,
    source: String(currentVideoConfig.value.lastFrameSource || "").trim(),
    name: String(currentVideoConfig.value.lastFrameName || "").trim(),
  },
]);

const currentVideoUploadCount = computed(() =>
  isVideoFirstLastMode.value
    ? firstLastVideoUploadSlots.value.filter((slot) => slot.source).length
    : currentVideoUploadItems.value.length,
);

const visibleHistory = computed<GalleryHistoryItem[]>(() => {
  const imageHistory = store.history
    .filter((item) => item.status === "success" && item.resultImages.length > 0)
    .map((item) => ({ ...item, kind: "image" as const }));

  const videoHistory = store.videoHistory
    .filter((item) => item.phase === "success" && item.videoUrl)
    .map((item) => ({ ...item, kind: "video" as const }));

  return [...imageHistory, ...videoHistory].sort((left, right) => right.createdAt - left.createdAt);
});

function getGalleryHistoryKey(task: GalleryHistoryItem) {
  return `${task.kind}-${task.id}`;
}

function setHistoryImageResolutionLabel(task: GalleryHistoryItem, event: Event) {
  if (task.kind !== "image") {
    return;
  }

  const image = event.target as HTMLImageElement;
  if (!image.naturalWidth || !image.naturalHeight) {
    return;
  }

  historyImageResolutionLabels.value = {
    ...historyImageResolutionLabels.value,
    [getGalleryHistoryKey(task)]: `${image.naturalWidth}×${image.naturalHeight}`,
  };
}

function formatVideoSeconds(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }

  const roundedSeconds = Math.round(seconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const remainder = roundedSeconds % 60;

  if (minutes <= 0) {
    return `${roundedSeconds}s`;
  }

  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function setHistoryVideoDurationLabel(task: GalleryHistoryItem, event: Event) {
  if (task.kind !== "video") {
    return;
  }

  const video = event.target as HTMLVideoElement;
  const label = formatVideoSeconds(video.duration);
  if (!label) {
    return;
  }

  historyVideoDurationLabels.value = {
    ...historyVideoDurationLabels.value,
    [getGalleryHistoryKey(task)]: label,
  };
}

function formatImageResolutionLabel(task: ImageTask) {
  const historyKey = `image-${task.id}`;
  const actualResolution = historyImageResolutionLabels.value[historyKey];
  if (actualResolution) {
    return actualResolution;
  }

  const config = task.modelConfig || {};
  const size = String(config.size || "").trim();
  const imageSize = String(config.imageSize || "").trim();

  if (size && size !== "auto") {
    return size.replace("x", "×");
  }

  if (imageSize && imageSize !== "auto") {
    return imageSize;
  }

  return "";
}

function formatVideoDurationLabel(task: VideoTask) {
  const historyKey = `video-${task.id}`;
  const actualDuration = historyVideoDurationLabels.value[historyKey];
  if (actualDuration) {
    return actualDuration;
  }

  const duration = String(task.modelConfig?.duration || "").trim();

  if (!duration) {
    return "";
  }

  return duration.endsWith("s") ? duration : `${duration}s`;
}

function getVeoExtensionCount(task?: VideoTask | null) {
  const count = Number(task?.modelConfig?.extensionCount || 0);
  return Number.isFinite(count) ? count : 0;
}

function shouldShowVeoExtendButton(task?: VideoTask | null) {
  return Boolean(
    task?.modelKey === "veo3" &&
      task.phase === "success" &&
      task.videoUrl &&
      !isErrorStatus(task.status),
  );
}

function getVeoExtendDisabledReason(task?: VideoTask | null) {
  if (!shouldShowVeoExtendButton(task)) {
    return "";
  }

  const resolution = String(task?.modelConfig?.resolution || "720p").trim().toLowerCase();
  if (resolution !== "720p") {
    return "Veo 延长仅支持 720p 输入视频";
  }

  if (getVeoExtensionCount(task) >= 20) {
    return "已达到最多 20 次延长限制";
  }

  const videoUrl = String(task?.videoUrl || "").trim();
  const hasGenerationReference = Boolean(task?.remoteVideoUrl || task?.raw || task?.modelConfig?.sourceVideoReference);
  if (videoUrl.startsWith("blob:") && !hasGenerationReference) {
    return "本地保存的视频可下载，但缺少 Veo 延长所需的生成引用";
  }

  return "";
}

watch(
  () => [store.currentTask?.status, store.currentTask?.createdAt] as const,
  ([status, createdAt]) => {
    if (imageTimer) {
      window.clearInterval(imageTimer);
      imageTimer = undefined;
    }

    if (status === "generating" && createdAt) {
      currentImageElapsed.value = Date.now() - createdAt;
      imageTimer = window.setInterval(() => {
        currentImageElapsed.value = Date.now() - createdAt;
      }, 100);
    } else {
      currentImageElapsed.value = 0;
    }
  },
  { immediate: true },
);

watch(
  () => [store.videoTask?.phase, store.videoTask?.createdAt] as const,
  ([phase, createdAt]) => {
    if (videoTimer) {
      window.clearInterval(videoTimer);
      videoTimer = undefined;
    }

    if (phase === "pending" && createdAt) {
      currentVideoElapsed.value = Date.now() - createdAt;
      videoTimer = window.setInterval(() => {
        currentVideoElapsed.value = Date.now() - createdAt;
      }, 100);
    } else {
      currentVideoElapsed.value = 0;
    }
  },
  { immediate: true },
);

function clearVideoPolling() {
  if (videoPollTimer) {
    window.clearTimeout(videoPollTimer);
    videoPollTimer = undefined;
  }
}

function scheduleVideoPolling(delay = 300) {
  clearVideoPolling();

  if (!store.videoTask || store.videoTask.phase !== "pending") {
    return;
  }

  videoPollTimer = window.setTimeout(() => {
    void refreshVideoTask();
  }, delay);
}

async function refreshVideoTask(force = false) {
  if (!store.videoTask || store.videoTask.phase !== "pending") {
    clearVideoPolling();
    return;
  }

  if (force) {
    clearVideoPolling();
  }

  try {
    const next = await pollVideoTask(store.videoTask, store.apiBaseUrl, store.apiKey);
    const updatedTask = {
      ...store.videoTask,
      ...next,
      updatedAt: Date.now(),
    } as VideoTask;

    if (next.phase === "success" && updatedTask.videoUrl) {
      const playableTask = {
        ...updatedTask,
        remoteVideoUrl: updatedTask.remoteVideoUrl || updatedTask.videoUrl,
      } as VideoTask;
      store.setVideoTask(playableTask);
      void store.addVideoHistoryTask(playableTask);
    } else {
      store.setVideoTask(updatedTask);
    }

    if (store.videoTask?.phase === "pending") {
      scheduleVideoPolling(5000);
    }
  } catch (error) {
    store.setVideoTask({
      ...store.videoTask,
      updatedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    } as VideoTask);
    scheduleVideoPolling(10000);
  }
}

function openPromptLibrary() {
  router.push("/prompts");
}

function openPreview(src: string, title = "", kind: "image" | "video" | "prompt" = "image", canContinue = false) {
  previewImage.value = src;
  previewTitle.value = title;
  previewKind.value = kind;
  previewCanContinue.value = canContinue;
}

function closePreview() {
  previewImage.value = "";
  previewTitle.value = "";
  previewCanContinue.value = false;
}

function downloadImage(src: string, index = 0) {
  const anchor = document.createElement("a");
  anchor.href = src;
  anchor.download = `art-workshop-${Date.now()}-${index}.png`;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function buildVideoFileName(task?: VideoTask | null) {
  const model = task?.modelTitle ? task.modelTitle.replace(/\s+/g, "-").toLowerCase() : "video";
  const createdAt = task?.createdAt || Date.now();
  return `art-workshop-${model}-${createdAt}.mp4`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function downloadVideoUrl(url: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function downloadVideo(source: string | VideoTask) {
  if (typeof source !== "string") {
    if (source.videoBlob) {
      downloadBlob(source.videoBlob, source.videoFileName || buildVideoFileName(source));
      return;
    }

    const url = source.remoteVideoUrl || source.videoUrl;
    if (!url) {
      window.alert("当前视频没有可下载地址");
      return;
    }
    downloadVideoUrl(url, source.videoFileName || buildVideoFileName(source));
    return;
  }

  downloadVideoUrl(source, `art-workshop-video-${Date.now()}.mp4`);
}

function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function formatElapsed(milliseconds: number) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function formatTimestamp(timestamp: number) {
  if (!timestamp) {
    return "-";
  }

  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

function getVideoTaskStatusLabel(task: VideoTask | null) {
  if (!task) return "未开始";
  if (task.phase === "success") return "已完成";
  if (task.phase === "error") return "失败";
  return task.status || "处理中";
}

function getVideoTaskStatusClass(task: VideoTask | null) {
  if (!task) return "bg-muted/50 text-muted-foreground";
  if (task.phase === "success") return "bg-green-500/10 text-green-500";
  if (task.phase === "error") return "bg-red-500/10 text-red-500";
  return "bg-blue-500/10 text-blue-500";
}

function getAspectPreviewSize(text: string) {
  const normalized = String(text || "").trim();
  const match = normalized.match(/(\d+)\s*[×x:]\s*(\d+)/i);

  if (!match) {
    if (normalized === "自动" || normalized.toLowerCase() === "auto") {
      return { width: 12, height: 12 };
    }
    return null;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) {
    return null;
  }

  const scale = 14 / Math.max(width, height);
  return {
    width: Math.ceil(width * scale),
    height: Math.ceil(height * scale),
  };
}

function aspectPreviewStyle(value: string | number | boolean) {
  const size = getAspectPreviewSize(String(value));
  if (!size) {
    return {};
  }

  return {
    width: `${size.width}px`,
    height: `${size.height}px`,
  };
}

function ensureTextareaHeight() {
  if (!promptTextarea.value) {
    return;
  }

  promptTextarea.value.style.height = "auto";
  promptTextarea.value.style.height = `${Math.max(120, promptTextarea.value.scrollHeight)}px`;
}

function updatePrompt(prompt: string) {
  store.setPrompt(prompt);
  window.requestAnimationFrame(ensureTextareaHeight);
}

function pickImageFiles() {
  imageInput.value?.click();
}

function pickVideoFiles(targetIndex: number | null = null) {
  videoUploadTargetIndex.value = targetIndex;
  videoInput.value?.click();
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.onload = () => {
      if (typeof reader.result === "string" && reader.result.startsWith("data:")) {
        resolve(reader.result);
        return;
      }
      reject(new Error("文件读取失败"));
    };
    reader.readAsDataURL(file);
  });
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

async function addImageFiles(files: FileList | File[] | null) {
  if (!files) {
    return;
  }

  const list = Array.from(files);
  const room = currentImageUploadLimit.value - store.uploadedImages.length;
  if (room <= 0) {
    window.alert(`最多只能上传 ${currentImageUploadLimit.value} 张参考图片`);
    return;
  }

  for (const file of list.slice(0, room)) {
    if (!file.type.startsWith("image/")) {
      continue;
    }
    const dataUrl = await fileToDataUrl(file);
    store.addUploadedImage(dataUrl);
  }

  if (list.length > room) {
    window.alert(`已达到上传限制，只能再上传 ${room} 张图片`);
  }
}

function removeImageUpload(index: number) {
  store.removeUploadedImage(index);
}

function reorderUploadedImages(fromIndex: number, toIndex: number) {
  store.setUploadedImages(moveArrayItem(store.uploadedImages, fromIndex, toIndex));
}

function handleImageThumbDragStart(index: number) {
  draggingImageIndex.value = index;
}

function handleImageThumbDragOver(event: DragEvent) {
  event.preventDefault();
}

function handleImageThumbDrop(index: number) {
  if (draggingImageIndex.value === null) {
    return;
  }

  reorderUploadedImages(draggingImageIndex.value, index);
  draggingImageIndex.value = null;
}

function handleImageThumbDragEnd() {
  draggingImageIndex.value = null;
}

async function handleImageInput(event: Event) {
  const target = event.target as HTMLInputElement;
  await addImageFiles(target.files);
  target.value = "";
}

async function handleImageDrop(event: DragEvent) {
  event.preventDefault();
  await addImageFiles(event.dataTransfer?.files ?? null);
}

function handleImageDragOver(event: DragEvent) {
  event.preventDefault();
}

function setCurrentVideoUploadItems(items: UploadPreviewItem[]) {
  const nextItems = items
    .map((item) => ({
      source: String(item.source || "").trim(),
      name: String(item.name || "").trim(),
    }))
    .filter((item) => item.source)
    .slice(0, currentVideoUploadLimit.value);

  if (isVideoFirstLastMode.value) {
    setFirstLastVideoUploadSlots([
      nextItems[0] || { source: "", name: "" },
      nextItems[1] || { source: "", name: "" },
    ]);
    return;
  }

  if (store.selectedVideoModel === "veo3" && !videoFirstLastEnabled.value) {
    store.setVideoField("referenceImages", nextItems.map((item) => item.source).slice(0, MAX_VEO_REFERENCE_IMAGES));
    store.setVideoField("referenceImageNames", nextItems.map((item) => item.name).slice(0, MAX_VEO_REFERENCE_IMAGES));
    return;
  }

  store.setVideoField("primaryImageSource", nextItems[0]?.source || "");
  store.setVideoField("primaryImageName", nextItems[0]?.name || "");
  store.setVideoField("lastFrameSource", nextItems[1]?.source || "");
  store.setVideoField("lastFrameName", nextItems[1]?.name || "");
}

function setFirstLastVideoUploadSlots(slots: UploadPreviewItem[]) {
  const first = slots[0] || { source: "", name: "" };
  const last = slots[1] || { source: "", name: "" };

  store.setVideoField("primaryImageSource", first.source || "");
  store.setVideoField("primaryImageName", first.name || "");
  store.setVideoField("lastFrameSource", last.source || "");
  store.setVideoField("lastFrameName", last.name || "");
}

async function addFirstLastVideoFiles(files: File[], targetIndex: number | null = null) {
  if (files.length === 0) {
    return;
  }

  const slots = firstLastVideoUploadSlots.value.map((slot) => ({
    source: slot.source,
    name: slot.name,
  }));
  const startIndex =
    targetIndex !== null
      ? targetIndex
      : slots.findIndex((slot) => !slot.source);

  if (startIndex < 0 || startIndex >= slots.length) {
    window.alert(`最多只能上传 ${currentVideoUploadLimit.value} 张参考图片`);
    return;
  }

  let fileIndex = 0;
  for (let slotIndex = startIndex; slotIndex < slots.length && fileIndex < files.length; slotIndex += 1) {
    const file = files[fileIndex];
    const dataUrl = await fileToDataUrl(file);
    slots[slotIndex] = {
      source: dataUrl,
      name: file.name || buildPastedImageName(file),
    };
    fileIndex += 1;
  }

  setFirstLastVideoUploadSlots(slots);

  if (fileIndex < files.length) {
    window.alert(`首尾帧最多只能上传 ${currentVideoUploadLimit.value} 张参考图片`);
  }
}

async function addVideoFiles(files: FileList | File[] | null, targetIndex: number | null = null) {
  if (!files) {
    return;
  }

  const list = Array.from(files).filter((file) => file.type.startsWith("image/"));
  if (isVideoFirstLastMode.value) {
    await addFirstLastVideoFiles(list, targetIndex);
    return;
  }

  const room = currentVideoUploadLimit.value - currentVideoUploadItems.value.length;
  if (room <= 0) {
    window.alert(`最多只能上传 ${currentVideoUploadLimit.value} 张参考图片`);
    return;
  }

  const nextItems = [...currentVideoUploadItems.value];
  for (const file of list.slice(0, room)) {
    const dataUrl = await fileToDataUrl(file);
    nextItems.push({
      source: dataUrl,
      name: file.name || buildPastedImageName(file),
    });
  }

  setCurrentVideoUploadItems(nextItems);

  if (list.length > room) {
    window.alert(`已达到上传限制，只能再上传 ${room} 张图片`);
  }
}

function clearVideoUploadItem(index: number) {
  if (isVideoFirstLastMode.value) {
    const slots = firstLastVideoUploadSlots.value.map((slot) => ({
      source: slot.source,
      name: slot.name,
    }));
    slots[index] = { source: "", name: "" };
    setFirstLastVideoUploadSlots(slots);
    return;
  }

  const nextItems = [...currentVideoUploadItems.value];
  nextItems.splice(index, 1);
  setCurrentVideoUploadItems(nextItems);
}

function reorderVideoUploadItems(fromIndex: number, toIndex: number) {
  if (isVideoFirstLastMode.value) {
    const slots = firstLastVideoUploadSlots.value.map((slot) => ({
      source: slot.source,
      name: slot.name,
    }));
    const fromSlot = slots[fromIndex];

    if (!fromSlot) {
      return;
    }

    slots[fromIndex] = slots[toIndex] || { source: "", name: "" };
    slots[toIndex] = fromSlot;
    setFirstLastVideoUploadSlots(slots);
    return;
  }

  setCurrentVideoUploadItems(moveArrayItem(currentVideoUploadItems.value, fromIndex, toIndex));
}

function handleVideoThumbDragStart(index: number) {
  draggingVideoIndex.value = index;
}

function handleVideoThumbDragOver(event: DragEvent) {
  event.preventDefault();
}

function handleVideoThumbDrop(index: number) {
  if (draggingVideoIndex.value === null) {
    return;
  }

  reorderVideoUploadItems(draggingVideoIndex.value, index);
  draggingVideoIndex.value = null;
}

function handleVideoThumbDragEnd() {
  draggingVideoIndex.value = null;
}

async function handleFirstLastVideoSlotDrop(event: DragEvent, index: number) {
  event.preventDefault();

  if (draggingVideoIndex.value !== null) {
    handleVideoThumbDrop(index);
    return;
  }

  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    await addVideoFiles(files, index);
    draggingVideoIndex.value = null;
  }
}

function handleFirstLastVideoSlotClick(slot: VideoUploadSlot) {
  if (slot.source) {
    openPreview(slot.source, slot.name || slot.label, "image");
    return;
  }

  pickVideoFiles(slot.slotIndex);
}

function getVideoUploadItemLabel(index: number) {
  if (!isVideoFirstLastMode.value) {
    return "";
  }

  return index === 0 ? "首帧" : index === 1 ? "尾帧" : "";
}

function getRandomStarterPrompt() {
  return STARTER_PROMPTS[Math.floor(Math.random() * STARTER_PROMPTS.length)];
}

async function handleOptimizePrompt() {
  if (optimizingPrompt.value) {
    return;
  }

  optimizingPrompt.value = true;

  try {
    const prompt =
      store.prompt.trim() || `生成一个关于"${getRandomStarterPrompt()}"的详细图像生成提示词`;
    const optimized = await optimizeImagePrompt(prompt, store.apiBaseUrl, store.apiKey);
    updatePrompt(optimized);
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "优化失败，请重试");
  } finally {
    optimizingPrompt.value = false;
  }
}

async function handleGenerateImage() {
  if (!canGenerateImage.value) {
    return;
  }

  const startedAt = Date.now();
  const task = createImageTask({
    createdAt: startedAt,
    status: "generating",
    sourceImages: [...store.uploadedImages],
    prompt: store.prompt,
    model: store.selectedImageModel,
    modelConfig: { ...currentImageConfig.value },
    resultImages: [],
    generationTime: 0,
  });

  store.setCurrentTask(task);
  store.setIsGenerating(true);

  try {
    const result = await generateImage({
      model: store.selectedImageModel,
      prompt: store.prompt,
      sourceImages: [...store.uploadedImages],
      config: currentImageConfig.value,
      apiBaseUrl: store.apiBaseUrl,
      apiKey: store.apiKey,
    });

    const finalTask: ImageTask = {
      ...task,
      status: "success",
      resultImages: result.images,
      generationTime: Date.now() - startedAt,
    };

    store.setCurrentTask(finalTask);
    store.addHistoryTask(finalTask);
  } catch (error) {
    const finalTask: ImageTask = {
      ...task,
      status: "failed",
      generationTime: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "未知错误",
    };

    store.setCurrentTask(finalTask);
    store.addHistoryTask(finalTask);
  } finally {
    store.setIsGenerating(false);
  }
}

function toggleVideoFirstLastFrames() {
  if (!videoSupportsFirstLastFrames.value) {
    return;
  }

  const nextEnabled = !videoFirstLastEnabled.value;

  if (nextEnabled) {
    const existingItems = currentVideoUploadItems.value;
    const hasPrimary = Boolean(String(currentVideoConfig.value.primaryImageSource || "").trim());
    const hasLast = Boolean(String(currentVideoConfig.value.lastFrameSource || "").trim());

    if (!hasPrimary && existingItems[0]) {
      store.setVideoField("primaryImageSource", existingItems[0].source);
      store.setVideoField("primaryImageName", existingItems[0].name);
    }
    if (!hasLast && existingItems[1]) {
      store.setVideoField("lastFrameSource", existingItems[1].source);
      store.setVideoField("lastFrameName", existingItems[1].name);
    }
  } else if (store.selectedVideoModel === "veo3") {
    const existingReferences = getVeoReferenceImages(currentVideoConfig.value);
    const slots = firstLastVideoUploadSlots.value.filter((slot) => slot.source);

    if (existingReferences.length === 0 && slots.length > 0) {
      store.setVideoField("referenceImages", slots.map((slot) => slot.source).slice(0, MAX_VEO_REFERENCE_IMAGES));
      store.setVideoField("referenceImageNames", slots.map((slot) => slot.name).slice(0, MAX_VEO_REFERENCE_IMAGES));
    }
  }

  store.setVideoField("useFirstLastFrames", nextEnabled);
  if (store.selectedVideoModel === "veo3") {
    store.setVideoField("veoUseFirstLastFrames", nextEnabled);
  }
}

function buildPastedImageName(file: File) {
  const extension = String(file.type || "").split("/")[1] || "png";
  return `粘贴图片-${Date.now()}.${extension}`;
}

async function handleVideoInput(event: Event) {
  const target = event.target as HTMLInputElement;
  const targetIndex = videoUploadTargetIndex.value;

  videoUploadTargetIndex.value = null;
  await addVideoFiles(target.files, targetIndex);
  target.value = "";
}

async function handleVideoDrop(event: DragEvent, targetIndex: number | null = null) {
  event.preventDefault();
  await addVideoFiles(event.dataTransfer?.files ?? null, targetIndex);
}

async function handleSubmitVideo() {
  if (isVideoGenerating.value) {
    return;
  }

  clearVideoPolling();
  submittingVideo.value = true;

  const startedAt = Date.now();
  const pendingTask: VideoTask = {
    id: "",
    modelKey: store.selectedVideoModel,
    modelTitle: VIDEO_MODELS[store.selectedVideoModel].title,
    prompt: String(currentVideoConfig.value.prompt || ""),
    modelConfig: {
      ...currentVideoConfig.value,
      ...(store.selectedVideoModel === "veo3" ? { duration: "8" } : {}),
    },
    sourceImages: currentVideoUploadItems.value.map((item) => item.source),
    status: "SUBMITTING",
    phase: "pending",
    progress: "",
    error: "",
    videoUrl: "",
    createdAt: startedAt,
    updatedAt: startedAt,
  };
  store.setVideoTask(pendingTask);

  try {
    const task = await submitVideoTask({
      modelKey: store.selectedVideoModel,
      config: currentVideoConfig.value,
      apiBaseUrl: store.apiBaseUrl,
      apiKey: store.apiKey,
    });
    store.setVideoTask({
      ...task,
      createdAt: startedAt,
      updatedAt: Date.now(),
    });
    scheduleVideoPolling(300);
  } catch (error) {
    store.setVideoTask({
      id: "",
      modelKey: store.selectedVideoModel,
      modelTitle: VIDEO_MODELS[store.selectedVideoModel].title,
      status: "ERROR",
      phase: "error",
      progress: "",
      error: error instanceof Error ? error.message : String(error),
      videoUrl: "",
      createdAt: startedAt,
      updatedAt: Date.now(),
    });
  } finally {
    submittingVideo.value = false;
  }
}

async function handleExtendVeoVideo(task: VideoTask | null | undefined) {
  if (!task) {
    return;
  }

  const disabledReason = getVeoExtendDisabledReason(task);
  if (disabledReason) {
    window.alert(disabledReason);
    return;
  }

  const defaultPrompt = String(currentVideoConfig.value.prompt || task.prompt || "").trim();
  const prompt = window.prompt("输入延长视频提示词", defaultPrompt);
  if (prompt === null) {
    return;
  }

  clearVideoPolling();

  try {
    const nextTask = await submitVeoVideoExtension({
      task,
      prompt,
      apiBaseUrl: store.apiBaseUrl,
      apiKey: store.apiKey,
    });
    store.setVideoTask(nextTask);
    scheduleVideoPolling(300);
  } catch (error) {
    store.setVideoTask({
      id: "",
      modelKey: "veo3",
      modelTitle: "Veo 3.1",
      prompt,
      modelConfig: {
        ...(task.modelConfig || {}),
        mode: "extend",
        prompt,
        sourceVideoId: task.id,
        sourceVideoUrl: task.videoUrl,
      },
      sourceImages: [],
      status: "ERROR",
      phase: "error",
      progress: "",
      error: error instanceof Error ? error.message : String(error),
      videoUrl: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}

function continueFromPreview() {
  if (!previewImage.value || previewKind.value !== "image") {
    return;
  }
  store.continueWithResult(previewImage.value);
  closePreview();
}

function handlePreviewDownload() {
  if (!previewImage.value) {
    return;
  }
  if (previewKind.value === "video") {
    downloadVideo(previewImage.value);
  } else {
    downloadImage(previewImage.value, 0);
  }
}

function loadGalleryItemConfig(item: GalleryHistoryItem) {
  if (item.kind === "image") {
    store.loadTaskConfig(item);
    return;
  }

  store.loadVideoTaskConfig(item);
}

function removeGalleryItem(item: GalleryHistoryItem) {
  if (item.kind === "image") {
    void store.removeHistoryTask(item.id);
    return;
  }

  void store.removeVideoHistoryTask(item.id);
}

async function handleGlobalPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.items || [])
    .filter((item) => item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  if (files.length === 0) {
    return;
  }

  event.preventDefault();

  if (store.generationMode === "image") {
    await addImageFiles(files);
    return;
  }

  await addVideoFiles(files);
}

onMounted(() => {
  document.addEventListener("paste", handleGlobalPaste);
  window.requestAnimationFrame(ensureTextareaHeight);
  if (store.videoTask?.phase === "pending") {
    scheduleVideoPolling(800);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("paste", handleGlobalPaste);
  clearVideoPolling();
  if (imageTimer) {
    window.clearInterval(imageTimer);
  }
  if (videoTimer) {
    window.clearInterval(videoTimer);
  }
});
</script>

<template>
  <div class="min-h-screen bg-background">
    <header class="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div class="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <div class="flex items-center gap-2">
          <img
            src="/favicon.svg"
            alt="logo"
            class="h-6 w-6"
          />
          <h1
            class="text-2xl font-bold leading-none"
            style="font-family: 'Caveat', cursive"
          >
            Art Workshop
          </h1>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            @click="openPromptLibrary"
          >
            <BookOpen class="h-4 w-4" />
            <span class="hidden sm:inline">提示词库</span>
          </button>

          <button
            type="button"
            class="inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground"
            @click="settingsOpen = true"
          >
            <Settings class="h-5 w-5" />
          </button>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-7xl px-4 py-6">
      <div class="mb-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="inline-flex h-8 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors"
          :class="store.generationMode === 'image' ? 'bg-primary text-primary-foreground shadow' : 'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground'"
          @click="store.setGenerationMode('image')"
        >
          图片生成
        </button>
        <button
          type="button"
          class="inline-flex h-8 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors"
          :class="store.generationMode === 'video' ? 'bg-primary text-primary-foreground shadow' : 'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground'"
          @click="store.setGenerationMode('video')"
        >
          视频生成
        </button>
      </div>

      <template v-if="store.generationMode === 'image'">
        <div class="grid gap-6 lg:grid-cols-[280px_1fr_320px]">
          <section class="rounded-xl border bg-card text-card-foreground shadow h-fit">
            <div class="flex flex-col space-y-1.5 p-6 pb-3">
              <h3 class="text-base font-semibold tracking-tight">图片 & 模型</h3>
            </div>

            <div class="space-y-6 p-6 pt-0">
              <div class="space-y-3">
                <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Bot class="h-4 w-4" />
                  <span>模型选择</span>
                </div>

                <div class="space-y-1">
                  <button
                    v-for="model in IMAGE_MODELS"
                    :key="model.id"
                    type="button"
                    class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors"
                    :class="store.selectedImageModel === model.id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent hover:text-accent-foreground'"
                    @click="store.setSelectedImageModel(model.id)"
                  >
                    <component
                      :is="getImageModelIcon(model.id)"
                      v-if="getImageModelIcon(model.id)"
                      class="h-4 w-4 shrink-0"
                    />
                    <span
                      v-else
                      class="shrink-0 text-base leading-none"
                    >
                      🍌
                    </span>
                    <span>{{ model.name }}</span>
                  </button>
                </div>
              </div>

              <div class="border-t pt-4">
                <div class="mb-3 flex items-center justify-between">
                  <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Upload class="h-4 w-4" />
                    <span>参考图片</span>
                    <span class="text-xs text-muted-foreground/60">(最多{{ currentImageUploadLimit }}张)</span>
                  </div>
                  <span
                    v-if="store.uploadedImages.length > 0"
                    class="text-xs text-muted-foreground"
                  >
                    {{ store.uploadedImages.length }}/{{ currentImageUploadLimit }}
                  </span>
                </div>

                <input
                  ref="imageInput"
                  type="file"
                  accept="image/*"
                  multiple
                  class="hidden"
                  @change="handleImageInput"
                />

                <div
                  v-if="store.uploadedImages.length === 0"
                  class="relative flex min-h-[100px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/50 p-4 transition-colors hover:border-muted-foreground/50 hover:bg-muted"
                  @click="pickImageFiles"
                  @drop="handleImageDrop"
                  @dragover="handleImageDragOver"
                >
                  <ImageIcon class="h-8 w-8 text-muted-foreground/50" />
                  <div class="text-center text-sm text-muted-foreground">
                    <p>拖拽图片到此处</p>
                    <p class="text-xs">或点击上传 / Ctrl+V 粘贴</p>
                  </div>
                </div>

                <div
                  v-else
                  class="space-y-2"
                >
                  <div class="flex flex-wrap gap-2">
                    <div
                      v-for="(image, index) in store.uploadedImages"
                      :key="`${image}-${index}`"
                      class="group relative h-16 w-16 cursor-move overflow-hidden rounded-md ring-1 ring-border/40 transition-all"
                      draggable="true"
                      @dragstart="handleImageThumbDragStart(index)"
                      @dragover="handleImageThumbDragOver"
                      @drop="handleImageThumbDrop(index)"
                      @dragend="handleImageThumbDragEnd"
                    >
                      <img
                        :src="image"
                        :alt="`图片 ${index + 1}`"
                        class="h-full w-full cursor-pointer object-cover"
                        @click="openPreview(image, `参考图 ${index + 1}`, 'image')"
                      />
                      <span class="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[10px] text-white">
                        {{ index + 1 }}
                      </span>
                      <button
                        type="button"
                        class="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                        @click.stop="removeImageUpload(index)"
                      >
                        <X class="h-3 w-3" />
                      </button>
                    </div>

                    <button
                      v-if="store.uploadedImages.length < currentImageUploadLimit"
                      type="button"
                      class="flex h-16 w-16 items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/25 bg-muted/50 transition-colors hover:border-muted-foreground/50 hover:bg-muted"
                      @click="pickImageFiles"
                    >
                      <Plus class="h-5 w-5 text-muted-foreground" />
                    </button>
                  </div>

                  <div
                    v-if="store.uploadedImages.length > 1"
                    class="text-[11px] text-muted-foreground"
                  >
                    拖动缩略图可调整顺序
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section class="rounded-xl border bg-card text-card-foreground shadow">
            <div class="p-6">
              <div class="flex h-full flex-col space-y-4">
                <div class="flex items-center gap-2 text-base font-semibold">参数 & 提示词</div>

                <div
                  v-for="field in currentImageModel.options"
                  :key="field.key"
                  class="space-y-2"
                >
                  <div class="text-xs font-medium text-muted-foreground">{{ field.label }}</div>

                  <div
                    v-if="field.preview"
                    class="grid grid-cols-5 gap-1.5"
                  >
                    <button
                      v-for="option in field.options"
                      :key="String(option.value)"
                      type="button"
                      class="flex flex-col items-center rounded-md py-2 transition-all"
                      :class="currentImageConfig[field.key] === option.value ? 'bg-blue-500 text-white' : 'bg-muted/50 text-muted-foreground hover:bg-muted'"
                      @click="store.setImageModelConfig(store.selectedImageModel, field.key, option.value)"
                    >
                      <div class="flex h-5 items-end justify-center">
                        <div
                          class="rounded-[3px] border-2 border-current"
                          :style="aspectPreviewStyle(option.value)"
                        />
                      </div>
                      <span class="mt-1 text-[10px] font-medium">{{ option.label }}</span>
                    </button>
                  </div>

                  <div
                    v-else-if="field.compact"
                    class="flex gap-2 overflow-x-auto"
                  >
                    <button
                      v-for="option in field.options"
                      :key="String(option.value)"
                      type="button"
                      class="rounded-lg px-3 py-2.5 text-sm font-medium transition-all"
                      :class="currentImageConfig[field.key] === option.value ? 'bg-blue-500 text-white' : 'bg-muted/50 hover:bg-muted'"
                      @click="store.setImageModelConfig(store.selectedImageModel, field.key, option.value)"
                    >
                      {{ option.label }}
                    </button>
                  </div>

                  <div
                    v-else
                    class="grid grid-cols-4 gap-2"
                  >
                    <button
                      v-for="option in field.options"
                      :key="String(option.value)"
                      type="button"
                      class="rounded-lg py-2.5 text-sm font-medium transition-all"
                      :class="currentImageConfig[field.key] === option.value ? 'bg-blue-500 text-white' : 'bg-muted/50 hover:bg-muted'"
                      @click="store.setImageModelConfig(store.selectedImageModel, field.key, option.value)"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </div>

                <div class="flex-1 space-y-2">
                  <div class="text-xs text-muted-foreground">提示词</div>
                  <div class="group relative">
                    <textarea
                      ref="promptTextarea"
                      :value="store.prompt"
                      placeholder="输入提示词，生成图片..."
                      class="min-h-[120px] w-full resize-none overflow-hidden rounded-md border border-input bg-transparent px-3 py-2 pr-24 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      @input="updatePrompt(($event.target as HTMLTextAreaElement).value)"
                    />
                    <button
                      type="button"
                      class="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-md border border-border/10 bg-background/20 px-2.5 py-1.5 text-xs opacity-50 transition-all backdrop-blur-sm group-hover:opacity-100 hover:bg-background/70 hover:border-border/40 group-focus-within:opacity-100"
                      :class="optimizingPrompt ? 'bg-accent/60 opacity-100' : ''"
                      :disabled="optimizingPrompt"
                      @click="handleOptimizePrompt"
                    >
                      <WandSparkles class="h-3.5 w-3.5" />
                      <span>{{ optimizingPrompt ? "优化中" : store.prompt.trim() ? "提示词优化" : "随机生成" }}</span>
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  class="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-8 text-sm font-semibold text-primary-foreground shadow transition-colors hover:bg-primary/90"
                  :class="store.isGenerating ? 'opacity-80' : ''"
                  :disabled="!canGenerateImage"
                  @click="handleGenerateImage"
                >
                  <LoaderCircle
                    v-if="store.isGenerating"
                    class="h-4 w-4 animate-spin"
                  />
                  <Sparkles
                    v-else
                    class="h-4 w-4"
                  />
                  {{ store.isGenerating ? "生成中..." : "开始生成" }}
                </button>
              </div>
            </div>
          </section>

          <section class="rounded-xl border bg-card text-card-foreground shadow h-fit">
            <div class="flex flex-col space-y-1.5 p-6 pb-3">
              <h3 class="text-base font-semibold tracking-tight">生成结果</h3>
            </div>
            <div class="p-6 pt-0">
              <div class="flex h-full flex-col space-y-4">
                <div
                  v-if="!store.currentTask"
                  class="flex aspect-video items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/50"
                >
                  <div class="text-center text-muted-foreground">
                    <ImageIcon class="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                    <p class="text-sm">生成结果将在这里显示</p>
                  </div>
                </div>

                <div
                  v-else-if="store.currentTask.status === 'generating'"
                  class="flex aspect-video items-center justify-center rounded-md bg-muted"
                >
                  <div class="text-center">
                    <LoaderCircle class="mx-auto mb-2 h-8 w-8 animate-spin text-primary" />
                    <p class="text-sm text-muted-foreground">生成中...</p>
                    <p class="mt-1 font-mono text-xs text-muted-foreground">
                      {{ formatElapsed(currentImageElapsed) }}
                    </p>
                  </div>
                </div>

                <div
                  v-else-if="store.currentTask.status === 'success' && store.currentTask.resultImages.length > 0"
                  class="space-y-3"
                >
                  <div class="grid gap-2">
                    <div
                      v-for="(image, index) in store.currentTask.resultImages"
                      :key="`${image}-${index}`"
                      class="relative overflow-hidden rounded-md"
                    >
                      <img
                        :src="image"
                        :alt="`结果 ${index + 1}`"
                        class="w-full cursor-pointer transition-opacity hover:opacity-90"
                        @click="openPreview(image, `结果 ${index + 1}`, 'image', true)"
                      />
                      <div class="absolute bottom-2 right-2 flex gap-1">
                        <button
                          type="button"
                          class="inline-flex h-8 w-8 items-center justify-center rounded-md bg-secondary text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80"
                          @click.stop="store.continueWithResult(image)"
                        >
                          <Pencil class="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          class="inline-flex h-8 w-8 items-center justify-center rounded-md bg-secondary text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80"
                          @click.stop="downloadImage(image, index)"
                        >
                          <Download class="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div class="flex items-center gap-3 text-xs text-muted-foreground">
                    <span class="flex items-center gap-1">
                      <Cpu class="h-3 w-3" />
                      {{ currentImageModel.name }}
                    </span>
                    <span class="flex items-center gap-1">
                      <Clock class="h-3 w-3" />
                      {{ formatElapsed(store.currentTask.generationTime) }}
                    </span>
                  </div>
                </div>

                <div
                  v-else
                  class="rounded-md bg-destructive/10 p-3 text-center"
                >
                  <p class="text-sm text-destructive">生成失败</p>
                  <p class="text-xs text-muted-foreground">{{ store.currentTask.error }}</p>
                </div>
              </div>
            </div>
          </section>
        </div>

      </template>

      <template v-else>
        <div class="grid gap-6 lg:grid-cols-[280px_1fr_320px]">
          <section class="rounded-xl border bg-card text-card-foreground shadow h-fit">
            <div class="flex flex-col space-y-1.5 p-6 pb-3">
              <h3 class="text-base font-semibold tracking-tight">视频 & 模型</h3>
            </div>

            <div class="space-y-6 p-6 pt-0">
              <div class="space-y-3">
                <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Bot class="h-4 w-4" />
                  <span>模型选择</span>
                </div>

                <div class="space-y-3">
                  <button
                    v-for="model in Object.values(VIDEO_MODELS)"
                    :key="model.key"
                    type="button"
                    class="flex w-full items-center justify-start gap-2 rounded-md px-3 py-2 text-sm transition-colors"
                    :class="store.selectedVideoModel === model.key ? 'bg-primary text-primary-foreground' : 'hover:bg-accent hover:text-accent-foreground'"
                    @click="store.setSelectedVideoModel(model.key)"
                  >
                    <component
                      :is="getVideoModelIcon(model.key)"
                      v-if="getVideoModelIcon(model.key)"
                      class="h-4 w-4 shrink-0"
                    />
                    <span
                      v-else-if="model.iconSvg"
                      class="inline-flex h-4 w-4 shrink-0 items-center justify-center [&_svg]:h-4 [&_svg]:w-4"
                      v-html="model.iconSvg"
                    />
                    <img
                      v-else-if="model.iconSrc"
                      :src="model.iconSrc"
                      :alt="model.title"
                      class="h-4 w-4 shrink-0 object-contain"
                    />
                    <span class="min-w-0 shrink-0 text-left font-medium">{{ model.title }}</span>
                    <span class="flex shrink-0 items-center gap-1.5">
                      <template
                        v-for="badge in model.badges"
                        :key="badge"
                      >
                        <component
                          :is="getVideoBadgeIcon(badge)"
                          v-if="getVideoBadgeIcon(badge)"
                          class="h-3.5 w-3.5"
                          :title="getVideoBadgeLabel(badge)"
                          :aria-label="getVideoBadgeLabel(badge)"
                        />
                        <span
                          v-else
                          class="text-xs"
                        >
                          {{ getVideoBadgeLabel(badge) }}
                        </span>
                      </template>
                    </span>
                  </button>
                </div>
              </div>

              <div
                v-if="currentVideoUploadLimit > 0"
                class="border-t pt-4"
              >
                <div class="mb-3 flex items-center justify-between gap-3">
                  <div class="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-medium text-muted-foreground">
                    <Upload class="h-4 w-4 shrink-0" />
                    <span>参考图片</span>
                    <span class="whitespace-nowrap text-xs text-muted-foreground">
                      {{ currentVideoUploadCount }}/{{ currentVideoUploadLimit }}
                    </span>
                  </div>

                  <div
                    v-if="videoSupportsFirstLastFrames"
                    class="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"
                  >
                    <span class="font-medium">首尾帧</span>
                    <button
                      type="button"
                      class="relative inline-flex h-4 w-8 shrink-0 rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      :class="videoFirstLastEnabled ? 'bg-blue-500' : 'bg-muted'"
                      role="switch"
                      :aria-checked="videoFirstLastEnabled"
                      aria-label="切换首尾帧模式"
                      @click="toggleVideoFirstLastFrames"
                    >
                      <span
                        class="block h-3 w-3 rounded-full shadow-sm transition-transform"
                          :style="{
                            backgroundColor: 'rgb(248, 250, 252)',
                            transform: videoFirstLastEnabled ? 'translateX(16px)' : 'translateX(0)',
                          }"
                      />
                    </button>
                  </div>
                </div>

                <input
                  ref="videoInput"
                  type="file"
                  accept="image/*"
                  multiple
                  class="hidden"
                  @change="handleVideoInput"
                />

                <div
                  v-if="isVideoFirstLastMode"
                  class="grid min-h-[100px] grid-cols-2 gap-2"
                  style="height: 100px"
                >
                  <div
                    v-for="slot in firstLastVideoUploadSlots"
                    :key="slot.label"
                    class="group relative flex min-h-[100px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/50 p-3 text-center transition-colors hover:border-muted-foreground/50 hover:bg-muted"
                    style="height: 100px"
                    :draggable="Boolean(slot.source)"
                    @click="handleFirstLastVideoSlotClick(slot)"
                    @dragstart="slot.source && handleVideoThumbDragStart(slot.slotIndex)"
                    @dragover.prevent
                    @drop="handleFirstLastVideoSlotDrop($event, slot.slotIndex)"
                    @dragend="handleVideoThumbDragEnd"
                  >
                    <template v-if="slot.source">
                      <img
                        :src="slot.source"
                        :alt="slot.name || slot.label"
                        class="absolute inset-0 h-full w-full object-cover"
                      />
                      <div class="pointer-events-none absolute inset-0 bg-gradient-to-t from-muted/50 to-transparent" />
                      <span class="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[10px] text-white">
                        {{ slot.label }}
                      </span>
                      <button
                        type="button"
                        class="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                        @click.stop="clearVideoUploadItem(slot.slotIndex)"
                      >
                        <X class="h-3 w-3" />
                      </button>
                    </template>

                    <template v-else>
                      <ImageIcon class="h-7 w-7 text-muted-foreground/50" />
                      <div class="mt-1 text-sm text-muted-foreground">
                        <p>{{ slot.label }}</p>
                        <p class="text-xs">点击上传 / 拖拽 / Ctrl+V 粘贴</p>
                      </div>
                    </template>
                  </div>
                </div>

                <div
                  v-else-if="currentVideoUploadItems.length === 0"
                  class="relative flex min-h-[100px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/50 p-4 text-center transition-colors hover:border-muted-foreground/50 hover:bg-muted"
                  @click="pickVideoFiles()"
                  @drop="handleVideoDrop"
                  @dragover.prevent
                >
                  <ImageIcon class="h-8 w-8 text-muted-foreground/50" />
                  <div class="text-sm text-muted-foreground">
                    <p>等待上传</p>
                    <p class="text-xs">点击上传 / 拖拽 / Ctrl+V 粘贴</p>
                  </div>
                </div>

                <div
                  v-else
                  class="space-y-2"
                >
                  <div class="flex flex-wrap gap-2">
                    <div
                      v-for="(asset, index) in currentVideoUploadItems"
                      :key="`${asset.source}-${index}`"
                      class="group relative h-16 w-16 cursor-move overflow-hidden rounded-md ring-1 ring-border/40 transition-all"
                      draggable="true"
                      @dragstart="handleVideoThumbDragStart(index)"
                      @dragover="handleVideoThumbDragOver"
                      @drop="handleVideoThumbDrop(index)"
                      @dragend="handleVideoThumbDragEnd"
                    >
                      <img
                        :src="asset.source"
                        :alt="asset.name || `参考图 ${index + 1}`"
                        class="h-full w-full cursor-pointer object-cover"
                        @click="openPreview(asset.source, asset.name || `参考图 ${index + 1}`, 'image')"
                      />
                      <span
                        class="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[10px] text-white"
                      >
                        {{ getVideoUploadItemLabel(index) || index + 1 }}
                      </span>
                      <button
                        type="button"
                        class="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                        @click.stop="clearVideoUploadItem(index)"
                      >
                        <X class="h-3 w-3" />
                      </button>
                    </div>

                    <button
                      v-if="currentVideoUploadItems.length < currentVideoUploadLimit"
                      type="button"
                      class="flex h-16 w-16 items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/25 bg-muted/50 transition-colors hover:border-muted-foreground/50 hover:bg-muted"
                      @click="pickVideoFiles()"
                    >
                      <Plus class="h-5 w-5 text-muted-foreground" />
                    </button>
                  </div>

                  <div
                    v-if="currentVideoUploadItems.length > 1"
                    class="text-[11px] text-muted-foreground"
                  >
                    拖动缩略图可调整顺序
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section class="rounded-xl border bg-card text-card-foreground shadow">
            <div class="flex flex-col space-y-1.5 p-6 pb-3">
              <h3 class="text-base font-semibold tracking-tight">参数设置</h3>
            </div>

            <div class="space-y-4 p-6 pt-0">
              <div
                v-for="row in currentVideoFieldRows"
                :key="row.map((field) => field.key).join('-')"
                :class="row.length > 1 ? 'flex flex-wrap items-start gap-3' : 'space-y-2'"
              >
                <div
                  v-for="field in row"
                  :key="field.key"
                  class="space-y-2"
                >
                  <div class="text-xs font-medium text-muted-foreground">{{ field.label }}</div>

                  <div
                    v-if="field.type === 'choice'"
                    :class="field.compact ? 'flex flex-wrap items-start gap-2' : ['grid gap-2', field.columns]"
                  >
                    <template v-if="field.preview">
                      <button
                        v-for="option in field.options"
                        :key="String(option.value)"
                        type="button"
                        :class="[
                          'flex h-10 flex-col items-center justify-center rounded-md transition-all',
                          currentVideoConfig[field.key] === option.value
                            ? 'bg-blue-500 text-white'
                            : 'bg-muted/50 text-muted-foreground hover:bg-muted',
                        ]"
                        :style="field.buttonWidthPx ? { width: `${field.buttonWidthPx}px`, minWidth: `${field.buttonWidthPx}px` } : undefined"
                        @click="store.setVideoField(field.key, option.value)"
                      >
                        <div class="flex h-4 items-end justify-center">
                          <div
                            class="rounded-[3px] border-2 border-current"
                            :style="aspectPreviewStyle(option.value)"
                          />
                        </div>
                        <span class="mt-1 text-[10px] font-medium leading-none">{{ option.label }}</span>
                      </button>
                    </template>

                    <button
                      v-else
                      v-for="option in field.options"
                      :key="String(option.value)"
                      type="button"
                      :class="[
                        'h-10 rounded-lg py-2.5 text-sm font-medium transition-all',
                        currentVideoConfig[field.key] === option.value
                          ? 'bg-blue-500 text-white'
                          : 'bg-muted/50 text-muted-foreground hover:bg-muted',
                      ]"
                      :style="field.buttonWidthPx ? { width: `${field.buttonWidthPx}px`, minWidth: `${field.buttonWidthPx}px` } : undefined"
                      @click="store.setVideoField(field.key, option.value)"
                    >
                      {{ option.label }}
                    </button>
                  </div>

                  <input
                    v-else-if="field.type === 'text'"
                    :value="String(currentVideoConfig[field.key] || '')"
                    type="text"
                    class="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    :placeholder="field.placeholder"
                    @input="store.setVideoField(field.key, ($event.target as HTMLInputElement).value)"
                  />

                  <textarea
                    v-else
                    :value="String(currentVideoConfig[field.key] || '')"
                    class="min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    :placeholder="field.placeholder"
                    @input="store.setVideoField(field.key, ($event.target as HTMLTextAreaElement).value)"
                  />
                </div>
              </div>

              <button
                type="button"
                class="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-8 text-sm font-semibold text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-primary disabled:text-primary-foreground"
                :disabled="isVideoGenerating"
                @click="handleSubmitVideo"
              >
                <LoaderCircle
                  v-if="isVideoGenerating"
                  class="h-4 w-4 animate-spin"
                />
                <Sparkles
                  v-else
                  class="h-4 w-4"
                />
                {{ isVideoGenerating ? '生成中...' : '开始生成' }}
              </button>
            </div>
          </section>

          <section class="rounded-xl border bg-card text-card-foreground shadow h-fit">
            <div class="flex flex-col space-y-1.5 p-6 pb-3">
              <h3 class="text-base font-semibold tracking-tight">生成结果</h3>
            </div>
            <div class="p-6 pt-0">
              <div
                v-if="!store.videoTask"
                class="flex aspect-video items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/50"
              >
                <div class="px-6 text-center text-muted-foreground">
                  <Video class="mx-auto mb-2 h-9 w-9 text-muted-foreground/50" />
                  <p class="text-sm font-medium">视频生成结果将在这里显示</p>
                </div>
              </div>

              <div
                v-else
                class="space-y-4"
              >
                <template v-if="store.videoTask.videoUrl && !isErrorStatus(store.videoTask.status)">
                  <div class="overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/25 bg-black">
                    <video
                      :src="store.videoTask.videoUrl"
                      controls
                      playsinline
                      class="aspect-video w-full"
                    />
                  </div>

                  <div
                    class="flex flex-wrap gap-2"
                  >
                    <button
                      type="button"
                      class="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-secondary px-3 text-sm font-medium text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80"
                      title="下载视频"
                      @click="downloadVideo(store.videoTask)"
                    >
                      <Download class="h-4 w-4" />
                      下载
                    </button>
                    <button
                      v-if="shouldShowVeoExtendButton(store.videoTask)"
                      type="button"
                      class="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-secondary px-3 text-sm font-medium text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="Boolean(getVeoExtendDisabledReason(store.videoTask))"
                      :title="getVeoExtendDisabledReason(store.videoTask) || '延长 7 秒'"
                      @click="handleExtendVeoVideo(store.videoTask)"
                    >
                      <StepForward class="h-4 w-4" />
                      延长 7s
                    </button>
                  </div>
                  <p
                    v-if="store.videoTask.error"
                    class="text-xs text-destructive"
                  >
                    {{ store.videoTask.error }}
                  </p>
                </template>

                <div
                  v-else
                  class="flex aspect-video items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/50"
                >
                  <div class="px-6 text-center text-muted-foreground">
                    <Video class="mx-auto mb-2 h-9 w-9 text-muted-foreground/50" />
                    <p class="text-sm font-medium">{{ store.videoTask.phase === 'error' ? '任务失败' : '正在生成视频' }}</p>
                    <p
                      v-if="store.videoTask.phase === 'pending'"
                      class="mt-1 font-mono text-xs text-muted-foreground"
                    >
                      {{ formatElapsed(currentVideoElapsed) }}
                    </p>
                    <p
                      v-else
                      class="mt-1 text-xs"
                    >
                      {{ store.videoTask.error || '请调整参数或切换模型后重试。' }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </template>

      <div
        v-if="visibleHistory.length > 0"
        class="mt-6 border-t pt-6"
      >
        <div class="columns-2 gap-3 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 2xl:columns-7">
          <article
            v-for="task in visibleHistory"
            :key="`${task.kind}-${task.id}`"
            class="group relative mb-4 break-inside-avoid overflow-hidden rounded-lg border bg-card transition-all hover:shadow-md"
          >
            <div
              class="cursor-pointer"
              @click="task.kind === 'image' ? openPreview(task.resultImages[0], '', 'image', true) : openPreview(task.videoUrl, '', 'video', false)"
            >
              <img
                v-if="task.kind === 'image'"
                :src="task.resultImages[0]"
                alt=""
                class="w-full transition-opacity hover:opacity-90"
                @load="setHistoryImageResolutionLabel(task, $event)"
              />
              <video
                v-else
                :src="task.videoUrl"
                muted
                playsinline
                preload="metadata"
                class="w-full bg-black transition-opacity hover:opacity-90"
                @loadedmetadata="setHistoryVideoDurationLabel(task, $event)"
              />
            </div>

            <div class="absolute bottom-1 left-1 flex flex-col items-start gap-1">
              <div class="flex flex-wrap gap-1">
                <span
                  v-if="task.kind === 'image' ? formatImageResolutionLabel(task) : formatVideoDurationLabel(task)"
                  class="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white"
                >
                  {{
                    task.kind === 'image'
                      ? formatImageResolutionLabel(task)
                      : formatVideoDurationLabel(task)
                  }}
                </span>
              </div>
              <div class="flex flex-wrap gap-1">
                <span class="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                  {{
                    task.kind === 'image'
                      ? IMAGE_MODELS.find((model) => model.id === task.model)?.name || task.model
                      : task.modelTitle
                  }}
                </span>
                <span class="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                  {{
                    task.kind === 'image'
                      ? formatElapsed(task.generationTime)
                      : formatElapsed((task.updatedAt || task.createdAt) - task.createdAt)
                  }}
                </span>
              </div>
            </div>

            <div class="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                class="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-secondary text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80"
                title="加载配置"
                @click.stop="loadGalleryItemConfig(task)"
              >
                <Copy class="h-3 w-3" />
              </button>
              <button
                v-if="task.kind === 'image'"
                type="button"
                class="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-secondary text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80"
                title="继续编辑"
                @click.stop="store.continueWithResult(task.resultImages[0])"
              >
                <Pencil class="h-3 w-3" />
              </button>
              <button
                v-if="task.kind === 'video' && shouldShowVeoExtendButton(task)"
                type="button"
                class="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-secondary text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="Boolean(getVeoExtendDisabledReason(task))"
                :title="getVeoExtendDisabledReason(task) || '延长 7 秒'"
                @click.stop="handleExtendVeoVideo(task)"
              >
                <StepForward class="h-3 w-3" />
              </button>
              <button
                v-if="task.kind === 'video'"
                type="button"
                class="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-secondary text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80"
                title="下载"
                @click.stop="downloadVideo(task)"
              >
                <Download class="h-3 w-3" />
              </button>
              <button
                type="button"
                class="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-secondary text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80"
                title="删除"
                @click.stop="removeGalleryItem(task)"
              >
                <Trash2 class="h-3 w-3" />
              </button>
            </div>
          </article>
        </div>
      </div>
    </main>

    <SettingsModal
      :open="settingsOpen"
      @close="settingsOpen = false"
    />

    <MediaModal
      :open="Boolean(previewImage)"
      :src="previewImage"
      :title="previewTitle"
      :show-continue="previewCanContinue"
      :show-download="previewKind !== 'prompt'"
      @close="closePreview"
      @continue="continueFromPreview"
      @download="handlePreviewDownload"
    />
  </div>
</template>
