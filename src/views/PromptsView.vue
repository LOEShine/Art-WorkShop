<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Search,
  Sparkles,
} from "lucide-vue-next";

import MediaModal from "@/components/MediaModal.vue";
import { PROMPT_CATEGORIES, PROMPT_LIBRARY } from "@/data/reference";
import { useAppStore } from "@/stores/app";

const router = useRouter();
const store = useAppStore();

const keyword = ref("");
const activeCategory = ref<string | null>(null);
const copiedPromptId = ref<string | null>(null);
const expandedPromptId = ref<string | null>(null);
const previewImage = ref<string | null>(null);
const previewTitle = ref("");

const filteredPrompts = computed(() => {
  const query = keyword.value.trim().toLowerCase();

  return PROMPT_LIBRARY.filter((item) => {
    const matchesQuery =
      !query ||
      item.title.toLowerCase().includes(query) ||
      item.titleEn?.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query) ||
      item.prompt.toLowerCase().includes(query) ||
      item.tags.some((tag) => tag.toLowerCase().includes(query));

    const matchesCategory = !activeCategory.value || item.category === activeCategory.value;
    return matchesQuery && matchesCategory;
  });
});

async function copyPrompt(promptId: string, prompt: string) {
  await navigator.clipboard.writeText(prompt);
  copiedPromptId.value = promptId;
  window.setTimeout(() => {
    copiedPromptId.value = null;
  }, 2000);
}

function usePrompt(prompt: string) {
  store.setGenerationMode("image");
  store.setPrompt(prompt);
  router.push("/");
}

function backToCreate() {
  store.setGenerationMode("image");
  router.push("/");
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <header class="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div class="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <div class="flex items-center gap-4">
          <button
            type="button"
            class="flex items-center gap-2 transition-opacity hover:opacity-80"
            @click="backToCreate"
          >
            <img
              src="/favicon.svg"
              alt="logo"
              class="h-6 w-6"
            />
            <h1
              class="text-2xl font-bold leading-none"
              style="font-family: 'Caveat', cursive"
            >
              Art Workshop
            </h1>
          </button>
          <span class="text-muted-foreground">/</span>
          <span class="font-medium">提示词库</span>
        </div>

        <button
          type="button"
          class="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          @click="backToCreate"
        >
          <Sparkles class="h-4 w-4" />
          开始创作
        </button>
      </div>
    </header>

    <main class="mx-auto max-w-7xl px-4 py-8">
      <div class="mb-8 text-center">
        <h2 class="mb-2 text-3xl font-bold">提示词参考库</h2>
        <p class="mx-auto max-w-2xl text-muted-foreground">
          精选自
          <a
            href="https://github.com/ZeroLu/awesome-nanobanana-pro"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary hover:underline"
          >
            awesome-nanobanana-pro
          </a>
          和
          <a
            href="https://github.com/ZHO-ZHO-ZHO/Nano-Bananary"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary hover:underline"
          >
            Nano-Bananary
          </a>
          的优质提示词示例
        </p>
      </div>

      <div class="mb-6 space-y-4">
        <div class="relative mx-auto max-w-md">
          <Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            v-model="keyword"
            type="text"
            placeholder="搜索提示词..."
            class="h-10 w-full rounded-lg border bg-background pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div class="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            class="rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
            :class="activeCategory === null ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'"
            @click="activeCategory = null"
          >
            全部
          </button>

          <button
            v-for="category in PROMPT_CATEGORIES"
            :key="category.id"
            type="button"
            class="rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
            :class="activeCategory === category.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'"
            @click="activeCategory = category.id"
          >
            {{ category.name }}
          </button>
        </div>
      </div>

      <div class="mb-4 text-center text-sm text-muted-foreground">
        找到 {{ filteredPrompts.length }} 个提示词
      </div>

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="item in filteredPrompts"
          :key="item.id"
          class="overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md"
        >
          <div
            v-if="item.imageUrl"
            class="group relative aspect-video cursor-pointer overflow-hidden bg-muted"
            @click="previewImage = item.imageUrl || null; previewTitle = item.title"
          >
            <img
              :src="item.imageUrl"
              :alt="item.title"
              class="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
            <div class="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20">
              <span class="rounded bg-black/50 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                点击预览
              </span>
            </div>
          </div>

          <div class="p-4">
            <div class="mb-2 flex items-start justify-between gap-2">
              <div>
                <h3 class="text-base font-semibold">{{ item.title }}</h3>
                <p
                  v-if="item.titleEn"
                  class="text-xs text-muted-foreground"
                >
                  {{ item.titleEn }}
                </p>
              </div>

              <span
                v-if="PROMPT_CATEGORIES.find((category) => category.id === item.category)"
                class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
              >
                {{ PROMPT_CATEGORIES.find((category) => category.id === item.category)?.name }}
              </span>
            </div>

            <p class="mb-3 text-sm text-muted-foreground">{{ item.description }}</p>

            <div class="mb-3 flex flex-wrap gap-1">
              <span
                v-for="tag in item.tags"
                :key="tag"
                class="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {{ tag }}
              </span>
            </div>

            <div
              class="relative cursor-pointer rounded-md bg-muted/50 p-3 text-xs font-mono transition-all"
              :class="expandedPromptId === item.id ? 'max-h-[400px] overflow-y-auto' : 'max-h-[80px] overflow-hidden'"
              @click="expandedPromptId = expandedPromptId === item.id ? null : item.id"
            >
              <pre class="whitespace-pre-wrap break-words">{{ item.prompt }}</pre>
              <div
                v-if="expandedPromptId !== item.id"
                class="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-muted/50 to-transparent"
              />
            </div>

            <button
              type="button"
              class="mt-2 flex w-full items-center justify-center gap-1 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              @click="expandedPromptId = expandedPromptId === item.id ? null : item.id"
            >
              <ChevronUp
                v-if="expandedPromptId === item.id"
                class="h-3 w-3"
              />
              <ChevronDown
                v-else
                class="h-3 w-3"
              />
              {{ expandedPromptId === item.id ? "收起" : "展开全部" }}
            </button>
          </div>

          <div class="flex border-t">
            <button
              type="button"
              class="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm transition-colors hover:bg-muted"
              @click="copyPrompt(item.id, item.prompt)"
            >
              <Check
                v-if="copiedPromptId === item.id"
                class="h-4 w-4 text-green-500"
              />
              <Copy
                v-else
                class="h-4 w-4"
              />
              <span :class="copiedPromptId === item.id ? 'text-green-500' : ''">
                {{ copiedPromptId === item.id ? "已复制" : "复制" }}
              </span>
            </button>
            <div class="w-px bg-border" />
            <button
              type="button"
              class="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm text-primary transition-colors hover:bg-primary/5"
              @click="usePrompt(item.prompt)"
            >
              <ArrowRight class="h-4 w-4" />
              使用
            </button>
          </div>

          <div
            v-if="item.source"
            class="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground"
          >
            来源: {{ item.source }}
          </div>
        </article>
      </div>

      <div
        v-if="filteredPrompts.length === 0"
        class="py-12 text-center text-muted-foreground"
      >
        <p>没有找到匹配的提示词</p>
        <button
          type="button"
          class="mt-2 text-primary hover:underline"
          @click="keyword = ''; activeCategory = null"
        >
          清除筛选条件
        </button>
      </div>

      <div class="mt-12 border-t pt-8 text-center text-sm text-muted-foreground">
        <p class="mb-2">数据来源</p>
        <div class="flex justify-center gap-4">
          <a
            href="https://github.com/ZeroLu/awesome-nanobanana-pro"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-1 transition-colors hover:text-primary"
          >
            awesome-nanobanana-pro
            <ExternalLink class="h-3 w-3" />
          </a>
          <a
            href="https://github.com/ZHO-ZHO-ZHO/Nano-Bananary"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-1 transition-colors hover:text-primary"
          >
            Nano-Bananary
            <ExternalLink class="h-3 w-3" />
          </a>
        </div>
      </div>
    </main>

    <MediaModal
      :open="Boolean(previewImage)"
      :src="previewImage || ''"
      :title="previewTitle"
      @close="previewImage = null"
    />
  </div>
</template>
