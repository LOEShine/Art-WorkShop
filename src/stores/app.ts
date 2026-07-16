import { defineStore } from "pinia";

import {
  createDefaultImageConfigs,
  DEFAULT_IMAGE_MODEL_ID,
  is4kImageConfig,
} from "@/data/image-models";
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
const LEGACY_SEEDREAM_MODEL_ID = "seedream-4.5";
const SEEDREAM_5_MODEL_ID: ImageModelId = "seedream-5.0-pro";

const LEGACY_SEEDREAM_ASPECT_RATIOS: Record<string, string> = {
  "2048x2048": "1:1",
  "2560x1440": "16:9",
  "2688x1792": "3:2",
  "2688x2016": "4:3",
  "4096x4096": "1:1",
};

function migrateLegacySeedreamConfig(config: ImageConfigRecord = {}): ImageConfigRecord {
  const { size, ...currentConfig } = config;
  return {
    ...currentConfig,
    aspectRatio: LEGACY_SEEDREAM_ASPECT_RATIOS[String(size || "")] || "auto",
    resolution: "2k",
    outputFormat: "jpeg",
  };
}

function migrateLegacySeedreamTask(task: ImageTask | null): ImageTask | null {
  if (!task || String(task.model) !== LEGACY_SEEDREAM_MODEL_ID) {
    return task;
  }

  return {
    ...task,
    model: SEEDREAM_5_MODEL_ID,
    modelConfig: migrateLegacySeedreamConfig(task.modelConfig),
  };
}

interface PersistedState {
  apiBaseUrl: string;
  apiKey: string;
  imageApiKey: string;
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
    imageApiKey: "",
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
    const persistedImageModelConfigs = (parsed.imageModelConfigs || {}) as Record<string, ImageConfigRecord>;
    const imageModelConfigs = {
      ...defaults.imageModelConfigs,
      ...persistedImageModelConfigs,
    };
    if (persistedImageModelConfigs[LEGACY_SEEDREAM_MODEL_ID] && !persistedImageModelConfigs[SEEDREAM_5_MODEL_ID]) {
      imageModelConfigs[SEEDREAM_5_MODEL_ID] = {
        ...defaults.imageModelConfigs[SEEDREAM_5_MODEL_ID],
        ...migrateLegacySeedreamConfig(persistedImageModelConfigs[LEGACY_SEEDREAM_MODEL_ID]),
      };
    }
    delete (imageModelConfigs as Record<string, ImageConfigRecord>)[LEGACY_SEEDREAM_MODEL_ID];
    Object.values(imageModelConfigs).forEach((config) => {
      if ("n" in config && is4kImageConfig(config)) {
        config.n = 1;
      }
    });

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
      imageApiKey: parsed.imageApiKey ?? defaults.imageApiKey ?? "",
      codexApiKey: parsed.codexApiKey ?? defaults.codexApiKey ?? "",
      themeMode: getPreferredThemeMode(),
      selectedImageModel:
        String(parsed.selectedImageModel || defaults.selectedImageModel) === LEGACY_SEEDREAM_MODEL_ID
          ? SEEDREAM_5_MODEL_ID
          : parsed.selectedImageModel || defaults.selectedImageModel,
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
      imageApiKey: persisted.imageApiKey,
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
        this.history = imageHistory.map((task) => migrateLegacySeedreamTask(task) as ImageTask);
        this.videoHistory = videoHistory;
        const migratedCurrentImageTask = migrateLegacySeedreamTask(currentImageTask);
        if (!this.currentTask && migratedCurrentImageTask?.status === "generating") {
          this.currentTask = migratedCurrentImageTask;
          this.isGenerating = true;
        } else if (migratedCurrentImageTask) {
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
        imageApiKey: this.imageApiKey,
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
        imageApiKey: this.imageApiKey,
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
    setApiSettings(imageApiKey: string, apiKey: string, codexApiKey: string) {
      this.apiBaseUrl = VECTOR_API_BASE_URL;
      this.imageApiKey = imageApiKey.trim();
      this.apiKey = apiKey.trim();
      this.codexApiKey = codexApiKey.trim();
      writePersistedSettings({
        apiBaseUrl: this.apiBaseUrl,
        apiKey: this.apiKey,
        imageApiKey: this.imageApiKey,
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
      const nextConfig = {
        ...this.imageModelConfigs[model],
        [key]: value,
      };
      if ("n" in nextConfig && is4kImageConfig(nextConfig)) {
        nextConfig.n = 1;
      }
      this.imageModelConfigs[model] = nextConfig;
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
    async addHistoryTask(task: ImageTask, options: { requirePersistence?: boolean } = {}) {
      const nextHistory = [task, ...this.history.filter((item) => !isSameImageTaskIdentity(item, task))].slice(
        0,
        HISTORY_LIMIT,
      );

      if (options.requirePersistence) {
        try {
          await saveImageHistoryTask(task, HISTORY_LIMIT);
        } catch (error) {
          console.error("[history-db] failed to save image history task:", error);
          throw error;
        }
        this.history = nextHistory;
        this.persist();
        return;
      }

      this.history = nextHistory;
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
