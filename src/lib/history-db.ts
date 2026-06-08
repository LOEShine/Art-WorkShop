import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";

import type { ImageTask, VideoTask } from "@/types";

const DB_NAME = "art-workshop-db";
const DB_VERSION = 4;
const IMAGE_HISTORY_STORE = "image-history";
const VIDEO_HISTORY_STORE = "video-history";
const CURRENT_IMAGE_TASK_STORE = "current-image-task";
const CURRENT_VIDEO_TASK_STORE = "current-video-task";
const CURRENT_IMAGE_TASK_KEY = "current";
const CURRENT_VIDEO_TASK_KEY = "current";

interface ArtWorkshopDb extends DBSchema {
  "image-history": {
    key: string;
    value: ImageTask;
    indexes: {
      "by-createdAt": number;
    };
  };
  "video-history": {
    key: string;
    value: VideoTask;
    indexes: {
      "by-createdAt": number;
    };
  };
  "current-image-task": {
    key: string;
    value: {
      key: string;
      task: ImageTask;
    };
  };
  "current-video-task": {
    key: string;
    value: {
      key: string;
      task: VideoTask;
    };
  };
}

function prepareImageTaskForStorage(task: ImageTask): ImageTask {
  const now = Date.now();
  return {
    id: String(task.id || ""),
    createdAt: Number(task.createdAt) || now,
    updatedAt: Number(task.updatedAt) || now,
    status: task.status,
    serverJobId: task.serverJobId ? String(task.serverJobId) : undefined,
    clientRequestId: task.clientRequestId ? String(task.clientRequestId) : undefined,
    requestFingerprint: task.requestFingerprint ? String(task.requestFingerprint) : undefined,
    remoteStatus: task.remoteStatus ? String(task.remoteStatus) : undefined,
    progress: task.progress ? String(task.progress) : undefined,
    progressPercent: Number(task.progressPercent) || 0,
    sourceImages: toPlainStringArray(task.sourceImages),
    prompt: String(task.prompt || ""),
    promptMetadata: task.promptMetadata
      ? {
          userPrompt: String(task.promptMetadata.userPrompt || ""),
          submittedPrompt: String(task.promptMetadata.submittedPrompt || ""),
          referenceText: String(task.promptMetadata.referenceText || ""),
          systemPrompts: toPlainStringArray(task.promptMetadata.systemPrompts),
          sourceImageCount: Number(task.promptMetadata.sourceImageCount) || 0,
        }
      : undefined,
    model: task.model,
    modelConfig: { ...(task.modelConfig || {}) },
    resultImages: toPlainStringArray(task.resultImages),
    generationTime: Number(task.generationTime) || 0,
    error: task.error ? String(task.error) : undefined,
  };
}

let databasePromise: Promise<IDBPDatabase<ArtWorkshopDb>> | null = null;

function toPlainStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function toPlainVideoConfig(config: VideoTask["modelConfig"]): VideoTask["modelConfig"] {
  if (!config) {
    return undefined;
  }

  const plainConfig: Record<string, string | number | boolean | string[]> = {};

  Object.entries(config as Record<string, unknown>).forEach(([key, value]) => {
    if (key === "sourceVideoReference" || key === "sourceVideoUrl") {
      plainConfig[key] = "";
      return;
    }

    if (Array.isArray(value)) {
      plainConfig[key] = toPlainStringArray(value);
      return;
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      plainConfig[key] = value;
    }
  });

  return plainConfig;
}

function createPlaybackUrl(task: VideoTask): VideoTask {
  if (task.videoBlob && !task.videoUrl) {
    return {
      ...task,
      videoUrl: URL.createObjectURL(task.videoBlob),
    };
  }

  if (!task.videoBlob && !task.videoUrl && task.remoteVideoUrl) {
    return {
      ...task,
      videoUrl: task.remoteVideoUrl,
    };
  }

  return task;
}

function prepareVideoTaskForStorage(task: VideoTask): VideoTask {
  const remoteVideoUrl = String(task.remoteVideoUrl || task.videoUrl || "").trim();
  const now = Date.now();

  return {
    id: String(task.id || ""),
    modelKey: task.modelKey,
    modelTitle: String(task.modelTitle || ""),
    prompt: String(task.prompt || ""),
    modelConfig: toPlainVideoConfig(task.modelConfig),
    sourceImages: toPlainStringArray(task.sourceImages),
    status: String(task.status || ""),
    phase: task.phase,
    progress: String(task.progress || ""),
    error: String(task.error || ""),
    videoUrl: remoteVideoUrl,
    videoBlob: undefined,
    videoMimeType: task.videoMimeType ? String(task.videoMimeType) : undefined,
    videoFileName: task.videoFileName ? String(task.videoFileName) : undefined,
    remoteVideoUrl,
    createdAt: Number(task.createdAt) || now,
    updatedAt: Number(task.updatedAt) || now,
    responseUrl: task.responseUrl ? String(task.responseUrl) : undefined,
    statusUrl: task.statusUrl ? String(task.statusUrl) : undefined,
    endpoint: task.endpoint ? String(task.endpoint) : undefined,
    raw: undefined,
  };
}

function getDatabase() {
  if (!databasePromise) {
    databasePromise = openDB<ArtWorkshopDb>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(IMAGE_HISTORY_STORE)) {
          const store = database.createObjectStore(IMAGE_HISTORY_STORE, {
            keyPath: "id",
          });
          store.createIndex("by-createdAt", "createdAt");
        }

        if (!database.objectStoreNames.contains(VIDEO_HISTORY_STORE)) {
          const store = database.createObjectStore(VIDEO_HISTORY_STORE, {
            keyPath: "id",
          });
          store.createIndex("by-createdAt", "createdAt");
        }

        if (!database.objectStoreNames.contains(CURRENT_IMAGE_TASK_STORE)) {
          database.createObjectStore(CURRENT_IMAGE_TASK_STORE, {
            keyPath: "key",
          });
        }

        if (!database.objectStoreNames.contains(CURRENT_VIDEO_TASK_STORE)) {
          database.createObjectStore(CURRENT_VIDEO_TASK_STORE, {
            keyPath: "key",
          });
        }
      },
    });
  }

  return databasePromise;
}

export async function loadImageHistory(limit = 20): Promise<ImageTask[]> {
  const database = await getDatabase();
  const tasks = await database.getAll(IMAGE_HISTORY_STORE);
  const uniqueTasks: ImageTask[] = [];

  for (const task of tasks.sort((left, right) => right.createdAt - left.createdAt)) {
    if (!uniqueTasks.some((item) => isSameImageTaskIdentity(item, task))) {
      uniqueTasks.push(task);
    }
  }

  return uniqueTasks.slice(0, limit);
}

export async function saveImageHistoryTask(task: ImageTask, limit = 20): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(IMAGE_HISTORY_STORE, "readwrite");

  await transaction.store.put(task);

  const tasks = await transaction.store.getAll();
  const retainedTasks: ImageTask[] = [];
  for (const currentTask of [task, ...tasks.filter((item) => item.id !== task.id)]) {
    if (retainedTasks.some((item) => isSameImageTaskIdentity(item, currentTask))) {
      await transaction.store.delete(currentTask.id);
      continue;
    }
    retainedTasks.push(currentTask);
  }

  const overflow = retainedTasks.sort((left, right) => right.createdAt - left.createdAt).slice(limit);

  for (const staleTask of overflow) {
    await transaction.store.delete(staleTask.id);
  }

  await transaction.done;
}

export async function deleteImageHistoryTask(taskId: string): Promise<void> {
  const database = await getDatabase();
  await database.delete(IMAGE_HISTORY_STORE, taskId);
}

export async function clearImageHistory(): Promise<void> {
  const database = await getDatabase();
  await database.clear(IMAGE_HISTORY_STORE);
}

export function isSameImageTaskIdentity(left: ImageTask, right: ImageTask): boolean {
  if (left.id && right.id && left.id === right.id) {
    return true;
  }
  if (left.serverJobId && right.serverJobId && left.serverJobId === right.serverJobId) {
    return true;
  }
  if (left.clientRequestId && right.clientRequestId && left.clientRequestId === right.clientRequestId) {
    return true;
  }
  return false;
}

export async function loadCurrentImageTask(): Promise<ImageTask | null> {
  const database = await getDatabase();
  const record = await database.get(CURRENT_IMAGE_TASK_STORE, CURRENT_IMAGE_TASK_KEY);
  return record?.task || null;
}

export async function saveCurrentImageTask(task: ImageTask): Promise<void> {
  const database = await getDatabase();
  await database.put(CURRENT_IMAGE_TASK_STORE, {
    key: CURRENT_IMAGE_TASK_KEY,
    task: prepareImageTaskForStorage(task),
  });
}

export async function deleteCurrentImageTask(): Promise<void> {
  const database = await getDatabase();
  await database.delete(CURRENT_IMAGE_TASK_STORE, CURRENT_IMAGE_TASK_KEY);
}

export async function loadVideoHistory(limit = 20): Promise<VideoTask[]> {
  const database = await getDatabase();
  const tasks = await database.getAll(VIDEO_HISTORY_STORE);
  return tasks
    .map(createPlaybackUrl)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, limit);
}

export async function saveVideoHistoryTask(task: VideoTask, limit = 20): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(VIDEO_HISTORY_STORE, "readwrite");

  await transaction.store.put(prepareVideoTaskForStorage(task));

  const tasks = await transaction.store.getAll();
  const overflow = tasks
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(limit);

  for (const staleTask of overflow) {
    await transaction.store.delete(staleTask.id);
  }

  await transaction.done;
}

export async function deleteVideoHistoryTask(taskId: string): Promise<void> {
  const database = await getDatabase();
  await database.delete(VIDEO_HISTORY_STORE, taskId);
}

export async function loadCurrentVideoTask(): Promise<VideoTask | null> {
  const database = await getDatabase();
  const record = await database.get(CURRENT_VIDEO_TASK_STORE, CURRENT_VIDEO_TASK_KEY);
  return record?.task ? createPlaybackUrl(record.task) : null;
}

export async function saveCurrentVideoTask(task: VideoTask): Promise<void> {
  const database = await getDatabase();
  await database.put(CURRENT_VIDEO_TASK_STORE, {
    key: CURRENT_VIDEO_TASK_KEY,
    task: prepareVideoTaskForStorage(task),
  });
}

export async function deleteCurrentVideoTask(): Promise<void> {
  const database = await getDatabase();
  await database.delete(CURRENT_VIDEO_TASK_STORE, CURRENT_VIDEO_TASK_KEY);
}
