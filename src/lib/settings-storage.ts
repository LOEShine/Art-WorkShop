const SETTINGS_STORAGE_KEY = "art-workshop-settings-v1";

export interface PersistedSettings {
  apiBaseUrl: string;
  apiKey: string;
  codexApiKey: string;
}

export function readPersistedSettings(): Partial<PersistedSettings> {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writePersistedSettings(settings: PersistedSettings): void {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}
