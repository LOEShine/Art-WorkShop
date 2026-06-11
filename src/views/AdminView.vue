<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Filter,
  Image as ImageIcon,
  LoaderCircle,
  Lock,
  LogOut,
  RefreshCw,
  Search,
  UserRound,
  X,
} from "lucide-vue-next";

import {
  listAdminImageJobs,
  verifyAdminPin,
  type AdminImageJob,
  type AdminImageJobResponse,
  type AdminImageJobSummary,
} from "@/lib/api";

const ADMIN_SESSION_KEY = "art-workshop-admin-pin";
const PAGE_SIZE = 60;

const pinInput = ref("");
const adminPin = ref("");
const loginError = ref("");
const loading = ref(false);
const error = ref("");
const response = ref<AdminImageJobResponse | null>(null);
const query = ref("");
const statusFilter = ref("all");
const userFilter = ref("");
const modelFilter = ref("");
const fromDate = ref("");
const toDate = ref("");
const offset = ref(0);
const previewImage = ref("");
const previewTitle = ref("");

const statusOptions = [
  { value: "all", label: "全部状态" },
  { value: "succeeded", label: "成功" },
  { value: "running", label: "生成中" },
  { value: "queued", label: "排队中" },
  { value: "failed", label: "失败" },
];

const summary = computed(() => response.value?.summary || createEmptySummary());
const filteredSummary = computed(() => response.value?.filteredSummary || createEmptySummary());
const jobs = computed(() => response.value?.jobs || []);
const total = computed(() => response.value?.total || 0);
const pageStart = computed(() => (total.value === 0 ? 0 : offset.value + 1));
const pageEnd = computed(() => Math.min(offset.value + PAGE_SIZE, total.value));
const canPrev = computed(() => offset.value > 0);
const canNext = computed(() => offset.value + PAGE_SIZE < total.value);
const userOptions = computed(() => summary.value.users);
const modelOptions = computed(() => summary.value.models);

function createEmptySummary(): AdminImageJobSummary {
  return {
    totalJobs: 0,
    totalImages: 0,
    totalUsers: 0,
    succeededJobs: 0,
    failedJobs: 0,
    runningJobs: 0,
    queuedJobs: 0,
    todayJobs: 0,
    users: [],
    models: [],
  };
}

function getStatusLabel(status: string) {
  return statusOptions.find((option) => option.value === status)?.label || status || "-";
}

function getStatusClass(status: string) {
  if (status === "succeeded") return "admin-status admin-status--success";
  if (status === "failed") return "admin-status admin-status--failed";
  if (status === "running") return "admin-status admin-status--running";
  if (status === "queued") return "admin-status admin-status--queued";
  return "admin-status";
}

function formatDate(timestamp: number) {
  if (!timestamp) {
    return "-";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatFullDate(timestamp: number) {
  if (!timestamp) {
    return "-";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function formatDuration(milliseconds: number) {
  if (!milliseconds) {
    return "-";
  }
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function shortId(value: string) {
  if (!value) {
    return "-";
  }
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function formatVersion(version: string | undefined) {
  const normalized = String(version || "").trim();
  return normalized ? normalized.split(".")[0] : "";
}

function formatNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.round(number)) : "";
}

function getBrowserLabel(job: AdminImageJob) {
  const browser = job.submissionInfo?.browser;
  const name = String(browser?.name || "").trim();
  const version = formatVersion(browser?.version);
  return [name, version].filter(Boolean).join(" ") || "-";
}

function getOperatingSystemLabel(job: AdminImageJob) {
  const os = job.submissionInfo?.operatingSystem;
  return [os?.name, formatVersion(os?.version)].filter(Boolean).join(" ");
}

function getDeviceTypeLabel(type: string | undefined) {
  if (type === "mobile") return "手机";
  if (type === "tablet") return "平板";
  if (type === "desktop") return "桌面";
  return type || "";
}

function getViewportLabel(job: AdminImageJob) {
  const viewport = job.submissionInfo?.device?.viewport;
  const width = formatNumber(viewport?.width);
  const height = formatNumber(viewport?.height);
  return width && height ? `${width}x${height}` : "";
}

function getDeviceLabel(job: AdminImageJob) {
  const device = job.submissionInfo?.device;
  const pieces = [
    getDeviceTypeLabel(device?.type),
    getOperatingSystemLabel(job),
    getViewportLabel(job),
  ].filter(Boolean);
  return pieces.join(" · ") || "-";
}

function getIpLabel(job: AdminImageJob) {
  return String(job.submissionInfo?.ip || "").trim() || "暂无记录";
}

function getLocationLabel(job: AdminImageJob) {
  const location = job.submissionInfo?.ipLocation;
  if (!location) {
    return "暂无记录";
  }

  const label =
    String(location.label || "").trim() ||
    [location.country, location.region, location.city].map((item) => String(item || "").trim()).filter(Boolean).join(" / ");
  if (label) {
    return label;
  }

  if (location.status === "pending") return "定位中";
  if (location.status === "failed") return location.error ? `定位失败：${location.error}` : "定位失败";
  if (location.status === "skipped") return location.reason === "private-or-local" ? "本地/内网 IP" : "已跳过定位";
  if (location.status === "disabled") return "未启用定位";
  if (location.status === "unavailable") return "未获取到 IP";
  return "暂无记录";
}

function getLocationTitle(job: AdminImageJob) {
  const location = job.submissionInfo?.ipLocation;
  if (!location) {
    return "";
  }
  const coordinates =
    Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude))
      ? `${location.latitude}, ${location.longitude}`
      : "";
  return [
    getLocationLabel(job),
    location.provider ? `API: ${location.provider}` : "",
    location.isp ? `ISP: ${location.isp}` : "",
    location.org ? `ORG: ${location.org}` : "",
    location.asn ? `ASN: ${location.asn}` : "",
    coordinates ? `坐标: ${coordinates}` : "",
  ].filter(Boolean).join("\n");
}

function getAdminUserMetaRows(job: AdminImageJob) {
  return [
    {
      key: "ip",
      label: "IP",
      value: getIpLabel(job),
      title: job.submissionInfo?.forwardedFor || job.submissionInfo?.ip || "",
    },
    {
      key: "location",
      label: "位置",
      value: getLocationLabel(job),
      title: getLocationTitle(job),
    },
    {
      key: "browser",
      label: "浏览器",
      value: getBrowserLabel(job) === "-" ? "暂无记录" : getBrowserLabel(job),
    },
    {
      key: "device",
      label: "设备",
      value: getDeviceLabel(job) === "-" ? "暂无记录" : getDeviceLabel(job),
    },
  ];
}

function getUserPrompt(job: AdminImageJob) {
  return String(job.promptMetadata?.userPrompt || job.prompt || "").trim();
}

function getReferenceText(job: AdminImageJob) {
  const metadata = job.promptMetadata;
  const promptText = String(metadata?.referenceText || "").trim();
  if (promptText) {
    return promptText;
  }

  return Array.isArray(metadata?.systemPrompts)
    ? metadata.systemPrompts.map((item) => String(item || "").trim()).filter(Boolean).join("\n")
    : "";
}

function getSubmittedPrompt(job: AdminImageJob) {
  return String(job.promptMetadata?.submittedPrompt || job.prompt || "").trim();
}

function getSourceImageCount(job: AdminImageJob) {
  const metadataCount = Number(job.promptMetadata?.sourceImageCount);
  return Number.isFinite(metadataCount) && metadataCount > 0
    ? metadataCount
    : Number(job.sourceImageCount) || 0;
}

function getReferenceImages(job: AdminImageJob) {
  return Array.isArray(job.referenceImages) ? job.referenceImages.filter((reference) => reference.url) : [];
}

function hasAnyPreviewImages(job: AdminImageJob) {
  return Boolean(job.resultImages.length || getReferenceImages(job).length);
}

function hasMissingReferencePreviews(job: AdminImageJob) {
  return getSourceImageCount(job) > 0 && getReferenceImages(job).length === 0;
}

function hasSubmittedPromptDetails(job: AdminImageJob) {
  const submittedPrompt = getSubmittedPrompt(job);
  return Boolean(submittedPrompt && submittedPrompt !== getUserPrompt(job));
}

function getPromptDetailText(job: AdminImageJob) {
  const sections = [
    ["用户提示词", getUserPrompt(job)],
    ["参考文字", getReferenceText(job)],
    ["完整提交提示词", getSubmittedPrompt(job)],
  ].filter(([, value]) => value);

  return sections.map(([label, value]) => `${label}：\n${value}`).join("\n\n");
}

async function loadJobs() {
  if (!adminPin.value) {
    return;
  }

  loading.value = true;
  error.value = "";
  try {
    response.value = await listAdminImageJobs({
      pin: adminPin.value,
      q: query.value.trim(),
      status: statusFilter.value,
      userId: userFilter.value,
      model: modelFilter.value,
      from: fromDate.value,
      to: toDate.value,
      limit: PAGE_SIZE,
      offset: offset.value,
    });
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : String(loadError);
    if (/PIN|401/.test(error.value)) {
      logout();
    }
  } finally {
    loading.value = false;
  }
}

async function login() {
  const pin = pinInput.value.trim();
  if (!pin) {
    loginError.value = "请输入 PIN";
    return;
  }

  loading.value = true;
  loginError.value = "";
  try {
    await verifyAdminPin(pin);
    adminPin.value = pin;
    sessionStorage.setItem(ADMIN_SESSION_KEY, pin);
    offset.value = 0;
    await loadJobs();
  } catch (loginFailed) {
    loginError.value = loginFailed instanceof Error ? loginFailed.message : String(loginFailed);
  } finally {
    loading.value = false;
  }
}

function logout() {
  adminPin.value = "";
  pinInput.value = "";
  response.value = null;
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
}

function applyFilters() {
  offset.value = 0;
  void loadJobs();
}

function clearFilters() {
  query.value = "";
  statusFilter.value = "all";
  userFilter.value = "";
  modelFilter.value = "";
  fromDate.value = "";
  toDate.value = "";
  applyFilters();
}

function showPreviousPage() {
  if (!canPrev.value) {
    return;
  }
  offset.value = Math.max(0, offset.value - PAGE_SIZE);
  void loadJobs();
}

function showNextPage() {
  if (!canNext.value) {
    return;
  }
  offset.value += PAGE_SIZE;
  void loadJobs();
}

function openPreview(job: AdminImageJob, image: string, index: number, label = "结果图") {
  previewImage.value = image;
  previewTitle.value = `${shortId(job.userId)} / ${formatDate(job.createdAt)} / ${label} ${index + 1}`;
}

function closePreview() {
  previewImage.value = "";
  previewTitle.value = "";
}

async function copyPrompt(job: AdminImageJob) {
  await navigator.clipboard.writeText(getPromptDetailText(job));
}

onMounted(() => {
  const savedPin = sessionStorage.getItem(ADMIN_SESSION_KEY) || "";
  if (savedPin) {
    adminPin.value = savedPin;
    void loadJobs();
  }
});
</script>

<template>
  <main class="admin-shell">
    <section
      v-if="!adminPin"
      class="admin-login"
    >
      <form
        class="admin-login-panel"
        @submit.prevent="login"
      >
        <div class="admin-login-icon">
          <Lock class="h-5 w-5" />
        </div>
        <h1>后台管理</h1>
        <div class="admin-pin-row">
          <input
            v-model="pinInput"
            type="password"
            inputmode="numeric"
            autocomplete="current-password"
            placeholder="PIN"
          />
          <button
            type="submit"
            :disabled="loading"
          >
            <LoaderCircle
              v-if="loading"
              class="h-4 w-4 animate-spin"
            />
            <Lock
              v-else
              class="h-4 w-4"
            />
            登录
          </button>
        </div>
        <p
          v-if="loginError"
          class="admin-error"
        >
          {{ loginError }}
        </p>
      </form>
    </section>

    <template v-else>
      <header class="admin-header">
        <div>
          <h1>后台管理</h1>
          <p>所有用户生成记录、图片和关键词</p>
        </div>
        <div class="admin-header-actions">
          <a
            class="admin-icon-button"
            href="/"
            title="返回前台"
          >
            <ExternalLink class="h-4 w-4" />
          </a>
          <button
            class="admin-icon-button"
            type="button"
            title="刷新"
            :disabled="loading"
            @click="loadJobs"
          >
            <RefreshCw
              class="h-4 w-4"
              :class="loading ? 'animate-spin' : ''"
            />
          </button>
          <button
            class="admin-icon-button"
            type="button"
            title="退出"
            @click="logout"
          >
            <LogOut class="h-4 w-4" />
          </button>
        </div>
      </header>

      <section class="admin-stats">
        <div class="admin-stat">
          <span>任务</span>
          <strong>{{ filteredSummary.totalJobs }}</strong>
        </div>
        <div class="admin-stat">
          <span>图片</span>
          <strong>{{ filteredSummary.totalImages }}</strong>
        </div>
        <div class="admin-stat">
          <span>用户</span>
          <strong>{{ filteredSummary.totalUsers }}</strong>
        </div>
        <div class="admin-stat">
          <span>成功</span>
          <strong>{{ filteredSummary.succeededJobs }}</strong>
        </div>
        <div class="admin-stat">
          <span>今天</span>
          <strong>{{ filteredSummary.todayJobs }}</strong>
        </div>
      </section>

      <section class="admin-toolbar">
        <div class="admin-search">
          <Search class="h-4 w-4" />
          <input
            v-model="query"
            type="search"
            placeholder="搜索关键词、用户、模型、IP、地区、浏览器"
            @keydown.enter.prevent="applyFilters"
          />
        </div>
        <select v-model="statusFilter">
          <option
            v-for="option in statusOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
        <select v-model="userFilter">
          <option value="">全部用户</option>
          <option
            v-for="user in userOptions"
            :key="user.userId"
            :value="user.userId"
          >
            {{ shortId(user.userId) }} · {{ user.jobs }}
          </option>
        </select>
        <select v-model="modelFilter">
          <option value="">全部模型</option>
          <option
            v-for="model in modelOptions"
            :key="model.model"
            :value="model.model"
          >
            {{ model.model }} · {{ model.jobs }}
          </option>
        </select>
        <label class="admin-date-field">
          <CalendarDays class="h-4 w-4" />
          <input
            v-model="fromDate"
            type="date"
          />
        </label>
        <label class="admin-date-field">
          <CalendarDays class="h-4 w-4" />
          <input
            v-model="toDate"
            type="date"
          />
        </label>
        <button
          class="admin-action-button"
          type="button"
          @click="applyFilters"
        >
          <Filter class="h-4 w-4" />
          筛选
        </button>
        <button
          class="admin-secondary-button"
          type="button"
          @click="clearFilters"
        >
          清空
        </button>
      </section>

      <p
        v-if="error"
        class="admin-inline-error"
      >
        <AlertTriangle class="h-4 w-4" />
        {{ error }}
      </p>

      <section class="admin-meta-row">
        <span>{{ pageStart }}-{{ pageEnd }} / {{ total }}</span>
        <span>全量 {{ summary.totalJobs }} 个任务，{{ summary.totalImages }} 张图</span>
      </section>

      <section class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>图片</th>
              <th>提示词 / 参考文字</th>
              <th>用户</th>
              <th>模型</th>
              <th>状态</th>
              <th>时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="job in jobs"
              :key="job.id"
            >
              <td class="admin-images-cell">
                <div v-if="hasAnyPreviewImages(job)" class="admin-media-stack">
                  <div v-if="job.resultImages.length" class="admin-media-group">
                    <span class="admin-media-label">结果图</span>
                    <div class="admin-image-strip">
                      <button
                        v-for="(image, index) in job.resultImages.slice(0, 4)"
                        :key="`${job.id}-${image}`"
                        type="button"
                        @click="openPreview(job, image, index)"
                      >
                        <img
                          :src="image"
                          :alt="`结果图 ${index + 1}`"
                        />
                      </button>
                    </div>
                  </div>
                  <div v-if="getReferenceImages(job).length" class="admin-media-group">
                    <span class="admin-media-label">参考图</span>
                    <div class="admin-image-strip admin-reference-strip">
                      <button
                        v-for="(reference, index) in getReferenceImages(job).slice(0, 4)"
                        :key="`${job.id}-reference-${reference.url}`"
                        type="button"
                        @click="openPreview(job, reference.url, index, '参考图')"
                      >
                        <img
                          :src="reference.url"
                          :alt="`参考图 ${index + 1}`"
                        />
                      </button>
                    </div>
                  </div>
                </div>
                <div
                  v-else
                  class="admin-empty-image"
                >
                  <ImageIcon class="h-4 w-4" />
                </div>
              </td>
              <td class="admin-prompt-cell">
                <div class="admin-prompt-block">
                  <span class="admin-field-label">用户提示词</span>
                  <p class="admin-prompt">{{ getUserPrompt(job) || "-" }}</p>
                </div>
                <div
                  v-if="getReferenceText(job)"
                  class="admin-prompt-block admin-prompt-block--reference"
                >
                  <span class="admin-field-label">参考文字</span>
                  <p class="admin-prompt admin-prompt--reference">{{ getReferenceText(job) }}</p>
                </div>
                <details
                  v-if="hasSubmittedPromptDetails(job)"
                  class="admin-prompt-details"
                >
                  <summary>完整提交提示词</summary>
                  <p class="admin-prompt admin-prompt--full">{{ getSubmittedPrompt(job) }}</p>
                </details>
                <p
                  v-if="getSourceImageCount(job)"
                  class="admin-reference-count"
                >
                  参考图 {{ getSourceImageCount(job) }} 张
                  <span v-if="hasMissingReferencePreviews(job)">，旧记录未保存预览</span>
                </p>
                <p
                  v-if="job.error"
                  class="admin-job-error"
                >
                  {{ job.error }}
                </p>
              </td>
              <td>
                <div class="admin-user-stack">
                  <div class="admin-user">
                    <UserRound class="h-4 w-4" />
                    <span :title="job.userId">{{ shortId(job.userId) }}</span>
                  </div>
                  <div class="admin-user-meta">
                    <div
                      v-for="row in getAdminUserMetaRows(job)"
                      :key="`${job.id}-${row.key}`"
                      class="admin-user-meta-row"
                      :title="row.title || row.value"
                    >
                      <span class="admin-user-meta-label">{{ row.label }}</span>
                      <span class="admin-user-meta-value">{{ row.value }}</span>
                    </div>
                  </div>
                </div>
              </td>
              <td>{{ job.model }}</td>
              <td>
                <span :class="getStatusClass(job.status)">
                  <CheckCircle2
                    v-if="job.status === 'succeeded'"
                    class="h-3.5 w-3.5"
                  />
                  {{ getStatusLabel(job.status) }}
                </span>
              </td>
              <td>
                <div class="admin-time">
                  <span>{{ formatDate(job.createdAt) }}</span>
                  <small>{{ formatDuration(job.generationTime) }}</small>
                </div>
              </td>
              <td>
                <button
                  class="admin-row-button"
                  type="button"
                  title="复制提示词详情"
                  @click="copyPrompt(job)"
                >
                  <Copy class="h-4 w-4" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="admin-mobile-list">
          <article
            v-for="job in jobs"
            :key="`mobile-${job.id}`"
            class="admin-job-card"
          >
            <div class="admin-job-card-head">
              <span :class="getStatusClass(job.status)">{{ getStatusLabel(job.status) }}</span>
              <span>{{ formatDate(job.createdAt) }}</span>
            </div>
            <div
              v-if="job.resultImages.length"
              class="admin-card-images"
            >
              <button
                v-for="(image, index) in job.resultImages.slice(0, 3)"
                :key="`${job.id}-mobile-${image}`"
                type="button"
                @click="openPreview(job, image, index)"
              >
                <img
                  :src="image"
                  :alt="`结果图 ${index + 1}`"
                />
              </button>
            </div>
            <div
              v-if="getReferenceImages(job).length"
              class="admin-mobile-reference-group"
            >
              <span class="admin-media-label">参考图</span>
              <div class="admin-card-images admin-reference-strip">
                <button
                  v-for="(reference, index) in getReferenceImages(job).slice(0, 3)"
                  :key="`${job.id}-mobile-reference-${reference.url}`"
                  type="button"
                  @click="openPreview(job, reference.url, index, '参考图')"
                >
                  <img
                    :src="reference.url"
                    :alt="`参考图 ${index + 1}`"
                  />
                </button>
              </div>
            </div>
            <div class="admin-prompt-block">
              <span class="admin-field-label">用户提示词</span>
              <p class="admin-prompt">{{ getUserPrompt(job) || "-" }}</p>
            </div>
            <div
              v-if="getReferenceText(job)"
              class="admin-prompt-block admin-prompt-block--reference"
            >
              <span class="admin-field-label">参考文字</span>
              <p class="admin-prompt admin-prompt--reference">{{ getReferenceText(job) }}</p>
            </div>
            <details
              v-if="hasSubmittedPromptDetails(job)"
              class="admin-prompt-details"
            >
              <summary>完整提交提示词</summary>
              <p class="admin-prompt admin-prompt--full">{{ getSubmittedPrompt(job) }}</p>
            </details>
            <p
              v-if="getSourceImageCount(job)"
              class="admin-reference-count"
            >
              参考图 {{ getSourceImageCount(job) }} 张
              <span v-if="hasMissingReferencePreviews(job)">，旧记录未保存预览</span>
            </p>
            <p
              v-if="job.error"
              class="admin-job-error"
            >
              {{ job.error }}
            </p>
            <div class="admin-card-user-meta">
              <div
                v-for="row in getAdminUserMetaRows(job)"
                :key="`${job.id}-mobile-${row.key}`"
                class="admin-user-meta-row"
                :title="row.title || row.value"
              >
                <span class="admin-user-meta-label">{{ row.label }}</span>
                <span class="admin-user-meta-value">{{ row.value }}</span>
              </div>
            </div>
            <div class="admin-card-meta">
              <span><UserRound class="h-4 w-4" />{{ shortId(job.userId) }}</span>
              <span>{{ job.model }}</span>
              <span><Clock class="h-4 w-4" />{{ formatDuration(job.generationTime) }}</span>
            </div>
            <button
              class="admin-card-copy"
              type="button"
              @click="copyPrompt(job)"
            >
              <Copy class="h-4 w-4" />
              复制提示词
            </button>
          </article>
        </div>

        <div
          v-if="!jobs.length && !loading"
          class="admin-empty-state"
        >
          <ImageIcon class="h-8 w-8" />
          <span>没有匹配的生成记录</span>
        </div>
      </section>

      <footer class="admin-pagination">
        <button
          type="button"
          :disabled="!canPrev"
          @click="showPreviousPage"
        >
          上一页
        </button>
        <span>{{ pageStart }}-{{ pageEnd }} / {{ total }}</span>
        <button
          type="button"
          :disabled="!canNext"
          @click="showNextPage"
        >
          下一页
        </button>
      </footer>
    </template>

    <div
      v-if="previewImage"
      class="admin-preview"
      @click="closePreview"
    >
      <div
        class="admin-preview-panel"
        @click.stop
      >
        <div class="admin-preview-head">
          <span>{{ previewTitle }}</span>
          <div>
            <a
              :href="previewImage"
              target="_blank"
              rel="noreferrer"
              title="打开原图"
            >
              <ExternalLink class="h-4 w-4" />
            </a>
            <button
              type="button"
              title="关闭"
              @click="closePreview"
            >
              <X class="h-4 w-4" />
            </button>
          </div>
        </div>
        <img
          :src="previewImage"
          alt="生成图片预览"
        />
      </div>
    </div>
  </main>
</template>

<style scoped>
.admin-shell {
  box-sizing: border-box;
  min-height: 100vh;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  padding: 1.25rem;
}

.admin-shell *,
.admin-shell *::before,
.admin-shell *::after {
  box-sizing: border-box;
}

.admin-login {
  display: grid;
  min-height: calc(100vh - 2.5rem);
  place-items: center;
}

.admin-login-panel {
  width: min(24rem, calc(100vw - 1.5rem));
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--card));
  padding: 1.5rem;
}

.admin-login-icon {
  display: inline-flex;
  height: 2.5rem;
  width: 2.5rem;
  align-items: center;
  justify-content: center;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--muted));
}

.admin-login h1,
.admin-header h1 {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
}

.admin-pin-row {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}

.admin-pin-row input,
.admin-toolbar input,
.admin-toolbar select {
  height: 2.5rem;
  min-width: 0;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--background));
  padding: 0 0.75rem;
  outline: none;
}

.admin-pin-row input {
  flex: 1;
}

.admin-pin-row button,
.admin-action-button,
.admin-secondary-button,
.admin-pagination button,
.admin-card-copy {
  display: inline-flex;
  height: 2.5rem;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border-radius: calc(var(--radius) - 2px);
  padding: 0 0.85rem;
  font-weight: 600;
}

.admin-pin-row button,
.admin-action-button {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}

.admin-secondary-button,
.admin-pagination button,
.admin-card-copy {
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  color: hsl(var(--foreground));
}

.admin-error,
.admin-inline-error,
.admin-job-error {
  color: hsl(var(--error));
}

.admin-error {
  margin: 0.75rem 0 0;
  font-size: 0.875rem;
}

.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  max-width: 92rem;
  margin: 0 auto 1rem;
}

.admin-header p {
  margin: 0.25rem 0 0;
  color: hsl(var(--muted-foreground));
  font-size: 0.875rem;
}

.admin-header-actions {
  display: flex;
  gap: 0.5rem;
}

.admin-icon-button,
.admin-row-button,
.admin-preview-head a,
.admin-preview-head button {
  display: inline-flex;
  height: 2.25rem;
  width: 2.25rem;
  align-items: center;
  justify-content: center;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--card));
  color: hsl(var(--foreground));
}

.admin-stats,
.admin-toolbar,
.admin-meta-row,
.admin-table-wrap,
.admin-pagination {
  max-width: 92rem;
  margin-left: auto;
  margin-right: auto;
}

.admin-stats {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.admin-stat {
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--card));
  padding: 0.85rem;
}

.admin-stat span {
  color: hsl(var(--muted-foreground));
  font-size: 0.75rem;
}

.admin-stat strong {
  display: block;
  margin-top: 0.25rem;
  font-size: 1.45rem;
}

.admin-toolbar {
  display: grid;
  grid-template-columns: minmax(16rem, 1.6fr) repeat(5, minmax(8rem, 0.75fr)) auto auto;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.admin-search,
.admin-date-field {
  display: flex;
  height: 2.5rem;
  min-width: 0;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--background));
  padding: 0 0.75rem;
}

.admin-search input,
.admin-date-field input {
  width: 100%;
  border: 0;
  background: transparent;
  padding: 0;
}

.admin-inline-error {
  display: flex;
  max-width: 92rem;
  align-items: center;
  gap: 0.5rem;
  margin: 0 auto 0.75rem;
  font-size: 0.875rem;
}

.admin-meta-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.8125rem;
}

.admin-table-wrap {
  position: relative;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--card));
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.admin-table th {
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
  text-align: left;
  font-weight: 600;
}

.admin-table th,
.admin-table td {
  border-bottom: 1px solid hsl(var(--border));
  padding: 0.75rem;
  vertical-align: top;
}

.admin-table tbody tr:last-child td {
  border-bottom: 0;
}

.admin-images-cell {
  width: 13rem;
}

.admin-media-stack {
  display: grid;
  gap: 0.625rem;
}

.admin-media-group {
  display: grid;
  gap: 0.25rem;
}

.admin-media-label {
  color: hsl(var(--muted-foreground));
  font-size: 0.68rem;
  font-weight: 700;
}

.admin-image-strip,
.admin-card-images {
  display: flex;
  gap: 0.375rem;
}

.admin-image-strip button,
.admin-card-images button {
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--muted));
}

.admin-image-strip button {
  height: 3.5rem;
  width: 3.5rem;
}

.admin-reference-strip button {
  border-color: hsl(var(--primary) / 0.32);
}

.admin-image-strip img,
.admin-card-images img {
  height: 100%;
  width: 100%;
  object-fit: cover;
}

.admin-empty-image {
  display: inline-flex;
  height: 3.5rem;
  width: 3.5rem;
  align-items: center;
  justify-content: center;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 2px);
  color: hsl(var(--muted-foreground));
}

.admin-prompt-cell {
  min-width: 22rem;
}

.admin-prompt-block {
  display: grid;
  gap: 0.25rem;
}

.admin-prompt-block + .admin-prompt-block,
.admin-prompt-details,
.admin-reference-count {
  margin-top: 0.45rem;
}

.admin-field-label {
  color: hsl(var(--muted-foreground));
  font-size: 0.7rem;
  font-weight: 700;
}

.admin-prompt {
  display: -webkit-box;
  max-width: 34rem;
  overflow: hidden;
  margin: 0;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.admin-prompt--reference {
  color: hsl(var(--muted-foreground));
  -webkit-line-clamp: 2;
}

.admin-prompt-details {
  max-width: 34rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.75rem;
}

.admin-prompt-details summary {
  cursor: pointer;
  font-weight: 700;
}

.admin-prompt-details[open] .admin-prompt--full {
  display: block;
  max-height: 13rem;
  overflow: auto;
  -webkit-line-clamp: unset;
  margin-top: 0.35rem;
}

.admin-reference-count {
  margin-bottom: 0;
  color: hsl(var(--muted-foreground));
  font-size: 0.75rem;
}

.admin-job-error {
  margin: 0.35rem 0 0;
  font-size: 0.75rem;
}

.admin-user,
.admin-card-meta span {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.admin-user-stack {
  display: grid;
  min-width: 13rem;
  max-width: 18rem;
  gap: 0.45rem;
}

.admin-user-meta,
.admin-card-user-meta {
  display: grid;
  gap: 0.2rem;
}

.admin-card-user-meta {
  margin-top: 0.55rem;
}

.admin-user-meta-row {
  display: grid;
  grid-template-columns: 3.4rem minmax(0, 1fr);
  align-items: baseline;
  gap: 0.35rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.72rem;
  line-height: 1.35;
}

.admin-user-meta-label {
  color: hsl(var(--muted-foreground));
  font-weight: 700;
  white-space: nowrap;
}

.admin-user-meta-value {
  min-width: 0;
  overflow: hidden;
  color: hsl(var(--foreground));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-status {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid hsl(var(--border));
  border-radius: 999px;
  padding: 0.2rem 0.5rem;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
}

.admin-status--success {
  border-color: hsl(var(--success) / 0.28);
  background: hsl(var(--success) / 0.1);
  color: hsl(var(--success));
}

.admin-status--failed {
  border-color: hsl(var(--error) / 0.3);
  background: hsl(var(--error) / 0.1);
  color: hsl(var(--error));
}

.admin-status--running,
.admin-status--queued {
  border-color: hsl(var(--warning) / 0.3);
  background: hsl(var(--warning) / 0.12);
  color: hsl(var(--warning));
}

.admin-time {
  display: grid;
  gap: 0.15rem;
}

.admin-time small {
  color: hsl(var(--muted-foreground));
}

.admin-mobile-list {
  display: none;
}

.admin-empty-state {
  display: flex;
  min-height: 14rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: hsl(var(--muted-foreground));
}

.admin-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  padding-top: 1rem;
}

.admin-pagination button:disabled,
.admin-action-button:disabled,
.admin-icon-button:disabled {
  cursor: default;
  opacity: 0.45;
}

.admin-preview {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 0.72);
  padding: 1rem;
}

.admin-preview-panel {
  width: min(72rem, 100%);
  max-height: calc(100vh - 2rem);
  overflow: hidden;
  border-radius: var(--radius);
  background: hsl(var(--card));
}

.admin-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid hsl(var(--border));
  padding: 0.75rem;
}

.admin-preview-head div {
  display: flex;
  gap: 0.5rem;
}

.admin-preview-panel img {
  display: block;
  max-height: calc(100vh - 6rem);
  width: 100%;
  object-fit: contain;
}

@media (max-width: 1120px) {
  .admin-toolbar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .admin-search {
    grid-column: 1 / -1;
  }
}

@media (max-width: 760px) {
  .admin-shell {
    padding: 0.75rem;
  }

  .admin-pin-row {
    display: grid;
    grid-template-columns: 1fr;
  }

  .admin-pin-row button {
    width: 100%;
  }

  .admin-header {
    align-items: flex-start;
  }

  .admin-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .admin-stat:last-child {
    grid-column: 1 / -1;
  }

  .admin-toolbar {
    grid-template-columns: 1fr;
  }

  .admin-meta-row {
    display: grid;
    gap: 0.25rem;
  }

  .admin-table {
    display: none;
  }

  .admin-mobile-list {
    display: grid;
    gap: 0.75rem;
    padding: 0.75rem;
  }

  .admin-job-card {
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius);
    padding: 0.75rem;
  }

  .admin-job-card-head,
  .admin-card-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .admin-job-card-head {
    margin-bottom: 0.625rem;
  }

  .admin-card-images {
    margin-bottom: 0.75rem;
  }

  .admin-mobile-reference-group {
    display: grid;
    gap: 0.35rem;
    margin-bottom: 0.75rem;
  }

  .admin-card-images button {
    aspect-ratio: 1 / 1;
    flex: 1 1 0;
    min-width: 0;
  }

  .admin-card-meta {
    flex-wrap: wrap;
    margin-top: 0.75rem;
    color: hsl(var(--muted-foreground));
    font-size: 0.8125rem;
  }

  .admin-card-copy {
    width: 100%;
    margin-top: 0.75rem;
  }

  .admin-pagination {
    justify-content: space-between;
  }
}
</style>
