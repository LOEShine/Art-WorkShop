import type { ImageModelConfigs, ImageModelDefinition, ImageModelId } from "@/types";

export const IMAGE_UPLOAD_LIMITS: Record<ImageModelId, number> = {
  "gpt-image-1.5": 16,
  "gpt-image-1.5-official": 16,
  "gemini-3-pro-image-preview": 14,
};

export const IMAGE_MODELS: ImageModelDefinition[] = [
  {
    id: "gpt-image-1.5",
    name: "GPT Image 2.0",
    description: "VectorEngine 图像模型（gpt-image-2）",
    options: [
      {
        key: "size",
        label: "分辨率",
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
    description: "OpenAI 图像生成模型",
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
        key: "transparency",
        label: "透明度",
        default: "auto",
        options: [
          { value: "auto", label: "自动" },
          { value: "transparent", label: "透明" },
          { value: "opaque", label: "不透明" },
        ],
      },
    ],
  },
  {
    id: "gemini-3-pro-image-preview",
    name: "Nano Banana Pro",
    description: "Google 图像生成模型",
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
          { value: "1K", label: "1K" },
          { value: "2K", label: "2K" },
          { value: "4K", label: "4K" },
        ],
      },
    ],
  },
];

export const DEFAULT_IMAGE_MODEL_ID: ImageModelId = "gpt-image-1.5";

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

