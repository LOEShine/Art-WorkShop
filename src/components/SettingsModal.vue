<script setup lang="ts">
import { ref, watch } from "vue";

import { buildApiUrl } from "@/lib/api";
import { useAppStore } from "@/stores/app";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const store = useAppStore();

const apiBaseUrl = ref(store.apiBaseUrl);
const apiKey = ref(store.apiKey);
const showApiKey = ref(false);
const isTesting = ref(false);
const saved = ref(false);
const testStatus = ref<"success" | "error" | null>(null);
const testMessage = ref("");

watch(
  () => props.open,
  (open) => {
    if (!open) {
      return;
    }

    apiBaseUrl.value = store.apiBaseUrl;
    apiKey.value = store.apiKey;
    showApiKey.value = false;
    saved.value = false;
    testStatus.value = null;
    testMessage.value = "";
  },
);

function handleSave() {
  store.setApiSettings(apiBaseUrl.value, apiKey.value);
  saved.value = true;
  testStatus.value = null;
  testMessage.value = "";
  window.setTimeout(() => {
    saved.value = false;
  }, 2000);
}

async function handleTest() {
  isTesting.value = true;
  testStatus.value = null;
  testMessage.value = "";

  try {
    const response = await fetch(buildApiUrl(apiBaseUrl.value, "/v1/models"), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey.value.trim()}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    testStatus.value = "success";
    testMessage.value = "连接成功！API 可用";
  } catch (error) {
    testStatus.value = "error";
    testMessage.value = `连接失败: ${error instanceof Error ? error.message : "网络错误"}`;
  } finally {
    isTesting.value = false;
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
          ×
        </button>
      </div>

      <div class="space-y-4">
        <div class="space-y-2">
          <label class="text-sm font-medium">API 地址</label>
          <input
            v-model="apiBaseUrl"
            type="text"
            class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="https://api.example.com"
          />
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium">API Key</label>
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
              {{ showApiKey ? "隐" : "显" }}
            </button>
          </div>
        </div>

        <div class="space-y-2 pt-2">
          <button
            type="button"
            class="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            @click="handleSave"
          >
            保存配置
          </button>

          <button
            type="button"
            class="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent"
            :disabled="isTesting"
            @click="handleTest"
          >
            {{ isTesting ? "测试中..." : "测试连接" }}
          </button>

          <div
            v-if="saved"
            class="rounded-md bg-green-500/10 p-2 text-sm text-green-500"
          >
            配置已保存！
          </div>

          <div
            v-if="testStatus"
            class="rounded-md p-2 text-sm"
            :class="testStatus === 'success' ? 'bg-green-500/10 text-green-500' : 'bg-destructive/10 text-destructive'"
          >
            {{ testMessage }}
          </div>
        </div>

        <div class="border-t pt-4 text-xs text-muted-foreground">
          <p><strong>当前配置:</strong></p>
          <p>• 图片端点: POST /v1/images/generations</p>
          <p>• 视频端点: VectorEngine 统一代理接口</p>
          <p>• 支持模型: GPT Image, Gemini 3 Pro, Veo 3, Hailuo, Seedance, Sora</p>
        </div>
      </div>
    </div>
  </div>
</template>

