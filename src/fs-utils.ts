import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function readVideoIdsFromFile(filePath: string): Promise<string[]> {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function timestampLabel(): string {
  return new Date().toISOString().replaceAll(":", "-");
}

export function sanitizeFileComponent(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export function resolveInside(baseDir: string, ...parts: string[]): string {
  return path.join(baseDir, ...parts);
}
