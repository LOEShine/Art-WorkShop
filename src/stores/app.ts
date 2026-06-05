import { defineStore } from "pinia";

import { createDefaultImageConfigs, DEFAULT_IMAGE_MODEL_ID } from "@/data/image-models";
import {
  createDefaultVideoConfigs,
  normalizeVideoConfig,
  VIDEO_TRANSIENT_KEYS,
} from "@/data/video-models";
import {
  deleteCurrentImageTask,
  deleteCurrentVideoTask,
  deleteImageHistoryTask,
  loadCurrentImageTask,
  loadImageHistory,
  loadCurrentVideoTask,
  loadVideoHistory,
  isSameImageTaskIdentity,
  saveCurrentImageTask,
  saveCurrentVideoTask,
  saveImageHistoryTask,
  saveVideoHistoryTask,
  deleteVideoHistoryTask,
} from "@/lib/history-db";
import { VECTOR_API_BASE_URL } from "@/lib/api";
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
  ThemeMode,
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
  codexApiKey: string;
  themeMode: ThemeMode;
  generationMode: GenerationMode;
  selectedImageModel: ImageModelId;
  imageModelConfigs: ReturnType<typeof createDefaultImageConfigs>;
  selectedVideoModel: VideoModelId;
  videoConfigs: ReturnType<typeof createDefaultVideoConfigs>;
}

function getPreferredThemeMode(): ThemeMode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function buildPersistedState(): PersistedState {
  const imageModelConfigs = createDefaultImageConfigs();
  const videoConfigs = createDefaultVideoConfigs();
  return {
    apiBaseUrl: VECTOR_API_BASE_URL,
    apiKey: "",
    codexApiKey: "",
    themeMode: getPreferredThemeMode(),
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
    apiBaseUrl: VECTOR_API_BASE_URL,
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
      apiBaseUrl: VECTOR_API_BASE_URL,
      codexApiKey: parsed.codexApiKey ?? defaults.codexApiKey ?? "",
      themeMode: getPreferredThemeMode(),
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
      codexApiKey: persisted.codexApiKey,
      themeMode: persisted.themeMode,
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
        const [imageHistory, videoHistory, currentImageTask, currentVideoTask] = await Promise.all([
          loadImageHistory(HISTORY_LIMIT),
          loadVideoHistory(HISTORY_LIMIT),
          loadCurrentImageTask(),
          loadCurrentVideoTask(),
        ]);
        this.history = imageHistory;
        this.videoHistory = videoHistory;
        if (!this.currentTask && currentImageTask?.status === "generating") {
          this.currentTask = currentImageTask;
          this.isGenerating = true;
        } else if (currentImageTask) {
          await deleteCurrentImageTask();
        }
        if (!this.videoTask && currentVideoTask) {
          this.videoTask = currentVideoTask;
        }
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
        codexApiKey: this.codexApiKey,
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
        codexApiKey: this.codexApiKey,
        themeMode: getPreferredThemeMode(),
        generationMode: this.generationMode,
        selectedImageModel: this.selectedImageModel,
        imageModelConfigs: this.imageModelConfigs,
        selectedVideoModel: this.selectedVideoModel,
        videoConfigs,
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    },
    applyTheme() {
      document.documentElement.classList.toggle("dark", this.themeMode === "dark");
      document.documentElement.dataset.theme = this.themeMode;
    },
    setThemeMode(mode: ThemeMode) {
      this.themeMode = mode;
      this.applyTheme();
      this.persist();
    },
    toggleTheme() {
      this.setThemeMode(this.themeMode === "dark" ? "light" : "dark");
    },
    setApiSettings(apiKey: string, codexApiKey: string) {
      this.apiBaseUrl = VECTOR_API_BASE_URL;
      this.apiKey = apiKey.trim();
      this.codexApiKey = codexApiKey.trim();
      writePersistedSettings({
        apiBaseUrl: this.apiBaseUrl,
        apiKey: this.apiKey,
        codexApiKey: this.codexApiKey,
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
      if (task?.status === "generating") {
        void saveCurrentImageTask(task).catch((error) => {
          console.error("[history-db] failed to save current image task:", error);
        });
      } else {
        void deleteCurrentImageTask().catch((error) => {
          console.error("[history-db] failed to clear current image task:", error);
        });
      }
    },
    async addHistoryTask(task: ImageTask) {
      this.history = [task, ...this.history.filter((item) => !isSameImageTaskIdentity(item, task))].slice(
        0,
        HISTORY_LIMIT,
      );
      try {
        await saveImageHistoryTask(task, HISTORY_LIMIT);
      } catch (error) {
        console.error("[history-db] failed to save image history task:", error);
      }
      this.persist();
    },
    async removeHistoryTask(taskId: string) {
      const removedTask = this.history.find((task) => task.id === taskId);
      this.history = this.history.filter((task) => task.id !== taskId);
      if (removedTask && this.currentTask && isSameImageTaskIdentity(removedTask, this.currentTask)) {
        this.setCurrentTask(null);
        this.isGenerating = false;
      }
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
    async setVideoTask(task: VideoTask | null) {
      this.videoTask = task;
      try {
        if (task) {
          await saveCurrentVideoTask(task);
        } else {
          await deleteCurrentVideoTask();
        }
      } catch (error) {
        if (task) {
          console.error("[history-db] failed to save current video task:", error);
        } else {
          console.error("[history-db] failed to clear current video task:", error);
        }
      }
      this.persist();
    },
  },
});
