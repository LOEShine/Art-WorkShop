import type {
  VideoConfigRecord,
  VideoMode,
  VideoModelConfigs,
  VideoModelId,
  VideoModelMeta,
} from "@/types";

export const VIDEO_TRANSIENT_KEYS = [
  "referenceImages",
  "referenceImageNames",
  "primaryImageSource",
  "primaryImageName",
  "lastFrameSource",
  "lastFrameName",
] as const;
export const MAX_VEO_REFERENCE_IMAGES = 3;

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

export function getVeoReferenceImages(config: VideoConfigRecord): string[] {
  return toStringArray(config.referenceImages).slice(0, MAX_VEO_REFERENCE_IMAGES);
}

export function getVeoReferenceImageNames(config: VideoConfigRecord): string[] {
  const names = toStringArray(config.referenceImageNames);
  return names.slice(0, Math.max(getVeoReferenceImages(config).length, names.length, 0));
}

export function isVeoFirstLastEnabled(config: VideoConfigRecord): boolean {
  return isFirstLastFramesEnabled(config);
}

export function isFirstLastFramesEnabled(config: VideoConfigRecord): boolean {
  return Boolean(config.useFirstLastFrames || config.veoUseFirstLastFrames);
}

export function supportsFirstLastFrames(modelKey: VideoModelId): boolean {
  return getAvailableVideoModes(modelKey).includes("first-last");
}

export function getFirstLastFrameSources(config: VideoConfigRecord) {
  const first = String(config.primaryImageSource || "").trim();
  const last = String(config.lastFrameSource || "").trim();
  const fallback = first || last;

  return {
    first: first || fallback,
    last: last || fallback,
  };
}

export function hasAnyFirstLastFrame(config: VideoConfigRecord): boolean {
  const sources = getFirstLastFrameSources(config);
  return Boolean(sources.first || sources.last);
}

export const VIDEO_MODELS: Record<VideoModelId, VideoModelMeta> = {
  veo3: {
    key: "veo3",
    title: "Veo 3.1",
    desc: "文生/图生/首尾帧视频，支持音频开关。",
    detail: "基于 Veo 3.1 路线的文生/图生/首尾帧视频模型。",
    docsUrl: "https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/veo/3-1-generate",
    iconSvg: `
      <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M214.101333 512c0-32.512 5.546667-63.701333 15.36-92.928L57.173333 290.218667A491.861333 491.861333 0 0 0 4.693333 512c0 79.701333 18.858667 154.88 52.394667 221.610667l172.202667-129.066667A290.56 290.56 0 0 1 214.101333 512" fill="#FBBC05"></path>
        <path d="M516.693333 216.192c72.106667 0 137.258667 25.002667 188.458667 65.962667L854.101333 136.533333C763.349333 59.178667 646.997333 11.392 516.693333 11.392c-202.325333 0-376.234667 113.28-459.52 278.826667l172.373334 128.853333c39.68-118.016 152.832-202.88 287.146666-202.88" fill="#EA4335"></path>
        <path d="M516.693333 807.808c-134.357333 0-247.509333-84.864-287.232-202.88l-172.288 128.853333c83.242667 165.546667 257.152 278.826667 459.52 278.826667 124.842667 0 244.053333-43.392 333.568-124.757333l-163.584-123.818667c-46.122667 28.458667-104.234667 43.776-170.026666 43.776" fill="#34A853"></path>
        <path d="M1005.397333 512c0-29.568-4.693333-61.44-11.648-91.008H516.650667V614.4h274.602666c-13.696 65.962667-51.072 116.650667-104.533333 149.632l163.541333 123.818667c93.994667-85.418667 155.136-212.650667 155.136-375.850667" fill="#4285F4"></path>
      </svg>
    `,
    badges: ["text", "image", "first-last", "audio"],
  },
  hailuo: {
    key: "hailuo",
    title: "海螺 Hailuo",
    desc: "文生/图生/首尾帧视频。",
    detail: "基于 VectorEngine 文档中的 MiniMax 海螺接口。",
    docsUrl: "https://vectorengine.apifox.cn/api-373137983",
    iconSvg: `
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M29.5715 15.9992C29.5715 8.2658 23.0792 2.02246 15.2601 2.44076C8.38082 2.80721 2.8145 8.37655 2.44825 15.2595C2.03362 23.0794 8.2737 29.5786 15.9995 29.5786H24.9174C27.4846 29.5786 29.5647 27.4974 29.5647 24.9288V16.4521C29.5681 16.3035 29.5715 16.1513 29.5715 15.9992ZM9.02004 23.5426C6.86054 21.6966 5.52684 18.7442 5.58903 15.7366C5.59248 15.5257 5.60284 15.3148 5.62357 15.1039V15.0901C5.938 11.4982 8.25644 8.14827 11.5043 6.5926C14.7557 5.03693 18.8155 5.33421 21.8077 7.34275C24.7965 9.35476 26.607 13.0054 26.3962 16.6042C26.3513 17.3924 26.2131 18.1737 26.0231 18.9377C25.9332 19.3007 25.8192 19.681 25.5013 19.9092C25.3251 20.0336 25.0936 20.082 24.8932 19.9956C24.5581 19.8504 24.5166 19.4597 24.4924 19.1244C24.3231 16.7079 23.6804 14.2189 22.0461 12.4316C20.8126 11.0799 19.0643 10.2226 17.2434 10.0532C15.4225 9.8838 13.5533 10.4057 12.0675 11.4705C10.8237 12.3624 9.84927 13.6381 9.37591 15.0901C8.90255 16.542 8.95093 18.1738 9.57286 19.5739C10.0289 20.6007 10.7856 21.4924 11.722 22.1078C13.3805 23.1968 15.6506 23.3523 17.3747 22.3671C19.0988 21.3818 20.1285 19.2454 19.6897 17.3095C19.2301 15.2802 17.1017 13.721 15.0355 14.1048C14.8386 14.1428 14.6313 14.0252 14.5794 13.8316C14.5069 13.5516 14.8178 13.4065 15.0735 13.3615C17.0775 13.002 19.2232 14.0183 20.322 15.733C21.4207 17.4477 21.476 19.7432 20.5777 21.572C19.6793 23.4008 17.8999 24.7352 15.9201 25.2192C13.2561 25.8691 10.8409 25.1017 9.01658 23.5426H9.02004Z" fill="url(#paint0_linear_hailuo_icon)"></path>
        <defs>
          <linearGradient id="paint0_linear_hailuo_icon" x1="3.03563" y1="3.41911" x2="33.5332" y2="32.9813" gradientUnits="userSpaceOnUse">
            <stop offset="0.11" stop-color="#FFD400"></stop>
            <stop offset="0.22" stop-color="#FF891F"></stop>
            <stop offset="0.42" stop-color="#E4659A"></stop>
            <stop offset="0.56" stop-color="#DB2ED7"></stop>
            <stop offset="0.75" stop-color="#7264F4"></stop>
          </linearGradient>
        </defs>
      </svg>
    `,
    badges: ["text", "image", "first-last"],
  },
  seedance: {
    key: "seedance",
    title: "Seedance 1.5",
    desc: "文生/图生/首尾帧视频。",
    detail: "基于 VectorEngine 文档中的豆包 Seedance 接口。",
    docsUrl: "https://vectorengine.apifox.cn/api-358028488",
    iconSvg: `
      <svg viewBox="0 0 1170 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M0 968.175058l197.847012-50.485503V105.300006L0 54.697503v913.536055z" fill="#2F57C2"></path>
        <path d="M968.175058 0v1018.719061l202.117512-50.485503V54.697503L968.233558 0z" fill="#78DED4"></path>
        <path d="M648.297039 378.904523l202.059012-50.544003v534.631531l-202.059012-50.544003V378.904523z" fill="#3A8DDE"></path>
        <path d="M315.724519 458.874027l202.059012 50.485503v433.602026l-202.059012 54.697503v-538.785032z" fill="#1ECAD3"></path>
      </svg>
    `,
    badges: ["text", "image", "first-last"],
  },
  sora: {
    key: "sora",
    title: "Sora 2",
    desc: "文生视频，Sora 2 支持图生。",
    detail: "基于 VectorEngine 文档中的 Sora 统一视频格式接口。",
    docsUrl: "https://vectorengine.apifox.cn/api-386534725",
    badges: ["text", "image"],
  },
};

export function createDefaultVideoConfigs(): VideoModelConfigs {
  return {
    veo3: {
      mode: "text",
      prompt: "",
      aspectRatio: "16:9",
      duration: "8",
      resolution: "720p",
      generateAudio: true,
      personGeneration: "allow_all",
      seed: "",
      useFirstLastFrames: false,
      veoUseFirstLastFrames: false,
      referenceImages: [],
      referenceImageNames: [],
      primaryImageSource: "",
      primaryImageName: "",
      lastFrameSource: "",
      lastFrameName: "",
    },
    hailuo: {
      mode: "text",
      prompt: "",
      duration: "10",
      resolution: "768P",
      promptOptimizer: true,
      useFirstLastFrames: false,
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
      generateAudio: true,
      draft: false,
      returnLastFrame: false,
      useFirstLastFrames: false,
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
      return ["text", "image", "first-last"];
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

export function getVideoUploadLimit(modelKey: VideoModelId, config?: VideoConfigRecord): number {
  if (modelKey === "veo3") {
    return isFirstLastFramesEnabled(config || {}) ? 2 : MAX_VEO_REFERENCE_IMAGES;
  }

  if (modelKey === "hailuo" || modelKey === "seedance") {
    return isFirstLastFramesEnabled(config || {}) ? 2 : 1;
  }

  if (modelKey === "sora") {
    return 1;
  }

  return 0;
}

export function resolveVideoMode(
  modelKey: VideoModelId,
  config: VideoConfigRecord,
): VideoMode {
  if (modelKey === "veo3") {
    if (isFirstLastFramesEnabled(config)) {
      return "first-last";
    }

    return getVeoReferenceImages(config).length > 0 ? "image" : "text";
  }

  const hasPrimary = Boolean(String(config.primaryImageSource || "").trim());
  const modes = getAvailableVideoModes(modelKey);

  if (modes.includes("first-last") && isFirstLastFramesEnabled(config)) {
    return "first-last";
  }

  if (modes.includes("image") && hasPrimary) {
    return "image";
  }

  return "text";
}

export function getResolvedVideoModelId(
  modelKey: VideoModelId,
  config: VideoConfigRecord,
): string {
  const mode = resolveVideoMode(modelKey, config);

  if (modelKey === "veo3") {
    const resolution = String(config.resolution || "").trim().toLowerCase();
    return resolution === "4k" ? "veo3.1-pro-4k" : "veo3.1-pro";
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
  config: VideoConfigRecord,
): string[] {
  return resolveVideoMode("sora", config) === "image" ? ["10", "15"] : ["15", "25"];
}

export const SEEDANCE_RATIO_OPTIONS = ["adaptive", "16:9", "9:16", "4:3", "3:4", "1:1", "21:9"];

export function getSeedanceDurationOptions(): string[] {
  return Array.from({ length: 11 }, (_, index) => String(index + 2));
}

export function getHailuoDurationOptions(
  config: VideoConfigRecord,
): string[] {
  const resolution = String(config.resolution || "").trim().toUpperCase();
  return resolution === "1080P" ? ["6"] : ["6", "10"];
}

export function normalizeVideoConfig(
  modelKey: VideoModelId,
  config: VideoConfigRecord,
): void {
  const availableModes = getAvailableVideoModes(modelKey);
  const currentMode = String(config.mode || "");
  if (!availableModes.includes(currentMode as VideoMode)) {
    config.mode = availableModes[0];
  }

  if (modelKey === "veo3") {
    if (typeof config.useFirstLastFrames !== "boolean") {
      config.useFirstLastFrames = Boolean(config.veoUseFirstLastFrames || currentMode === "first-last");
    }
    if (typeof config.veoUseFirstLastFrames !== "boolean") {
      config.veoUseFirstLastFrames = Boolean(config.useFirstLastFrames);
    }
    config.veoUseFirstLastFrames = Boolean(config.useFirstLastFrames);

    const migratedReferenceImages = getVeoReferenceImages(config);
    const migratedReferenceNames = getVeoReferenceImageNames(config);
    const legacyPrimary = String(config.primaryImageSource || "").trim();
    const legacyPrimaryName = String(config.primaryImageName || "").trim();

    if (!migratedReferenceImages.length && legacyPrimary && currentMode === "image") {
      migratedReferenceImages.push(legacyPrimary);
      if (legacyPrimaryName) {
        migratedReferenceNames.push(legacyPrimaryName);
      }
    }

    config.referenceImages = migratedReferenceImages.slice(0, MAX_VEO_REFERENCE_IMAGES);
    config.referenceImageNames = migratedReferenceNames.slice(0, MAX_VEO_REFERENCE_IMAGES);

    if (!String(config.primaryImageSource || "").trim()) {
      config.primaryImageName = "";
    }

    if (!String(config.lastFrameSource || "").trim()) {
      config.lastFrameName = "";
    }

    const mode = resolveVideoMode(modelKey, config);
    config.mode = mode;

    const resolution = String(config.resolution || "").trim().toLowerCase();
    config.resolution = ["720p", "1080p", "4k"].includes(resolution) ? resolution : "720p";

    if (!["16:9", "9:16"].includes(String(config.aspectRatio || ""))) {
      config.aspectRatio = "16:9";
    }

    config.personGeneration = "allow_all";
    config.duration = "8";
    return;
  }

  if (supportsFirstLastFrames(modelKey) && typeof config.useFirstLastFrames !== "boolean") {
    config.useFirstLastFrames = currentMode === "first-last";
  }

  if (!String(config.primaryImageSource || "").trim()) {
    config.primaryImageName = "";
    if (!isFirstLastFramesEnabled(config) && config.mode !== "text") {
      config.mode = "text";
    }
  }

  if (!String(config.lastFrameSource || "").trim()) {
    config.lastFrameName = "";
    if (!isFirstLastFramesEnabled(config) && config.mode === "first-last") {
      config.mode = String(config.primaryImageSource || "").trim() ? "image" : "text";
    }
  }

  config.mode = resolveVideoMode(modelKey, config);

  if (modelKey === "hailuo") {
    const resolution = String(config.resolution || "").trim().toUpperCase();
    config.resolution = resolution === "1080P" ? "1080P" : "768P";

    const duration = String(config.duration || "").trim().replace(/s$/i, "");
    const validDurations = getHailuoDurationOptions(config);
    config.duration = validDurations.includes(duration)
      ? duration
      : config.resolution === "1080P"
        ? "6"
        : "10";

    if (typeof config.promptOptimizer !== "boolean") {
      config.promptOptimizer = true;
    }
  }

  if (modelKey === "seedance") {
    const ratio = String(config.ratio || "").trim();
    config.ratio = SEEDANCE_RATIO_OPTIONS.includes(ratio) ? ratio : "adaptive";

    const resolution = String(config.resolution || "").trim().toLowerCase();
    config.resolution = ["480p", "720p", "1080p"].includes(resolution) ? resolution : "720p";

    const duration = String(config.duration || "").trim().replace(/s$/i, "");
    const validDurations = getSeedanceDurationOptions();
    config.duration = validDurations.includes(duration) ? duration : "5";

    config.framespersecond = "24";

    config.seed = "";

    if (typeof config.camerafixed !== "boolean") {
      config.camerafixed = false;
    }
    config.watermark = false;
    if (typeof config.generateAudio !== "boolean") {
      config.generateAudio = true;
    }
    config.draft = false;
    config.returnLastFrame = false;
  }

  if (modelKey === "sora") {
    const validDurations = getSoraDurationOptions(config);
    if (!validDurations.includes(String(config.duration || ""))) {
      config.duration = validDurations[0];
    }
  }
}
