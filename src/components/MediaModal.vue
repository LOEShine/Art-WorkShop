<script setup lang="ts">
import { Download, Pencil, X } from "lucide-vue-next";

defineProps<{
  open: boolean;
  src: string;
  kind?: "image" | "video" | "prompt";
  title?: string;
  showContinue?: boolean;
  showDownload?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  continue: [];
  download: [];
}>();
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
    @click="emit('close')"
  >
    <div class="relative max-h-[90vh] max-w-[90vw]">
      <video
        v-if="kind === 'video'"
        :src="src"
        class="max-h-[90vh] max-w-[90vw] rounded-lg bg-black object-contain"
        controls
        playsinline
        preload="metadata"
        @click.stop
      />
      <img
        v-else
        :src="src"
        :alt="title || '预览'"
        class="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
        @click.stop
      />

      <div class="absolute right-2 top-2 flex gap-2">
        <button
          type="button"
          class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
          @click="emit('close')"
        >
          <X class="h-5 w-5" />
        </button>
      </div>

      <div
        v-if="showContinue || showDownload || title"
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

      <p
        v-if="title"
        class="mt-3 text-center text-sm text-white/80"
      >
        {{ title }}
      </p>
    </div>
  </div>
</template>
