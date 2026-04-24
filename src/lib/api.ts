import { getResolvedVideoModelId, resolveVideoMode } from "@/data/video-models";
import type {
  ImageModelId,
  ImageTask,
  VideoModelId,
  VideoTask,
} from "@/types";

interface GenerateImageArgs {
  model: ImageModelId;
  prompt: string;
  sourceImages: string[];
  config: Record<string, string | number | boolean>;
  apiBaseUrl: string;
  apiKey: string;
}

interface GenerateImageResult {
  images: string[];
}

interface SubmitVideoArgs {
  modelKey: VideoModelId;
  config: Record<string, string | number | boolean>;
  apiBaseUrl: string;
  apiKey: string;
}

const PROMPT_OPTIMIZER_SYSTEM_PROMPT =
  "你是一个专业的AI图像生成提示词优化助手。你的任务是将用户提供的简单描述优化成详细、具体、适合AI图像生成的提示词。优化后的提示词应该：1) 包含具体的视觉细节（颜色、光线、构图等）2) 使用专业的摄影或艺术术语 3) 保持原意但更加生动和详细 4) 使用换行和逗号分隔不同的描述要素，让结构清晰 5) 关键的视觉元素用简短的短语表达 6) 直接返回优化后的提示词，不要有任何解释或前缀。";

export function buildApiUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${baseUrl.replace(/\/+$/, "")}/${String(path || "").replace(/^\/+/, "")}`;
}

export function isErrorStatus(status: string): boolean {
  return /fail|failed|error|cancel|rejected|expired/i.test(String(status || ""));
}

export function isSuccessStatus(status: string): boolean {
  return /success|succeeded|completed|done|finished/i.test(String(status || ""));
}

export function extractErrorMessage(value: unknown, seen = new WeakSet<object>()): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed && !/^https?:\/\//i.test(trimmed) ? trimmed : "";
  }

  if (typeof value !== "object") {
    return "";
  }

  if (seen.has(value)) {
    return "";
  }
  seen.add(value);

  const record = value as Record<string, unknown>;
  const keys = ["error", "message", "detail", "fail_reason", "status_msg", "msg"];
  for (const key of keys) {
    if (record[key]) {
      const nested = extractErrorMessage(record[key], seen);
      if (nested) {
        return nested;
      }
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractErrorMessage(item, seen);
      if (nested) {
        return nested;
      }
    }
    return "";
  }

  for (const nestedValue of Object.values(record)) {
    const nested = extractErrorMessage(nestedValue, seen);
    if (nested) {
      return nested;
    }
  }

  return "";
}

export function findVideoUrl(value: unknown, keyHint = "", seen = new WeakSet<object>()): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const likelyUrl = /^https?:\/\//i.test(trimmed);
    const likelyVideo =
      /\.(mp4|mov|webm|m3u8)(\?|$)/i.test(trimmed) ||
      /(video|download|output\.mp4|content\/)/i.test(trimmed);

    if (likelyUrl && (likelyVideo || /(video_url|download_url|url)/i.test(keyHint))) {
      return trimmed;
    }

    return "";
  }

  if (typeof value !== "object") {
    return "";
  }

  if (seen.has(value)) {
    return "";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideoUrl(item, keyHint, seen);
      if (found) {
        return found;
      }
    }
    return "";
  }

  for (const [key, nested] of Object.entries(value)) {
    const found = findVideoUrl(nested, key, seen);
    if (found) {
      return found;
    }
  }

  return "";
}

async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();

  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(extractErrorMessage(data) || `HTTP ${response.status}`);
  }

  return data as T;
}

function ensureApiKey(apiKey: string): void {
  if (!String(apiKey || "").trim()) {
    throw new Error("请先在设置中配置 API Key");
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, base64] = dataUrl.split(",");
  const mime = meta.match(/data:(image\/[^;]+)/)?.[1] || "image/png";
  const binary = atob(base64 || "");
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mime });
}

function buildGeminiParts(prompt: string, sourceImages: string[]): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  for (const image of sourceImages) {
    if (!image.startsWith("data:image")) {
      continue;
    }

    const mimeType = image.match(/data:(image\/[^;]+)/)?.[1] || "image/jpeg";
    const data = image.split(",")[1];
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data,
      },
    });
  }

  return parts;
}

function extractGeneratedImages(payload: Record<string, unknown>, model: ImageModelId): string[] {
  const images: string[] = [];

  if (model === "gemini-3-pro-image-preview" && Array.isArray(payload.candidates)) {
    for (const candidate of payload.candidates as Array<Record<string, unknown>>) {
      const content = candidate.content as Record<string, unknown> | undefined;
      const parts = Array.isArray(content?.parts) ? (content.parts as Array<Record<string, unknown>>) : [];

      for (const part of parts) {
        const inlineData = (part.inlineData || part.inline_data) as
          | Record<string, unknown>
          | undefined;

        if (inlineData?.data) {
          const mimeType =
            String(inlineData.mimeType || inlineData.mime_type || "image/png");
          images.push(`data:${mimeType};base64,${inlineData.data}`);
          continue;
        }

        const text = String(part.text || "");
        const match = text.match(/(data:image\/[^;]+;base64,[^)]+)/);
        if (match?.[1]) {
          images.push(match[1]);
        }
      }
    }
  }

  if (Array.isArray(payload.data)) {
    for (const item of payload.data as Array<Record<string, unknown>>) {
      if (typeof item.url === "string" && item.url) {
        images.push(item.url);
      } else if (typeof item.b64_json === "string" && item.b64_json) {
        images.push(`data:image/png;base64,${item.b64_json}`);
      }
    }
  }

  if (Array.isArray(payload.choices)) {
    for (const item of payload.choices as Array<Record<string, unknown>>) {
      const content = item.url || (item.message as Record<string, unknown> | undefined)?.content;
      if (typeof content === "string" && (content.startsWith("data:image") || content.startsWith("http"))) {
        images.push(content);
      }
    }
  }

  return images;
}

export async function optimizeImagePrompt(
  prompt: string,
  apiBaseUrl: string,
  apiKey: string,
): Promise<string> {
  ensureApiKey(apiKey);

  const payload = await fetchJson<Record<string, unknown>>(
    buildApiUrl(apiBaseUrl, "/v1/chat/completions"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: PROMPT_OPTIMIZER_SYSTEM_PROMPT },
          { role: "user", content: `请优化这个图像生成提示词：${prompt}` },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    },
  );

  const content = (
    ((payload.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as
      | Record<string, unknown>
      | undefined)?.content || ""
  )
    .toString()
    .trim();

  if (!content) {
    throw new Error("优化失败，未获取到结果");
  }

  return content;
}

export async function generateImage(args: GenerateImageArgs): Promise<GenerateImageResult> {
  const { apiBaseUrl, apiKey, config, model, prompt, sourceImages } = args;
  ensureApiKey(apiKey);

  let endpoint = buildApiUrl(apiBaseUrl, "/v1/images/generations");
  let body: Record<string, unknown> = { model, prompt };

  if (model === "gpt-image-1.5") {
    const count = Number(config.n || 1);
    const size = String(config.size || "auto");
    body = {
      model: "gpt-image-2",
      prompt,
      size,
      quality: "high",
      n: count,
      background: "auto",
      moderation: "low",
    };

    if (sourceImages.length > 0) {
      endpoint = buildApiUrl(apiBaseUrl, "/v1/images/edits");
      body.images = sourceImages;
    }
  } else if (model === "gpt-image-1.5-official") {
    body = {
      model: "gpt-image-1.5",
      prompt,
      size: String(config.size || "1024x1024"),
      quality: "auto",
      n: 1,
      background: String(config.transparency || "auto"),
      moderation: "auto",
    };

    if (sourceImages.length > 0) {
      endpoint = buildApiUrl(apiBaseUrl, "/v1/images/edits");
      body.images = sourceImages;
    }
  } else if (model === "gemini-3-pro-image-preview") {
    endpoint = `${buildApiUrl(
      apiBaseUrl,
      "/v1beta/models/gemini-3-pro-image-preview:generateContent",
    )}?key=${encodeURIComponent(apiKey)}`;

    let effectivePrompt = prompt;
    if (config.aspectRatio && config.aspectRatio !== "auto") {
      effectivePrompt = `${effectivePrompt}, aspect ratio ${config.aspectRatio}`;
    }
    if (config.imageSize && config.imageSize !== "auto") {
      effectivePrompt = `${effectivePrompt}, ${config.imageSize} resolution`;
    }

    body = {
      contents: [
        {
          role: "user",
          parts: buildGeminiParts(effectivePrompt, sourceImages),
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig:
          config.aspectRatio !== "auto" || config.imageSize !== "auto"
            ? {
                ...(config.aspectRatio !== "auto" ? { aspectRatio: config.aspectRatio } : {}),
                ...(config.imageSize !== "auto" ? { imageSize: config.imageSize } : {}),
              }
            : undefined,
      },
    };
  }

  let payload: Record<string, unknown>;
  if (
    (model === "gpt-image-1.5" || model === "gpt-image-1.5-official") &&
    sourceImages.length > 0
  ) {
    const formData = new FormData();
    formData.append("model", String(body.model || ""));
    formData.append("prompt", String(body.prompt || ""));
    formData.append("size", String(body.size || ""));
    formData.append("quality", String(body.quality || ""));
    formData.append("n", String(body.n || 1));
    formData.append("background", String(body.background || "auto"));
    formData.append("moderation", String(body.moderation || "auto"));

    sourceImages.forEach((image, index) => {
      formData.append("image", dataUrlToBlob(image), `image-${index + 1}.png`);
    });

    payload = await fetchJson<Record<string, unknown>>(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });
  } else {
    payload = await fetchJson<Record<string, unknown>>(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  }

  const images = extractGeneratedImages(payload, model);
  if (images.length === 0) {
    throw new Error(extractErrorMessage(payload) || "未能获取生成的图片");
  }

  return { images };
}

export async function submitVideoTask({
  apiBaseUrl,
  apiKey,
  config,
  modelKey,
}: SubmitVideoArgs): Promise<VideoTask> {
  ensureApiKey(apiKey);

  const mode = resolveVideoMode(modelKey, config);
  const prompt = String(config.prompt || "").trim();
  if (!prompt) {
    throw new Error("请先输入视频提示词");
  }

  if ((mode === "image" || mode === "first-last") && !String(config.primaryImageSource || "").trim()) {
    throw new Error("请先上传参考图片");
  }

  if (mode === "first-last" && !String(config.lastFrameSource || "").trim()) {
    throw new Error("首尾帧模式需要上传尾帧图片");
  }

  if (modelKey === "veo3") {
    const endpoint = mode === "image" ? "/fal-ai/veo3/image-to-video" : "/fal-ai/veo3";
    const response = await fetchJson<Record<string, unknown>>(buildApiUrl(apiBaseUrl, endpoint), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        prompt,
        aspect_ratio: config.aspectRatio,
        duration: config.duration,
        resolution: config.resolution,
        generate_audio: Boolean(config.generateAudio),
        ...(mode === "image"
          ? { image_url: config.primaryImageSource }
          : {
              enhance_prompt: Boolean(config.enhancePrompt),
              auto_fix: Boolean(config.autoFix),
            }),
      }),
    });

    return {
      id: String(response.request_id || response.id || "").trim(),
      modelKey,
      modelTitle: "Veo 3",
      status: String(response.status || "IN_QUEUE"),
      phase: "pending",
      progress: "",
      error: "",
      videoUrl: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      responseUrl: String(response.response_url || ""),
      statusUrl: String(response.status_url || ""),
      endpoint,
      raw: response,
    };
  }

  if (modelKey === "hailuo") {
    const response = await fetchJson<Record<string, unknown>>(
      buildApiUrl(apiBaseUrl, "/minimax/v1/video_generation"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: getResolvedVideoModelId(modelKey, config),
          prompt,
          duration: Number(config.duration),
          resolution: config.resolution,
          prompt_optimizer: Boolean(config.promptOptimizer),
          ...(mode === "image" || mode === "first-last"
            ? { first_frame_image: config.primaryImageSource }
            : {}),
          ...(mode === "first-last" ? { last_frame_image: config.lastFrameSource } : {}),
        }),
      },
    );

    return {
      id: String(response.task_id || (response.data as Record<string, unknown> | undefined)?.task_id || "").trim(),
      modelKey,
      modelTitle: "海螺 Hailuo",
      status: "SUBMITTED",
      phase: "pending",
      progress: "",
      error: "",
      videoUrl: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      endpoint: "/minimax/v1/video_generation",
      raw: response,
    };
  }

  if (modelKey === "seedance") {
    const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
    if (mode === "image") {
      content.push({
        type: "image_url",
        image_url: { url: config.primaryImageSource },
      });
    }
    if (mode === "first-last") {
      content.push({
        type: "image_url",
        image_url: { url: config.primaryImageSource },
        role: "first_frame",
      });
      content.push({
        type: "image_url",
        image_url: { url: config.lastFrameSource },
        role: "last_frame",
      });
    }

    const body: Record<string, unknown> = {
      model: getResolvedVideoModelId(modelKey, config),
      content,
    };

    if (mode !== "first-last") {
      body.ratio = config.ratio;
      body.duration = Number(config.duration);
      body.resolution = config.resolution;
      body.framespersecond = Number(config.framespersecond);
      if (String(config.seed || "").trim()) {
        body.seed = Number(config.seed);
      }
      body.camerafixed = Boolean(config.camerafixed);
      body.watermark = Boolean(config.watermark);
      body.generate_audio = Boolean(config.generateAudio);
      body.return_last_frame = Boolean(config.returnLastFrame);
    }

    const response = await fetchJson<Record<string, unknown>>(
      buildApiUrl(apiBaseUrl, "/volc/v1/contents/generations/tasks"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
    );

    return {
      id: String(response.id || "").trim(),
      modelKey,
      modelTitle: "Seedance 1.5",
      status: String(response.status || "submitted"),
      phase: "pending",
      progress: "",
      error: "",
      videoUrl: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      endpoint: "/volc/v1/contents/generations/tasks",
      raw: response,
    };
  }

  const response = await fetchJson<Record<string, unknown>>(buildApiUrl(apiBaseUrl, "/v1/video/create"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      images: mode === "image" ? [config.primaryImageSource] : [],
      model: getResolvedVideoModelId(modelKey, config),
      orientation: config.orientation,
      prompt,
      size: config.size,
      duration: Number(config.duration),
      watermark: Boolean(config.watermark),
      private: Boolean(config.isPrivate),
    }),
  });

  return {
    id: String(response.id || "").trim(),
    modelKey,
    modelTitle: "Sora 2",
    status: String(response.status || "pending"),
    phase: "pending",
    progress: "",
    error: "",
    videoUrl: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    endpoint: "/v1/video/create",
    raw: response,
  };
}

export async function pollVideoTask(
  task: VideoTask,
  apiBaseUrl: string,
  apiKey: string,
): Promise<Partial<VideoTask>> {
  ensureApiKey(apiKey);

  if (task.modelKey === "veo3") {
    const response = await fetchJson<Record<string, unknown>>(
      buildApiUrl(apiBaseUrl, `/fal-ai/veo3/requests/${encodeURIComponent(task.id)}`),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    let payload = response;
    let videoUrl = findVideoUrl(payload);
    if (!videoUrl && task.responseUrl) {
      try {
        payload = await fetchJson<Record<string, unknown>>(task.responseUrl, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
        });
        videoUrl = findVideoUrl(payload);
      } catch {
        payload = response;
      }
    }

    const status = String(payload.status || response.status || "").trim() || "IN_PROGRESS";
    const error = extractErrorMessage(payload) || extractErrorMessage(response);

    if (videoUrl && !isErrorStatus(status)) {
      return { status, phase: "success", progress: "100%", error: "", videoUrl, raw: payload };
    }
    if (isErrorStatus(status)) {
      return { status, phase: "error", error: error || "Veo 任务失败", raw: payload };
    }
    return {
      status,
      phase: "pending",
      progress: String(response.progress || task.progress || ""),
      error: error || "",
      raw: payload,
    };
  }

  if (task.modelKey === "hailuo") {
    const response = await fetchJson<Record<string, unknown>>(
      buildApiUrl(apiBaseUrl, `/minimax/v1/query/video_generation?task_id=${encodeURIComponent(task.id)}`),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    const root = (response.data as Record<string, unknown> | undefined) || response;
    const status = String(root.status || response.status || "").trim() || "PROCESSING";
    const error = extractErrorMessage(response);
    const fileNode = (root.data as Record<string, unknown> | undefined)?.file as
      | Record<string, unknown>
      | undefined;
    let videoUrl =
      String(fileNode?.download_url || fileNode?.backup_download_url || "").trim() ||
      findVideoUrl(response);
    const fileId = String(root.file_id || (root.data as Record<string, unknown> | undefined)?.file_id || fileNode?.file_id || "").trim();

    if (!videoUrl && isSuccessStatus(status) && fileId) {
      try {
        const fileResponse = await fetchJson<Record<string, unknown>>(
          buildApiUrl(apiBaseUrl, `/minimax/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`),
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
          },
        );
        videoUrl =
          String(
            (fileResponse.file as Record<string, unknown> | undefined)?.download_url ||
              (fileResponse.file as Record<string, unknown> | undefined)?.backup_download_url ||
              "",
          ).trim() || findVideoUrl(fileResponse);
      } catch {
        // ignore follow-up fetch failure and keep polling
      }
    }

    if (videoUrl && !isErrorStatus(status)) {
      return {
        status,
        phase: "success",
        progress: String(root.progress || "100%"),
        error: "",
        videoUrl,
        raw: response,
      };
    }
    if (isErrorStatus(status)) {
      return { status, phase: "error", error: error || "海螺任务失败", raw: response };
    }
    return {
      status,
      phase: "pending",
      progress: String(root.progress || ""),
      error: error || "",
      raw: response,
    };
  }

  if (task.modelKey === "seedance") {
    let response: Record<string, unknown> | null = null;
    let current: Record<string, unknown> | undefined;

    try {
      response = await fetchJson<Record<string, unknown>>(
        buildApiUrl(apiBaseUrl, `/volc/v1/contents/generations/tasks/${encodeURIComponent(task.id)}`),
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
        },
      );
      current = response;
    } catch {
      response = await fetchJson<Record<string, unknown>>(
        buildApiUrl(apiBaseUrl, "/volc/v1/contents/generations/tasks?page_size=20"),
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
        },
      );

      const items = Array.isArray(response.items) ? (response.items as Array<Record<string, unknown>>) : [];
      current = items.find((item) => String(item.id) === String(task.id));
    }

    if (!current) {
      return { status: "submitted", phase: "pending", progress: "", error: "", raw: response || undefined };
    }

    const status = String(current.status || "").trim() || "submitted";
    const error = extractErrorMessage(current) || extractErrorMessage(response);
    const videoUrl =
      String((current.content as Record<string, unknown> | undefined)?.video_url || "").trim() ||
      String(current.video_url || "").trim() ||
      findVideoUrl(current);

    if (videoUrl && !isErrorStatus(status)) {
      return { status, phase: "success", progress: "100%", error: "", videoUrl, raw: current };
    }
    if (isErrorStatus(status)) {
      return { status, phase: "error", error: error || "Seedance 任务失败", raw: current };
    }
    return { status, phase: "pending", progress: "", error: error || "", raw: current };
  }

  const response = await fetchJson<Record<string, unknown>>(
    buildApiUrl(apiBaseUrl, `/v1/video/query?id=${encodeURIComponent(task.id)}`),
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );

  let videoUrl = String(response.video_url || (response.data as Record<string, unknown> | undefined)?.video_url || "").trim();
  const status = String(response.status || "").trim() || "pending";
  const error = extractErrorMessage(response);

  if (!videoUrl && isSuccessStatus(status)) {
    try {
      const contentResponse = await fetchJson<Record<string, unknown>>(
        buildApiUrl(apiBaseUrl, `/v1/videos/${encodeURIComponent(task.id)}/content`),
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
        },
      );
      videoUrl =
        String(contentResponse.video_url || (contentResponse.data as Record<string, unknown> | undefined)?.video_url || "").trim() ||
        findVideoUrl(contentResponse);
    } catch {
      // ignore and keep polling
    }
  }

  if (videoUrl && !isErrorStatus(status)) {
    return { status, phase: "success", progress: "100%", error: "", videoUrl, raw: response };
  }
  if (isErrorStatus(status)) {
    return { status, phase: "error", error: error || "Sora 任务失败", raw: response };
  }
  return { status, phase: "pending", progress: "", error: error || "", raw: response };
}

export function createImageTask(task: Omit<ImageTask, "id">): ImageTask {
  return {
    ...task,
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `task-${Date.now()}`,
  };
}

