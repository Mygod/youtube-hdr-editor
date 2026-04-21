import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, firefox } from "playwright-core";
import type { BrowserEngine } from "./types.ts";

const FIREFOX_PROFILES_INI = path.join(os.homedir(), ".mozilla", "firefox", "profiles.ini");
const EXECUTABLE_CANDIDATES: Record<BrowserEngine, string[]> = {
  firefox: ["firefox", "firefox-esr"],
  chromium: ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"],
};

export function resolveDefaultBrowser(): BrowserEngine {
  return "chromium";
}

export function discoverBrowserExecutable(browserName: BrowserEngine): string | undefined {
  const managedExecutable = discoverManagedBrowserExecutable(browserName);
  if (managedExecutable) {
    return managedExecutable;
  }

  for (const candidate of EXECUTABLE_CANDIDATES[browserName]) {
    const resolved = findExecutableInPath(candidate);
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}

export function discoverProfileDir(browserName: BrowserEngine): string | undefined {
  if (browserName === "firefox") {
    return resolveFirefoxDefaultProfile() ?? undefined;
  }
  return resolveChromiumUserDataDir() ?? undefined;
}

export function discoverBrowserConnectUrl(browserName: BrowserEngine, profileDir?: string): string | undefined {
  if (browserName !== "chromium" || !profileDir) {
    return undefined;
  }

  for (const candidate of chromiumUserDataDirCandidates(profileDir)) {
    const connectUrl = readChromiumDevToolsActivePort(candidate);
    if (connectUrl) {
      return connectUrl;
    }
  }

  return undefined;
}

export function isBrowserEngine(value: string): value is BrowserEngine {
  return value === "chromium" || value === "firefox";
}

function resolveFirefoxDefaultProfile(): string | null {
  let text: string;
  try {
    text = fs.readFileSync(FIREFOX_PROFILES_INI, "utf8");
  } catch {
    return null;
  }

  const sections = parseIni(text);
  const installDefault = Object.entries(sections)
    .find(([sectionName]) => sectionName.startsWith("Install"))
    ?.[1]?.Default;

  const candidates = Object.entries(sections)
    .filter(([, section]) => Boolean(section.Path))
    .map(([sectionName, section]) => {
      const resolvedPath = resolveFirefoxProfilePath(section);
      return {
        resolvedPath,
        score: scoreFirefoxProfile(sectionName, section, installDefault),
        locked: isFirefoxProfileLocked(resolvedPath),
      };
    });

  if (candidates.length === 0) {
    return null;
  }

  const unlockedCandidates = candidates.filter((candidate) => !candidate.locked);
  const pool = unlockedCandidates.length > 0 ? unlockedCandidates : candidates;
  pool.sort((left, right) => right.score - left.score || left.resolvedPath.localeCompare(right.resolvedPath));
  return pool[0]?.resolvedPath ?? null;
}

function resolveFirefoxProfilePath(section: Record<string, string>): string {
  const profilePath = section.Path;
  if (section.IsRelative === "1") {
    return path.join(path.dirname(FIREFOX_PROFILES_INI), profilePath);
  }
  return profilePath;
}

function resolveChromiumUserDataDir(): string | undefined {
  const candidates = [
    path.join(os.homedir(), ".config", "chromium"),
    path.join(os.homedir(), ".config", "google-chrome"),
    path.join(os.homedir(), ".var", "app", "com.google.Chrome", "config", "google-chrome"),
  ];

  for (const candidate of candidates) {
    if (
      fs.existsSync(candidate) &&
      (fs.existsSync(path.join(candidate, "Local State")) || fs.existsSync(path.join(candidate, "Default")))
    ) {
      return candidate;
    }
  }

  return undefined;
}

function chromiumUserDataDirCandidates(profileDir: string): string[] {
  const candidates = [profileDir];
  const baseName = path.basename(profileDir);
  if (/^Default$|^Profile\b/.test(baseName)) {
    candidates.push(path.dirname(profileDir));
  }
  return [...new Set(candidates)];
}

function readChromiumDevToolsActivePort(profileDir: string): string | undefined {
  const activePortPath = path.join(profileDir, "DevToolsActivePort");
  if (!fs.existsSync(activePortPath)) {
    return undefined;
  }

  try {
    const [port] = fs.readFileSync(activePortPath, "utf8").split(/\r?\n/, 2);
    if (!/^\d+$/.test(port ?? "")) {
      return undefined;
    }
    return `http://127.0.0.1:${port}`;
  } catch {
    return undefined;
  }
}

function discoverManagedBrowserExecutable(browserName: BrowserEngine): string | undefined {
  try {
    const executablePath = (browserName === "firefox" ? firefox : chromium).executablePath();
    if (executablePath && fs.existsSync(executablePath)) {
      return executablePath;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function findExecutableInPath(commandName: string): string | undefined {
  const pathEnv = process.env.PATH;
  if (!pathEnv) {
    return undefined;
  }

  for (const directory of pathEnv.split(path.delimiter)) {
    const candidate = path.join(directory, commandName);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

function parseIni(text: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  let currentSection: Record<string, string> | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) {
      continue;
    }
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = {};
      result[sectionMatch[1]] = currentSection;
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1 || !currentSection) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    currentSection[key] = value;
  }

  return result;
}

function scoreFirefoxProfile(
  sectionName: string,
  section: Record<string, string>,
  installDefault?: string,
): number {
  let score = 0;
  const name = section.Name ?? "";
  const profilePath = section.Path ?? "";
  const normalized = `${name} ${profilePath}`.toLowerCase();

  if (section.Default === "1") {
    score += 500;
  }
  if (installDefault && profilePath === installDefault) {
    score += 50;
  }
  if (normalized.includes("default-release")) {
    score += 300;
  } else if (normalized.includes("default-esr")) {
    score += 275;
  } else if (normalized.includes("default")) {
    score += 200;
  }
  if (sectionName.startsWith("Profile")) {
    score += 25;
  }

  return score;
}

function isFirefoxProfileLocked(profilePath: string): boolean {
  return ["parent.lock", "lock", ".parentlock"]
    .some((name) => fs.existsSync(path.join(profilePath, name)));
}
