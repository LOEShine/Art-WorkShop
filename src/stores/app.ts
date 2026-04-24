import { defineStore } from "pinia";

import { createDefaultImageConfigs, DEFAULT_IMAGE_MODEL_ID } from "@/data/image-models";
import {
  createDefaultVideoConfigs,
  normalizeVideoConfig,
  VIDEO_TRANSIENT_KEYS,
} from "@/data/video-models";
import {
  deleteImageHistoryTask,
  loadImageHistory,
  loadVideoHistory,
  saveImageHistoryTask,
  saveVideoHistoryTask,
  deleteVideoHistoryTask,
} from "@/lib/history-db";
import {
  readPersistedSettings,
  writePersistedSettings,
} from "@/lib/settings-storage";
import type {
  GenerationMode,
  ImageConfigRecord,
  ImageConfigValue,
  ImageModelId,
  ImageTask,
  VideoConfigRecord,
  VideoConfigValue,
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
  };
}

function readPersistedState(): PersistedState {
  const defaults = {
    ...buildPersistedState(),
    ...readPersistedSettings(),
  };

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
      history: [] as ImageTask[],
      videoHistory: [] as VideoTask[],
      selectedVideoModel: persisted.selectedVideoModel,
      videoConfigs: persisted.videoConfigs,
      videoTask: null as VideoTask | null,
      historyHydrated: false,
    };
  },
  actions: {
    async hydrateHistory() {
      try {
        const [imageHistory, videoHistory] = await Promise.all([
          loadImageHistory(HISTORY_LIMIT),
          loadVideoHistory(HISTORY_LIMIT),
        ]);
        this.history = imageHistory;
        this.videoHistory = videoHistory;
      } catch (error) {
        console.error("[history-db] failed to load history:", error);
      } finally {
        this.historyHydrated = true;
      }
    },
    persist() {
      writePersistedSettings({
        apiBaseUrl: this.apiBaseUrl,
        apiKey: this.apiKey,
      });

      const videoConfigs = {} as PersistedState["videoConfigs"];
      (Object.keys(this.videoConfigs) as VideoModelId[]).forEach((key) => {
        const config = this.videoConfigs[key];
        const plainConfig = {} as VideoConfigRecord;

        Object.entries(config).forEach(([field, value]) => {
          if (VIDEO_TRANSIENT_KEYS.includes(field as (typeof VIDEO_TRANSIENT_KEYS)[number])) {
            return;
          }
          plainConfig[field] = value;
        });

        videoConfigs[key] = plainConfig;
      });

      const payload: PersistedState = {
        apiBaseUrl: this.apiBaseUrl,
        apiKey: this.apiKey,
        generationMode: this.generationMode,
        selectedImageModel: this.selectedImageModel,
        imageModelConfigs: this.imageModelConfigs,
        selectedVideoModel: this.selectedVideoModel,
        videoConfigs,
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    },
    setApiSettings(baseUrl: string, apiKey: string) {
      this.apiBaseUrl = baseUrl.trim().replace(/\/+$/, "") || "https://api.vectorengine.ai";
      this.apiKey = apiKey.trim();
      writePersistedSettings({
        apiBaseUrl: this.apiBaseUrl,
        apiKey: this.apiKey,
      });
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
    setImageModelConfig(model: ImageModelId, key: string, value: ImageConfigValue) {
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
    async addHistoryTask(task: ImageTask) {
      this.history = [task, ...this.history].slice(0, HISTORY_LIMIT);
      try {
        await saveImageHistoryTask(task, HISTORY_LIMIT);
      } catch (error) {
        console.error("[history-db] failed to save image history task:", error);
      }
      this.persist();
    },
    async removeHistoryTask(taskId: string) {
      this.history = this.history.filter((task) => task.id !== taskId);
      try {
        await deleteImageHistoryTask(taskId);
      } catch (error) {
        console.error("[history-db] failed to delete image history task:", error);
      }
      this.persist();
    },
    async addVideoHistoryTask(task: VideoTask) {
      this.videoHistory = [task, ...this.videoHistory]
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, HISTORY_LIMIT);
      try {
        await saveVideoHistoryTask(task, HISTORY_LIMIT);
      } catch (error) {
        console.error("[history-db] failed to save video history task:", error);
      }
      this.persist();
    },
    async removeVideoHistoryTask(taskId: string) {
      this.videoHistory = this.videoHistory.filter((task) => task.id !== taskId);
      try {
        await deleteVideoHistoryTask(taskId);
      } catch (error) {
        console.error("[history-db] failed to delete video history task:", error);
      }
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
    loadVideoTaskConfig(task: VideoTask) {
      this.generationMode = "video";
      this.selectedVideoModel = task.modelKey;
      this.videoConfigs[task.modelKey] = {
        ...this.videoConfigs[task.modelKey],
        ...(task.modelConfig || {}),
      };
      normalizeVideoConfig(task.modelKey, this.videoConfigs[task.modelKey]);
      this.prompt = task.prompt || "";
      this.persist();
    },
    setSelectedVideoModel(model: VideoModelId) {
      this.selectedVideoModel = model;
      normalizeVideoConfig(model, this.videoConfigs[model]);
      this.persist();
    },
    setVideoField(field: string, value: VideoConfigValue) {
      const config = this.videoConfigs[this.selectedVideoModel];
      if (!config) {
        return;
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
      this.persist();
    },
  },
});
