import rawData from "@/data/reference-data.generated.json";
import type { PromptCategory, PromptItem } from "@/types";

export const PROMPT_CATEGORIES = rawData.categories as PromptCategory[];
export const PROMPT_LIBRARY = rawData.prompts as PromptItem[];

