import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_DB_PATH,
  DEFAULT_DIAGNOSTICS_DIR,
  DEFAULT_TIMEOUT_MS,
} from "./constants.ts";
import {
  discoverBrowserConnectUrl,
  discoverBrowserExecutable,
  discoverProfileDir,
  isBrowserEngine,
  resolveDefaultBrowser,
} from "./browserPreferences.ts";
import type { BrowserEngine } from "./types.ts";

export interface RuntimeDefaults {
  videoIds: string[];
  channelId?: string;
  browserName: BrowserEngine;
  browserExecutablePath?: string;
  profileDir?: string;
  browserConnectUrl?: string;
  dbPath: string;
  headless: boolean;
  timeoutMs: number;
  diagnosticsDir?: string;
}

interface RootConfigFile {
  videoIds?: unknown;
  channelId?: unknown;
  browserName?: unknown;
  browserExecutablePath?: unknown;
  profileDir?: unknown;
  browserConnectUrl?: unknown;
  dbPath?: unknown;
  headless?: unknown;
  timeoutMs?: unknown;
  diagnosticsDir?: unknown;
}

export const DEFAULT_CONFIG_PATH = path.resolve("config.json");

export function buildBuiltInDefaults(): RuntimeDefaults {
  const browserName = resolveDefaultBrowser();
  const profileDir = discoverProfileDir(browserName);
  return {
    videoIds: [],
    browserName,
    browserExecutablePath: discoverBrowserExecutable(browserName),
    profileDir,
    browserConnectUrl: discoverBrowserConnectUrl(browserName, profileDir),
    dbPath: DEFAULT_DB_PATH,
    headless: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    diagnosticsDir: DEFAULT_DIAGNOSTICS_DIR,
  };
}

export function findRequestedConfigPath(argv: string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--config") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--config requires a path");
      }
      return path.resolve(next);
    }
  }
  return null;
}

export async function loadRuntimeDefaults(configPath: string | null = null): Promise<{
  defaults: RuntimeDefaults;
  configPath?: string;
}> {
  const builtInDefaults = buildBuiltInDefaults();
  const resolvedPath = configPath ?? DEFAULT_CONFIG_PATH;

  if (!(await fileExists(resolvedPath))) {
    if (configPath) {
      throw new Error(`Config file not found: ${resolvedPath}`);
    }
    return { defaults: builtInDefaults };
  }

  const fileText = await fs.readFile(resolvedPath, "utf8");
  let parsed: RootConfigFile;
  try {
    parsed = JSON.parse(fileText) as RootConfigFile;
  } catch (error) {
    throw new Error(`Could not parse config file ${resolvedPath}: ${(error as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Config file ${resolvedPath} must contain a JSON object.`);
  }

  return {
    defaults: applyConfigFile(builtInDefaults, parsed, path.dirname(resolvedPath)),
    configPath: resolvedPath,
  };
}

function applyConfigFile(
  defaults: RuntimeDefaults,
  rawConfig: RootConfigFile,
  baseDir: string,
): RuntimeDefaults {
  const next: RuntimeDefaults = { ...defaults };

  if (rawConfig.videoIds !== undefined) {
    next.videoIds = readStringArray(rawConfig.videoIds, "videoIds");
  }

  if (rawConfig.channelId !== undefined) {
    next.channelId = readString(rawConfig.channelId, "channelId");
  }

  if (rawConfig.browserName !== undefined) {
    const browserName = readBrowserName(rawConfig.browserName, "browserName");
    next.browserName = browserName;
    if (rawConfig.browserExecutablePath === undefined) {
      next.browserExecutablePath = discoverBrowserExecutable(browserName);
    }
    if (rawConfig.profileDir === undefined) {
      next.profileDir = discoverProfileDir(browserName);
    }
    if (rawConfig.browserConnectUrl === undefined) {
      next.browserConnectUrl = discoverBrowserConnectUrl(browserName, next.profileDir);
    }
  }

  if (rawConfig.browserExecutablePath !== undefined) {
    next.browserExecutablePath = normalizePath(readString(rawConfig.browserExecutablePath, "browserExecutablePath"), baseDir);
  }

  if (rawConfig.profileDir !== undefined) {
    next.profileDir = normalizePath(readString(rawConfig.profileDir, "profileDir"), baseDir);
    if (rawConfig.browserConnectUrl === undefined) {
      next.browserConnectUrl = discoverBrowserConnectUrl(next.browserName, next.profileDir);
    }
  }

  if (rawConfig.browserConnectUrl !== undefined) {
    next.browserConnectUrl = readString(rawConfig.browserConnectUrl, "browserConnectUrl");
  }

  if (rawConfig.dbPath !== undefined) {
    next.dbPath = normalizePath(readString(rawConfig.dbPath, "dbPath"), baseDir);
  }

  if (rawConfig.diagnosticsDir !== undefined) {
    next.diagnosticsDir = normalizePath(readString(rawConfig.diagnosticsDir, "diagnosticsDir"), baseDir);
  }

  if (rawConfig.headless !== undefined) {
    if (typeof rawConfig.headless !== "boolean") {
      throw new Error("Config field headless must be a boolean.");
    }
    next.headless = rawConfig.headless;
  }

  if (rawConfig.timeoutMs !== undefined) {
    if (typeof rawConfig.timeoutMs !== "number" || !Number.isFinite(rawConfig.timeoutMs) || rawConfig.timeoutMs <= 0) {
      throw new Error("Config field timeoutMs must be a positive number.");
    }
    next.timeoutMs = rawConfig.timeoutMs;
  }

  return next;
}

function normalizePath(value: string, baseDir: string): string {
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(baseDir, value);
}

function readString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Config field ${fieldName} must be a non-empty string.`);
  }
  return value;
}

function readBrowserName(value: unknown, fieldName: string): BrowserEngine {
  if (typeof value !== "string" || !isBrowserEngine(value)) {
    throw new Error(`Config field ${fieldName} must be one of: chromium, firefox.`);
  }
  return value;
}

function readStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Config field ${fieldName} must be an array of non-empty strings.`);
  }
  return value.map((item, index) => readString(item, `${fieldName}[${index}]`));
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
