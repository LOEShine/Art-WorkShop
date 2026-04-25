<script setup lang="ts">
import { ref, watch } from "vue";
import { Check, Eye, EyeOff, Key, LoaderCircle, Server, TestTube, X } from "lucide-vue-next";

import {
  buildApiUrl,
  CODEX_IMAGE_API_BASE_URL,
  CODEX_IMAGE_REMOTE_BASE_URL,
  VECTOR_API_BASE_URL,
} from "@/lib/api";
import { useAppStore } from "@/stores/app";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const store = useAppStore();

const apiKey = ref(store.apiKey);
const codexApiKey = ref(store.codexApiKey);
const showApiKey = ref(false);
const showCodexApiKey = ref(false);
const testingTarget = ref<"api" | "codex" | null>(null);
const saved = ref(false);
const apiTestStatus = ref<"success" | "error" | null>(null);
const apiTestMessage = ref("");
const codexTestStatus = ref<"success" | "error" | null>(null);
const codexTestMessage = ref("");

watch(
  () => props.open,
  (open) => {
    if (!open) {
      return;
    }

    apiKey.value = store.apiKey;
    codexApiKey.value = store.codexApiKey;
    showApiKey.value = false;
    showCodexApiKey.value = false;
    saved.value = false;
    testingTarget.value = null;
    apiTestStatus.value = null;
    apiTestMessage.value = "";
    codexTestStatus.value = null;
    codexTestMessage.value = "";
  },
);

function handleSave() {
  store.setApiSettings(apiKey.value, codexApiKey.value);
  saved.value = true;
  apiTestStatus.value = null;
  apiTestMessage.value = "";
  codexTestStatus.value = null;
  codexTestMessage.value = "";
  window.setTimeout(() => {
    saved.value = false;
  }, 2000);
}

async function testKey(kind: "api" | "codex") {
  const baseUrl = kind === "api" ? VECTOR_API_BASE_URL : CODEX_IMAGE_API_BASE_URL;
  const key = kind === "api" ? apiKey.value.trim() : codexApiKey.value.trim();

  testingTarget.value = kind;
  if (kind === "api") {
    apiTestStatus.value = null;
    apiTestMessage.value = "";
  } else {
    codexTestStatus.value = null;
    codexTestMessage.value = "";
  }

  try {
    const response = await fetch(buildApiUrl(baseUrl, "/v1/models"), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    if (kind === "api") {
      apiTestStatus.value = "success";
      apiTestMessage.value = "API KEY 可用";
    } else {
      codexTestStatus.value = "success";
      codexTestMessage.value = "CODEX KEY 可用";
    }
  } catch (error) {
    const message = `连接失败: ${error instanceof Error ? error.message : "网络错误"}`;
    if (kind === "api") {
      apiTestStatus.value = "error";
      apiTestMessage.value = message;
    } else {
      codexTestStatus.value = "error";
      codexTestMessage.value = message;
    }
  } finally {
    testingTarget.value = null;
  }
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center"
  >
    <div
      class="fixed inset-0 bg-black/50"
      @click="emit('close')"
    />

    <div class="relative z-50 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-semibold">设置</h2>
        <button
          type="button"
          class="inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-accent"
          @click="emit('close')"
        >
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="space-y-4">
        <div class="space-y-2">
          <label class="flex items-center gap-2 text-sm font-medium">
            <Key class="h-4 w-4" />
            API KEY
          </label>
          <div class="relative">
            <input
              v-model="apiKey"
              :type="showApiKey ? 'text' : 'password'"
              class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 pr-10 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="sk-..."
            />
            <button
              type="button"
              class="absolute right-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-accent"
              @click="showApiKey = !showApiKey"
            >
              <EyeOff
                v-if="showApiKey"
                class="h-4 w-4"
              />
              <Eye
                v-else
                class="h-4 w-4"
              />
            </button>
          </div>
          <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Server class="h-3.5 w-3.5" />
            {{ VECTOR_API_BASE_URL }}
          </p>
        </div>

        <div class="space-y-2">
          <label class="flex items-center gap-2 text-sm font-medium">
            <Key class="h-4 w-4" />
            CODEX KEY
          </label>
          <div class="relative">
            <input
              v-model="codexApiKey"
              :type="showCodexApiKey ? 'text' : 'password'"
              class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 pr-10 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="sk-..."
            />
            <button
              type="button"
              class="absolute right-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-accent"
              @click="showCodexApiKey = !showCodexApiKey"
            >
              <EyeOff
                v-if="showCodexApiKey"
                class="h-4 w-4"
              />
              <Eye
                v-else
                class="h-4 w-4"
              />
            </button>
          </div>
          <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Server class="h-3.5 w-3.5" />
            {{ CODEX_IMAGE_REMOTE_BASE_URL }}
          </p>
        </div>

        <div class="space-y-2 pt-2">
          <button
            type="button"
            class="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            @click="handleSave"
          >
            <Check class="h-4 w-4" />
            保存配置
          </button>

          <button
            type="button"
            class="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent"
            :disabled="Boolean(testingTarget)"
            @click="testKey('api')"
          >
            <LoaderCircle
              v-if="testingTarget === 'api'"
              class="h-4 w-4 animate-spin"
            />
            <TestTube
              v-else
              class="h-4 w-4"
            />
            {{ testingTarget === 'api' ? "测试中..." : "测试 API KEY" }}
          </button>

          <button
            type="button"
            class="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent"
            :disabled="Boolean(testingTarget)"
            @click="testKey('codex')"
          >
            <LoaderCircle
              v-if="testingTarget === 'codex'"
              class="h-4 w-4 animate-spin"
            />
            <TestTube
              v-else
              class="h-4 w-4"
            />
            {{ testingTarget === 'codex' ? "测试中..." : "测试 CODEX KEY" }}
          </button>

          <div
            v-if="saved"
            class="rounded-md bg-green-500/10 p-2 text-sm text-green-500"
          >
            <Check class="mr-2 inline h-4 w-4" />
            配置已保存！
          </div>

          <div
            v-if="apiTestStatus"
            class="flex items-center rounded-md p-2 text-sm"
            :class="apiTestStatus === 'success' ? 'bg-green-500/10 text-green-500' : 'bg-destructive/10 text-destructive'"
          >
            <Check
              v-if="apiTestStatus === 'success'"
              class="mr-2 h-4 w-4"
            />
            <X
              v-else
              class="mr-2 h-4 w-4"
            />
            {{ apiTestMessage }}
          </div>

          <div
            v-if="codexTestStatus"
            class="flex items-center rounded-md p-2 text-sm"
            :class="codexTestStatus === 'success' ? 'bg-green-500/10 text-green-500' : 'bg-destructive/10 text-destructive'"
          >
            <Check
              v-if="codexTestStatus === 'success'"
              class="mr-2 h-4 w-4"
            />
            <X
              v-else
              class="mr-2 h-4 w-4"
            />
            {{ codexTestMessage }}
          </div>
        </div>

        <div class="border-t pt-4 text-xs text-muted-foreground">
          <p><strong>当前配置:</strong></p>
          <p>• API KEY: VectorEngine 图片/视频统一接口</p>
          <p>• CODEX KEY: Codex Image 2.0 生图/图生图接口</p>
          <p>• 支持模型: GPT Image, Codex Image, Gemini, Veo, Hailuo, Seedance, Sora</p>
        </div>
      </div>
    </div>
  </div>
</template>
