export type GenerationMode = "image" | "video";

export type ImageModelId =
  | "gpt-image-1.5"
  | "gpt-image-1.5-official"
  | "gemini-3-pro-image-preview";

export type VideoModelId = "veo3" | "hailuo" | "seedance" | "sora";
export type VideoMode = "text" | "image" | "first-last";

export interface SelectOption<T extends string | number | boolean = string | number | boolean> {
  value: T;
  label: string;
}

export interface ImageModelField {
  key: string;
  label: string;
  options: SelectOption[];
  default: string | number | boolean;
  preview?: boolean;
  compact?: boolean;
}

export interface ImageModelDefinition {
  id: ImageModelId;
  name: string;
  description: string;
  options: ImageModelField[];
}

export interface PromptCategory {
  id: string;
  name: string;
  nameEn?: string;
}

export interface PromptItem {
  id: string;
  title: string;
  titleEn?: string;
  category: string;
  description: string;
  prompt: string;
  source?: string;
  tags: string[];
  imageUrl?: string;
}

export interface ImageTask {
  id: string;
  createdAt: number;
  status: "generating" | "success" | "failed";
  sourceImages: string[];
  prompt: string;
  model: ImageModelId;
  modelConfig: Record<string, string | number | boolean>;
  resultImages: string[];
  generationTime: number;
  error?: string;
}

export interface VideoTask {
  id: string;
  modelKey: VideoModelId;
  modelTitle: string;
  status: string;
  phase: "pending" | "success" | "error";
  progress: string;
  error: string;
  videoUrl: string;
  createdAt: number;
  updatedAt: number;
  responseUrl?: string;
  statusUrl?: string;
  endpoint?: string;
  raw?: unknown;
}

export interface VideoModelMeta {
  key: VideoModelId;
  title: string;
  desc: string;
  detail: string;
  docsUrl: string;
  badges: Array<"text" | "image" | "audio" | "first-last">;
  iconSrc?: string;
  iconEmoji?: string;
  iconSvg?: string;
}

export type ImageModelConfigs = Record<ImageModelId, Record<string, string | number | boolean>>;
export type VideoModelConfigs = Record<VideoModelId, Record<string, string | number | boolean>>;

