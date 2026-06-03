import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.ART_WORKSHOP_API_PORT || 8787);
const HOST = process.env.ART_WORKSHOP_API_HOST || "127.0.0.1";
const STORAGE_DIR = path.resolve(process.env.ART_WORKSHOP_STORAGE_DIR || path.join(ROOT_DIR, "server-data"));
const JOBS_DIR = path.join(STORAGE_DIR, "jobs");
const RESULTS_DIR = path.join(STORAGE_DIR, "results");
const MAX_BODY_BYTES = Number(process.env.ART_WORKSHOP_MAX_BODY_BYTES || 96 * 1024 * 1024);
const MAX_CONCURRENT_JOBS = Math.max(1, Number(process.env.ART_WORKSHOP_IMAGE_JOB_CONCURRENCY || 2));
const VECTOR_API_BASE_URL = "https://api.vectorengine.ai";
const CODEX_IMAGE_REMOTE_BASE_URL = "https://sgdr.funai.vip";
const WAVESPEED_REMOTE_BASE_URL = "https://api.wavespeed.ai/api/v3";

const jobs = new Map();
const runtimePayloads = new Map();
const queue = [];
let activeJobCount = 0;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function now() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeId(value, fallback = "") {
  const sanitized = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  return sanitized || fallback;
}

function sanitizeString(value, maxLength = 20000) {
  return String(value || "").slice(0, maxLength);
}

function buildApiUrl(baseUrl, requestPath) {
  if (/^https?:\/\//i.test(requestPath)) {
    return requestPath;
  }

  return `${String(baseUrl || "").replace(/\/+$/, "")}/${String(requestPath || "").replace(/^\/+/, "")}`;
}

function normalizeImageCount(value) {
  const count = Number(value || 1);
  if (!Number.isFinite(count)) {
    return 1;
  }

  return Math.min(Math.max(Math.floor(count), 1), 10);
}

function normalizeDegrees360(degrees) {
  const value = Number(degrees || 0);
  if (!Number.isFinite(value)) {
    return 0;
  }

  return ((Math.round(value) % 360) + 360) % 360;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(Math.max(number, min), max);
}

function mapViewRotationZoomToWaveSpeedDistance(zoom) {
  const value = clampNumber(zoom, 1, 8, 5);
  if (value < 3.2) {
    return 2;
  }
  if (value > 6.6) {
    return 0;
  }
  return 1;
}

function normalizeWaveSpeedSize(value) {
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

function fitWaveSpeedDimensionSize(width, height) {
  const maxDimension = 1536;
  const minDimension = 256;
  const scaleDown = Math.min(1, maxDimension / Math.max(width, height));
  const scaledWidth = width * scaleDown;
  const scaledHeight = height * scaleDown;
  const scaleUp = Math.max(1, minDimension / Math.min(scaledWidth, scaledHeight));

  return `${Math.round(scaledWidth * scaleUp)}*${Math.round(scaledHeight * scaleUp)}`;
}

function dataUrlToBuffer(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.*)$/s);
  if (!match) {
    throw new Error("图片数据格式无效");
  }

  return {
    mimeType: match[1] || "image/png",
    buffer: Buffer.from(match[2] || "", "base64"),
  };
}

function getDataUrlImageExtension(dataUrl) {
  const mime = String(dataUrl || "").match(/^data:(image\/[^;]+)/i)?.[1]?.toLowerCase() || "image/png";
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

function getBufferDimensions(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3 && offset + 8 < buffer.length) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
  }

  return null;
}

function getDataUrlDimensions(source) {
  try {
    const { buffer } = dataUrlToBuffer(source);
    return getBufferDimensions(buffer);
  } catch {
    return null;
  }
}

function resolveWaveSpeedSize(config, sourceImages) {
  const configuredSize = String(config.size || "auto").trim();
  if (configuredSize && configuredSize !== "auto") {
    return normalizeWaveSpeedSize(configuredSize);
  }

  const sourceImage = sourceImages[0];
  if (!sourceImage) {
    return undefined;
  }

  const dimensions = getDataUrlDimensions(sourceImage);
  return dimensions ? fitWaveSpeedDimensionSize(dimensions.width, dimensions.height) : undefined;
}

function appendFormField(formData, key, value) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  formData.append(key, String(value));
}

function buildGeminiParts(prompt, sourceImages) {
  const parts = [{ text: prompt }];
  for (const image of sourceImages) {
    if (!String(image).startsWith("data:image")) {
      continue;
    }

    const mimeType = String(image).match(/data:(image\/[^;]+)/)?.[1] || "image/jpeg";
    const data = String(image).split(",")[1];
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data,
      },
    });
  }

  return parts;
}

function extractErrorMessage(value, seen = new WeakSet()) {
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

  const record = value;
  for (const key of ["error", "message", "detail", "fail_reason", "status_msg", "msg"]) {
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

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(extractErrorMessage(data) || `HTTP ${response.status}`);
  }

  return data;
}

function getWaveSpeedPredictionId(payload) {
  const data = payload.data || {};
  return String(data.id || payload.id || "").trim();
}

async function pollWaveSpeedPrediction(id) {
  const wavespeedApiKey = process.env.WAVESPEED_API_KEY || "";
  let lastPayload = {};

  for (let attempt = 0; attempt < 90; attempt += 1) {
    await sleep(1500);

    const payload = await fetchJson(
      buildApiUrl(WAVESPEED_REMOTE_BASE_URL, `/predictions/${encodeURIComponent(id)}/result`),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(wavespeedApiKey ? { Authorization: `Bearer ${wavespeedApiKey}` } : {}),
        },
      },
    );
    lastPayload = payload;
    const data = payload.data || payload;
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

function extractGeneratedImages(payload, model) {
  const images = [];

  if (model === "gemini-3-pro-image-preview" && Array.isArray(payload.candidates)) {
    for (const candidate of payload.candidates) {
      const content = candidate.content || {};
      const parts = Array.isArray(content.parts) ? content.parts : [];

      for (const part of parts) {
        const inlineData = part.inlineData || part.inline_data;
        if (inlineData?.data) {
          const mimeType = String(inlineData.mimeType || inlineData.mime_type || "image/png");
          images.push(`data:${mimeType};base64,${inlineData.data}`);
          continue;
        }

        const match = String(part.text || "").match(/(data:image\/[^;]+;base64,[^)]+)/);
        if (match?.[1]) {
          images.push(match[1]);
        }
      }
    }
  }

  if (Array.isArray(payload.data)) {
    for (const item of payload.data) {
      if (typeof item.url === "string" && item.url) {
        images.push(item.url);
      } else if (typeof item.b64_json === "string" && item.b64_json) {
        images.push(`data:image/png;base64,${item.b64_json}`);
      }
    }
  }

  if (Array.isArray(payload.choices)) {
    for (const item of payload.choices) {
      const content = item.url || item.message?.content;
      if (typeof content === "string" && (content.startsWith("data:image") || content.startsWith("http"))) {
        images.push(content);
      }
    }
  }

  if (model === "qwen-image-edit-multiple-angles") {
    const root = payload.data || payload;
    for (const collection of [root.outputs, root.images, root.image_urls, root.urls]) {
      if (!Array.isArray(collection)) {
        continue;
      }

      for (const item of collection) {
        if (typeof item === "string" && item.trim()) {
          images.push(item.startsWith("http") || item.startsWith("data:image") ? item : `data:image/png;base64,${item}`);
          continue;
        }
        if (item && typeof item === "object") {
          const url = String(item.url || item.image || item.output || "").trim();
          if (url) {
            images.push(url.startsWith("http") || url.startsWith("data:image") ? url : `data:image/png;base64,${url}`);
          }
        }
      }
    }

    const directImage = String(root.image || root.output_image || "").trim();
    if (directImage) {
      images.push(directImage.startsWith("http") || directImage.startsWith("data:image") ? directImage : `data:image/png;base64,${directImage}`);
    }
  }

  return images;
}

async function generateImages(payload) {
  const model = payload.model;
  const prompt = sanitizeString(payload.prompt, 30000);
  const config = payload.config && typeof payload.config === "object" ? payload.config : {};
  const sourceImages = Array.isArray(payload.sourceImages) ? payload.sourceImages.filter(Boolean).map(String) : [];
  const apiKey = String(payload.apiKey || "");
  const apiBaseUrl = String(payload.apiBaseUrl || "") || VECTOR_API_BASE_URL;

  if (model !== "qwen-image-edit-multiple-angles" && !apiKey.trim()) {
    throw new Error("缺少 API Key");
  }

  let endpoint = buildApiUrl(apiBaseUrl, "/v1/images/generations");
  let body = { model, prompt };

  if (model === "qwen-image-edit-multiple-angles") {
    if (sourceImages.length === 0) {
      throw new Error("多角度生成需要先上传参考图片");
    }
    const wavespeedApiKey = process.env.WAVESPEED_API_KEY || "";
    if (!wavespeedApiKey) {
      throw new Error("服务端缺少 WAVESPEED_API_KEY");
    }

    const size = resolveWaveSpeedSize(config, sourceImages);
    const seed = Number(config.seed);
    endpoint = buildApiUrl(WAVESPEED_REMOTE_BASE_URL, "/wavespeed-ai/qwen-image/edit-multiple-angles");
    body = {
      images: sourceImages.slice(0, 3),
      prompt: prompt.trim() || "Keep the subject identity, outfit, and visual style consistent.",
      horizontal_angle: normalizeDegrees360(config.horizontalAngle),
      vertical_angle: clampNumber(config.verticalAngle, -30, 60, 0),
      distance: clampNumber(config.distance, 0, 2, mapViewRotationZoomToWaveSpeedDistance(config.viewRotationZoom)),
      output_format: String(config.outputFormat || "jpeg"),
      enable_base64_output: false,
      enable_sync_mode: true,
      ...(size ? { size } : {}),
      ...(Number.isFinite(seed) && seed >= 0 ? { seed } : {}),
    };
  } else if (model === "gpt-image-1.5") {
    body = {
      model: "gpt-image-2",
      prompt,
      size: String(config.size || "auto"),
      quality: "high",
      n: normalizeImageCount(config.n),
      background: "auto",
      moderation: "low",
    };

    if (sourceImages.length > 0) {
      endpoint = buildApiUrl(apiBaseUrl, "/v1/images/edits");
      body.images = sourceImages;
    }
  } else if (model === "codex-image-2") {
    const size = String(config.size || "default");
    body = {
      model: "gpt-image-2",
      prompt,
      quality: "high",
      n: normalizeImageCount(config.n),
      background: "auto",
      moderation: "low",
      ...(size !== "default" ? { size } : {}),
    };

    if (sourceImages.length > 0) {
      endpoint = buildApiUrl(apiBaseUrl || CODEX_IMAGE_REMOTE_BASE_URL, "/v1/images/edits");
      body.images = sourceImages;
    } else {
      endpoint = buildApiUrl(apiBaseUrl || CODEX_IMAGE_REMOTE_BASE_URL, "/v1/images/generations");
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
    endpoint = `${buildApiUrl(apiBaseUrl, "/v1beta/models/gemini-3-pro-image-preview:generateContent")}?key=${encodeURIComponent(apiKey)}`;

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
  } else {
    throw new Error(`不支持的图像模型：${model}`);
  }

  const requestImagePayload = async (requestBody) => {
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
        const { mimeType, buffer } = dataUrlToBuffer(image);
        const blob = new Blob([buffer], { type: mimeType });
        formData.append("image[]", blob, `image-${index + 1}.${getDataUrlImageExtension(image)}`);
      });

      return fetchJson(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });
    }

    return fetchJson(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(model === "qwen-image-edit-multiple-angles"
          ? { Authorization: `Bearer ${process.env.WAVESPEED_API_KEY || ""}` }
          : { Authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify(requestBody),
    });
  };

  const splitMultiImageRequest = model === "gpt-image-1.5" || model === "codex-image-2";
  const requestedCount = splitMultiImageRequest ? normalizeImageCount(config.n) : 1;
  const requestBodies = splitMultiImageRequest
    ? Array.from({ length: requestedCount }, () => ({ ...body, n: 1 }))
    : [body];
  const payloadResults = await Promise.allSettled(requestBodies.map((requestBody) => requestImagePayload(requestBody)));
  let payloads = payloadResults.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const firstError = payloadResults.find((result) => result.status === "rejected")?.reason;
  let images = payloads.flatMap((result) => extractGeneratedImages(result, model));

  if (model === "qwen-image-edit-multiple-angles" && images.length === 0 && payloads[0]) {
    const predictionId = getWaveSpeedPredictionId(payloads[0]);
    if (predictionId) {
      const result = await pollWaveSpeedPrediction(predictionId);
      payloads = [result];
      images = extractGeneratedImages(result, model);
    }
  }

  if (images.length === 0) {
    const errorMessage = payloads.map((result) => extractErrorMessage(result)).find(Boolean);
    throw new Error(errorMessage || (firstError instanceof Error ? firstError.message : "") || "未能获取生成的图片");
  }

  return images;
}

async function ensureStorage() {
  await fs.mkdir(JOBS_DIR, { recursive: true });
  await fs.mkdir(RESULTS_DIR, { recursive: true });
}

function getJobFile(jobId) {
  return path.join(JOBS_DIR, `${sanitizeId(jobId)}.json`);
}

async function saveJob(job) {
  job.updatedAt = now();
  await fs.writeFile(getJobFile(job.id), `${JSON.stringify(job, null, 2)}\n`, "utf8");
}

function toPublicJob(job) {
  return {
    id: job.id,
    clientRequestId: job.clientRequestId,
    status: job.status,
    progress: job.progress || "",
    sourceImageCount: job.sourceImageCount || 0,
    prompt: job.prompt || "",
    model: job.model,
    modelConfig: job.modelConfig || {},
    resultImages: job.resultImages || [],
    generationTime: job.generationTime || 0,
    error: job.error || "",
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

async function loadJobs() {
  await ensureStorage();
  const files = await fs.readdir(JOBS_DIR).catch(() => []);
  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }

    try {
      const job = JSON.parse(await fs.readFile(path.join(JOBS_DIR, file), "utf8"));
      if (!job.id || !job.userId) {
        continue;
      }

      if (job.status === "queued" || job.status === "running") {
        job.status = "failed";
        job.error = "服务重启后缺少本次任务的临时 API Key，请重新提交生成。";
        job.progress = "";
        job.generationTime = Math.max(0, now() - Number(job.createdAt || now()));
        await saveJob(job);
      }

      jobs.set(job.id, job);
    } catch (error) {
      console.warn("[art-workshop-api] skip invalid job file", file, error);
    }
  }
}

function getUserId(request) {
  const header = request.headers["x-art-workshop-user"];
  return sanitizeId(Array.isArray(header) ? header[0] : header, "");
}

function assertJobOwner(job, userId) {
  if (!job || job.userId !== userId) {
    throw new HttpError(404, "任务不存在");
  }
}

function findExistingClientJob(userId, clientRequestId) {
  if (!clientRequestId) {
    return null;
  }

  for (const job of jobs.values()) {
    if (job.userId === userId && job.clientRequestId === clientRequestId) {
      return job;
    }
  }

  return null;
}

function enqueueJob(jobId) {
  if (!queue.includes(jobId)) {
    queue.push(jobId);
  }
  processQueue();
}

function processQueue() {
  while (activeJobCount < MAX_CONCURRENT_JOBS && queue.length > 0) {
    const jobId = queue.shift();
    activeJobCount += 1;
    runJob(jobId)
      .catch((error) => {
        console.error("[art-workshop-api] job runner crashed", jobId, error);
      })
      .finally(() => {
        activeJobCount -= 1;
        processQueue();
      });
  }
}

async function persistGeneratedImage(job, source, index) {
  const resultDir = path.join(RESULTS_DIR, sanitizeId(job.userId), sanitizeId(job.id));
  await fs.mkdir(resultDir, { recursive: true });

  let buffer;
  let contentType = "image/png";
  let extension = "png";

  if (/^data:image\//i.test(source)) {
    const decoded = dataUrlToBuffer(source);
    buffer = decoded.buffer;
    contentType = decoded.mimeType;
    extension = getDataUrlImageExtension(source);
  } else if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "ArtWorkshop-ImageJob/1.0",
      },
    });
    if (!response.ok) {
      throw new Error(`下载生成图片失败 (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
    contentType = response.headers.get("content-type") || "image/png";
    if (/jpeg|jpg/i.test(contentType)) {
      extension = "jpg";
    } else if (/webp/i.test(contentType)) {
      extension = "webp";
    } else if (/gif/i.test(contentType)) {
      extension = "gif";
    }
  } else {
    buffer = Buffer.from(source, "base64");
  }

  if (!buffer.length) {
    throw new Error("生成图片为空");
  }

  const filename = `${String(index + 1).padStart(2, "0")}.${extension}`;
  await fs.writeFile(path.join(resultDir, filename), buffer);
  return `/api/image-jobs/${encodeURIComponent(job.id)}/images/${encodeURIComponent(filename)}`;
}

async function runJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }

  const payload = runtimePayloads.get(jobId);
  if (!payload) {
    job.status = "failed";
    job.error = "任务缺少运行参数，请重新提交。";
    job.progress = "";
    job.generationTime = Math.max(0, now() - job.createdAt);
    await saveJob(job);
    return;
  }

  job.status = "running";
  job.progress = "生成中";
  await saveJob(job);

  const startedAt = now();
  try {
    const images = await generateImages(payload);
    job.progress = "保存结果";
    await saveJob(job);

    const resultImages = [];
    for (let index = 0; index < images.length; index += 1) {
      resultImages.push(await persistGeneratedImage(job, images[index], index));
    }

    job.status = "succeeded";
    job.progress = "完成";
    job.resultImages = resultImages;
    job.error = "";
    job.generationTime = now() - startedAt;
  } catch (error) {
    job.status = "failed";
    job.progress = "";
    job.error = error instanceof Error ? error.message : String(error);
    job.generationTime = now() - startedAt;
  } finally {
    runtimePayloads.delete(jobId);
    await saveJob(job);
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "请求体过大");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "JSON 请求体无效");
  }
}

function sendJson(response, statusCode, payload, request) {
  const origin = request.headers.origin || "*";
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type, X-Art-Workshop-User",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  response.end(JSON.stringify(payload));
}

async function createImageJob(request, response) {
  const userId = getUserId(request);
  if (!userId) {
    throw new HttpError(400, "缺少匿名用户标识");
  }

  const body = await readJsonBody(request);
  const clientRequestId = sanitizeId(body.clientRequestId, "");
  const existingJob = findExistingClientJob(userId, clientRequestId);
  if (existingJob) {
    sendJson(response, 200, toPublicJob(existingJob), request);
    return;
  }

  const model = sanitizeString(body.model, 80);
  const prompt = sanitizeString(body.prompt, 30000);
  if (!model || !prompt.trim()) {
    throw new HttpError(400, "缺少模型或提示词");
  }

  const sourceImages = Array.isArray(body.sourceImages) ? body.sourceImages.filter(Boolean).map(String) : [];
  const config = body.config && typeof body.config === "object" ? body.config : {};
  const createdAt = now();
  const job = {
    id: randomUUID(),
    userId,
    clientRequestId,
    status: "queued",
    progress: "排队中",
    sourceImageCount: sourceImages.length,
    prompt,
    model,
    modelConfig: config,
    resultImages: [],
    generationTime: 0,
    error: "",
    createdAt,
    updatedAt: createdAt,
  };

  jobs.set(job.id, job);
  runtimePayloads.set(job.id, {
    model,
    prompt,
    sourceImages,
    config,
    apiBaseUrl: sanitizeString(body.apiBaseUrl || "", 200),
    apiKey: sanitizeString(body.apiKey || "", 2000),
  });
  await saveJob(job);
  enqueueJob(job.id);
  sendJson(response, 202, toPublicJob(job), request);
}

function listUserJobs(request, response) {
  const userId = getUserId(request);
  if (!userId) {
    throw new HttpError(400, "缺少匿名用户标识");
  }

  const requestUrl = new URL(request.url, "http://localhost");
  const limit = Math.min(Math.max(Number(requestUrl.searchParams.get("limit") || 20), 1), 100);
  const userJobs = Array.from(jobs.values())
    .filter((job) => job.userId === userId)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, limit)
    .map(toPublicJob);
  sendJson(response, 200, { jobs: userJobs }, request);
}

function getUserJob(request, response, jobId) {
  const userId = getUserId(request);
  if (!userId) {
    throw new HttpError(400, "缺少匿名用户标识");
  }

  const job = jobs.get(jobId);
  assertJobOwner(job, userId);
  sendJson(response, 200, toPublicJob(job), request);
}

async function serveJobImage(request, response, jobId, filename) {
  const job = jobs.get(jobId);
  if (!job) {
    throw new HttpError(404, "图片不存在");
  }

  const safeFilename = path.basename(filename);
  const imagePath = path.join(RESULTS_DIR, sanitizeId(job.userId), sanitizeId(jobId), safeFilename);
  const ext = path.extname(safeFilename).toLowerCase();
  const contentType =
    ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".webp"
        ? "image/webp"
        : ext === ".gif"
          ? "image/gif"
          : "image/png";
  const data = await fs.readFile(imagePath);
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  response.end(data);
}

async function handleRequest(request, response) {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {}, request);
    return;
  }

  const requestUrl = new URL(request.url, "http://localhost");
  const parts = requestUrl.pathname.split("/").filter(Boolean);

  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, activeJobCount, queuedJobCount: queue.length }, request);
    return;
  }

  if (parts[0] === "api" && parts[1] === "image-jobs") {
    if (request.method === "POST" && parts.length === 2) {
      await createImageJob(request, response);
      return;
    }
    if (request.method === "GET" && parts.length === 2) {
      listUserJobs(request, response);
      return;
    }
    if (request.method === "GET" && parts.length === 3) {
      getUserJob(request, response, parts[2]);
      return;
    }
    if (request.method === "GET" && parts.length === 5 && parts[3] === "images") {
      await serveJobImage(request, response, parts[2], decodeURIComponent(parts[4]));
      return;
    }
  }

  throw new HttpError(404, "接口不存在");
}

async function main() {
  await loadJobs();

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      if (statusCode >= 500) {
        console.error("[art-workshop-api] request failed", error);
      }
      sendJson(response, statusCode, { error: error instanceof Error ? error.message : String(error) }, request);
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`[art-workshop-api] listening on http://${HOST}:${PORT}`);
    console.log(`[art-workshop-api] storage: ${STORAGE_DIR}`);
  });
}

main().catch((error) => {
  console.error("[art-workshop-api] failed to start", error);
  process.exit(1);
});
