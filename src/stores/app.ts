import { defineStore } from "pinia";

import { createDefaultImageConfigs, DEFAULT_IMAGE_MODEL_ID } from "@/data/image-models";
import {
  createDefaultVideoConfigs,
  normalizeVideoConfig,
  VIDEO_TRANSIENT_KEYS,
} from "@/data/video-models";
import type {
  GenerationMode,
  ImageModelId,
  ImageTask,
  VideoModelId,
  VideoTask,
} from "@/types";

const STORAGE_KEY = "art-workshop-storage-v1";
const HISTORY_LIMIT = 20;

interface PersistedState {
  apiBaseUrl: string;
  apiKey: string;
  generationMode: GenerationMode;
  selectedImageModel: ImageModelId;
  imageModelConfigs: ReturnType<typeof createDefaultImageConfigs>;
  selectedVideoModel: VideoModelId;
  videoConfigs: ReturnType<typeof createDefaultVideoConfigs>;
  history: ImageTask[];
}

function buildPersistedState(): PersistedState {
  const imageModelConfigs = createDefaultImageConfigs();
  const videoConfigs = createDefaultVideoConfigs();
  return {
    apiBaseUrl: "https://api.vectorengine.ai",
    apiKey: "",
    generationMode: "image",
    selectedImageModel: DEFAULT_IMAGE_MODEL_ID,
    imageModelConfigs,
    selectedVideoModel: "veo3",
    videoConfigs,
    history: [],
  };
}

function readPersistedState(): PersistedState {
  const defaults = buildPersistedState();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaults;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const imageModelConfigs = {
      ...defaults.imageModelConfigs,
      ...(parsed.imageModelConfigs || {}),
    };

    const videoConfigs = {
      ...defaults.videoConfigs,
      ...(parsed.videoConfigs || {}),
    };

    (Object.keys(videoConfigs) as VideoModelId[]).forEach((key) => {
      videoConfigs[key] = {
        ...defaults.videoConfigs[key],
        ...(videoConfigs[key] || {}),
      };
      normalizeVideoConfig(key, videoConfigs[key]);
    });

    return {
      ...defaults,
      ...parsed,
      imageModelConfigs,
      videoConfigs,
      history: Array.isArray(parsed.history)
        ? parsed.history.slice(0, HISTORY_LIMIT)
        : defaults.history,
    };
  } catch {
    return defaults;
  }
}

export const useAppStore = defineStore("artWorkshop", {
  state: () => {
    const persisted = readPersistedState();
    return {
      apiBaseUrl: persisted.apiBaseUrl,
      apiKey: persisted.apiKey,
      generationMode: persisted.generationMode,
      selectedImageModel: persisted.selectedImageModel,
      imageModelConfigs: persisted.imageModelConfigs,
      uploadedImages: [] as string[],
      prompt: "",
      isGenerating: false,
      currentTask: null as ImageTask | null,
      history: persisted.history,
      selectedVideoModel: persisted.selectedVideoModel,
      videoConfigs: persisted.videoConfigs,
      videoTask: null as VideoTask | null,
    };
  },
  actions: {
    persist() {
      const videoConfigs = structuredClone(this.videoConfigs);
      (Object.keys(videoConfigs) as VideoModelId[]).forEach((key) => {
        for (const transientKey of VIDEO_TRANSIENT_KEYS) {
          delete videoConfigs[key][transientKey];
        }
      });

      const payload: PersistedState = {
        apiBaseUrl: this.apiBaseUrl,
        apiKey: this.apiKey,
        generationMode: this.generationMode,
        selectedImageModel: this.selectedImageModel,
        imageModelConfigs: this.imageModelConfigs,
        selectedVideoModel: this.selectedVideoModel,
        videoConfigs,
        history: this.history
          .slice(0, HISTORY_LIMIT)
          .map((item) => ({ ...item, sourceImages: [], resultImages: [] })),
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    },
    setApiSettings(baseUrl: string, apiKey: string) {
      this.apiBaseUrl = baseUrl.trim().replace(/\/+$/, "") || "https://api.vectorengine.ai";
      this.apiKey = apiKey.trim();
      this.persist();
    },
    setGenerationMode(mode: GenerationMode) {
      this.generationMode = mode;
      this.persist();
    },
    setSelectedImageModel(model: ImageModelId) {
      this.selectedImageModel = model;
      this.persist();
    },
    setImageModelConfig(model: ImageModelId, key: string, value: string | number | boolean) {
      this.imageModelConfigs[model] = {
        ...this.imageModelConfigs[model],
        [key]: value,
      };
      this.persist();
    },
    setPrompt(prompt: string) {
      this.prompt = prompt;
    },
    addUploadedImage(image: string) {
      this.uploadedImages.push(image);
    },
    removeUploadedImage(index: number) {
      this.uploadedImages = this.uploadedImages.filter((_, currentIndex) => currentIndex !== index);
    },
    setUploadedImages(images: string[]) {
      this.uploadedImages = images;
    },
    clearUploadedImages() {
      this.uploadedImages = [];
    },
    setIsGenerating(value: boolean) {
      this.isGenerating = value;
    },
    setCurrentTask(task: ImageTask | null) {
      this.currentTask = task;
    },
    addHistoryTask(task: ImageTask) {
      this.history = [task, ...this.history].slice(0, HISTORY_LIMIT);
      this.persist();
    },
    removeHistoryTask(taskId: string) {
      this.history = this.history.filter((task) => task.id !== taskId);
      this.persist();
    },
    continueWithResult(image: string) {
      this.generationMode = "image";
      this.uploadedImages = [image];
      this.prompt = "";
      this.persist();
    },
    loadTaskConfig(task: ImageTask) {
      this.generationMode = "image";
      this.selectedImageModel = task.model;
      this.imageModelConfigs[task.model] = {
        ...this.imageModelConfigs[task.model],
        ...task.modelConfig,
      };
      this.prompt = task.prompt;
      this.persist();
    },
    setSelectedVideoModel(model: VideoModelId) {
      this.selectedVideoModel = model;
      normalizeVideoConfig(model, this.videoConfigs[model]);
      this.persist();
    },
    setVideoField(field: string, value: string | number | boolean) {
      const config = this.videoConfigs[this.selectedVideoModel];
      if (!config) {
        return;
      }

      if (field === "primaryImageSource" && value && config.mode === "text") {
        config.mode = "image";
      }

      if (field === "lastFrameSource" && value) {
        config.mode = "first-last";
      }

      config[field] = value;
      normalizeVideoConfig(this.selectedVideoModel, config);
      this.persist();
    },
    clearVideoAsset(sourceKey: string, nameKey: string) {
      const config = this.videoConfigs[this.selectedVideoModel];
      if (!config) {
        return;
      }

      config[sourceKey] = "";
      config[nameKey] = "";
      normalizeVideoConfig(this.selectedVideoModel, config);
      this.persist();
    },
    setVideoTask(task: VideoTask | null) {
      this.videoTask = task;
    },
  },
});

