<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { DotLottie } from "@lottiefiles/dotlottie-web";

const props = withDefaults(
  defineProps<{
    active?: boolean;
    src?: string;
  }>(),
  {
    active: true,
    src: "/lottie/loading.lottie",
  },
);

const canvas = ref<HTMLCanvasElement | null>(null);
let player: DotLottie | null = null;

function createPlayer() {
  if (!canvas.value) {
    return;
  }

  player?.destroy();
  player = new DotLottie({
    canvas: canvas.value,
    src: props.src,
    loop: true,
    autoplay: props.active,
    layout: {
      fit: "contain",
      align: [0.5, 0.5],
    },
    renderConfig: {
      autoResize: true,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
  });
}

function syncPlayback() {
  if (!player) {
    return;
  }

  if (props.active) {
    player.play();
  } else {
    player.stop();
  }
}

onMounted(createPlayer);

watch(() => props.active, syncPlayback);
watch(() => props.src, createPlayer);

onBeforeUnmount(() => {
  player?.destroy();
  player = null;
});
</script>

<template>
  <canvas
    ref="canvas"
    class="h-full w-full"
    aria-hidden="true"
  />
</template>
