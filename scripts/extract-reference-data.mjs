import fs from "node:fs";
import path from "node:path";

const inputPath = path.resolve("output/remote-site/ai/assets/index-gpt2-20260422d.js");
const outputPath = path.resolve("src/data/reference-data.generated.json");

function readSource(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Reference bundle not found: ${filePath}`);
  }

  return fs.readFileSync(filePath, "utf8");
}

function extractArrayLiteral(source, marker) {
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`Marker not found: ${marker}`);
  }

  const arrayStart = source.indexOf("[", start);
  if (arrayStart === -1) {
    throw new Error(`Array start not found for marker: ${marker}`);
  }

  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = arrayStart; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === quote) {
        inString = false;
        quote = "";
      }

      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === "[") {
      depth += 1;
    } else if (ch === "]") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(arrayStart, i + 1);
      }
    }
  }

  throw new Error(`Unterminated array literal for marker: ${marker}`);
}

function evaluateArray(arrayLiteral, label) {
  try {
    return Function(`"use strict"; return (${arrayLiteral});`)();
  } catch (error) {
    throw new Error(`Failed to evaluate ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

const source = readSource(inputPath);
const categoriesLiteral = extractArrayLiteral(source, "const Vd=");
const promptsLiteral = extractArrayLiteral(source, "],py=");

const data = {
  categories: evaluateArray(categoriesLiteral, "categories"),
  prompts: evaluateArray(promptsLiteral, "prompts"),
};

ensureDir(outputPath);
fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
