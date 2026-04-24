import type {
  VideoMode,
  VideoModelConfigs,
  VideoModelId,
  VideoModelMeta,
} from "@/types";

export const VIDEO_TRANSIENT_KEYS = [
  "primaryImageSource",
  "primaryImageName",
  "lastFrameSource",
  "lastFrameName",
] as const;

export const VIDEO_MODELS: Record<VideoModelId, VideoModelMeta> = {
  veo3: {
    key: "veo3",
    title: "Veo 3",
    desc: "文生/图生视频，支持音频开关。",
    detail: "基于 VectorEngine 文档中的 fal-ai Veo 3 接口。",
    docsUrl: "https://vectorengine.apifox.cn/api-358028510",
    iconSrc: "https://www.gstatic.com/images/branding/product/1x/googleg_48dp.png",
    badges: ["text", "image", "audio"],
  },
  hailuo: {
    key: "hailuo",
    title: "海螺 Hailuo",
    desc: "文生/图生/首尾帧视频。",
    detail: "基于 VectorEngine 文档中的 MiniMax 海螺接口。",
    docsUrl: "https://vectorengine.apifox.cn/api-373137983",
    iconSrc: "https://www.minimax.io/favicon.ico",
    badges: ["text", "image", "first-last"],
  },
  seedance: {
    key: "seedance",
    title: "Seedance 1.5",
    desc: "文生/图生/首尾帧视频。",
    detail: "基于 VectorEngine 文档中的豆包 Seedance 接口。",
    docsUrl: "https://vectorengine.apifox.cn/api-358028488",
    badges: ["text", "image", "first-last"],
  },
  sora: {
    key: "sora",
    title: "Sora 2",
    desc: "文生视频，Sora 2 支持图生。",
    detail: "基于 VectorEngine 文档中的 Sora 统一视频格式接口。",
    docsUrl: "https://vectorengine.apifox.cn/api-386534725",
    iconSrc:
      "https://images.ctfassets.net/j22is2dtoxu1/intercom-img-d177d076c9a5453052925143/49d5d812b0a6fcc20a14faa8c629d9fb/icon-ios-1024_401x.png",
    badges: ["text", "image"],
  },
};

export function createDefaultVideoConfigs(): VideoModelConfigs {
  return {
    veo3: {
      mode: "text",
      prompt: "",
      aspectRatio: "16:9",
      duration: "8s",
      resolution: "720p",
      generateAudio: true,
      enhancePrompt: true,
      autoFix: true,
      primaryImageSource: "",
      primaryImageName: "",
    },
    hailuo: {
      mode: "text",
      prompt: "",
      duration: "10",
      resolution: "768P",
      promptOptimizer: true,
      primaryImageSource: "",
      primaryImageName: "",
      lastFrameSource: "",
      lastFrameName: "",
    },
    seedance: {
      mode: "text",
      prompt: "",
      ratio: "adaptive",
      duration: "5",
      resolution: "720p",
      framespersecond: "24",
      seed: "",
      camerafixed: false,
      watermark: false,
      generateAudio: false,
      returnLastFrame: false,
      primaryImageSource: "",
      primaryImageName: "",
      lastFrameSource: "",
      lastFrameName: "",
    },
    sora: {
      mode: "text",
      prompt: "",
      soraVariant: "sora-2",
      orientation: "portrait",
      size: "large",
      duration: "15",
      watermark: false,
      isPrivate: true,
      primaryImageSource: "",
      primaryImageName: "",
    },
  };
}

export function getAvailableVideoModes(modelKey: VideoModelId): VideoMode[] {
  switch (modelKey) {
    case "veo3":
      return ["text", "image"];
    case "hailuo":
      return ["text", "image", "first-last"];
    case "seedance":
      return ["text", "image", "first-last"];
    case "sora":
      return ["text", "image"];
    default:
      return ["text"];
  }
}

export function getVideoUploadLimit(modelKey: VideoModelId): number {
  if (modelKey === "hailuo" || modelKey === "seedance") {
    return 2;
  }

  if (modelKey === "veo3" || modelKey === "sora") {
    return 1;
  }

  return 0;
}

export function resolveVideoMode(
  modelKey: VideoModelId,
  config: Record<string, string | number | boolean>,
): VideoMode {
  const hasPrimary = Boolean(String(config.primaryImageSource || "").trim());
  const hasLast = Boolean(String(config.lastFrameSource || "").trim());
  const modes = getAvailableVideoModes(modelKey);

  if (modes.includes("first-last") && hasPrimary && hasLast) {
    return "first-last";
  }

  if (modes.includes("image") && hasPrimary) {
    return "image";
  }

  return "text";
}

export function getResolvedVideoModelId(
  modelKey: VideoModelId,
  config: Record<string, string | number | boolean>,
): string {
  const mode = resolveVideoMode(modelKey, config);

  if (modelKey === "veo3") {
    return "fal-ai/veo3";
  }

  if (modelKey === "hailuo") {
    return mode === "first-last" ? "MiniMax-Hailuo-02" : "MiniMax-Hailuo-2.3";
  }

  if (modelKey === "seedance") {
    return "doubao-seedance-1-5-pro-251215";
  }

  if (modelKey === "sora") {
    return mode === "image" ? "sora-2-all" : "sora-2-pro";
  }

  return "";
}

export function getSoraDurationOptions(
  config: Record<string, string | number | boolean>,
): string[] {
  return resolveVideoMode("sora", config) === "image" ? ["10", "15"] : ["15", "25"];
}

export function normalizeVideoConfig(
  modelKey: VideoModelId,
  config: Record<string, string | number | boolean>,
): void {
  const availableModes = getAvailableVideoModes(modelKey);
  const currentMode = String(config.mode || "");
  if (!availableModes.includes(currentMode as VideoMode)) {
    config.mode = availableModes[0];
  }

  if (!String(config.primaryImageSource || "").trim()) {
    config.primaryImageName = "";
    if (config.mode !== "text") {
      config.mode = "text";
    }
  }

  if (!String(config.lastFrameSource || "").trim()) {
    config.lastFrameName = "";
    if (config.mode === "first-last") {
      config.mode = String(config.primaryImageSource || "").trim() ? "image" : "text";
    }
  }

  if (modelKey === "veo3" && resolveVideoMode(modelKey, config) === "image" && config.aspectRatio === "1:1") {
    config.aspectRatio = "auto";
  }

  if (modelKey === "sora") {
    const validDurations = getSoraDurationOptions(config);
    if (!validDurations.includes(String(config.duration || ""))) {
      config.duration = validDurations[0];
    }
  }
}

