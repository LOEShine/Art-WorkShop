<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  BookOpen,
  Bot,
  Camera,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Cpu,
  Download,
  Image as ImageIcon,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rotate3d,
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
import MultiAngleThreePreview from "@/components/MultiAngleThreePreview.vue";
import SettingsModal from "@/components/SettingsModal.vue";
import {
  createDefaultImageConfigs,
  IMAGE_MODELS,
  IMAGE_UPLOAD_LIMITS,
} from "@/data/image-models";
import { STARTER_PROMPTS } from "@/data/starter-prompts";
import {
  createDefaultVideoConfigs,
  getHailuoDurationOptions,
  getSeedanceDurationOptions,
  getVeoReferenceImageNames,
  getVeoReferenceImages,
  getSoraDurationOptions,
  getVideoUploadLimit,
  isFirstLastFramesEnabled,
  MAX_VEO_REFERENCE_IMAGES,
  resolveVideoMode,
  SEEDANCE_RATIO_OPTIONS,
  supportsFirstLastFrames,
  VIDEO_MODELS,
} from "@/data/video-models";
import {
  CODEX_IMAGE_API_BASE_URL,
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

interface CameraParameterSelection {
  cameraType: string;
  focalLength: string;
  aperture: string;
  filterStyle: string;
}

interface CameraParameterColumn {
  key: keyof CameraParameterSelection;
  title: string;
  options: string[];
}

interface ViewRotationSettings {
  target: "subject" | "camera";
  rotation: number;
  tilt: number;
  zoom: number;
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
const CAMERA_PARAMETER_COLUMNS: CameraParameterColumn[] = [
  {
    key: "cameraType",
    title: "相机类型",
    options: ["富士系列", "哈苏系列", "徕卡系列", "ARRI 电影机", "RED 电影机", "索尼", "佳能", "尼康", "手机镜头", "无人机镜头模拟"],
  },
  {
    key: "focalLength",
    title: "焦距",
    options: ["8mm", "16mm", "24mm", "35mm", "50mm", "85mm", "100mm", "125mm", "135mm", "200mm"],
  },
  {
    key: "aperture",
    title: "光圈",
    options: ["f/8.0", "f/11", "f/16"],
  },
  {
    key: "filterStyle",
    title: "滤镜风格",
    options: ["黑白风格", "复古风格", "电影颗粒风格", "高对比度风格", "低饱和风格", "夜景风格", "人像风格", "风光风格"],
  },
];
const DEFAULT_CAMERA_PARAMETERS: CameraParameterSelection = {
  cameraType: "富士系列",
  focalLength: "8mm",
  aperture: "f/8.0",
  filterStyle: "黑白风格",
};
const DEFAULT_VIEW_ROTATION: ViewRotationSettings = {
  target: "subject",
  rotation: 0,
  tilt: 0,
  zoom: 5,
};
const VIEW_ROTATION_VERTICAL_MIN = -30;
const VIEW_ROTATION_VERTICAL_MAX = 60;
const VIEW_ROTATION_DISTANCE_MIN = 1;
const VIEW_ROTATION_DISTANCE_MAX = 8;

const imageInput = ref<HTMLInputElement | null>(null);
const videoInput = ref<HTMLInputElement | null>(null);
const settingsOpen = ref(false);
const previewImage = ref("");
const previewTitle = ref("");
const previewKind = ref<"image" | "video" | "prompt">("image");
const previewCanContinue = ref(false);
const previewItems = ref<string[]>([]);
const previewIndex = ref(0);
const previewTitlePrefix = ref("");
const activeResultImageIndex = ref(0);
const currentImageElapsed = ref(0);
const currentVideoElapsed = ref(0);
const historyImageResolutionLabels = ref<Record<string, string>>({});
const historyVideoResolutionLabels = ref<Record<string, string>>({});
const historyVideoDurationLabels = ref<Record<string, string>>({});
const optimizingPrompt = ref(false);
const submittingVideo = ref(false);
const promptTextarea = ref<HTMLTextAreaElement | null>(null);
const promptSystemRow = ref<HTMLElement | null>(null);
const promptSystemInlineOffset = ref("0px");
const cameraParametersEnabled = ref(false);
const cameraParametersOpen = ref(false);
const cameraSummaryOpen = ref(false);
const cameraParameterReferenceEnabled = ref(false);
const cameraParameterReferenceOpen = ref(false);
const cameraParameterReferencePinned = ref(false);
const cameraParameters = ref<CameraParameterSelection>({ ...DEFAULT_CAMERA_PARAMETERS });
const cameraParameterDraft = ref<CameraParameterSelection>({ ...DEFAULT_CAMERA_PARAMETERS });
const viewRotationEnabled = ref(false);
const viewRotationOpen = ref(false);
const viewRotationSummaryOpen = ref(false);
const viewRotationReferenceEnabled = ref(false);
const viewRotationReferenceOpen = ref(false);
const viewRotationReferencePinned = ref(false);
const viewRotation = ref<ViewRotationSettings>({ ...DEFAULT_VIEW_ROTATION });
const viewRotationDraft = ref<ViewRotationSettings>({ ...DEFAULT_VIEW_ROTATION });
const draggingImageIndex = ref<number | null>(null);
const draggingVideoIndex = ref<number | null>(null);
const videoUploadTargetIndex = ref<number | null>(null);

let imageTimer: number | undefined;
let videoTimer: number | undefined;
let videoPollTimer: number | undefined;
const cameraWheelScrollTimers: Partial<Record<keyof CameraParameterSelection, number>> = {};
const cameraWheelAnimationFrames: Partial<Record<keyof CameraParameterSelection, number>> = {};
const cameraWheelScrollTargets: Partial<Record<keyof CameraParameterSelection, number>> = {};

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
const currentResultImages = computed(() =>
  store.currentTask?.status === "success" ? store.currentTask.resultImages : [],
);
const activeResultImage = computed(
  () => currentResultImages.value[activeResultImageIndex.value] || currentResultImages.value[0] || "",
);
const promptShimmerText = computed(() =>
  optimizingPrompt.value
    ? store.prompt.trim() || "正在生成随机提示词..."
    : "",
);
const cameraParameterSummaryRows = computed(() =>
  CAMERA_PARAMETER_COLUMNS.map((column) => ({
    label: column.title,
    value: cameraParameters.value[column.key],
  })),
);
const cameraParameterPrompt = computed(() => {
  if (!cameraParametersEnabled.value) {
    return "";
  }

  const hasReference = cameraParameterReferenceEnabled.value && viewRotationReferenceImage.value;
  const settingsText = `${cameraParameters.value.cameraType}，${cameraParameters.value.focalLength}焦距，${cameraParameters.value.aperture}光圈，${cameraParameters.value.filterStyle}滤镜`;
  if (hasReference && !viewRotationReferenceEnabled.value) {
    return `将参考图1的相机设定改为${settingsText}`;
  }
  return `相机设定：${settingsText}`;
});
const viewRotationReferenceImage = computed(() => store.uploadedImages[0] || "");
const viewRotationDraftDescription = computed(() => getViewRotationDescription(viewRotationDraft.value));
const hasPromptSystemTokens = computed(() => cameraParametersEnabled.value || viewRotationEnabled.value);
const viewRotationSummaryRows = computed(() => [
  { label: "视角", value: getViewRotationDescription(viewRotation.value) },
  { label: "相机位置", value: getViewRotationCameraPositionDescription(viewRotation.value) },
  {
    label: "数值",
    value: `水平 ${viewRotation.value.rotation}°，垂直 ${viewRotation.value.tilt}°，远近 ${getViewRotationZoomLabel(viewRotation.value.zoom)}`,
  },
]);
const viewRotationPrompt = computed(() => {
  if (!viewRotationEnabled.value) {
    return "";
  }

  const promptDescription = getViewRotationPromptDescription(viewRotation.value);
  if (viewRotationReferenceEnabled.value && viewRotationReferenceImage.value) {
    return `将参考图1改变角度，将相机旋转到${promptDescription}`;
  }
  return `改变角度，将相机旋转到${promptDescription}`;
});
const canGenerateImage = computed(() => buildEffectiveImagePrompt().length > 0 && !store.isGenerating);
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
    const hailuoDurationOptions = getHailuoDurationOptions(config);
    return [
      {
        key: "resolution",
        label: "分辨率",
        type: "choice",
        columns: "grid-cols-2",
        options: [
          { value: "768P", label: "768P" },
          { value: "1080P", label: "1080P" },
        ],
      },
      {
        key: "duration",
        label: "时长",
        type: "choice",
        columns: hailuoDurationOptions.length === 1 ? "grid-cols-1" : "grid-cols-2",
        options: hailuoDurationOptions.map((value) => ({ value, label: `${value}s` })),
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
      {
        key: "resolution",
        label: "分辨率",
        type: "choice" as const,
        compact: true,
        buttonWidthPx: 92,
        options: [
          { value: "480p", label: "480p" },
          { value: "720p", label: "720p" },
          { value: "1080p", label: "1080p" },
        ],
      },
      {
        key: "ratio",
        label: "比例",
        type: "choice" as const,
        compact: true,
        preview: true,
        buttonWidthPx: 78,
        options: SEEDANCE_RATIO_OPTIONS.map((value) => ({
          value,
          label: value === "adaptive" ? "自适应" : value,
        })),
      },
      {
        key: "duration",
        label: "时长",
        type: "choice" as const,
        compact: true,
        buttonWidthPx: 52,
        options: getSeedanceDurationOptions().map((value) => ({ value, label: `${value}s` })),
      },
      {
        key: "generateAudio",
        label: "音频",
        type: "choice" as const,
        compact: true,
        buttonWidthPx: 72,
        options: [
          { value: true, label: "开启" },
          { value: false, label: "关闭" },
        ],
      },
      {
        key: "camerafixed",
        label: "固定镜头",
        type: "choice" as const,
        compact: true,
        buttonWidthPx: 72,
        options: [
          { value: false, label: "关闭" },
          { value: true, label: "开启" },
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

  if (store.selectedVideoModel === "seedance") {
    const generateAudioField = fields.find((field) => field.key === "generateAudio");
    const cameraFixedField = fields.find((field) => field.key === "camerafixed");
    if (!generateAudioField || !cameraFixedField) {
      return fields.map((field) => [field]);
    }

    return fields.reduce<DynamicField[][]>((rows, field) => {
      if (field.key === "generateAudio") {
        rows.push([generateAudioField, cameraFixedField]);
        return rows;
      }

      if (field.key !== "camerafixed") {
        rows.push([field]);
      }

      return rows;
    }, []);
  }

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
  const resolution = video.videoWidth && video.videoHeight ? `${video.videoWidth}×${video.videoHeight}` : "";
  const historyKey = getGalleryHistoryKey(task);

  if (label) {
    historyVideoDurationLabels.value = {
      ...historyVideoDurationLabels.value,
      [historyKey]: label,
    };
  }

  if (resolution) {
    historyVideoResolutionLabels.value = {
      ...historyVideoResolutionLabels.value,
      [historyKey]: resolution,
    };
  }
}

function formatImageResolutionLabel(task: GalleryHistoryItem) {
  if (task.kind !== "image") {
    return "";
  }

  const historyKey = getGalleryHistoryKey(task);
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

function getHistoryImagePreview(task: GalleryHistoryItem) {
  return task.kind === "image" ? task.resultImages[0] || "" : "";
}

function getHistoryImageStackItems(task: GalleryHistoryItem) {
  if (task.kind !== "image") {
    return [];
  }

  return task.resultImages.slice(0, 5);
}

function getHistoryImageStackStyle(index: number) {
  const offsets = [
    { x: 0, y: 16, rotate: -1.5 },
    { x: 9, y: 10, rotate: 2.5 },
    { x: 18, y: 5, rotate: -3 },
    { x: 27, y: 0, rotate: 4 },
    { x: 37, y: 10, rotate: 8 },
  ];
  const item = offsets[index] || offsets[offsets.length - 1];

  return {
    transform: `translate(${item.x}px, ${item.y}px) rotate(${item.rotate}deg)`,
    zIndex: String(index),
  };
}

function getHistoryImageCountLabel(task: GalleryHistoryItem) {
  return task.kind === "image" && task.resultImages.length > 1
    ? `${task.resultImages.length}张`
    : "";
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

function formatVideoResolutionLabel(task: VideoTask) {
  const historyKey = `video-${task.id}`;
  const actualResolution = historyVideoResolutionLabels.value[historyKey];
  if (actualResolution) {
    return actualResolution;
  }

  return String(task.modelConfig?.resolution || "").trim();
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
  () => store.currentTask?.id,
  () => {
    activeResultImageIndex.value = 0;
  },
);

watch(currentResultImages, (images) => {
  if (activeResultImageIndex.value >= images.length) {
    activeResultImageIndex.value = Math.max(images.length - 1, 0);
  }
});

watch(
  () => [
    cameraParametersEnabled.value,
    cameraParameterReferenceEnabled.value,
    viewRotationEnabled.value,
    viewRotationReferenceEnabled.value,
    viewRotationReferenceImage.value,
  ] as const,
  () => {
    if (!viewRotationReferenceImage.value) {
      cameraParameterReferenceEnabled.value = false;
      cameraParameterReferenceOpen.value = false;
      cameraParameterReferencePinned.value = false;
      viewRotationReferenceEnabled.value = false;
      viewRotationReferenceOpen.value = false;
      viewRotationReferencePinned.value = false;
    }
    updatePromptSystemInlineOffset();
  },
  { flush: "post" },
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

function clampIndex(index: number, length: number) {
  if (length <= 0) {
    return 0;
  }

  return Math.min(Math.max(index, 0), length - 1);
}

function setActiveResultImage(index: number) {
  activeResultImageIndex.value = clampIndex(index, currentResultImages.value.length);
}

function showPreviousResultImage() {
  const length = currentResultImages.value.length;
  if (length <= 1) {
    return;
  }

  activeResultImageIndex.value = (activeResultImageIndex.value - 1 + length) % length;
}

function showNextResultImage() {
  const length = currentResultImages.value.length;
  if (length <= 1) {
    return;
  }

  activeResultImageIndex.value = (activeResultImageIndex.value + 1) % length;
}

function openPreview(src: string, title = "", kind: "image" | "video" | "prompt" = "image", canContinue = false) {
  previewImage.value = src;
  previewTitle.value = title;
  previewKind.value = kind;
  previewCanContinue.value = canContinue;
  previewItems.value = kind === "image" && src ? [src] : [];
  previewIndex.value = 0;
  previewTitlePrefix.value = title;
}

function setPreviewIndex(index: number) {
  const items = previewItems.value;
  if (items.length === 0) {
    return;
  }

  const nextIndex = clampIndex(index, items.length);
  previewIndex.value = nextIndex;
  previewImage.value = items[nextIndex];
  if (items.length > 1) {
    previewTitle.value = `${previewTitlePrefix.value || "结果"} ${nextIndex + 1}/${items.length}`;
  }
}

function showPreviousPreviewImage() {
  const items = previewItems.value;
  if (items.length <= 1) {
    return;
  }

  setPreviewIndex((previewIndex.value - 1 + items.length) % items.length);
}

function showNextPreviewImage() {
  const items = previewItems.value;
  if (items.length <= 1) {
    return;
  }

  setPreviewIndex((previewIndex.value + 1) % items.length);
}

function openImageGallery(images: string[], index = 0, titlePrefix = "结果") {
  const items = images.filter(Boolean);
  if (items.length === 0) {
    return;
  }

  previewKind.value = "image";
  previewCanContinue.value = true;
  previewItems.value = items;
  previewTitlePrefix.value = titlePrefix;
  setPreviewIndex(index);
}

function openImageHistoryPreview(task: GalleryHistoryItem) {
  if (task.kind !== "image") {
    return;
  }

  openImageGallery(task.resultImages, 0);
}

function closePreview() {
  previewImage.value = "";
  previewTitle.value = "";
  previewCanContinue.value = false;
  previewItems.value = [];
  previewIndex.value = 0;
  previewTitlePrefix.value = "";
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

function downloadImageSet(images: string[]) {
  images.filter(Boolean).forEach((image, index) => downloadImage(image, index + 1));
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
    const lower = normalized.toLowerCase();
    if (normalized === "自动" || normalized === "默认" || lower === "auto" || lower === "adaptive" || lower === "default") {
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
  promptTextarea.value.style.height = `${Math.max(96, promptTextarea.value.scrollHeight)}px`;
}

function updatePromptSystemInlineOffset() {
  nextTick(() => {
    const rowWidth = promptSystemRow.value?.getBoundingClientRect().width ?? 0;
    promptSystemInlineOffset.value = rowWidth ? `${Math.ceil(rowWidth + 20)}px` : "0px";
    window.requestAnimationFrame(ensureTextareaHeight);
  });
}

function updatePrompt(prompt: string) {
  store.setPrompt(prompt);
  window.requestAnimationFrame(ensureTextareaHeight);
}

function handlePromptKeydown(event: KeyboardEvent) {
  if (!hasPromptSystemTokens.value || (event.key !== "Backspace" && event.key !== "Delete")) {
    return;
  }

  const target = event.currentTarget;
  if (!(target instanceof HTMLTextAreaElement)) {
    return;
  }

  if (target.selectionStart === 0 && target.selectionEnd === 0) {
    event.preventDefault();
    if (viewRotationEnabled.value) {
      removeViewRotation();
      return;
    }
    removeCameraParameters();
  }
}

function removeCameraParameters() {
  if (cameraParameterReferenceEnabled.value) {
    cameraParameterReferenceEnabled.value = false;
    cameraParameterReferenceOpen.value = false;
    cameraParameterReferencePinned.value = false;
    updatePromptSystemInlineOffset();
    return;
  }

  cameraParametersEnabled.value = false;
  cameraSummaryOpen.value = false;
  updatePromptSystemInlineOffset();
}

function removeViewRotation() {
  if (viewRotationReferenceEnabled.value) {
    viewRotationReferenceEnabled.value = false;
    viewRotationReferenceOpen.value = false;
    viewRotationReferencePinned.value = false;
    updatePromptSystemInlineOffset();
    return;
  }

  viewRotationEnabled.value = false;
  viewRotationSummaryOpen.value = false;
  viewRotationReferenceOpen.value = false;
  viewRotationReferencePinned.value = false;
  updatePromptSystemInlineOffset();
}

function openViewRotationReferencePreview() {
  if (!viewRotationReferenceImage.value) {
    return;
  }

  openPreview(viewRotationReferenceImage.value, "参考图1");
}

function showViewRotationReferencePreview() {
  viewRotationReferenceOpen.value = true;
}

function hideViewRotationReferencePreview() {
  if (!viewRotationReferencePinned.value) {
    viewRotationReferenceOpen.value = false;
  }
}

function toggleViewRotationReferencePreview() {
  if (viewRotationReferencePinned.value) {
    viewRotationReferencePinned.value = false;
    viewRotationReferenceOpen.value = false;
    return;
  }

  viewRotationReferencePinned.value = true;
  viewRotationReferenceOpen.value = true;
}

function showCameraParameterReferencePreview() {
  cameraParameterReferenceOpen.value = true;
}

function hideCameraParameterReferencePreview() {
  if (!cameraParameterReferencePinned.value) {
    cameraParameterReferenceOpen.value = false;
  }
}

function toggleCameraParameterReferencePreview() {
  if (cameraParameterReferencePinned.value) {
    cameraParameterReferencePinned.value = false;
    cameraParameterReferenceOpen.value = false;
    return;
  }

  cameraParameterReferencePinned.value = true;
  cameraParameterReferenceOpen.value = true;
}

function getViewRotationTargetLabel(target: ViewRotationSettings["target"]) {
  return target === "camera" ? "自由视角" : "标准控件";
}

function getViewRotationHorizontalLabel(rotation: number) {
  const normalized = normalizeDegrees360(rotation);
  const labels = [
    "正面视角",
    "右前方偏正面视角",
    "右前侧四分之三视角",
    "右前方偏侧面视角",
    "右侧视角",
    "右后方偏侧面视角",
    "右后侧四分之三视角",
    "右后方偏背面视角",
    "背面视角",
    "左后方偏背面视角",
    "左后侧四分之三视角",
    "左后方偏侧面视角",
    "左侧视角",
    "左前方偏侧面视角",
    "左前侧四分之三视角",
    "左前方偏正面视角",
  ];
  return labels[Math.floor((normalized + 11.25) / 22.5) % labels.length];
}

function getViewRotationPromptHorizontalLabel(rotation: number) {
  const normalized = normalizeDegrees360(rotation);
  const labels = [
    "正面视图",
    "右前方偏正面的视图",
    "右前方四分之三视图",
    "右前方偏侧面的视图",
    "从主体正右侧拍摄的侧面视图",
    "右后方偏侧面的视图",
    "右后方四分之三视图",
    "右后方偏背面的视图",
    "背面视图",
    "左后方偏背面的视图",
    "左后方四分之三视图",
    "左后方偏侧面的视图",
    "从主体正左侧拍摄的侧面视图",
    "左前方偏侧面的视图",
    "左前方四分之三视图",
    "左前方偏正面的视图",
  ];
  return labels[Math.floor((normalized + 11.25) / 22.5) % labels.length];
}

function getViewRotationVerticalLabel(tilt: number) {
  if (tilt < -22) {
    return "极低机位仰视";
  }
  if (tilt < -8) {
    return "低机位仰视";
  }
  if (tilt < 8) {
    return "平视机位";
  }
  if (tilt < 22) {
    return "轻微俯视";
  }
  if (tilt < 38) {
    return "高机位俯视";
  }
  if (tilt < 52) {
    return "强俯视";
  }
  return "接近顶视";
}

function getViewRotationZoomLabel(zoom: number) {
  return zoom.toFixed(1);
}

function getViewRotationShotLabel(zoom: number) {
  if (zoom < 1.8) {
    return "超远景";
  }
  if (zoom < 3.2) {
    return "远景";
  }
  if (zoom < 5.2) {
    return "中景";
  }
  if (zoom < 6.8) {
    return "近景";
  }
  return "特写";
}

function getViewRotationHorizontalPositionLabel(rotation: number) {
  const normalized = normalizeDegrees360(rotation);
  const labels = [
    "正前方",
    "右前方偏正面",
    "右前方",
    "右前方偏侧面",
    "正右方",
    "右后方偏侧面",
    "右后方",
    "右后方偏背面",
    "正后方",
    "左后方偏背面",
    "左后方",
    "左后方偏侧面",
    "正左方",
    "左前方偏侧面",
    "左前方",
    "左前方偏正面",
  ];
  return labels[Math.floor((normalized + 11.25) / 22.5) % labels.length];
}

function getViewRotationHeightPositionLabel(tilt: number) {
  if (tilt < -22) {
    return "极低处";
  }
  if (tilt < -8) {
    return "低处";
  }
  if (tilt < 8) {
    return "平视高度";
  }
  if (tilt < 22) {
    return "略高处";
  }
  if (tilt < 38) {
    return "高处";
  }
  if (tilt < 52) {
    return "很高处";
  }
  return "接近正上方";
}

function getViewRotationDistancePositionLabel(zoom: number) {
  if (zoom < 1.8) {
    return "很远距离";
  }
  if (zoom < 3.2) {
    return "远距离";
  }
  if (zoom < 5.2) {
    return "中等距离";
  }
  if (zoom < 6.8) {
    return "近距离";
  }
  return "贴近主体";
}

function getViewRotationCameraPositionDescription(settings: ViewRotationSettings) {
  return `相机位于主体${getViewRotationHorizontalPositionLabel(settings.rotation)}、${getViewRotationHeightPositionLabel(settings.tilt)}、${getViewRotationDistancePositionLabel(settings.zoom)}，镜头朝向主体中心`;
}

function getViewRotationDescription(settings: ViewRotationSettings) {
  return [
    getViewRotationHorizontalLabel(settings.rotation),
    getViewRotationVerticalLabel(settings.tilt),
    getViewRotationShotLabel(settings.zoom),
  ].join("，");
}

function getViewRotationPromptDescription(settings: ViewRotationSettings) {
  return [
    getViewRotationPromptHorizontalLabel(settings.rotation),
    getViewRotationVerticalLabel(settings.tilt),
    getViewRotationShotLabel(settings.zoom),
  ].join("，");
}

function normalizeDegrees360(degrees: number) {
  let normalized = degrees;
  while (normalized >= 360) {
    normalized -= 360;
  }
  while (normalized < 0) {
    normalized += 360;
  }
  return normalized;
}

function buildEffectiveImagePrompt() {
  const prompt = store.prompt.trim();
  const cameraPrompt = cameraParameterPrompt.value;
  const rotationPrompt = viewRotationPrompt.value;
  return [rotationPrompt, cameraPrompt, prompt].filter(Boolean).join("\n");
}

function hasBoundReferenceImage() {
  if (!viewRotationReferenceImage.value) {
    return false;
  }

  return (
    (cameraParametersEnabled.value && cameraParameterReferenceEnabled.value) ||
    (viewRotationEnabled.value && viewRotationReferenceEnabled.value)
  );
}

function buildEffectiveSourceImages() {
  if (!store.uploadedImages.length) {
    return [];
  }

  if (hasBoundReferenceImage()) {
    return [store.uploadedImages[0]];
  }

  return [...store.uploadedImages];
}

function openCameraParameters() {
  cameraParameterDraft.value = { ...cameraParameters.value };
  cameraParametersOpen.value = true;
  cameraSummaryOpen.value = false;
  nextTick(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(scrollCameraParameterWheels);
    });
  });
}

function closeCameraParameters() {
  cameraParametersOpen.value = false;
}

function confirmCameraParameters() {
  cameraParameters.value = { ...cameraParameterDraft.value };
  cameraParametersEnabled.value = true;
  cameraParameterReferenceEnabled.value = Boolean(viewRotationReferenceImage.value);
  cameraParametersOpen.value = false;
  cameraSummaryOpen.value = false;
  cameraParameterReferenceOpen.value = false;
  cameraParameterReferencePinned.value = false;
  updatePromptSystemInlineOffset();
}

function openViewRotation() {
  viewRotationDraft.value = { ...viewRotation.value };
  viewRotationOpen.value = true;
}

function closeViewRotation() {
  viewRotationOpen.value = false;
}

function confirmViewRotation() {
  viewRotation.value = { ...viewRotationDraft.value };
  viewRotationEnabled.value = true;
  viewRotationReferenceEnabled.value = Boolean(viewRotationReferenceImage.value);
  viewRotationOpen.value = false;
  viewRotationSummaryOpen.value = false;
  viewRotationReferenceOpen.value = false;
  viewRotationReferencePinned.value = false;
  updatePromptSystemInlineOffset();
}

function resetViewRotation() {
  viewRotationDraft.value = {
    ...DEFAULT_VIEW_ROTATION,
    target: viewRotationDraft.value.target,
  };
}

function scrollCameraParameterWheels() {
  for (const column of CAMERA_PARAMETER_COLUMNS) {
    const wheel = document.querySelector<HTMLElement>(`[data-camera-wheel-scroll-key="${column.key}"]`);
    const active = wheel?.querySelector<HTMLElement>("[data-camera-option-active='true']");
    if (!wheel || !active) {
      continue;
    }

    snapCameraWheelToOption(wheel, active, false, column.key);
  }
}

function selectCameraParameter(key: keyof CameraParameterSelection, value: string, event?: Event) {
  cameraParameterDraft.value = {
    ...cameraParameterDraft.value,
    [key]: value,
  };

  const target = event?.currentTarget;
  if (target instanceof HTMLElement) {
    const wheel = target.closest<HTMLElement>("[data-camera-wheel-scroll-key]");
    if (wheel) {
      snapCameraWheelToOption(wheel, target, true, key);
    }
  }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getCameraWheelMaxScroll(wheel: HTMLElement) {
  return Math.max(0, wheel.scrollHeight - wheel.clientHeight);
}

function getCameraWheelOptionHeight(wheel: HTMLElement) {
  return wheel.querySelector<HTMLElement>("[data-camera-option-value]")?.clientHeight || 36;
}

function getClosestCameraWheelOption(wheel: HTMLElement) {
  const wheelCenter = wheel.scrollTop + wheel.clientHeight / 2;
  const options = Array.from(wheel.querySelectorAll<HTMLElement>("[data-camera-option-value]"));
  return options.reduce<HTMLElement | null>((current, option) => {
    const optionCenter = option.offsetTop + option.clientHeight / 2;
    if (!current) {
      return option;
    }

    const currentCenter = current.offsetTop + current.clientHeight / 2;
    return Math.abs(optionCenter - wheelCenter) < Math.abs(currentCenter - wheelCenter) ? option : current;
  }, null);
}

function animateCameraWheelTo(
  key: keyof CameraParameterSelection,
  wheel: HTMLElement,
  targetTop: number,
  durationMs = 180,
) {
  const target = clampNumber(targetTop, 0, getCameraWheelMaxScroll(wheel));
  const startTop = wheel.scrollTop;
  const startTime = performance.now();

  if (cameraWheelAnimationFrames[key]) {
    window.cancelAnimationFrame(cameraWheelAnimationFrames[key]);
  }

  cameraWheelScrollTargets[key] = target;

  const step = (now: number) => {
    const progress = clampNumber((now - startTime) / durationMs, 0, 1);
    const easedProgress = 1 - Math.pow(1 - progress, 3);
    wheel.scrollTop = startTop + (target - startTop) * easedProgress;

    if (progress < 1) {
      cameraWheelAnimationFrames[key] = window.requestAnimationFrame(step);
      return;
    }

    wheel.scrollTop = target;
    delete cameraWheelAnimationFrames[key];
  };

  cameraWheelAnimationFrames[key] = window.requestAnimationFrame(step);
}

function snapCameraWheelToOption(
  wheel: HTMLElement,
  option: HTMLElement,
  smooth = true,
  key?: keyof CameraParameterSelection,
) {
  const targetTop = option.offsetTop - (wheel.clientHeight - option.clientHeight) / 2;
  const target = clampNumber(targetTop, 0, getCameraWheelMaxScroll(wheel));

  if (!smooth) {
    const previousScrollBehavior = wheel.style.scrollBehavior;
    if (key && cameraWheelAnimationFrames[key]) {
      window.cancelAnimationFrame(cameraWheelAnimationFrames[key]);
      delete cameraWheelAnimationFrames[key];
    }
    wheel.style.scrollBehavior = "auto";
    wheel.scrollTop = target;
    wheel.style.scrollBehavior = previousScrollBehavior;
    if (key) {
      cameraWheelScrollTargets[key] = target;
    }
    return;
  }

  if (key) {
    animateCameraWheelTo(key, wheel, target);
    return;
  }

  wheel.scrollTo({
    top: target,
    behavior: "smooth",
  });
}

function scheduleCameraWheelSnap(column: CameraParameterColumn, wheel: HTMLElement, delayMs = 120) {
  const existingTimer = cameraWheelScrollTimers[column.key];
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  cameraWheelScrollTimers[column.key] = window.setTimeout(() => {
    const closest = getClosestCameraWheelOption(wheel);
    const value = closest?.dataset.cameraOptionValue;
    if (value) {
      cameraParameterDraft.value = {
        ...cameraParameterDraft.value,
        [column.key]: value,
      };
      if (closest) {
        snapCameraWheelToOption(wheel, closest, true, column.key);
      }
    }
  }, delayMs);
}

function handleCameraWheelScroll(column: CameraParameterColumn, event: Event) {
  const wheel = event.currentTarget;
  if (!(wheel instanceof HTMLElement)) {
    return;
  }

  if (!cameraWheelAnimationFrames[column.key]) {
    cameraWheelScrollTargets[column.key] = wheel.scrollTop;
  }
  scheduleCameraWheelSnap(column, wheel);
}

function handleCameraWheelWheel(column: CameraParameterColumn, event: WheelEvent) {
  const wheel = event.currentTarget;
  if (!(wheel instanceof HTMLElement)) {
    return;
  }

  const direction = Math.sign(event.deltaY || event.deltaX);
  if (!direction) {
    return;
  }

  event.preventDefault();
  const optionHeight = getCameraWheelOptionHeight(wheel);
  const baseTop = cameraWheelScrollTargets[column.key] ?? wheel.scrollTop;
  const targetTop = clampNumber(baseTop + direction * optionHeight, 0, getCameraWheelMaxScroll(wheel));
  animateCameraWheelTo(column.key, wheel, targetTop, 170);
  scheduleCameraWheelSnap(column, wheel, 220);
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
  const imagePrompt = buildEffectiveImagePrompt();
  const sourceImages = buildEffectiveSourceImages();
  const task = createImageTask({
    createdAt: startedAt,
    status: "generating",
    sourceImages,
    prompt: imagePrompt,
    model: store.selectedImageModel,
    modelConfig: { ...currentImageConfig.value },
    resultImages: [],
    generationTime: 0,
  });

  store.setCurrentTask(task);
  store.setIsGenerating(true);

  try {
    const usesCodexImageKey = store.selectedImageModel === "codex-image-2";
    const result = await generateImage({
      model: store.selectedImageModel,
      prompt: imagePrompt,
      sourceImages,
      config: currentImageConfig.value,
      apiBaseUrl: usesCodexImageKey ? CODEX_IMAGE_API_BASE_URL : store.apiBaseUrl,
      apiKey: usesCodexImageKey ? store.codexApiKey : store.apiKey,
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
    downloadImage(previewImage.value, previewIndex.value);
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
  for (const timer of Object.values(cameraWheelScrollTimers)) {
    if (timer) {
      window.clearTimeout(timer);
    }
  }
  for (const frame of Object.values(cameraWheelAnimationFrames)) {
    if (frame) {
      window.cancelAnimationFrame(frame);
    }
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
      <div class="mb-6 flex justify-center">
        <div
          class="mode-switch"
          :data-mode="store.generationMode"
        >
          <div class="mode-switch-thumb" />
          <button
            type="button"
            class="mode-switch-button"
            :class="store.generationMode === 'image' ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="store.setGenerationMode('image')"
          >
            <ImageIcon class="h-4 w-4" />
            图片
          </button>
          <button
            type="button"
            class="mode-switch-button"
            :class="store.generationMode === 'video' ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="store.setGenerationMode('video')"
          >
            <Video class="h-4 w-4" />
            视频
          </button>
        </div>
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
                        class="h-full w-full cursor-pointer bg-muted/40 object-contain"
                        @click="openPreview(image, `参考图 ${index + 1}`, 'image')"
                      />
                      <span class="absolute bottom-1 left-1 inline-flex h-4 w-4 items-center justify-center rounded bg-black/60 text-[10px] font-medium leading-none text-white">
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
                    class="image-option-grid image-option-grid--preview"
                  >
                    <button
                      v-for="option in field.options"
                      :key="String(option.value)"
                      type="button"
                      class="image-option-button image-option-button--preview"
                      :class="currentImageConfig[field.key] === option.value ? 'bg-blue-500 text-white' : 'bg-muted/50 text-muted-foreground hover:bg-muted'"
                      @click="store.setImageModelConfig(store.selectedImageModel, field.key, option.value)"
                    >
                      <div class="flex h-5 items-end justify-center">
                        <div
                          class="rounded-[3px] border-2 border-current"
                          :style="aspectPreviewStyle(option.value)"
                        />
                      </div>
                      <span class="image-option-label mt-1 text-[10px] font-medium">{{ option.label }}</span>
                    </button>
                  </div>

                  <div
                    v-else-if="field.compact"
                    class="image-option-grid image-option-grid--compact"
                  >
                    <button
                      v-for="option in field.options"
                      :key="String(option.value)"
                      type="button"
                      class="image-option-button image-option-button--compact"
                      :class="currentImageConfig[field.key] === option.value ? 'bg-blue-500 text-white' : 'bg-muted/50 hover:bg-muted'"
                      @click="store.setImageModelConfig(store.selectedImageModel, field.key, option.value)"
                    >
                      {{ option.label }}
                    </button>
                  </div>

                  <div
                    v-else
                    class="image-option-grid image-option-grid--plain"
                  >
                    <button
                      v-for="option in field.options"
                      :key="String(option.value)"
                      type="button"
                      class="image-option-button image-option-button--plain"
                      :class="currentImageConfig[field.key] === option.value ? 'bg-blue-500 text-white' : 'bg-muted/50 hover:bg-muted'"
                      @click="store.setImageModelConfig(store.selectedImageModel, field.key, option.value)"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </div>

                <div class="flex-1 space-y-2">
                  <div class="text-xs text-muted-foreground">提示词</div>
                  <div class="rounded-md border border-input bg-transparent shadow-sm focus-within:ring-1 focus-within:ring-ring">
                    <div
                      class="relative"
                      :style="{ '--prompt-system-offset': promptSystemInlineOffset }"
                    >
                      <div
                        v-if="hasPromptSystemTokens"
                        ref="promptSystemRow"
                        class="prompt-system-indicator"
                      >
                        <div
                          v-if="cameraParametersEnabled"
                          class="prompt-system-chain"
                        >
                          <div
                            class="prompt-system-token-wrap"
                            @mouseenter="cameraSummaryOpen = true"
                            @mouseleave="cameraSummaryOpen = false"
                          >
                            <div
                              class="prompt-system-token-group prompt-system-token-group--linked"
                              :class="cameraParameterReferenceEnabled && viewRotationReferenceImage ? 'prompt-system-token-group--has-reference' : ''"
                            >
                              <button
                                type="button"
                                class="prompt-system-token prompt-system-token--camera"
                                @click.stop="cameraSummaryOpen = !cameraSummaryOpen"
                              >
                                <Camera class="h-3.5 w-3.5" />
                                <span>相机参数</span>
                              </button>
                            </div>
                            <div
                              v-if="cameraSummaryOpen"
                              class="prompt-system-popover"
                              @click.stop
                            >
                              <div class="mb-1 text-[11px] font-semibold text-foreground">已应用到系统提示词</div>
                              <div
                                v-for="row in cameraParameterSummaryRows"
                                :key="row.label"
                                class="prompt-system-row"
                              >
                                <span class="text-muted-foreground">{{ row.label }}</span>
                                <span class="font-medium text-foreground">{{ row.value }}</span>
                              </div>
                            </div>
                          </div>

                          <div
                            v-if="cameraParameterReferenceEnabled && viewRotationReferenceImage"
                            class="prompt-reference-token-wrap"
                            @mouseenter="showCameraParameterReferencePreview"
                            @mouseleave="hideCameraParameterReferencePreview"
                          >
                            <button
                              type="button"
                              class="prompt-reference-token prompt-reference-token--linked"
                              @click.stop="toggleCameraParameterReferencePreview"
                            >
                              @参考图1
                            </button>
                            <div
                              v-if="cameraParameterReferenceOpen"
                              class="prompt-reference-popover"
                              @click.stop
                            >
                              <button
                                type="button"
                                class="prompt-reference-preview"
                                @click="openViewRotationReferencePreview"
                              >
                                <img
                                  :src="viewRotationReferenceImage"
                                  alt="参考图1缩略图"
                                />
                              </button>
                              <div class="prompt-reference-caption">@参考图1</div>
                            </div>
                          </div>
                        </div>

                        <div
                          v-if="viewRotationEnabled"
                          class="prompt-system-chain"
                        >
                          <div
                            class="prompt-system-token-wrap"
                            @mouseenter="viewRotationSummaryOpen = true"
                            @mouseleave="viewRotationSummaryOpen = false"
                          >
                            <div
                              class="prompt-system-token-group prompt-system-token-group--linked"
                              :class="viewRotationReferenceEnabled && viewRotationReferenceImage ? 'prompt-system-token-group--has-reference' : ''"
                            >
                              <button
                                type="button"
                                class="prompt-system-token prompt-system-token--view"
                                @click.stop="viewRotationSummaryOpen = !viewRotationSummaryOpen"
                              >
                                <Rotate3d class="h-3.5 w-3.5" />
                                <span>视角转动</span>
                              </button>
                            </div>
                            <div
                              v-if="viewRotationSummaryOpen"
                              class="prompt-system-popover prompt-system-popover--wide"
                              @click.stop
                            >
                              <div class="mb-1 text-[11px] font-semibold text-foreground">已应用到系统提示词</div>
                              <div
                                v-for="row in viewRotationSummaryRows"
                                :key="row.label"
                                class="prompt-system-row prompt-system-row--stack"
                              >
                                <span class="text-muted-foreground">{{ row.label }}</span>
                                <span class="font-medium text-foreground">{{ row.value }}</span>
                              </div>
                            </div>
                          </div>

                          <div
                            v-if="viewRotationReferenceEnabled && viewRotationReferenceImage"
                            class="prompt-reference-token-wrap"
                            @mouseenter="showViewRotationReferencePreview"
                            @mouseleave="hideViewRotationReferencePreview"
                          >
                            <button
                              type="button"
                              class="prompt-reference-token prompt-reference-token--linked"
                              @click.stop="toggleViewRotationReferencePreview"
                            >
                              @参考图1
                            </button>
                            <div
                              v-if="viewRotationReferenceOpen"
                              class="prompt-reference-popover"
                              @click.stop
                            >
                              <button
                                type="button"
                                class="prompt-reference-preview"
                                @click="openViewRotationReferencePreview"
                              >
                                <img
                                  :src="viewRotationReferenceImage"
                                  alt="参考图1缩略图"
                                />
                              </button>
                              <div class="prompt-reference-caption">@参考图1</div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <textarea
                        ref="promptTextarea"
                        :value="store.prompt"
                        :placeholder="hasPromptSystemTokens ? '' : '输入提示词，生成图片...'"
                        class="block min-h-24 w-full resize-none overflow-hidden rounded-t-md border-0 bg-transparent px-3 py-2 text-sm shadow-none placeholder:text-muted-foreground focus-visible:outline-none"
                        :class="[optimizingPrompt ? 'prompt-textarea--busy' : '', hasPromptSystemTokens ? 'prompt-textarea--with-system' : '']"
                        @keydown="handlePromptKeydown"
                        @input="updatePrompt(($event.target as HTMLTextAreaElement).value)"
                      />
                      <div
                        v-if="optimizingPrompt"
                        class="prompt-shimmer-layer pointer-events-none absolute inset-0 whitespace-pre-wrap break-words px-3 py-2 text-sm"
                        :class="hasPromptSystemTokens ? 'prompt-shimmer-layer--with-system' : ''"
                        aria-hidden="true"
                      >
                        <span
                          v-for="(char, index) in promptShimmerText"
                          :key="`${char}-${index}`"
                          class="prompt-shimmer-char"
                          :style="{ animationDelay: `${index * 28}ms` }"
                        >{{ char }}</span>
                      </div>
                    </div>
                    <div class="prompt-tools-row px-3 pb-3 pt-1">
                      <div class="prompt-tools-group">
                        <button
                          type="button"
                          class="prompt-tool-button"
                          :class="optimizingPrompt ? 'prompt-tool-button--active' : ''"
                          :disabled="optimizingPrompt"
                          @click="handleOptimizePrompt"
                        >
                          <WandSparkles class="h-3.5 w-3.5" />
                          <span>{{ optimizingPrompt ? "优化中" : store.prompt.trim() ? "提示词优化" : "随机提示词" }}</span>
                        </button>
                        <button
                          type="button"
                          class="prompt-tool-button"
                          :class="cameraParametersEnabled ? 'prompt-tool-button--selected' : ''"
                          :aria-pressed="cameraParametersEnabled"
                          @click="openCameraParameters"
                        >
                          <Camera class="h-3.5 w-3.5" />
                          <span>相机参数</span>
                        </button>
                        <button
                          type="button"
                          class="prompt-tool-button"
                          :class="viewRotationEnabled ? 'prompt-tool-button--selected' : ''"
                          :aria-pressed="viewRotationEnabled"
                          @click="openViewRotation"
                        >
                          <Rotate3d class="h-3.5 w-3.5" />
                          <span>视角转动</span>
                        </button>
                      </div>
                    </div>
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
                  <div class="space-y-2">
                    <div class="relative flex aspect-square items-center justify-center overflow-hidden rounded-md bg-muted">
                      <img
                        :src="activeResultImage"
                        :alt="`结果 ${activeResultImageIndex + 1}`"
                        class="h-full w-full cursor-pointer object-contain transition-opacity hover:opacity-90"
                        @click="openImageGallery(currentResultImages, activeResultImageIndex)"
                      />
                      <template v-if="currentResultImages.length > 1">
                        <button
                          type="button"
                          class="absolute left-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
                          @click.stop="showPreviousResultImage"
                        >
                          <ChevronLeft class="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          class="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
                          @click.stop="showNextResultImage"
                        >
                          <ChevronRight class="h-4 w-4" />
                        </button>
                        <div class="absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-xs font-medium text-white">
                          {{ activeResultImageIndex + 1 }}/{{ currentResultImages.length }}
                        </div>
                      </template>
                      <div class="absolute bottom-2 right-2 flex gap-1">
                        <button
                          type="button"
                          class="inline-flex h-8 w-8 items-center justify-center rounded-md bg-secondary text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80"
                          title="继续编辑"
                          @click.stop="store.continueWithResult(activeResultImage)"
                        >
                          <Pencil class="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          class="inline-flex h-8 w-8 items-center justify-center rounded-md bg-secondary text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80"
                          title="下载"
                          @click.stop="downloadImage(activeResultImage, activeResultImageIndex)"
                        >
                          <Download class="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div
                      v-if="currentResultImages.length > 1"
                      class="flex gap-2 overflow-x-auto pb-1"
                    >
                      <button
                        v-for="(image, index) in currentResultImages"
                        :key="`${image}-${index}`"
                        type="button"
                        class="h-14 w-14 shrink-0 overflow-hidden rounded-md border transition-colors"
                        :class="index === activeResultImageIndex ? 'border-primary' : 'border-border opacity-70 hover:opacity-100'"
                        @click="setActiveResultImage(index)"
                      >
                        <img
                          :src="image"
                          :alt="`结果缩略图 ${index + 1}`"
                          class="h-full w-full object-cover"
                        />
                      </button>
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
            :key="getGalleryHistoryKey(task)"
            class="group relative mb-4 break-inside-avoid rounded-lg transition-all hover:shadow-md"
            :class="task.kind === 'image' && task.resultImages.length > 1 ? 'overflow-visible' : 'overflow-hidden border bg-card'"
          >
            <div
              class="cursor-pointer"
              @click="task.kind === 'image' ? openImageHistoryPreview(task) : openPreview(task.videoUrl, '', 'video', false)"
            >
              <div
                v-if="task.kind === 'image'"
                class="history-stack"
                :class="task.resultImages.length > 1 ? 'history-stack--multiple' : ''"
              >
                <div
                  v-if="task.resultImages.length > 1"
                  class="history-stack-stage"
                >
                  <img
                    v-for="(image, index) in getHistoryImageStackItems(task)"
                    :key="`${task.id}-${index}`"
                    :src="image"
                    :alt="`结果 ${index + 1}`"
                    class="history-stack-image"
                    :style="getHistoryImageStackStyle(index)"
                    @load="index === 0 ? setHistoryImageResolutionLabel(task, $event) : undefined"
                  />
                  <div class="history-stack-actions">
                    <button
                      type="button"
                      class="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-secondary text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80"
                      title="加载配置"
                      @click.stop="loadGalleryItemConfig(task)"
                    >
                      <Copy class="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      class="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-secondary text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80"
                      title="下载"
                      @click.stop="downloadImageSet(task.resultImages)"
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
                </div>
                <img
                  v-else
                  :src="getHistoryImagePreview(task)"
                  alt=""
                  class="w-full transition-opacity hover:opacity-90"
                  @load="setHistoryImageResolutionLabel(task, $event)"
                />
              </div>
              <video
                v-else
                :src="task.videoUrl"
                muted
                playsinline
                preload="metadata"
                class="w-full bg-black transition-opacity hover:opacity-90"
                @loadedmetadata="setHistoryVideoDurationLabel(task, $event)"
              />
              <template v-if="task.kind === 'video'">
                <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div class="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white shadow-sm">
                    <Play class="ml-0.5 h-5 w-5 fill-current" />
                  </div>
                </div>
                <div class="pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  <Video class="h-3 w-3" />
                  视频
                </div>
              </template>
            </div>

            <div
              v-if="task.kind === 'image' && task.resultImages.length > 1"
              class="pointer-events-none flex max-w-full flex-wrap items-start gap-1 px-1 pb-1 pt-0.5"
            >
              <span class="inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                <ImageIcon class="h-3 w-3" />
                {{ getHistoryImageCountLabel(task) }}
              </span>
              <span class="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                {{ IMAGE_MODELS.find((model) => model.id === task.model)?.name || task.model }}
              </span>
              <span
                v-if="formatImageResolutionLabel(task)"
                class="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white"
              >
                {{ formatImageResolutionLabel(task) }}
              </span>
              <span class="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                {{ formatElapsed(task.generationTime) }}
              </span>
            </div>

            <div
              v-else
              class="pointer-events-none absolute bottom-1 left-1 z-20 flex flex-col items-start gap-1"
            >
              <div class="flex flex-wrap gap-1">
                <span
                  v-if="task.kind === 'image' && formatImageResolutionLabel(task)"
                  class="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white"
                >
                  {{ formatImageResolutionLabel(task) }}
                </span>
                <span
                  v-if="task.kind === 'video' && formatVideoResolutionLabel(task)"
                  class="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white"
                >
                  {{ formatVideoResolutionLabel(task) }}
                </span>
                <span
                  v-if="task.kind === 'video' && formatVideoDurationLabel(task)"
                  class="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white"
                >
                  {{ formatVideoDurationLabel(task) }}
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

            <div
              v-if="task.kind !== 'image' || task.resultImages.length <= 1"
              class="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 opacity-0 transition-opacity group-hover:opacity-100"
            >
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
                @click.stop="store.continueWithResult(getHistoryImagePreview(task))"
              >
                <Pencil class="h-3 w-3" />
              </button>
              <button
                v-if="task.kind === 'image'"
                type="button"
                class="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-secondary text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80"
                title="下载"
                @click.stop="downloadImage(getHistoryImagePreview(task), 0)"
              >
                <Download class="h-3 w-3" />
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

    <div
      v-if="cameraParametersOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
      @click="closeCameraParameters"
    >
      <div
        class="camera-parameter-modal"
        @click.stop
      >
        <div class="camera-parameter-header">
          <h3 class="text-sm font-medium text-muted-foreground">相机参数</h3>
          <button
            type="button"
            class="camera-parameter-close"
            @click="closeCameraParameters"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
        <div class="camera-parameter-columns">
          <section
            v-for="column in CAMERA_PARAMETER_COLUMNS"
            :key="column.key"
            class="camera-parameter-column"
          >
            <h4 class="camera-parameter-title">{{ column.title }}</h4>
            <div class="camera-parameter-wheel">
              <div class="camera-parameter-selection" />
              <div
                class="camera-parameter-list"
                :data-camera-wheel-scroll-key="column.key"
                @scroll="handleCameraWheelScroll(column, $event)"
                @wheel="handleCameraWheelWheel(column, $event)"
              >
                <button
                  v-for="option in column.options"
                  :key="option"
                  type="button"
                  class="camera-parameter-option"
                  :class="cameraParameterDraft[column.key] === option ? 'camera-parameter-option--active' : ''"
                  :data-camera-option-value="option"
                  :data-camera-option-active="cameraParameterDraft[column.key] === option"
                  @click="selectCameraParameter(column.key, option, $event)"
                >
                  {{ option }}
                </button>
              </div>
            </div>
          </section>
        </div>
        <div class="camera-parameter-actions">
          <button
            type="button"
            class="camera-parameter-secondary"
            @click="closeCameraParameters"
          >
            取消
          </button>
          <button
            type="button"
            class="camera-parameter-primary"
            @click="confirmCameraParameters"
          >
            确定
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="viewRotationOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
      @click="closeViewRotation"
    >
      <div
        class="view-rotation-modal"
        @click.stop
      >
        <div class="view-rotation-header">
          <h3 class="text-sm font-semibold text-foreground">多角度</h3>
          <button
            type="button"
            class="view-rotation-reset"
            title="复位"
            @click="resetViewRotation"
          >
            <RefreshCw class="h-4 w-4" />
          </button>
        </div>

        <div class="view-rotation-tabs">
          <button
            type="button"
            class="view-rotation-tab"
            :class="viewRotationDraft.target === 'subject' ? 'view-rotation-tab--active' : ''"
            @click="viewRotationDraft = { ...viewRotationDraft, target: 'subject' }"
          >
            标准控件
          </button>
          <button
            type="button"
            class="view-rotation-tab"
            :class="viewRotationDraft.target === 'camera' ? 'view-rotation-tab--active' : ''"
            @click="viewRotationDraft = { ...viewRotationDraft, target: 'camera' }"
          >
            自由视角
          </button>
        </div>

        <div class="view-rotation-preview-wrap">
          <input
            class="view-rotation-readout"
            :value="viewRotationDraftDescription"
            readonly
          />
          <MultiAngleThreePreview
            v-model="viewRotationDraft"
            :image-url="viewRotationReferenceImage"
          />
        </div>

        <div class="view-rotation-sliders">
          <label class="view-rotation-slider">
            <span>水平</span>
            <input
              v-model.number="viewRotationDraft.rotation"
              type="range"
              min="0"
              max="359"
              step="1"
            />
            <strong>{{ viewRotationDraft.rotation }}°</strong>
          </label>
          <label class="view-rotation-slider">
            <span>垂直</span>
            <input
              v-model.number="viewRotationDraft.tilt"
              type="range"
              :min="VIEW_ROTATION_VERTICAL_MIN"
              :max="VIEW_ROTATION_VERTICAL_MAX"
              step="1"
            />
            <strong>{{ viewRotationDraft.tilt }}°</strong>
          </label>
          <label class="view-rotation-slider">
            <span>远近</span>
            <input
              v-model.number="viewRotationDraft.zoom"
              type="range"
              :min="VIEW_ROTATION_DISTANCE_MIN"
              :max="VIEW_ROTATION_DISTANCE_MAX"
              step="0.1"
            />
            <strong>{{ getViewRotationZoomLabel(viewRotationDraft.zoom) }}</strong>
          </label>
        </div>

        <div class="view-rotation-actions">
          <button
            type="button"
            class="view-rotation-secondary"
            @click="closeViewRotation"
          >
            取消
          </button>
          <button
            type="button"
            class="view-rotation-primary"
            @click="confirmViewRotation"
          >
            立即使用
          </button>
        </div>
      </div>
    </div>

    <MediaModal
      :open="Boolean(previewImage)"
      :src="previewImage"
      :kind="previewKind"
      :title="previewTitle"
      :show-continue="previewCanContinue"
      :show-download="previewKind !== 'prompt'"
      :items="previewItems"
      :active-index="previewIndex"
      @close="closePreview"
      @continue="continueFromPreview"
      @download="handlePreviewDownload"
      @previous="showPreviousPreviewImage"
      @next="showNextPreviewImage"
      @select="setPreviewIndex"
    />
  </div>
</template>

<style scoped>
.mode-switch {
  position: relative;
  display: inline-grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.125rem;
  width: 9.5rem;
  border: 1px solid hsl(var(--input));
  border-radius: calc(var(--radius) + 2px);
  background: hsl(var(--background));
  padding: 0.125rem;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
}

.mode-switch-thumb {
  position: absolute;
  inset: 0.125rem auto 0.125rem 0.125rem;
  width: calc(50% - 0.1875rem);
  border-radius: calc(var(--radius) - 1px);
  background: hsl(var(--primary));
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.14);
  transform: translateX(0);
  transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.mode-switch[data-mode="video"] .mode-switch-thumb {
  transform: translateX(calc(100% + 0.125rem));
}

.mode-switch-button {
  position: relative;
  z-index: 1;
  display: inline-flex;
  height: 2rem;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  border-radius: calc(var(--radius) - 1px);
  padding: 0 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25rem;
  transition:
    color 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
    transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.mode-switch-button:active {
  transform: scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .mode-switch-thumb,
  .mode-switch-button {
    transition: none;
  }
}

.image-option-grid {
  display: grid;
  gap: 0.5rem;
  width: 100%;
}

.image-option-grid--preview {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.image-option-grid--compact {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.image-option-grid--plain {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.image-option-button {
  min-width: 0;
  border-radius: calc(var(--radius) - 2px);
  font-weight: 500;
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}

.image-option-button--preview {
  display: flex;
  min-height: 3.5rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0.5rem 0.375rem;
}

.image-option-button--compact {
  min-height: 2.5rem;
  padding: 0.625rem 0.25rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
}

.image-option-button--plain {
  min-height: 2.5rem;
  padding: 0.625rem 0.5rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
}

.image-option-label {
  max-width: 100%;
  overflow-wrap: anywhere;
  text-align: center;
  line-height: 1.05;
}

.history-stack {
  position: relative;
  width: 100%;
  overflow: visible;
}

.history-stack--multiple {
  padding: 0.625rem 2.25rem 1.25rem 0.125rem;
}

.history-stack-stage {
  position: relative;
  z-index: 1;
  aspect-ratio: 1 / 1;
  min-height: 0;
}

.history-stack-image {
  position: absolute;
  inset: 0;
  height: 100%;
  width: 100%;
  border: 1px solid hsl(var(--border));
  border-radius: 0.5rem;
  background: hsl(var(--card));
  object-fit: cover;
  box-shadow: 0 2px 4px rgb(0 0 0 / 0.24);
  transform-origin: 50% 8%;
  transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.history-stack-image:hover {
  opacity: 0.9;
}

.history-stack-actions {
  pointer-events: none;
  position: absolute;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  opacity: 0;
  transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.group:hover .history-stack-actions {
  opacity: 1;
}

.prompt-system-indicator {
  position: absolute;
  left: 0.75rem;
  top: 0.45rem;
  z-index: 12;
  display: inline-flex;
  max-width: calc(100% - 1.5rem);
  align-items: center;
  gap: 0.5rem;
  white-space: nowrap;
}

.prompt-system-chain {
  display: inline-flex;
  align-items: center;
  border: 1px solid rgb(52 211 153 / 0.66);
  border-radius: calc(var(--radius) - 2px);
  background: rgb(16 185 129 / 0.12);
  box-shadow: inset 0 0 0 1px rgb(16 185 129 / 0.04);
  transition:
    background-color 150ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.prompt-system-chain:hover,
.prompt-system-chain:focus-within {
  border-color: rgb(110 231 183);
  background: rgb(16 185 129 / 0.18);
}

.prompt-system-token-wrap,
.prompt-reference-token-wrap {
  position: relative;
  display: inline-flex;
}

.prompt-system-token-group {
  display: inline-flex;
  align-items: center;
  border: 0;
  background: transparent;
  color: rgb(52 211 153);
}

.prompt-system-token {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  color: rgb(52 211 153);
  font-size: 0.75rem;
  line-height: 1rem;
}

.prompt-system-token:focus-visible,
.prompt-reference-token:focus-visible {
  outline: none;
}

.prompt-system-token--camera,
.prompt-system-token--view {
  color: rgb(52 211 153);
}

.prompt-system-popover {
  position: absolute;
  left: 0;
  top: calc(100% + 0.375rem);
  z-index: 20;
  width: min(22rem, calc(100vw - 3rem));
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) + 2px);
  background: hsl(var(--card));
  padding: 0.75rem;
  box-shadow: 0 18px 45px rgb(0 0 0 / 0.35);
}

.prompt-system-popover--wide {
  width: min(28rem, calc(100vw - 3rem));
}

.prompt-system-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.25rem 0;
  font-size: 0.75rem;
  line-height: 1rem;
}

.prompt-system-row--stack {
  display: grid;
  gap: 0.125rem;
}

.prompt-reference-token {
  display: inline-flex;
  align-items: center;
  height: 1.625rem;
  border: 0;
  border-left: 1px solid rgb(52 211 153 / 0.34);
  background: transparent;
  padding: 0 0.5rem;
  color: rgb(52 211 153);
  font-size: 0.75rem;
  line-height: 1rem;
}

.prompt-reference-token--linked {
  margin-left: 0.125rem;
}

.prompt-reference-token:hover,
.prompt-reference-token:focus-visible {
  background: rgb(16 185 129 / 0.16);
}

.prompt-reference-popover {
  position: absolute;
  left: 0;
  top: calc(100% + 0.375rem);
  z-index: 22;
  width: 8.75rem;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) + 2px);
  background: hsl(var(--card));
  padding: 0.5rem;
  box-shadow: 0 18px 45px rgb(0 0 0 / 0.35);
}

.prompt-reference-preview {
  display: block;
  width: 100%;
  overflow: hidden;
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--background));
}

.prompt-reference-preview img {
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: contain;
}

.prompt-reference-caption {
  padding-top: 0.375rem;
  text-align: center;
  color: hsl(var(--muted-foreground));
  font-size: 0.6875rem;
  line-height: 1rem;
}

.prompt-textarea--with-system {
  min-height: 7.5rem;
  padding-left: var(--prompt-system-offset, 0.75rem);
  padding-top: 0.5rem;
}

.prompt-textarea--busy {
  caret-color: transparent;
  color: transparent;
}

.prompt-textarea--busy::placeholder {
  color: transparent;
}

.prompt-shimmer-layer {
  color: hsl(var(--foreground) / 0.68);
}

.prompt-shimmer-layer--with-system {
  padding-left: var(--prompt-system-offset, 0.75rem);
  padding-top: 0.5rem;
}

.prompt-tools-row {
  display: flex;
  justify-content: flex-end;
  width: 100%;
}

.prompt-tools-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  justify-content: flex-end;
  width: 100%;
}

.prompt-tool-button {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  border: 1px solid hsl(var(--border) / 0.12);
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--background) / 0.2);
  padding: 0.375rem 0.625rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.75rem;
  line-height: 1rem;
  opacity: 0.5;
  transition:
    opacity 150ms cubic-bezier(0.4, 0, 0.2, 1),
    color 150ms cubic-bezier(0.4, 0, 0.2, 1),
    background-color 150ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.prompt-tool-button:hover,
.prompt-tool-button:focus-visible {
  border-color: hsl(var(--border) / 0.45);
  background: hsl(var(--background) / 0.72);
  color: hsl(var(--foreground));
  opacity: 1;
}

.prompt-tool-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1px hsl(var(--ring));
}

.prompt-tool-button--active {
  border-color: hsl(var(--border) / 0.45);
  background: hsl(var(--accent) / 0.6);
  color: hsl(var(--foreground));
  opacity: 1;
}

.prompt-tool-button--selected {
  border-color: rgb(96 165 250);
  background: rgb(59 130 246);
  color: white;
  opacity: 1;
}

.prompt-tool-button--selected:hover,
.prompt-tool-button--selected:focus-visible {
  border-color: rgb(147 197 253);
  background: rgb(59 130 246);
  color: white;
  opacity: 1;
}

.view-rotation-modal {
  width: min(21rem, calc(100vw - 2rem));
  max-height: min(88dvh, 45rem);
  overflow-y: auto;
  border: 1px solid hsl(var(--border));
  border-radius: 0.875rem;
  background: hsl(var(--card));
  color: hsl(var(--card-foreground));
  box-shadow: 0 30px 80px rgb(0 0 0 / 0.45);
}

.view-rotation-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1rem 0.75rem;
}

.view-rotation-reset {
  display: inline-flex;
  height: 2rem;
  width: 2rem;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  color: hsl(var(--muted-foreground));
  transition:
    background-color 150ms cubic-bezier(0.4, 0, 0.2, 1),
    color 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.view-rotation-reset:hover,
.view-rotation-reset:focus-visible {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
  outline: none;
}

.view-rotation-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.25rem;
  margin: 0 1rem 0.875rem;
  border-radius: calc(var(--radius) + 2px);
  background: hsl(var(--muted) / 0.42);
  padding: 0.25rem;
}

.view-rotation-tab {
  height: 2rem;
  border-radius: calc(var(--radius) - 2px);
  color: hsl(var(--muted-foreground));
  font-size: 0.875rem;
  font-weight: 500;
  transition:
    background-color 150ms cubic-bezier(0.4, 0, 0.2, 1),
    color 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.view-rotation-tab:hover,
.view-rotation-tab:focus-visible {
  color: hsl(var(--foreground));
  outline: none;
}

.view-rotation-tab--active {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  box-shadow: 0 8px 20px rgb(0 0 0 / 0.18);
}

.view-rotation-preview-wrap {
  margin: 0 1rem;
  border: 1px solid rgb(30 41 59);
  border-radius: calc(var(--radius) + 4px);
  background: rgb(7 12 22);
  padding: 0.5rem;
}

.view-rotation-readout {
  width: 100%;
  height: 1.875rem;
  border: 1px solid rgb(51 65 85);
  border-radius: calc(var(--radius) - 2px);
  background: rgb(12 18 31);
  padding: 0 0.625rem;
  text-align: center;
  color: rgb(226 232 240);
  font-size: 0.75rem;
  line-height: 1rem;
  outline: none;
}

.view-rotation-sliders {
  display: grid;
  gap: 0.625rem;
  padding: 0.875rem 1rem 0;
}

.view-rotation-slider {
  display: grid;
  grid-template-columns: 2.5rem minmax(0, 1fr) 3.25rem;
  align-items: center;
  gap: 0.625rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.8125rem;
}

.view-rotation-slider strong {
  text-align: right;
  color: hsl(var(--foreground));
  font-size: 0.75rem;
  font-weight: 600;
}

.view-rotation-slider input {
  height: 1.25rem;
  appearance: none;
  background: transparent;
}

.view-rotation-slider input::-webkit-slider-runnable-track {
  height: 0.1875rem;
  border-radius: 9999px;
  background: hsl(var(--border));
}

.view-rotation-slider input::-webkit-slider-thumb {
  width: 0.875rem;
  height: 0.875rem;
  margin-top: -0.34375rem;
  appearance: none;
  border-radius: 9999px;
  background: hsl(var(--foreground));
  box-shadow: 0 0 0 3px hsl(var(--background));
}

.view-rotation-slider input::-moz-range-track {
  height: 0.1875rem;
  border-radius: 9999px;
  background: hsl(var(--border));
}

.view-rotation-slider input::-moz-range-thumb {
  width: 0.875rem;
  height: 0.875rem;
  border: 0;
  border-radius: 9999px;
  background: hsl(var(--foreground));
  box-shadow: 0 0 0 3px hsl(var(--background));
}

.view-rotation-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  padding: 0.875rem 1rem 1rem;
}

.view-rotation-secondary,
.view-rotation-primary {
  display: inline-flex;
  height: 2.25rem;
  align-items: center;
  justify-content: center;
  border-radius: calc(var(--radius) + 2px);
  font-size: 0.875rem;
  font-weight: 600;
  transition:
    background-color 150ms cubic-bezier(0.4, 0, 0.2, 1),
    color 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.view-rotation-secondary {
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

.view-rotation-secondary:hover,
.view-rotation-secondary:focus-visible {
  background: hsl(var(--muted));
  outline: none;
}

.view-rotation-primary {
  background: hsl(var(--foreground));
  color: hsl(var(--background));
}

.view-rotation-primary:hover,
.view-rotation-primary:focus-visible {
  background: hsl(var(--foreground) / 0.88);
  outline: none;
}

.camera-parameter-modal {
  width: min(54rem, calc(100vw - 2rem));
  max-height: min(82vh, 42rem);
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: 1rem;
  background: hsl(var(--card));
  color: hsl(var(--card-foreground));
  box-shadow: 0 30px 80px rgb(0 0 0 / 0.45);
}

.camera-parameter-header {
  position: relative;
  display: flex;
  min-height: 3rem;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid hsl(var(--border));
}

.camera-parameter-close {
  position: absolute;
  right: 1rem;
  display: inline-flex;
  height: 2rem;
  width: 2rem;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  color: hsl(var(--muted-foreground));
  transition:
    color 150ms cubic-bezier(0.4, 0, 0.2, 1),
    background-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.camera-parameter-close:hover,
.camera-parameter-close:focus-visible {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
  outline: none;
}

.camera-parameter-columns {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
  padding: 1.25rem 1.5rem;
}

.camera-parameter-column {
  min-width: 0;
}

.camera-parameter-title {
  margin-bottom: 0.75rem;
  text-align: center;
  color: hsl(var(--muted-foreground));
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.25rem;
}

.camera-parameter-wheel {
  --camera-option-height: 2.25rem;
  --camera-wheel-height: 13.75rem;
  position: relative;
  height: var(--camera-wheel-height);
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) + 2px);
  background: hsl(var(--muted) / 0.32);
}

.camera-parameter-selection {
  pointer-events: none;
  position: absolute;
  left: 0.5rem;
  right: 0.5rem;
  top: 50%;
  z-index: 4;
  height: var(--camera-option-height);
  border: 1px solid rgb(96 165 250 / 0.28);
  border-radius: calc(var(--radius) - 2px);
  background: rgb(59 130 246 / 0.1);
  box-shadow:
    0 -1px 0 rgb(96 165 250 / 0.32),
    0 1px 0 rgb(96 165 250 / 0.32);
  transform: translateY(-50%);
}

.camera-parameter-list {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: calc((var(--camera-wheel-height) - var(--camera-option-height)) / 2) 0.5rem;
  touch-action: pan-y;
  mask-image: linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%);
  scrollbar-width: none;
}

.camera-parameter-list::-webkit-scrollbar {
  display: none;
}

.camera-parameter-option {
  position: relative;
  z-index: 2;
  display: flex;
  flex: 0 0 var(--camera-option-height);
  min-height: var(--camera-option-height);
  width: 100%;
  align-items: center;
  justify-content: center;
  border-radius: calc(var(--radius) - 2px);
  color: hsl(var(--muted-foreground));
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25rem;
  transition:
    color 150ms cubic-bezier(0.4, 0, 0.2, 1),
    background-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.camera-parameter-option:hover,
.camera-parameter-option:focus-visible {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
  outline: none;
}

.camera-parameter-option--active {
  color: rgb(96 165 250);
  font-weight: 600;
}

.camera-parameter-actions {
  display: flex;
  justify-content: center;
  gap: 1rem;
  border-top: 1px solid hsl(var(--border));
  padding: 1rem 1.5rem 1.25rem;
}

.camera-parameter-secondary,
.camera-parameter-primary {
  display: inline-flex;
  min-width: 6.25rem;
  height: 2.25rem;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25rem;
  transition:
    background-color 150ms cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.camera-parameter-secondary {
  background: hsl(var(--secondary));
  color: hsl(var(--secondary-foreground));
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.14);
}

.camera-parameter-secondary:hover,
.camera-parameter-secondary:focus-visible {
  background: hsl(var(--secondary) / 0.82);
  outline: none;
}

.camera-parameter-primary {
  background: rgb(59 130 246);
  color: white;
  box-shadow: 0 10px 24px rgb(59 130 246 / 0.28);
}

.camera-parameter-primary:hover,
.camera-parameter-primary:focus-visible {
  background: rgb(37 99 235);
  outline: none;
}

.prompt-shimmer-char {
  animation: prompt-char-shimmer 1.55s ease-in-out infinite;
  color: hsl(var(--foreground) / 0.66);
}

@keyframes prompt-char-shimmer {
  0%,
  88%,
  100% {
    color: hsl(var(--foreground) / 0.66);
    text-shadow: none;
  }

  44% {
    color: hsl(var(--foreground));
    text-shadow: 0 0 0.7em hsl(var(--primary) / 0.65);
  }
}

@media (max-width: 760px) {
  .prompt-tools-group {
    flex-wrap: nowrap;
  }

  .prompt-tool-button {
    min-width: 0;
    flex: 1 1 0;
    justify-content: center;
    padding-left: 0.375rem;
    padding-right: 0.375rem;
  }

  .prompt-tool-button span {
    white-space: nowrap;
  }

  .view-rotation-modal {
    width: min(21rem, calc(100vw - 1rem));
    max-height: calc(100dvh - 1rem);
  }

  .camera-parameter-modal {
    width: min(42rem, calc(100vw - 1rem));
    max-height: calc(100dvh - 1rem);
  }

  .camera-parameter-columns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.625rem;
    max-height: calc(100dvh - 10rem);
    overflow-y: auto;
    padding: 1rem;
  }

  .camera-parameter-title {
    margin-bottom: 0.5rem;
  }

  .camera-parameter-wheel {
    --camera-option-height: 2.125rem;
    --camera-wheel-height: 10.625rem;
  }

  .camera-parameter-actions {
    padding: 0.875rem 1rem 1rem;
  }
}

@media (max-width: 520px) {
  .prompt-textarea--with-system {
    min-height: 7.5rem;
  }

  .camera-parameter-columns {
    grid-template-columns: 1fr;
    max-height: calc(100dvh - 9rem);
  }

  .camera-parameter-wheel {
    --camera-wheel-height: 8.75rem;
  }
}

@media (min-width: 480px) {
  .image-option-grid--preview {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .image-option-grid--compact {
    grid-template-columns: repeat(10, minmax(0, 1fr));
  }
}

@media (min-width: 768px) {
  .image-option-grid--preview {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .image-option-grid--plain {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (min-width: 1180px) {
  .image-option-grid--preview {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}
</style>
