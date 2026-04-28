import {
  getFirstLastFrameSources,
  getResolvedVideoModelId,
  getVeoReferenceImages,
  isFirstLastFramesEnabled,
  resolveVideoMode,
} from "@/data/video-models";
import type {
  ImageConfigRecord,
  ImageModelId,
  ImageTask,
  VideoConfigRecord,
  VideoModelId,
  VideoTask,
} from "@/types";

interface GenerateImageArgs {
  model: ImageModelId;
  prompt: string;
  sourceImages: string[];
  config: ImageConfigRecord;
  apiBaseUrl: string;
  apiKey: string;
}

interface GenerateImageResult {
  images: string[];
}

interface SubmitVideoArgs {
  modelKey: VideoModelId;
  config: VideoConfigRecord;
  apiBaseUrl: string;
  apiKey: string;
}

interface SubmitVeoVideoExtensionArgs {
  task: VideoTask;
  prompt: string;
  apiBaseUrl: string;
  apiKey: string;
}

const PROMPT_OPTIMIZER_SYSTEM_PROMPT =
  "你是资深 AI 图像提示词导演。把用户的短描述改写成可直接用于生图的高质量提示词。要求：1) 保留用户原意，不擅自改变主体 2) 补充主体、场景、构图、镜头/相机参数、光线、色彩、材质、风格、细节、画质约束 3) 如果用户是随机生成需求，直接给出一个完整明确的创意提示词 4) 中文输入优先中文输出 5) 只返回最终提示词，不要解释、标题、编号或前缀。";
const PROMPT_OPTIMIZER_MODELS = ["gpt-5.5"];

export const VECTOR_API_BASE_URL = "https://api.vectorengine.ai";
export const CODEX_IMAGE_REMOTE_BASE_URL = "https://sgdr.funai.vip";
export const CODEX_IMAGE_API_BASE_URL = "/codex-image-api";
export const WAVESPEED_API_BASE_URL = "/wavespeed-api";

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

function formatNetworkError(error: unknown) {
  if (error instanceof Error && /failed to fetch|networkerror|load failed/i.test(error.message)) {
    return "网络请求失败：后端连接被关闭或不可达，请检查 API 地址、代理服务和网络连接";
  }

  return error instanceof Error ? error.message : String(error);
}

function sanitizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  const next: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    next[key] = /authorization|api-key|token/i.test(key) ? "Bearer ***" : value;
  });
  return next;
}

function summarizeString(value: string): string {
  if (/^data:image\/[^;]+;base64,/i.test(value)) {
    const mime = value.match(/^data:(image\/[^;]+)/i)?.[1] || "image/*";
    return `[${mime} data url, ${value.length} chars]`;
  }
  return value;
}

function summarizeUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return summarizeString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => summarizeUnknown(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, summarizeUnknown(nested)]),
    );
  }
  return value;
}

function summarizeRequestBody(body: BodyInit | null | undefined): unknown {
  if (!body) {
    return null;
  }

  if (body instanceof FormData) {
    const fields: Record<string, unknown> = {};
    const files: Array<{ field: string; name: string; type: string; size: number }> = [];

    body.forEach((value, key) => {
      if (value instanceof Blob) {
        files.push({
          field: key,
          name: value instanceof File ? value.name : "",
          type: value.type || "application/octet-stream",
          size: value.size,
        });
        return;
      }

      fields[key] = summarizeString(String(value));
    });

    return { type: "FormData", fields, files };
  }

  if (typeof body === "string") {
    try {
      return summarizeUnknown(JSON.parse(body));
    } catch {
      return summarizeString(body);
    }
  }

  return Object.prototype.toString.call(body);
}

function logApiRequest(label: string, url: string, init: RequestInit): void {
  console.groupCollapsed(`[Art Workshop API] ${label}`);
  console.log("request", {
    url,
    method: init.method || "GET",
    headers: sanitizeHeaders(init.headers),
    body: summarizeRequestBody(init.body),
  });
  console.groupEnd();
}

function logApiFailure(url: string, init: RequestInit, response: Response, data: unknown, rawText: string): void {
  console.groupCollapsed(`[Art Workshop API] 请求失败 ${response.status} ${response.statusText}`);
  console.log("request", {
    url,
    method: init.method || "GET",
    headers: sanitizeHeaders(init.headers),
    body: summarizeRequestBody(init.body),
  });
  console.log("response", {
    url: response.url,
    status: response.status,
    statusText: response.statusText,
    headers: sanitizeHeaders(response.headers),
    body: summarizeUnknown(data),
    rawText,
  });
  console.groupEnd();
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

function findVideoBytes(value: unknown, seen = new WeakSet<object>()): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  if (seen.has(value)) {
    return "";
  }
  seen.add(value);

  const record = value as Record<string, unknown>;
  const directBytes = record.videoBytes || record.video_bytes || record.bytes || record.data;
  if (typeof directBytes === "string" && directBytes.trim()) {
    return directBytes.trim();
  }

  for (const nestedValue of Object.values(record)) {
    const nestedBytes = findVideoBytes(nestedValue, seen);
    if (nestedBytes) {
      return nestedBytes;
    }
  }

  return "";
}

function base64ToBlob(base64: string, mimeType = "video/mp4") {
  const normalized = base64.includes(",") ? base64.split(",").pop() || "" : base64;
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

async function responseToVideoBlob(
  response: Response,
  apiKey: string,
  seenUrls = new Set<string>(),
): Promise<Blob> {
  if (!response.ok) {
    throw new Error(`下载视频文件失败 (${response.status})`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (/json/i.test(contentType)) {
    const payload = (await response.json()) as Record<string, unknown>;
    const videoBytes = findVideoBytes(payload);
    if (videoBytes) {
      return base64ToBlob(videoBytes, String(payload.mimeType || payload.mime_type || "video/mp4"));
    }

    const nestedUrl = findVideoUrl(payload);
    if (nestedUrl && !seenUrls.has(nestedUrl)) {
      return fetchVideoBlobFromUrl(nestedUrl, apiKey, false, seenUrls);
    }

    throw new Error(extractErrorMessage(payload) || "视频结果中没有可保存的文件");
  }

  const blob = await response.blob();
  if (!blob.size) {
    throw new Error("下载到的视频文件为空");
  }

  return blob;
}

async function fetchVideoBlobFromUrl(
  url: string,
  apiKey: string,
  withAuthorization = false,
  seenUrls = new Set<string>(),
): Promise<Blob> {
  if (!url) {
    throw new Error("缺少视频文件地址");
  }

  seenUrls.add(url);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "video/*,application/octet-stream,application/json",
      ...(withAuthorization ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  });

  return responseToVideoBlob(response, apiKey, seenUrls);
}

async function fetchJsonWithNetworkError<T>(url: string, init: RequestInit): Promise<T> {
  try {
    return await fetchJson<T>(url, init);
  } catch (error) {
    throw new Error(formatNetworkError(error));
  }
}

function toVertexPersonGeneration(value: unknown) {
  const normalized = String(value || "").trim();

  if (normalized === "allow_all") {
    return "allowAll";
  }

  if (normalized === "dont_allow") {
    return "disallow";
  }

  return normalized || "allowAll";
}

export async function fetchVideoBlob(
  task: VideoTask,
  apiBaseUrl: string,
  apiKey: string,
): Promise<Blob> {
  if (task.videoBlob) {
    return task.videoBlob;
  }

  const candidates: Array<{ url: string; withAuthorization: boolean }> = [];
  const remoteUrl = String(task.remoteVideoUrl || "").trim();
  const playbackUrl = String(task.videoUrl || "").trim();

  if (remoteUrl) {
    candidates.push({ url: remoteUrl, withAuthorization: false });
  }
  if (playbackUrl) {
    candidates.push({ url: playbackUrl, withAuthorization: false });
  }
  if (task.id) {
    candidates.push({
      url: buildApiUrl(apiBaseUrl, `/v1/videos/${encodeURIComponent(task.id)}/content`),
      withAuthorization: true,
    });
  }

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await fetchVideoBlobFromUrl(candidate.url, apiKey, candidate.withAuthorization);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    lastError instanceof Error
      ? lastError.message
      : "无法下载视频文件到 IndexedDB",
  );
}

function findVeoVideoReference(value: unknown, keyHint = "", seen = new WeakSet<object>()): unknown {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^https?:\/\//i.test(trimmed) && /(video|mp4|mov|webm|content)/i.test(`${keyHint} ${trimmed}`)
      ? trimmed
      : null;
  }

  if (typeof value !== "object") {
    return null;
  }

  if (seen.has(value)) {
    return null;
  }
  seen.add(value);

  const record = value as Record<string, unknown>;
  const hasVideoBytes = Boolean(record.videoBytes || record.video_bytes);
  const hasFileReference = Boolean(record.fileUri || record.file_uri || record.uri || record.name);
  const mimeType = String(record.mimeType || record.mime_type || "").toLowerCase();

  if (hasVideoBytes || (hasFileReference && (mimeType.includes("video") || /video/i.test(keyHint)))) {
    return record;
  }

  for (const [key, nestedValue] of Object.entries(record)) {
    if (/^(video|generatedVideo|generated_video)$/i.test(key)) {
      const nested = findVeoVideoReference(nestedValue, key, seen);
      if (nested) {
        return nested;
      }
    }
  }

  for (const [key, nestedValue] of Object.entries(record)) {
    const nested = findVeoVideoReference(nestedValue, key, seen);
    if (nested) {
      return nested;
    }
  }

  return null;
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
    logApiFailure(url, init, response, data, text);
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

function getDataUrlImageExtension(dataUrl: string): string {
  const mime = dataUrl.match(/^data:(image\/[^;]+)/)?.[1]?.toLowerCase() || "image/png";
  if (mime === "image/jpeg" || mime === "image/jpg") {
    return "jpg";
  }
  if (mime === "image/webp") {
    return "webp";
  }
  if (mime === "image/gif") {
    return "gif";
  }
  return "png";
}

function appendFormField(formData: FormData, key: string, value: unknown): void {
  if (value === undefined || value === null || value === "") {
    return;
  }

  formData.append(key, String(value));
}

function normalizeImageCount(value: unknown): number {
  const count = Number(value || 1);
  if (!Number.isFinite(count)) {
    return 1;
  }

  return Math.min(Math.max(Math.floor(count), 1), 10);
}

function normalizeDegrees360(degrees: unknown): number {
  const value = Number(degrees || 0);
  if (!Number.isFinite(value)) {
    return 0;
  }

  return ((Math.round(value) % 360) + 360) % 360;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(Math.max(number, min), max);
}

function mapViewRotationZoomToWaveSpeedDistance(zoom: unknown): number {
  const value = clampNumber(zoom, 1, 8, 5);
  if (value < 3.2) {
    return 2;
  }
  if (value > 6.6) {
    return 0;
  }
  return 1;
}

function normalizeWaveSpeedSize(value: unknown): string | undefined {
  const size = String(value || "").trim();
  const match = size.match(/^(\d+)x(\d+)$/i);
  if (!match) {
    return undefined;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return undefined;
  }

  return `${Math.round(width)}*${Math.round(height)}`;
}

function fitWaveSpeedDimensionSize(width: number, height: number): string {
  const maxDimension = 1536;
  const minDimension = 256;
  const scaleDown = Math.min(1, maxDimension / Math.max(width, height));
  const scaledWidth = width * scaleDown;
  const scaledHeight = height * scaleDown;
  const scaleUp = Math.max(1, minDimension / Math.min(scaledWidth, scaledHeight));

  return `${Math.round(scaledWidth * scaleUp)}*${Math.round(scaledHeight * scaleUp)}`;
}

function getImageDimensions(source: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("无法读取参考图尺寸"));
    image.src = source;
  });
}

async function resolveWaveSpeedSize(config: ImageConfigRecord, sourceImages: string[]): Promise<string | undefined> {
  const configuredSize = String(config.size || "auto").trim();
  if (configuredSize && configuredSize !== "auto") {
    return normalizeWaveSpeedSize(configuredSize);
  }

  const sourceImage = sourceImages[0];
  if (!sourceImage) {
    return undefined;
  }

  const { width, height } = await getImageDimensions(sourceImage);
  return fitWaveSpeedDimensionSize(width, height);
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

  if (model === "qwen-image-edit-multiple-angles") {
    const roots = [
      payload,
      payload.data as Record<string, unknown> | undefined,
      payload.result as Record<string, unknown> | undefined,
      payload.output as Record<string, unknown> | undefined,
    ].filter(Boolean) as Array<Record<string, unknown>>;

    for (const root of roots) {
      const collections = [root.outputs, root.images, root.image_urls, root.urls];
      for (const collection of collections) {
        if (Array.isArray(collection)) {
          for (const item of collection) {
            if (typeof item === "string" && item.trim()) {
              images.push(item.startsWith("http") || item.startsWith("data:image") ? item : `data:image/png;base64,${item}`);
              continue;
            }
            if (item && typeof item === "object") {
              const record = item as Record<string, unknown>;
              const url = String(record.url || record.image || record.output || "").trim();
              if (url) {
                images.push(url.startsWith("http") || url.startsWith("data:image") ? url : `data:image/png;base64,${url}`);
              }
            }
          }
        }
      }

      const directImage = String(root.image || root.output_image || "").trim();
      if (directImage) {
        images.push(
          directImage.startsWith("http") || directImage.startsWith("data:image")
            ? directImage
            : `data:image/png;base64,${directImage}`,
        );
      }
    }
  }

  return images;
}

function getWaveSpeedPredictionId(payload: Record<string, unknown>): string {
  const data = payload.data as Record<string, unknown> | undefined;
  return String(data?.id || payload.id || "").trim();
}

async function pollWaveSpeedPrediction(id: string): Promise<Record<string, unknown>> {
  let lastPayload: Record<string, unknown> = {};

  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1500));

    const requestInit: RequestInit = {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    };
    const payload = await fetchJson<Record<string, unknown>>(
      buildApiUrl(WAVESPEED_API_BASE_URL, `/predictions/${encodeURIComponent(id)}/result`),
      requestInit,
    );
    lastPayload = payload;
    const data = (payload.data as Record<string, unknown> | undefined) || payload;
    const status = String(data.status || payload.status || "").toLowerCase();

    if (status === "completed" || status === "succeeded" || status === "success") {
      return payload;
    }
    if (status === "failed" || status === "error") {
      throw new Error(extractErrorMessage(payload) || "WaveSpeed 多角度生成失败");
    }
  }

  throw new Error(extractErrorMessage(lastPayload) || "WaveSpeed 多角度生成超时");
}

export async function optimizeImagePrompt(
  prompt: string,
  apiBaseUrl: string,
  apiKey: string,
): Promise<string> {
  ensureApiKey(apiKey);

  let lastError: unknown;
  for (const model of PROMPT_OPTIMIZER_MODELS) {
    try {
      const payload = await fetchJson<Record<string, unknown>>(
        buildApiUrl(apiBaseUrl, "/v1/chat/completions"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: PROMPT_OPTIMIZER_SYSTEM_PROMPT },
              { role: "user", content: `请优化这个图像生成提示词：${prompt}` },
            ],
            temperature: 0.6,
            max_tokens: 700,
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

      if (content) {
        return content;
      }

      lastError = new Error("优化失败，未获取到结果");
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError instanceof Error ? lastError.message : "优化失败，未获取到结果");
}

export async function generateImage(args: GenerateImageArgs): Promise<GenerateImageResult> {
  const { apiBaseUrl, apiKey, config, model, prompt, sourceImages } = args;
  if (model !== "qwen-image-edit-multiple-angles") {
    ensureApiKey(apiKey);
  }

  let endpoint = buildApiUrl(apiBaseUrl, "/v1/images/generations");
  let body: Record<string, unknown> = { model, prompt };

  if (model === "qwen-image-edit-multiple-angles") {
    if (sourceImages.length === 0) {
      throw new Error("Qwen 多角度需要先上传参考图片");
    }

    const size = await resolveWaveSpeedSize(config, sourceImages);
    const seed = Number(config.seed);
    endpoint = buildApiUrl(WAVESPEED_API_BASE_URL, "/wavespeed-ai/qwen-image/edit-multiple-angles");
    body = {
      images: sourceImages.slice(0, 3),
      prompt: prompt.trim() || "Keep the subject identity, outfit, and visual style consistent.",
      horizontal_angle: normalizeDegrees360(config.horizontalAngle),
      vertical_angle: clampNumber(config.verticalAngle, -30, 60, 0),
      distance: clampNumber(
        config.distance,
        0,
        2,
        mapViewRotationZoomToWaveSpeedDistance(config.viewRotationZoom),
      ),
      output_format: String(config.outputFormat || "jpeg"),
      enable_base64_output: false,
      enable_sync_mode: true,
      ...(size ? { size } : {}),
      ...(Number.isFinite(seed) && seed >= 0 ? { seed } : {}),
    };
  } else if (model === "gpt-image-1.5") {
    const count = normalizeImageCount(config.n);
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
  } else if (model === "codex-image-2") {
    const size = String(config.size || "default");
    const count = normalizeImageCount(config.n);
    body = {
      model: "gpt-image-2",
      prompt,
      quality: "high",
      n: count,
      background: "auto",
      moderation: "low",
      ...(size !== "default" ? { size } : {}),
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

  const requestImagePayload = async (requestBody: Record<string, unknown>) => {
    if (
      (model === "gpt-image-1.5" || model === "codex-image-2" || model === "gpt-image-1.5-official") &&
      sourceImages.length > 0
    ) {
      const formData = new FormData();
      appendFormField(formData, "model", requestBody.model);
      appendFormField(formData, "prompt", requestBody.prompt);
      appendFormField(formData, "size", requestBody.size);
      appendFormField(formData, "quality", requestBody.quality);
      appendFormField(formData, "n", requestBody.n || 1);
      appendFormField(formData, "background", requestBody.background || "auto");
      appendFormField(formData, "moderation", requestBody.moderation || "auto");

      sourceImages.forEach((image, index) => {
        formData.append("image[]", dataUrlToBlob(image), `image-${index + 1}.${getDataUrlImageExtension(image)}`);
      });

      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      };
      logApiRequest("图像生成请求", endpoint, requestInit);
      return fetchJson<Record<string, unknown>>(endpoint, requestInit);
    }

    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(model === "qwen-image-edit-multiple-angles" ? {} : { Authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify(requestBody),
    };
    logApiRequest("图像生成请求", endpoint, requestInit);
    return fetchJson<Record<string, unknown>>(endpoint, requestInit);
  };

  const splitMultiImageRequest = model === "gpt-image-1.5" || model === "codex-image-2";
  const requestedCount = splitMultiImageRequest ? normalizeImageCount(config.n) : 1;
  const requestBodies = splitMultiImageRequest
    ? Array.from({ length: requestedCount }, () => ({ ...body, n: 1 }))
    : [body];
  const payloadResults = await Promise.allSettled(
    requestBodies.map((requestBody) => requestImagePayload(requestBody)),
  );
  let payloads = payloadResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const firstError = payloadResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  )?.reason;
  let images = payloads.flatMap((payload) => extractGeneratedImages(payload, model));

  if (model === "qwen-image-edit-multiple-angles" && images.length === 0 && payloads[0]) {
    const predictionId = getWaveSpeedPredictionId(payloads[0]);
    if (predictionId) {
      const payload = await pollWaveSpeedPrediction(predictionId);
      payloads = [payload];
      images = extractGeneratedImages(payload, model);
    }
  }

  if (images.length === 0) {
    const errorMessage = payloads.map((payload) => extractErrorMessage(payload)).find(Boolean);
    throw new Error(errorMessage || (firstError instanceof Error ? firstError.message : "") || "未能获取生成的图片");
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

  if (modelKey === "veo3") {
    const useFirstLastFrames = isFirstLastFramesEnabled(config);
    const firstLastSources = getFirstLastFrameSources(config);
    const referenceImages = getVeoReferenceImages(config);
    const resolution = String(config.resolution || "720p").trim().toLowerCase();
    const aspectRatio = String(config.aspectRatio || "16:9").trim();
    const durationSeconds = 8;
    const generateAudio = Boolean(config.generateAudio);
    const personGeneration = String(config.personGeneration || "allow_all");
    const vertexPersonGeneration = toVertexPersonGeneration(personGeneration);

    if (useFirstLastFrames) {
      if (!firstLastSources.first) {
        throw new Error("首尾帧模式需要至少上传一张参考图片");
      }
    } else if (mode === "image" && referenceImages.length === 0) {
      throw new Error("请先上传参考图片");
    }

    const images =
      mode === "first-last"
        ? [firstLastSources.first, firstLastSources.last]
        : referenceImages;

    const response = await fetchJsonWithNetworkError<Record<string, unknown>>(buildApiUrl(apiBaseUrl, "/v1/video/create"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: getResolvedVideoModelId(modelKey, config),
        images,
        prompt,
        aspect_ratio: aspectRatio,
        aspectRatio,
        duration: durationSeconds,
        duration_seconds: durationSeconds,
        durationSeconds,
        resolution,
        enable_upsample: resolution === "4k",
        generate_audio: generateAudio,
        generateAudio,
        person_generation: personGeneration,
        personGeneration: vertexPersonGeneration,
        parameters: {
          aspectRatio,
          durationSeconds,
          generateAudio,
          personGeneration: vertexPersonGeneration,
          resolution,
          sampleCount: 1,
        },
      }),
    });

    return {
      id: String(response.request_id || response.id || "").trim(),
      modelKey,
      modelTitle: "Veo 3.1",
      prompt,
      modelConfig:
        mode === "first-last"
          ? { ...config, primaryImageSource: firstLastSources.first, lastFrameSource: firstLastSources.last }
          : { ...config },
      sourceImages: images,
      status: String(response.status || "IN_QUEUE"),
      phase: "pending",
      progress: "",
      error: "",
      videoUrl: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      responseUrl: String(response.response_url || ""),
      statusUrl: String(response.status_url || ""),
      endpoint: "/v1/video/create",
      raw: response,
    };
  }

  const firstLastSources = getFirstLastFrameSources(config);
  if (mode === "image" && !String(config.primaryImageSource || "").trim()) {
    throw new Error("请先上传参考图片");
  }

  if (mode === "first-last" && !firstLastSources.first) {
    throw new Error("首尾帧模式需要至少上传一张参考图片");
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
            ? { first_frame_image: mode === "first-last" ? firstLastSources.first : config.primaryImageSource }
            : {}),
          ...(mode === "first-last" ? { last_frame_image: firstLastSources.last } : {}),
        }),
      },
    );

    return {
      id: String(response.task_id || (response.data as Record<string, unknown> | undefined)?.task_id || "").trim(),
      modelKey,
      modelTitle: "海螺 Hailuo",
      prompt,
      modelConfig:
        mode === "first-last"
          ? { ...config, primaryImageSource: firstLastSources.first, lastFrameSource: firstLastSources.last }
          : { ...config },
      sourceImages:
        mode === "image" || mode === "first-last"
          ? [
              mode === "first-last" ? firstLastSources.first : String(config.primaryImageSource || ""),
              ...(mode === "first-last" ? [firstLastSources.last] : []),
            ].filter(Boolean)
          : [],
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
        image_url: { url: firstLastSources.first },
        role: "first_frame",
      });
      content.push({
        type: "image_url",
        image_url: { url: firstLastSources.last },
        role: "last_frame",
      });
    }

    const body: Record<string, unknown> = {
      model: getResolvedVideoModelId(modelKey, config),
      content,
      ratio: config.ratio,
      duration: Number(config.duration),
      resolution: config.resolution,
      camerafixed: Boolean(config.camerafixed),
      watermark: false,
      generate_audio: Boolean(config.generateAudio),
      draft: false,
      return_last_frame: false,
    };

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
      prompt,
      modelConfig:
        mode === "first-last"
          ? { ...config, primaryImageSource: firstLastSources.first, lastFrameSource: firstLastSources.last }
          : { ...config },
      sourceImages:
        mode === "image" || mode === "first-last"
          ? [
              mode === "first-last" ? firstLastSources.first : String(config.primaryImageSource || ""),
              ...(mode === "first-last" ? [firstLastSources.last] : []),
            ].filter(Boolean)
          : [],
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

  const response = await fetchJsonWithNetworkError<Record<string, unknown>>(buildApiUrl(apiBaseUrl, "/v1/video/create"), {
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
    prompt,
    modelConfig: { ...config },
    sourceImages: mode === "image" ? [String(config.primaryImageSource || "")] : [],
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

export async function submitVeoVideoExtension({
  apiBaseUrl,
  apiKey,
  prompt,
  task,
}: SubmitVeoVideoExtensionArgs): Promise<VideoTask> {
  ensureApiKey(apiKey);

  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    throw new Error("请先输入延长视频提示词");
  }

  if (task.modelKey !== "veo3") {
    throw new Error("只有 Veo 3.1 视频支持延长");
  }

  const sourceVideoUrl = String(task.remoteVideoUrl || task.videoUrl || "").trim();
  if (!sourceVideoUrl) {
    throw new Error("当前视频还没有可用于延长的结果文件");
  }
  if (sourceVideoUrl.startsWith("blob:") && !task.raw && !task.modelConfig?.sourceVideoReference) {
    throw new Error("本地保存的视频缺少 Veo 延长所需的生成引用，无法继续延长");
  }

  const sourceResolution = String(task.modelConfig?.resolution || "720p").trim().toLowerCase();
  if (sourceResolution !== "720p") {
    throw new Error("Veo 延长仅支持 720p 输入视频，请用 720p 重新生成后再延长");
  }

  const aspectRatio = String(task.modelConfig?.aspectRatio || "16:9").trim();
  const generateAudio = Boolean(task.modelConfig?.generateAudio ?? true);
  const extensionCount = Number(task.modelConfig?.extensionCount || 0);
  if (Number.isFinite(extensionCount) && extensionCount >= 20) {
    throw new Error("该视频已达到最多 20 次延长限制");
  }

  const videoReference =
    findVeoVideoReference(task.raw) ||
    findVeoVideoReference(task.modelConfig?.sourceVideoReference) ||
    sourceVideoUrl;
  const modelConfig: VideoConfigRecord = {
    ...(task.modelConfig || {}),
    mode: "extend",
    prompt: trimmedPrompt,
    duration: "7",
    resolution: "720p",
    personGeneration: "allow_all",
    sourceVideoId: task.id,
    sourceVideoUrl,
    sourceVideoReference: typeof videoReference === "string" ? videoReference : "",
    extensionCount: Number.isFinite(extensionCount) ? extensionCount + 1 : 1,
  };
  const response = await fetchJsonWithNetworkError<Record<string, unknown>>(buildApiUrl(apiBaseUrl, "/v1/video/create"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getResolvedVideoModelId("veo3", modelConfig),
      prompt: trimmedPrompt,
      video: videoReference,
      video_url: sourceVideoUrl,
      source_video_url: sourceVideoUrl,
      source_video_id: task.id,
      aspect_ratio: aspectRatio,
      aspectRatio,
      duration: 7,
      duration_seconds: 7,
      durationSeconds: 7,
      resolution: "720p",
      number_of_videos: 1,
      person_generation: "allow_all",
      personGeneration: "allowAll",
      generate_audio: generateAudio,
      generateAudio,
      extend: true,
      parameters: {
        aspectRatio,
        durationSeconds: 7,
        generateAudio,
        personGeneration: "allowAll",
        resolution: "720p",
        sampleCount: 1,
      },
    }),
  });

  return {
    id: String(response.request_id || response.id || "").trim(),
    modelKey: "veo3",
    modelTitle: "Veo 3.1",
    prompt: trimmedPrompt,
    modelConfig,
    sourceImages: [],
    status: String(response.status || "IN_QUEUE"),
    phase: "pending",
    progress: "",
    error: "",
    videoUrl: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    responseUrl: String(response.response_url || ""),
    statusUrl: String(response.status_url || ""),
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
      buildApiUrl(apiBaseUrl, `/v1/video/query?id=${encodeURIComponent(task.id)}`),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    let payload = response;
    let videoUrl = String(response.video_url || (response.data as Record<string, unknown> | undefined)?.video_url || "").trim();
    const status = String(response.status || "").trim() || "pending";
    const error = extractErrorMessage(response);

    if (!videoUrl && isSuccessStatus(status)) {
      try {
        payload = await fetchJson<Record<string, unknown>>(
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
          String(payload.video_url || (payload.data as Record<string, unknown> | undefined)?.video_url || "").trim() ||
          findVideoUrl(payload);
      } catch {
        payload = response;
      }
    }

    if (videoUrl && !isErrorStatus(status)) {
      return { status, phase: "success", progress: "100%", error: "", videoUrl, raw: payload };
    }
    if (isErrorStatus(status)) {
      return { status, phase: "error", error: error || "Veo 3.1 任务失败", raw: payload };
    }
    return {
      status,
      phase: "pending",
      progress: String((response.data as Record<string, unknown> | undefined)?.progress || response.progress || task.progress || ""),
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
