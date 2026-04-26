<script setup lang="ts">
import { ChevronLeft, ChevronRight, Download, Pencil, X } from "lucide-vue-next";

defineProps<{
  open: boolean;
  src: string;
  kind?: "image" | "video" | "prompt";
  title?: string;
  showContinue?: boolean;
  showDownload?: boolean;
  items?: string[];
  activeIndex?: number;
}>();

const emit = defineEmits<{
  close: [];
  continue: [];
  download: [];
  previous: [];
  next: [];
  select: [index: number];
}>();
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/80 p-3 sm:p-5"
    @click="emit('close')"
  >
    <div class="relative flex h-full max-h-[calc(100dvh-1.5rem)] w-full max-w-[calc(100vw-1.5rem)] flex-col items-center justify-center gap-3 sm:max-h-[calc(100dvh-2.5rem)] sm:max-w-[calc(100vw-2.5rem)]">
      <div class="relative flex min-h-0 max-h-[80dvh] max-w-[80vw] flex-1 items-center justify-center">
        <video
          v-if="kind === 'video'"
          :src="src"
          class="max-h-[80dvh] max-w-[80vw] rounded-lg bg-black object-contain"
          controls
          playsinline
          preload="metadata"
          @click.stop
        />
        <img
          v-else
          :src="src"
          :alt="title || '预览'"
          class="max-h-[80dvh] max-w-[80vw] rounded-lg object-contain"
          @click.stop
        />

        <template v-if="kind !== 'video' && items && items.length > 1">
          <button
            type="button"
            class="absolute left-2 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
            @click.stop="emit('previous')"
          >
            <ChevronLeft class="h-5 w-5" />
          </button>
          <button
            type="button"
            class="absolute right-2 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
            @click.stop="emit('next')"
          >
            <ChevronRight class="h-5 w-5" />
          </button>
        </template>

        <div class="absolute right-2 top-2 flex gap-2">
          <button
            type="button"
            class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
            @click.stop="emit('close')"
          >
            <X class="h-5 w-5" />
          </button>
        </div>

        <div
          v-if="showContinue || showDownload"
          class="absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2"
        >
          <button
            v-if="showContinue"
            type="button"
            class="inline-flex items-center justify-center gap-2 rounded-md bg-secondary px-4 py-2 text-sm text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80"
            @click.stop="emit('continue')"
          >
            <Pencil class="h-4 w-4" />
            继续修改
          </button>
          <button
            v-if="showDownload"
            type="button"
            class="inline-flex items-center justify-center gap-2 rounded-md bg-secondary px-4 py-2 text-sm text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80"
            @click.stop="emit('download')"
          >
            <Download class="h-4 w-4" />
            下载
          </button>
        </div>
      </div>

      <p
        v-if="title"
        class="shrink-0 text-center text-sm text-white/80"
      >
        {{ title }}
      </p>

      <div
        v-if="kind !== 'video' && items && items.length > 1"
        class="flex max-w-full shrink-0 gap-2 overflow-x-auto px-2 pb-1"
        @click.stop
      >
        <button
          v-for="(item, index) in items"
          :key="`${item}-${index}`"
          type="button"
          class="h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 transition-colors"
          :class="index === activeIndex ? 'border-blue-300 opacity-100' : 'border-white/20 opacity-70 hover:opacity-100'"
          @click="emit('select', index)"
        >
          <img
            :src="item"
            alt=""
            class="h-full w-full object-cover"
          />
        </button>
      </div>
    </div>
  </div>
</template>
