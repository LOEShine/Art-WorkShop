import http from "node:http";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.ART_WORKSHOP_API_PORT || 8787);
const HOST = process.env.ART_WORKSHOP_API_HOST || "127.0.0.1";
const STORAGE_DIR = path.resolve(process.env.ART_WORKSHOP_STORAGE_DIR || path.join(ROOT_DIR, "server-data"));
const JOBS_DIR = path.join(STORAGE_DIR, "jobs");
const RESULTS_DIR = path.join(STORAGE_DIR, "results");
const REFERENCES_DIR = path.join(STORAGE_DIR, "references");
const MAX_BODY_BYTES = Number(process.env.ART_WORKSHOP_MAX_BODY_BYTES || 96 * 1024 * 1024);
const MAX_CONCURRENT_JOBS = Math.max(1, Number(process.env.ART_WORKSHOP_IMAGE_JOB_CONCURRENCY || 2));
const REQUEST_FINGERPRINT_CACHE_TTL_MS = Number(
  process.env.ART_WORKSHOP_IMAGE_JOB_CACHE_TTL_MS || 15 * 60 * 1000,
);
const ADMIN_PIN = String(process.env.ART_WORKSHOP_ADMIN_PIN || "1113");
const VECTOR_API_BASE_URL = "https://api.vectorengine.ai";
const CODEX_IMAGE_REMOTE_BASE_URL = "https://www.tokenbook.cc/v1";
const WAVESPEED_REMOTE_BASE_URL = "https://api.wavespeed.ai/api/v3";
const IP_GEO_API_URL = String(process.env.ART_WORKSHOP_IP_GEO_API_URL || "https://freeipapi.com/api/json/{ip}").trim();
const IP_GEO_LOOKUP_TIMEOUT_MS = Math.max(500, Number(process.env.ART_WORKSHOP_IP_GEO_TIMEOUT_MS || 8000));
const TRUST_PROXY_HEADERS = String(process.env.ART_WORKSHOP_TRUST_PROXY_HEADERS || "true").toLowerCase() !== "false";
const CODEX_IMAGE_LEGACY_API_KEY = "sk-0427d5c8903aabdf3d0df00a85d33fbc6a8bce0811cc231b4dd54622c74f16fa";
const CODEX_IMAGE_REPLACEMENT_API_KEY = "sk-09b7dd6f5f936a2576fabb314eb821d80be5daba9cebfa5a822ca9bc0bf3cfb7";

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

function compactRecord(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (value === undefined || value === null || value === "") {
        return false;
      }
      if (Array.isArray(value) && value.length === 0) {
        return false;
      }
      if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
        return false;
      }
      return true;
    }),
  );
}

function sanitizeNumber(value, min = -Infinity, max = Infinity) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return undefined;
  }
  return Math.min(Math.max(number, min), max);
}

function sanitizeBoolean(value) {
  return typeof value === "boolean" ? value : undefined;
}

function sanitizeStringArray(value, maxItems = 12, maxLength = 120) {
  return Array.isArray(value)
    ? value
        .slice(0, maxItems)
        .map((item) => sanitizeString(item, maxLength).trim())
        .filter(Boolean)
    : [];
}

function sanitizeDimensionRecord(value) {
  const record = value && typeof value === "object" ? value : {};
  return compactRecord({
    width: sanitizeNumber(record.width, 0, 20000),
    height: sanitizeNumber(record.height, 0, 20000),
    availWidth: sanitizeNumber(record.availWidth, 0, 20000),
    availHeight: sanitizeNumber(record.availHeight, 0, 20000),
    colorDepth: sanitizeNumber(record.colorDepth, 0, 128),
    pixelDepth: sanitizeNumber(record.pixelDepth, 0, 128),
    devicePixelRatio: sanitizeNumber(record.devicePixelRatio, 0, 20),
  });
}

function sanitizeClientBrands(value) {
  return Array.isArray(value)
    ? value
        .slice(0, 8)
        .map((item) => {
          const record = item && typeof item === "object" ? item : {};
          return compactRecord({
            brand: sanitizeString(record.brand, 120).trim(),
            version: sanitizeString(record.version, 40).trim(),
          });
        })
        .filter((item) => item.brand)
    : [];
}

function sanitizeClientInfo(value) {
  const record = value && typeof value === "object" ? value : {};
  const userAgentData = record.userAgentData && typeof record.userAgentData === "object" ? record.userAgentData : {};

  return compactRecord({
    userAgent: sanitizeString(record.userAgent, 1200).trim(),
    platform: sanitizeString(record.platform, 160).trim(),
    language: sanitizeString(record.language, 80).trim(),
    languages: sanitizeStringArray(record.languages, 12, 80),
    timezone: sanitizeString(record.timezone, 160).trim(),
    cookieEnabled: sanitizeBoolean(record.cookieEnabled),
    hardwareConcurrency: sanitizeNumber(record.hardwareConcurrency, 0, 512),
    deviceMemory: sanitizeNumber(record.deviceMemory, 0, 1024),
    maxTouchPoints: sanitizeNumber(record.maxTouchPoints, 0, 100),
    screen: sanitizeDimensionRecord(record.screen),
    viewport: sanitizeDimensionRecord(record.viewport),
    userAgentData: compactRecord({
      brands: sanitizeClientBrands(userAgentData.brands),
      mobile: sanitizeBoolean(userAgentData.mobile),
      platform: sanitizeString(userAgentData.platform, 160).trim(),
    }),
  });
}

function normalizeIpAddress(value) {
  let candidate = String(value || "").trim();
  if (!candidate || /^unknown$/i.test(candidate)) {
    return "";
  }

  candidate = candidate.replace(/^"+|"+$/g, "");
  if (candidate.startsWith("[") && candidate.includes("]")) {
    candidate = candidate.slice(1, candidate.indexOf("]"));
  }
  candidate = candidate.replace(/^::ffff:/i, "");
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.replace(/:\d+$/, "");
  }

  const zoneIndex = candidate.indexOf("%");
  if (zoneIndex > 0) {
    candidate = candidate.slice(0, zoneIndex);
  }

  return isIP(candidate) ? candidate : "";
}

function firstIpFromHeader(value) {
  for (const part of String(value || "").split(",")) {
    const ip = normalizeIpAddress(part);
    if (ip) {
      return ip;
    }
  }
  return "";
}

function firstIpFromForwardedHeader(value) {
  for (const part of String(value || "").split(",")) {
    const match = part.match(/(?:^|;)\s*for=(?:"?)(\[?[^";,\s]+\]?)(?:"?)/i);
    const ip = normalizeIpAddress(match?.[1] || "");
    if (ip) {
      return ip;
    }
  }
  return "";
}

function isPrivateOrLocalIp(ip) {
  const normalized = normalizeIpAddress(ip);
  if (!normalized) {
    return true;
  }

  const version = isIP(normalized);
  if (version === 4) {
    const parts = normalized.split(".").map((part) => Number(part));
    const [first, second] = parts;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 0) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51) ||
      (first === 203 && second === 0) ||
      first >= 224
    );
  }

  const lower = normalized.toLowerCase();
  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80:") ||
    lower.startsWith("2001:db8:")
  );
}

function getClientIp(request) {
  const remoteAddress = normalizeIpAddress(request.socket?.remoteAddress || "");
  if (!TRUST_PROXY_HEADERS) {
    return compactRecord({ ip: remoteAddress, source: "socket", remoteAddress });
  }

  const directHeaders = [
    "cf-connecting-ip",
    "true-client-ip",
    "x-real-ip",
    "x-client-ip",
  ];
  for (const headerName of directHeaders) {
    const ip = firstIpFromHeader(getRequestHeader(request, headerName));
    if (ip) {
      return compactRecord({ ip, source: headerName, remoteAddress });
    }
  }

  const forwardedFor = getRequestHeader(request, "x-forwarded-for");
  const forwardedForIp = firstIpFromHeader(forwardedFor);
  if (forwardedForIp) {
    return compactRecord({
      ip: forwardedForIp,
      source: "x-forwarded-for",
      forwardedFor: sanitizeString(forwardedFor, 1000).trim(),
      remoteAddress,
    });
  }

  const forwarded = getRequestHeader(request, "forwarded");
  const forwardedIp = firstIpFromForwardedHeader(forwarded);
  if (forwardedIp) {
    return compactRecord({
      ip: forwardedIp,
      source: "forwarded",
      forwardedFor: sanitizeString(forwarded, 1000).trim(),
      remoteAddress,
    });
  }

  return compactRecord({ ip: remoteAddress, source: "socket", remoteAddress });
}

function parseClientHintBrands(secChUa) {
  const brands = [];
  const pattern = /"([^"]+)";\s*v="([^"]+)"/g;
  let match = pattern.exec(String(secChUa || ""));
  while (match) {
    if (!/not.?a.?brand/i.test(match[1])) {
      brands.push({ brand: match[1], version: match[2] });
    }
    match = pattern.exec(String(secChUa || ""));
  }
  return brands;
}

function detectBrowser(userAgent, secChUa) {
  const ua = String(userAgent || "");
  const brands = parseClientHintBrands(secChUa);
  const prioritizedBrand = brands.find((item) => /Microsoft Edge|Google Chrome|Chromium|Opera|Firefox|Safari/i.test(item.brand));
  let name = prioritizedBrand?.brand || "";
  let version = prioritizedBrand?.version || "";
  let match;

  if ((match = ua.match(/EdgA?\/([\d.]+)/i))) {
    name = "Microsoft Edge";
    version = match[1];
  } else if ((match = ua.match(/OPR\/([\d.]+)/i))) {
    name = "Opera";
    version = match[1];
  } else if ((match = ua.match(/CriOS\/([\d.]+)/i))) {
    name = "Chrome iOS";
    version = match[1];
  } else if ((match = ua.match(/Chrome\/([\d.]+)/i))) {
    name = "Chrome";
    version = match[1];
  } else if ((match = ua.match(/FxiOS\/([\d.]+)/i))) {
    name = "Firefox iOS";
    version = match[1];
  } else if ((match = ua.match(/Firefox\/([\d.]+)/i))) {
    name = "Firefox";
    version = match[1];
  } else if ((match = ua.match(/Version\/([\d.]+).*Safari/i))) {
    name = "Safari";
    version = match[1];
  } else if ((match = ua.match(/MSIE\s([\d.]+)|rv:([\d.]+).*Trident/i))) {
    name = "Internet Explorer";
    version = match[1] || match[2] || "";
  }

  return compactRecord({ name: sanitizeString(name, 120), version: sanitizeString(version, 80) });
}

function detectOperatingSystem(userAgent, platformHint = "") {
  const ua = String(userAgent || "");
  const hint = String(platformHint || "");
  let name = hint;
  let version = "";
  let match;

  if ((match = ua.match(/Windows NT ([\d.]+)/i))) {
    name = "Windows";
    version = match[1];
  } else if ((match = ua.match(/Android ([\d.]+)/i))) {
    name = "Android";
    version = match[1];
  } else if ((match = ua.match(/(?:iPhone|iPad|iPod).*OS ([\d_]+)/i))) {
    name = "iOS";
    version = match[1].replace(/_/g, ".");
  } else if ((match = ua.match(/Mac OS X ([\d_]+)/i))) {
    name = "macOS";
    version = match[1].replace(/_/g, ".");
  } else if (/CrOS/i.test(ua)) {
    name = "Chrome OS";
  } else if (/Linux/i.test(ua)) {
    name = "Linux";
  }

  return compactRecord({ name: sanitizeString(name, 120), version: sanitizeString(version, 80) });
}

function detectDevice(userAgent, secChUaMobile, clientInfo) {
  const ua = String(userAgent || "");
  const mobileHint =
    secChUaMobile === "?1" ||
    secChUaMobile === "1" ||
    (clientInfo.userAgentData && clientInfo.userAgentData.mobile === true);
  let type = "desktop";

  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
    type = "tablet";
  } else if (mobileHint || /Mobi|iPhone|iPod|Android/i.test(ua)) {
    type = "mobile";
  }

  return compactRecord({
    type,
    platform: clientInfo.platform || clientInfo.userAgentData?.platform,
    touchPoints: clientInfo.maxTouchPoints,
    hardwareConcurrency: clientInfo.hardwareConcurrency,
    deviceMemory: clientInfo.deviceMemory,
    screen: clientInfo.screen,
    viewport: clientInfo.viewport,
    timezone: clientInfo.timezone,
    language: clientInfo.language,
    languages: clientInfo.languages,
    cookieEnabled: clientInfo.cookieEnabled,
  });
}

function getIpGeoProvider() {
  if (!IP_GEO_API_URL || /^(false|off|disabled|none)$/i.test(IP_GEO_API_URL)) {
    return "";
  }
  try {
    return new URL(IP_GEO_API_URL.replace("{ip}", "8.8.8.8")).hostname;
  } catch {
    return "custom";
  }
}

function buildInitialIpLocation(ip) {
  const provider = getIpGeoProvider();
  if (!ip) {
    return { status: "unavailable", reason: "missing-ip" };
  }
  if (!provider) {
    return { status: "disabled" };
  }
  if (isPrivateOrLocalIp(ip)) {
    return { status: "skipped", reason: "private-or-local", provider };
  }
  return { status: "pending", provider };
}

function buildSubmissionInfo(request, body) {
  const clientInfo = sanitizeClientInfo(body.clientInfo);
  const userAgent = sanitizeString(getRequestHeader(request, "user-agent") || clientInfo.userAgent, 1200).trim();
  const acceptLanguage = sanitizeString(getRequestHeader(request, "accept-language"), 300).trim();
  const secChUa = sanitizeString(getRequestHeader(request, "sec-ch-ua"), 500).trim();
  const secChUaMobile = sanitizeString(getRequestHeader(request, "sec-ch-ua-mobile"), 40).trim();
  const secChUaPlatform = sanitizeString(getRequestHeader(request, "sec-ch-ua-platform"), 160).replace(/^"+|"+$/g, "").trim();
  const ipInfo = getClientIp(request);

  return compactRecord({
    receivedAt: now(),
    ip: ipInfo.ip,
    ipSource: ipInfo.source,
    remoteAddress: ipInfo.remoteAddress,
    forwardedFor: ipInfo.forwardedFor,
    ipLocation: buildInitialIpLocation(ipInfo.ip),
    browser: detectBrowser(userAgent, secChUa),
    operatingSystem: detectOperatingSystem(userAgent, secChUaPlatform || clientInfo.userAgentData?.platform || clientInfo.platform),
    device: detectDevice(userAgent, secChUaMobile, clientInfo),
    headers: compactRecord({
      userAgent,
      acceptLanguage,
      secChUa,
      secChUaMobile,
      secChUaPlatform,
    }),
    client: clientInfo,
  });
}

function buildIpLocationUrl(ip) {
  if (IP_GEO_API_URL.includes("{ip}")) {
    return IP_GEO_API_URL.replaceAll("{ip}", encodeURIComponent(ip));
  }
  const separator = IP_GEO_API_URL.includes("?") ? "&" : "/";
  return `${IP_GEO_API_URL.replace(/\/+$/, "")}${separator}${encodeURIComponent(ip)}`;
}

function normalizeIpLocationPayload(payload) {
  const root =
    payload && typeof payload === "object" && payload.data && typeof payload.data === "object"
      ? payload.data
      : payload && typeof payload === "object"
        ? payload
        : {};

  if (root.success === false || root.error === true || String(root.status || "").toLowerCase() === "fail") {
    throw new Error(root.message || root.error || "IP 定位接口返回失败");
  }

  let latitude = sanitizeNumber(root.latitude ?? root.lat, -90, 90);
  let longitude = sanitizeNumber(root.longitude ?? root.lon ?? root.lng, -180, 180);
  if ((latitude === undefined || longitude === undefined) && typeof root.loc === "string") {
    const [lat, lon] = root.loc.split(",");
    latitude = sanitizeNumber(lat, -90, 90);
    longitude = sanitizeNumber(lon, -180, 180);
  }

  const timezone =
    root.timezone && typeof root.timezone === "object"
      ? root.timezone.id
      : Array.isArray(root.timeZones)
        ? root.timeZones[0]
        : root.timezone;
  const connection = root.connection && typeof root.connection === "object" ? root.connection : {};
  const country = sanitizeString(root.country || root.country_name || root.countryName || "", 120).trim();
  const region = sanitizeString(root.region || root.regionName || root.region_name || "", 120).trim();
  const city = sanitizeString(root.city || root.cityName || "", 120).trim();
  const label = [country, region, city].filter(Boolean).join(" / ");

  return compactRecord({
    ip: sanitizeString(root.ip || root.query || root.ipAddress || "", 80).trim(),
    country,
    countryCode: sanitizeString(root.country_code || root.countryCode || "", 20).trim(),
    region,
    city,
    postalCode: sanitizeString(root.postal || root.zip || root.zipCode || "", 40).trim(),
    latitude,
    longitude,
    timezone: sanitizeString(timezone || "", 120).trim(),
    isp: sanitizeString(root.isp || connection.isp || "", 200).trim(),
    org: sanitizeString(root.org || connection.org || root.asnOrganization || "", 200).trim(),
    asn: sanitizeString(root.asn || connection.asn || root.as || "", 80).trim(),
    label,
  });
}

async function lookupIpLocation(ip) {
  const provider = getIpGeoProvider();
  if (!ip || !provider || isPrivateOrLocalIp(ip)) {
    return buildInitialIpLocation(ip);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IP_GEO_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(buildIpLocationUrl(ip), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "ArtWorkshop-IPLookup/1.0",
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      throw new Error(extractErrorMessage(payload) || `HTTP ${response.status}`);
    }
    return compactRecord({
      status: "resolved",
      provider,
      lookedUpAt: now(),
      ...normalizeIpLocationPayload(payload),
    });
  } catch (error) {
    return compactRecord({
      status: "failed",
      provider,
      lookedUpAt: now(),
      error: sanitizeString(error instanceof Error ? error.message : String(error), 300),
    });
  } finally {
    clearTimeout(timeout);
  }
}

function needsIpLocationLookup(job) {
  return job?.submissionInfo?.ipLocation?.status === "pending" && job.submissionInfo.ip;
}

function scheduleIpLocationLookup(jobId) {
  setTimeout(() => {
    hydrateIpLocation(jobId).catch((error) => {
      console.warn("[art-workshop-api] IP location lookup failed", jobId, error);
    });
  }, 0);
}

async function hydrateIpLocation(jobId) {
  const job = jobs.get(jobId);
  if (!needsIpLocationLookup(job)) {
    return;
  }

  const ipLocation = await lookupIpLocation(job.submissionInfo.ip);
  const current = jobs.get(jobId);
  if (!current?.submissionInfo) {
    return;
  }

  current.submissionInfo.ipLocation = ipLocation;
  await saveJob(current);
}

function sanitizePromptMetadata(value, fallbackSubmittedPrompt, fallbackSourceImageCount) {
  const record = value && typeof value === "object" ? value : {};
  const systemPrompts = Array.isArray(record.systemPrompts)
    ? record.systemPrompts
        .map((entry) => sanitizeString(entry, 5000).trim())
        .filter(Boolean)
    : [];
  const referenceText = sanitizeString(record.referenceText || systemPrompts.join("\n"), 12000).trim();
  const sourceImageCount = Number(record.sourceImageCount);

  return {
    userPrompt: sanitizeString(record.userPrompt || "", 30000),
    submittedPrompt: sanitizeString(record.submittedPrompt || fallbackSubmittedPrompt || "", 30000),
    referenceText,
    systemPrompts,
    sourceImageCount: Number.isFinite(sourceImageCount)
      ? Math.max(0, Math.floor(sourceImageCount))
      : Number(fallbackSourceImageCount) || 0,
  };
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableJson(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableJson(value[key])]),
    );
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function buildRequestFingerprint({ model, prompt, sourceImages, config, apiBaseUrl }) {
  return sha256(
    JSON.stringify({
      model: String(model || ""),
      prompt: String(prompt || ""),
      sourceImages: (Array.isArray(sourceImages) ? sourceImages : []).map((source) => sha256(source)),
      config: stableJson(config && typeof config === "object" ? config : {}),
      apiBaseUrl: String(apiBaseUrl || ""),
    }),
  );
}

function buildApiUrl(baseUrl, requestPath) {
  if (/^https?:\/\//i.test(requestPath)) {
    return requestPath;
  }

  return `${String(baseUrl || "").replace(/\/+$/, "")}/${String(requestPath || "").replace(/^\/+/, "")}`;
}

function resolveCodexImageApiKey(apiKey) {
  const trimmed = String(apiKey || "").trim();
  return trimmed === CODEX_IMAGE_LEGACY_API_KEY ? CODEX_IMAGE_REPLACEMENT_API_KEY : trimmed;
}

function normalizeCodexImageApiBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed || /sgdr\.funai\.vip/i.test(trimmed)) {
    return CODEX_IMAGE_REMOTE_BASE_URL;
  }

  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

function normalizeCodexImageSize(value) {
  const size = String(value || "").trim();
  return size && size !== "auto" && size !== "default" ? size : "1024x1024";
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

function imageMimeTypeFromFilename(filename) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  if (ext === ".gif") {
    return "image/gif";
  }
  return "image/png";
}

function bufferToDataUrl({ mimeType, buffer }) {
  return `data:${mimeType || "image/png"};base64,${buffer.toString("base64")}`;
}

function parseLocalJobImageSource(source) {
  const value = String(source || "").trim();
  if (!value) {
    return null;
  }

  let pathname = "";
  if (value.startsWith("/")) {
    pathname = value;
  } else if (/^https?:\/\//i.test(value)) {
    try {
      pathname = new URL(value).pathname;
    } catch {
      return null;
    }
  }

  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 5 || parts[0] !== "api" || parts[1] !== "image-jobs" || parts[3] !== "images") {
    return null;
  }

  return {
    jobId: decodeURIComponent(parts[2] || ""),
    filename: path.basename(decodeURIComponent(parts[4] || "")),
  };
}

function buildLocalJobImageUrl(parsed) {
  return `/api/image-jobs/${encodeURIComponent(parsed.jobId)}/images/${encodeURIComponent(parsed.filename)}`;
}

async function localJobImageToBuffer(source) {
  const parsed = parseLocalJobImageSource(source);
  if (!parsed) {
    return null;
  }

  const job = jobs.get(parsed.jobId);
  if (!job) {
    throw new Error("参考图结果不存在，请重新上传图片");
  }

  const resultDir = path.resolve(RESULTS_DIR, sanitizeId(job.userId), sanitizeId(parsed.jobId));
  const imagePath = path.resolve(resultDir, parsed.filename);
  if (!imagePath.startsWith(`${resultDir}${path.sep}`)) {
    throw new Error("参考图路径无效");
  }

  return {
    mimeType: imageMimeTypeFromFilename(parsed.filename),
    buffer: await fs.readFile(imagePath),
  };
}

async function sourceImageToBuffer(source) {
  if (/^data:image\//i.test(String(source || ""))) {
    return dataUrlToBuffer(source);
  }

  const localImage = await localJobImageToBuffer(source);
  if (localImage) {
    return localImage;
  }

  throw new Error("图片数据格式无效");
}

async function normalizeSourceImages(sourceImages) {
  const normalized = [];
  for (const source of sourceImages) {
    normalized.push(bufferToDataUrl(await sourceImageToBuffer(source)));
  }
  return normalized;
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
  const rawSourceImages = Array.isArray(payload.sourceImages) ? payload.sourceImages.filter(Boolean).map(String) : [];
  const sourceImages = await normalizeSourceImages(rawSourceImages);
  const apiKey = model === "codex-image-2" ? resolveCodexImageApiKey(payload.apiKey) : String(payload.apiKey || "");
  const apiBaseUrl =
    model === "codex-image-2"
      ? CODEX_IMAGE_REMOTE_BASE_URL
      : String(payload.apiBaseUrl || "") || VECTOR_API_BASE_URL;

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
    body = {
      model: "gpt-image-2",
      prompt,
      size: normalizeCodexImageSize(config.size),
      n: normalizeImageCount(config.n),
    };

    if (sourceImages.length > 0) {
      endpoint = buildApiUrl(apiBaseUrl || CODEX_IMAGE_REMOTE_BASE_URL, "/images/edits");
    } else {
      endpoint = buildApiUrl(apiBaseUrl || CODEX_IMAGE_REMOTE_BASE_URL, "/images/generations");
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
      appendFormField(formData, "n", requestBody.n || 1);
      if (model !== "codex-image-2") {
        appendFormField(formData, "quality", requestBody.quality);
        appendFormField(formData, "background", requestBody.background || "auto");
        appendFormField(formData, "moderation", requestBody.moderation || "auto");
      }

      sourceImages.forEach((image, index) => {
        const { mimeType, buffer } = dataUrlToBuffer(image);
        const blob = new Blob([buffer], { type: mimeType });
        const imageField = model === "codex-image-2" ? "image" : "image[]";
        formData.append(imageField, blob, `image-${index + 1}.${getDataUrlImageExtension(image)}`);
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
  await fs.mkdir(REFERENCES_DIR, { recursive: true });
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
    requestFingerprint: job.requestFingerprint,
    status: job.status,
    progress: job.progress || "",
    progressPercent: Number(job.progressPercent) || 0,
    sourceImageCount: job.sourceImageCount || 0,
    prompt: job.prompt || "",
    promptMetadata: job.promptMetadata || {
      userPrompt: "",
      submittedPrompt: job.prompt || "",
      referenceText: "",
      systemPrompts: [],
      sourceImageCount: job.sourceImageCount || 0,
    },
    model: job.model,
    modelConfig: job.modelConfig || {},
    referenceImages: Array.isArray(job.referenceImages) ? job.referenceImages : [],
    resultImages: job.resultImages || [],
    generationTime: job.generationTime || 0,
    error: job.error || "",
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function toAdminJob(job) {
  const publicJob = toPublicJob(job);
  return {
    ...publicJob,
    userId: job.userId,
    submissionInfo: job.submissionInfo || undefined,
    resultImageCount: Array.isArray(job.resultImages) ? job.resultImages.length : 0,
  };
}

function getRequestHeader(request, name) {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : String(value || "");
}

function getAdminPin(request) {
  const directPin = getRequestHeader(request, "x-art-workshop-admin-pin").trim();
  if (directPin) {
    return directPin;
  }

  const authorization = getRequestHeader(request, "authorization").trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function assertAdminAccess(request) {
  if (getAdminPin(request) !== ADMIN_PIN) {
    throw new HttpError(401, "管理员 PIN 不正确");
  }
}

function parseAdminDate(value, endOfDay = false) {
  const raw = String(value || "").trim();
  if (!raw) {
    return 0;
  }

  const timestamp = Number(raw);
  if (Number.isFinite(timestamp) && timestamp > 0) {
    return timestamp;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    parsed.setHours(23, 59, 59, 999);
  }
  return parsed.getTime();
}

function buildAdminSummary(items) {
  const summary = {
    totalJobs: items.length,
    totalImages: 0,
    totalUsers: 0,
    succeededJobs: 0,
    failedJobs: 0,
    runningJobs: 0,
    queuedJobs: 0,
    todayJobs: 0,
    models: [],
    users: [],
  };
  const users = new Map();
  const models = new Map();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const job of items) {
    const imageCount = Array.isArray(job.resultImages) ? job.resultImages.length : 0;
    summary.totalImages += imageCount;
    if (job.status === "succeeded") summary.succeededJobs += 1;
    if (job.status === "failed") summary.failedJobs += 1;
    if (job.status === "running") summary.runningJobs += 1;
    if (job.status === "queued") summary.queuedJobs += 1;
    if (Number(job.createdAt || 0) >= today.getTime()) summary.todayJobs += 1;

    const userId = String(job.userId || "");
    if (userId) {
      const current = users.get(userId) || { userId, jobs: 0, images: 0 };
      current.jobs += 1;
      current.images += imageCount;
      users.set(userId, current);
    }

    const model = String(job.model || "");
    if (model) {
      const current = models.get(model) || { model, jobs: 0, images: 0 };
      current.jobs += 1;
      current.images += imageCount;
      models.set(model, current);
    }
  }

  summary.totalUsers = users.size;
  summary.users = Array.from(users.values()).sort((left, right) => right.jobs - left.jobs);
  summary.models = Array.from(models.values()).sort((left, right) => right.jobs - left.jobs);
  return summary;
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
        job.progressPercent = 100;
        job.generationTime = Math.max(0, now() - Number(job.createdAt || now()));
        await saveJob(job);
      }

      jobs.set(job.id, job);
      if (needsIpLocationLookup(job)) {
        scheduleIpLocationLookup(job.id);
      }
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

function findExistingRequestJob(userId, requestFingerprint) {
  if (!requestFingerprint) {
    return null;
  }

  const cutoff = now() - REQUEST_FINGERPRINT_CACHE_TTL_MS;
  const userJobs = Array.from(jobs.values())
    .filter((job) => job.userId === userId && job.requestFingerprint === requestFingerprint)
    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));

  for (const job of userJobs) {
    const pending = job.status === "queued" || job.status === "running";
    const recentlySucceeded =
      job.status === "succeeded" &&
      Array.isArray(job.resultImages) &&
      job.resultImages.length > 0 &&
      Number(job.updatedAt || job.createdAt || 0) >= cutoff;

    if (pending || recentlySucceeded) {
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

async function persistReferenceImages(job, sourceImages) {
  const references = [];
  const referenceDir = path.join(REFERENCES_DIR, sanitizeId(job.userId), sanitizeId(job.id));

  for (let index = 0; index < sourceImages.length; index += 1) {
    const source = String(sourceImages[index] || "").trim();
    if (!source) {
      continue;
    }

    const parsedLocalImage = parseLocalJobImageSource(source);
    if (parsedLocalImage) {
      references.push({
        index,
        kind: "generated",
        url: buildLocalJobImageUrl(parsedLocalImage),
        sourceJobId: parsedLocalImage.jobId,
        filename: parsedLocalImage.filename,
      });
      continue;
    }

    if (/^data:image\//i.test(source)) {
      const decoded = dataUrlToBuffer(source);
      const extension = getDataUrlImageExtension(source);
      const filename = `${String(index + 1).padStart(2, "0")}.${extension}`;
      await fs.mkdir(referenceDir, { recursive: true });
      await fs.writeFile(path.join(referenceDir, filename), decoded.buffer);
      references.push({
        index,
        kind: "uploaded",
        url: `/api/image-jobs/${encodeURIComponent(job.id)}/references/${encodeURIComponent(filename)}`,
        filename,
      });
    }
  }

  return references;
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
    job.progressPercent = 100;
    job.generationTime = Math.max(0, now() - job.createdAt);
    await saveJob(job);
    return;
  }

  job.status = "running";
  job.progress = "生成中";
  job.progressPercent = 30;
  await saveJob(job);

  const startedAt = now();
  try {
    const images = await generateImages(payload);
    job.progress = "保存结果";
    job.progressPercent = 82;
    await saveJob(job);

    const resultImages = [];
    for (let index = 0; index < images.length; index += 1) {
      job.progress = `保存结果 ${index + 1}/${images.length}`;
      job.progressPercent = Math.min(98, 82 + Math.round(((index + 1) / Math.max(images.length, 1)) * 14));
      await saveJob(job);
      resultImages.push(await persistGeneratedImage(job, images[index], index));
    }

    job.status = "succeeded";
    job.progress = "完成";
    job.progressPercent = 100;
    job.resultImages = resultImages;
    job.error = "";
    job.generationTime = now() - startedAt;
  } catch (error) {
    job.status = "failed";
    job.progress = "";
    job.progressPercent = 100;
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
    "Access-Control-Allow-Headers": "Content-Type, X-Art-Workshop-User, X-Art-Workshop-Admin-Pin, Authorization",
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
  const model = sanitizeString(body.model, 80);
  const prompt = sanitizeString(body.prompt, 30000);
  if (!model || !prompt.trim()) {
    throw new HttpError(400, "缺少模型或提示词");
  }

  const sourceImages = Array.isArray(body.sourceImages) ? body.sourceImages.filter(Boolean).map(String) : [];
  const config = body.config && typeof body.config === "object" ? body.config : {};
  const promptMetadata = sanitizePromptMetadata(body.promptMetadata, prompt, sourceImages.length);
  const submissionInfo = buildSubmissionInfo(request, body);
  const apiBaseUrl = sanitizeString(body.apiBaseUrl || "", 200);
  const requestFingerprint =
    sanitizeId(body.requestFingerprint, "") ||
    buildRequestFingerprint({
      model,
      prompt,
      sourceImages,
      config,
      apiBaseUrl,
    });

  const existingClientJob = findExistingClientJob(userId, clientRequestId);
  if (existingClientJob) {
    sendJson(response, 200, toPublicJob(existingClientJob), request);
    return;
  }

  const existingRequestJob = findExistingRequestJob(userId, requestFingerprint);
  if (existingRequestJob) {
    sendJson(response, 200, toPublicJob(existingRequestJob), request);
    return;
  }

  const createdAt = now();
  const job = {
    id: randomUUID(),
    userId,
    clientRequestId,
    requestFingerprint,
    status: "queued",
    progress: "排队中",
    progressPercent: 5,
    sourceImageCount: sourceImages.length,
    prompt,
    promptMetadata,
    submissionInfo,
    model,
    modelConfig: config,
    resultImages: [],
    generationTime: 0,
    error: "",
    createdAt,
    updatedAt: createdAt,
  };
  job.referenceImages = await persistReferenceImages(job, sourceImages);

  jobs.set(job.id, job);
  runtimePayloads.set(job.id, {
    model,
    prompt,
    sourceImages,
    config,
    apiBaseUrl,
    apiKey: sanitizeString(body.apiKey || "", 2000),
  });
  await saveJob(job);
  if (needsIpLocationLookup(job)) {
    scheduleIpLocationLookup(job.id);
  }
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

async function adminLogin(request, response) {
  const body = await readJsonBody(request);
  if (String(body.pin || "").trim() !== ADMIN_PIN) {
    throw new HttpError(401, "管理员 PIN 不正确");
  }

  sendJson(response, 200, { ok: true }, request);
}

function listAdminJobs(request, response) {
  assertAdminAccess(request);

  const requestUrl = new URL(request.url, "http://localhost");
  const query = String(requestUrl.searchParams.get("q") || "").trim().toLowerCase();
  const status = String(requestUrl.searchParams.get("status") || "all").trim();
  const userId = String(requestUrl.searchParams.get("userId") || "").trim();
  const model = String(requestUrl.searchParams.get("model") || "").trim();
  const from = parseAdminDate(requestUrl.searchParams.get("from"));
  const to = parseAdminDate(requestUrl.searchParams.get("to"), true);
  const limit = Math.min(Math.max(Number(requestUrl.searchParams.get("limit") || 80), 1), 500);
  const offset = Math.max(Number(requestUrl.searchParams.get("offset") || 0), 0);

  const allJobs = Array.from(jobs.values()).sort((left, right) => {
    return Number(right.createdAt || 0) - Number(left.createdAt || 0);
  });

  const filteredJobs = allJobs.filter((job) => {
    const createdAt = Number(job.createdAt || 0);
    if (status !== "all" && String(job.status || "") !== status) {
      return false;
    }
    if (userId && String(job.userId || "") !== userId) {
      return false;
    }
    if (model && String(job.model || "") !== model) {
      return false;
    }
    if (from && createdAt < from) {
      return false;
    }
    if (to && createdAt > to) {
      return false;
    }
    if (query) {
      const haystack = [
        job.id,
        job.userId,
        job.prompt,
        job.promptMetadata?.userPrompt,
        job.promptMetadata?.submittedPrompt,
        job.promptMetadata?.referenceText,
        ...(Array.isArray(job.referenceImages) ? job.referenceImages.map((reference) => reference.url) : []),
        job.model,
        job.status,
        job.error,
        job.clientRequestId,
        JSON.stringify(job.submissionInfo || {}),
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
      return haystack.includes(query);
    }
    return true;
  });

  sendJson(
    response,
    200,
    {
      jobs: filteredJobs.slice(offset, offset + limit).map(toAdminJob),
      total: filteredJobs.length,
      offset,
      limit,
      summary: buildAdminSummary(allJobs),
      filteredSummary: buildAdminSummary(filteredJobs),
    },
    request,
  );
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

function getImageContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ext === ".jpg" || ext === ".jpeg"
    ? "image/jpeg"
    : ext === ".webp"
      ? "image/webp"
      : ext === ".gif"
        ? "image/gif"
        : "image/png";
}

async function serveJobImage(request, response, jobId, filename) {
  const job = jobs.get(jobId);
  if (!job) {
    throw new HttpError(404, "图片不存在");
  }

  const safeFilename = path.basename(filename);
  const imagePath = path.join(RESULTS_DIR, sanitizeId(job.userId), sanitizeId(jobId), safeFilename);
  const data = await fs.readFile(imagePath);
  response.writeHead(200, {
    "Content-Type": getImageContentType(safeFilename),
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  response.end(data);
}

async function serveJobReferenceImage(request, response, jobId, filename) {
  const job = jobs.get(jobId);
  if (!job) {
    throw new HttpError(404, "参考图不存在");
  }

  const safeFilename = path.basename(filename);
  const reference = Array.isArray(job.referenceImages)
    ? job.referenceImages.find((item) => item.kind === "uploaded" && item.filename === safeFilename)
    : null;
  if (!reference) {
    throw new HttpError(404, "参考图不存在");
  }

  const referenceDir = path.resolve(REFERENCES_DIR, sanitizeId(job.userId), sanitizeId(jobId));
  const imagePath = path.resolve(referenceDir, safeFilename);
  if (!imagePath.startsWith(`${referenceDir}${path.sep}`)) {
    throw new HttpError(404, "参考图不存在");
  }

  const data = await fs.readFile(imagePath);
  response.writeHead(200, {
    "Content-Type": getImageContentType(safeFilename),
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

  if (parts[0] === "api" && parts[1] === "admin") {
    if (request.method === "POST" && parts.length === 3 && parts[2] === "login") {
      await adminLogin(request, response);
      return;
    }
    if (request.method === "GET" && parts.length === 3 && parts[2] === "image-jobs") {
      listAdminJobs(request, response);
      return;
    }
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
    if (request.method === "GET" && parts.length === 5 && parts[3] === "references") {
      await serveJobReferenceImage(request, response, parts[2], decodeURIComponent(parts[4]));
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
