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

onMounted(() => {
  if (!canvas.value) {
    return;
  }

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
});

watch(() => props.active, syncPlayback);

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
