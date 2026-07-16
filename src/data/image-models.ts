import type { ImageModelConfigs, ImageModelDefinition, ImageModelId } from "@/types";

export const IMAGE_UPLOAD_LIMITS: Record<ImageModelId, number> = {
  "gpt-image-1.5": 16,
  "codex-image-2": 16,
  "gpt-image-1.5-official": 16,
  "gemini-3-pro-image-preview": 14,
  "nano-banana-2": 14,
  "seedream-5.0-pro": 10,
  "wan-2.7": 9,
  "ultimate-image-upscaler": 1,
  "qwen-image-layered": 1,
  "qwen-image-edit-multiple-angles": 3,
};

export const IMAGE_MODELS: ImageModelDefinition[] = [
  {
    id: "gpt-image-1.5",
    name: "GPT Image 2.0",
    description: "WaveSpeed OpenAI GPT Image 2",
    options: [
      {
        key: "size",
        label: "比例/分辨率",
        default: "auto",
        preview: true,
        options: [
          { value: "auto", label: "自动" },
          { value: "1024x1024", label: "1024×1024" },
          { value: "1536x1024", label: "1536×1024" },
          { value: "1024x1536", label: "1024×1536" },
          { value: "2048x2048", label: "2048×2048" },
          { value: "2048x1152", label: "2048×1152" },
          { value: "3840x2160", label: "3840×2160 4K" },
          { value: "2160x3840", label: "2160×3840 4K" },
        ],
      },
      {
        key: "quality",
        label: "质量",
        default: "medium",
        compact: true,
        options: [
          { value: "low", label: "低" },
          { value: "medium", label: "中" },
          { value: "high", label: "高" },
        ],
      },
      {
        key: "outputFormat",
        label: "格式",
        default: "png",
        compact: true,
        options: [
          { value: "png", label: "PNG" },
          { value: "jpeg", label: "JPEG" },
          { value: "webp", label: "WebP" },
        ],
      },
      {
        key: "n",
        label: "生成张数",
        default: 1,
        compact: true,
        options: Array.from({ length: 10 }, (_, index) => ({
          value: index + 1,
          label: String(index + 1),
        })),
      },
    ],
  },
  {
    id: "codex-image-2",
    name: "Codex Image 2.0",
    description: "Codex KEY 图像模型（gpt-image-2）",
    options: [
      {
        key: "size",
        label: "分辨率",
        default: "default",
        preview: true,
        options: [
          { value: "default", label: "默认" },
          { value: "1024x1024", label: "1024×1024" },
          { value: "1792x1024", label: "1792×1024" },
          { value: "1024x1792", label: "1024×1792" },
        ],
      },
      {
        key: "n",
        label: "生成张数",
        default: 1,
        compact: true,
        options: Array.from({ length: 10 }, (_, index) => ({
          value: index + 1,
          label: String(index + 1),
        })),
      },
    ],
  },
  {
    id: "gpt-image-1.5-official",
    name: "GPT Image 1.5",
    description: "WaveSpeed OpenAI GPT Image 1.5",
    options: [
      {
        key: "size",
        label: "分辨率",
        default: "1024x1024",
        preview: true,
        options: [
          { value: "auto", label: "自动" },
          { value: "1024x1024", label: "1024×1024" },
          { value: "1536x1024", label: "1536×1024" },
          { value: "1024x1536", label: "1024×1536" },
        ],
      },
      {
        key: "quality",
        label: "质量",
        default: "medium",
        compact: true,
        options: [
          { value: "low", label: "低" },
          { value: "medium", label: "中" },
          { value: "high", label: "高" },
        ],
      },
      {
        key: "transparency",
        label: "透明度",
        default: "auto",
        options: [
          { value: "auto", label: "自动" },
          { value: "transparent", label: "透明" },
          { value: "opaque", label: "不透明" },
        ],
      },
      {
        key: "outputFormat",
        label: "格式",
        default: "jpeg",
        compact: true,
        options: [
          { value: "jpeg", label: "JPEG" },
          { value: "png", label: "PNG" },
        ],
      },
    ],
  },
  {
    id: "nano-banana-2",
    name: "Nano Banana 2",
    description: "WaveSpeed Google Nano Banana 2",
    options: [
      {
        key: "aspectRatio",
        label: "宽高比",
        default: "auto",
        preview: true,
        options: [
          { value: "auto", label: "自动" },
          { value: "1:1", label: "1:1" },
          { value: "3:2", label: "3:2" },
          { value: "2:3", label: "2:3" },
          { value: "3:4", label: "3:4" },
          { value: "4:3", label: "4:3" },
          { value: "4:5", label: "4:5" },
          { value: "5:4", label: "5:4" },
          { value: "9:16", label: "9:16" },
          { value: "16:9", label: "16:9" },
          { value: "21:9", label: "21:9" },
          { value: "1:4", label: "1:4" },
          { value: "4:1", label: "4:1" },
          { value: "1:8", label: "1:8" },
          { value: "8:1", label: "8:1" },
        ],
      },
      {
        key: "imageSize",
        label: "分辨率",
        default: "1k",
        options: [
          { value: "0.5k", label: "0.5K" },
          { value: "1k", label: "1K" },
          { value: "2k", label: "2K" },
          { value: "4k", label: "4K" },
        ],
      },
      {
        key: "outputFormat",
        label: "格式",
        default: "png",
        compact: true,
        options: [
          { value: "png", label: "PNG" },
          { value: "jpeg", label: "JPEG" },
        ],
      },
    ],
  },
  {
    id: "gemini-3-pro-image-preview",
    name: "Nano Banana Pro",
    description: "WaveSpeed Google Nano Banana Pro",
    options: [
      {
        key: "aspectRatio",
        label: "宽高比",
        default: "auto",
        preview: true,
        options: [
          { value: "auto", label: "自动" },
          { value: "1:1", label: "1:1" },
          { value: "2:3", label: "2:3" },
          { value: "3:2", label: "3:2" },
          { value: "3:4", label: "3:4" },
          { value: "4:3", label: "4:3" },
          { value: "4:5", label: "4:5" },
          { value: "5:4", label: "5:4" },
          { value: "9:16", label: "9:16" },
          { value: "16:9", label: "16:9" },
          { value: "21:9", label: "21:9" },
        ],
      },
      {
        key: "imageSize",
        label: "分辨率",
        default: "auto",
        options: [
          { value: "auto", label: "自动" },
          { value: "1k", label: "1K" },
          { value: "2k", label: "2K" },
          { value: "4k", label: "4K" },
        ],
      },
      {
        key: "outputFormat",
        label: "格式",
        default: "png",
        compact: true,
        options: [
          { value: "png", label: "PNG" },
          { value: "jpeg", label: "JPEG" },
        ],
      },
    ],
  },
  {
    id: "seedream-5.0-pro",
    name: "Seedream 5 Pro",
    description: "WaveSpeed Bytedance Seedream 5.0 Pro",
    options: [
      {
        key: "aspectRatio",
        label: "宽高比",
        default: "auto",
        preview: true,
        options: [
          { value: "auto", label: "自动" },
          { value: "1:1", label: "1:1" },
          { value: "1:2", label: "1:2" },
          { value: "2:1", label: "2:1" },
          { value: "1:3", label: "1:3" },
          { value: "3:1", label: "3:1" },
          { value: "2:3", label: "2:3" },
          { value: "3:2", label: "3:2" },
          { value: "3:4", label: "3:4" },
          { value: "4:3", label: "4:3" },
          { value: "4:5", label: "4:5" },
          { value: "5:4", label: "5:4" },
          { value: "9:16", label: "9:16" },
          { value: "16:9", label: "16:9" },
          { value: "9:21", label: "9:21" },
          { value: "21:9", label: "21:9" },
        ],
      },
      {
        key: "resolution",
        label: "分辨率",
        default: "1k",
        compact: true,
        options: [
          { value: "1k", label: "1K" },
          { value: "2k", label: "2K" },
        ],
      },
      {
        key: "outputFormat",
        label: "格式",
        default: "jpeg",
        compact: true,
        options: [
          { value: "jpeg", label: "JPEG" },
          { value: "png", label: "PNG" },
        ],
      },
    ],
  },
  {
    id: "wan-2.7",
    name: "WAN 2.7",
    description: "WaveSpeed Alibaba WAN 2.7",
    options: [
      {
        key: "size",
        label: "分辨率",
        default: "1024x1024",
        preview: true,
        options: [
          { value: "1024x1024", label: "1024×1024" },
          { value: "1536x1024", label: "1536×1024" },
          { value: "1024x1536", label: "1024×1536" },
          { value: "2048x2048", label: "2048×2048" },
          { value: "2048x1152", label: "2048×1152" },
          { value: "1152x2048", label: "1152×2048" },
        ],
      },
      {
        key: "thinkingMode",
        label: "思考模式",
        default: true,
        compact: true,
        options: [
          { value: true, label: "开启" },
          { value: false, label: "关闭" },
        ],
      },
      {
        key: "seed",
        label: "种子",
        default: -1,
        options: [
          { value: -1, label: "随机" },
          { value: 42, label: "固定 42" },
        ],
      },
    ],
  },
  {
    id: "ultimate-image-upscaler",
    name: "图像放大",
    description: "WaveSpeed Ultimate Image Upscaler",
    options: [
      {
        key: "targetResolution",
        label: "目标分辨率",
        default: "4k",
        preview: true,
        options: [
          { value: "2k", label: "2K" },
          { value: "4k", label: "4K" },
          { value: "8k", label: "8K" },
        ],
      },
      {
        key: "outputFormat",
        label: "格式",
        default: "jpeg",
        compact: true,
        options: [
          { value: "jpeg", label: "JPEG" },
          { value: "png", label: "PNG" },
          { value: "webp", label: "WebP" },
        ],
      },
    ],
  },
  {
    id: "qwen-image-layered",
    name: "图像分层",
    description: "WaveSpeed Qwen Image Layered RGBA 分层",
    options: [
      {
        key: "numLayers",
        label: "分层数量",
        default: 4,
        compact: true,
        options: Array.from({ length: 7 }, (_, index) => {
          const value = index + 2;
          return {
            value,
            label: `${value} 层`,
          };
        }),
      },
    ],
  },
  {
    id: "qwen-image-edit-multiple-angles",
    name: "旋转角度",
    description: "WaveSpeed Qwen 旋转角度图像编辑模型",
    options: [],
  },
];

export const DEFAULT_IMAGE_MODEL_ID: ImageModelId = "gpt-image-1.5";

export const IMAGE_SOURCE_REQUIRED_MODEL_IDS = new Set<ImageModelId>([
  "ultimate-image-upscaler",
  "qwen-image-layered",
  "qwen-image-edit-multiple-angles",
]);

export const IMAGE_PROMPT_OPTIONAL_MODEL_IDS = new Set<ImageModelId>([
  "ultimate-image-upscaler",
  "qwen-image-layered",
]);

export function isImageSourceRequiredModel(modelId: ImageModelId): boolean {
  return IMAGE_SOURCE_REQUIRED_MODEL_IDS.has(modelId);
}

export function isImagePromptOptionalModel(modelId: ImageModelId): boolean {
  return IMAGE_PROMPT_OPTIONAL_MODEL_IDS.has(modelId);
}

export function createDefaultImageConfigs(): ImageModelConfigs {
  return IMAGE_MODELS.reduce((configs, model) => {
    configs[model.id] = model.options.reduce<Record<string, string | number | boolean>>(
      (next, option) => {
        next[option.key] = option.default;
        return next;
      },
      {},
    );

    return configs;
  }, {} as ImageModelConfigs);
}
