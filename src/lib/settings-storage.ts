const SETTINGS_STORAGE_KEY = "art-workshop-settings-v1";
const LEGACY_SETTINGS_STORAGE_KEY = "art-workshop-storage-v1";

export interface PersistedSettings {
  apiBaseUrl: string;
  apiKey: string;
  codexApiKey: string;
}

export function readPersistedSettings(): Partial<PersistedSettings> {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
      return parsed && typeof parsed === "object" ? parsed : {};
    }

    const legacyRaw = localStorage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
    if (!legacyRaw) {
      return {};
    }

    const legacyParsed = JSON.parse(legacyRaw) as Partial<PersistedSettings>;
    return legacyParsed && typeof legacyParsed === "object"
      ? {
          apiBaseUrl: legacyParsed.apiBaseUrl,
          apiKey: legacyParsed.apiKey,
          codexApiKey: legacyParsed.codexApiKey,
        }
      : {};
  } catch {
    return {};
  }
}

export function writePersistedSettings(settings: PersistedSettings): void {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}
