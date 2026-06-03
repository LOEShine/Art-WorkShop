const ANONYMOUS_USER_STORAGE_KEY = "art-workshop-anonymous-user-id-v1";

function createAnonymousUserId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `anon_${crypto.randomUUID()}`;
  }

  return `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeUserId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
}

export function getAnonymousUserId(): string {
  const existing = sanitizeUserId(localStorage.getItem(ANONYMOUS_USER_STORAGE_KEY) || "");
  if (existing) {
    return existing;
  }

  const next = sanitizeUserId(createAnonymousUserId());
  localStorage.setItem(ANONYMOUS_USER_STORAGE_KEY, next);
  return next;
}
