import {
  discoverBrowserConnectUrl,
  discoverBrowserExecutable,
  discoverProfileDir,
  isBrowserEngine,
} from "./browserPreferences.ts";
import { buildBuiltInDefaults, type RuntimeDefaults } from "./config.ts";
import type { BrowserEngine } from "./types.ts";

export interface ParsedArgs {
  command: "run" | "status";
  videoIds: string[];
  filePath?: string;
  rerun: boolean;
  channelId?: string;
  browserName: BrowserEngine;
  browserExecutablePath?: string;
  profileDir?: string;
  browserConnectUrl?: string;
  dbPath: string;
  headless: boolean;
  timeoutMs: number;
  diagnosticsDir?: string;
  latest: boolean;
}

export function parseArgs(argv: string[], defaults: RuntimeDefaults = buildBuiltInDefaults()): ParsedArgs {
  const [command, ...rest] = argv;

  if (command !== "run" && command !== "status") {
    throw new Error(helpText());
  }

  const parsed: ParsedArgs = {
    command,
    videoIds: [...defaults.videoIds],
    channelId: defaults.channelId,
    rerun: false,
    browserName: defaults.browserName,
    browserExecutablePath: defaults.browserExecutablePath,
    profileDir: defaults.profileDir,
    browserConnectUrl: defaults.browserConnectUrl,
    dbPath: defaults.dbPath,
    headless: defaults.headless,
    timeoutMs: defaults.timeoutMs,
    diagnosticsDir: defaults.diagnosticsDir,
    latest: false,
  };
  let executableExplicit = false;
  let profileExplicit = false;
  let connectUrlExplicit = false;
  let videoIdsExplicit = false;
  let filePathExplicit = false;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];

    switch (arg) {
      case "--videos":
        if (!next) {
          throw new Error("--videos requires a comma-separated value");
        }
        parsed.videoIds = next
          .split(",")
          .map((videoId) => videoId.trim())
          .filter(Boolean);
        videoIdsExplicit = true;
        index += 1;
        break;
      case "--file":
        if (!next) {
          throw new Error("--file requires a path");
        }
        parsed.filePath = next;
        filePathExplicit = true;
        index += 1;
        break;
      case "--channel":
        if (!next) {
          throw new Error("--channel requires a value");
        }
        parsed.channelId = next;
        index += 1;
        break;
      case "--rerun":
        parsed.rerun = true;
        break;
      case "--config":
        if (!next) {
          throw new Error("--config requires a path");
        }
        index += 1;
        break;
      case "--browser":
        if (!next || !isBrowserEngine(next)) {
          throw new Error("--browser requires one of: chromium, firefox");
        }
        const previousBrowser = parsed.browserName;
        parsed.browserName = next;
        if (!executableExplicit && previousBrowser !== next) {
          parsed.browserExecutablePath = discoverBrowserExecutable(next);
        }
        if (!profileExplicit && previousBrowser !== next) {
          parsed.profileDir = discoverProfileDir(next);
        }
        if (!connectUrlExplicit && previousBrowser !== next) {
          parsed.browserConnectUrl = discoverBrowserConnectUrl(next, parsed.profileDir);
        }
        index += 1;
        break;
      case "--browser-executable":
        if (!next) {
          throw new Error("--browser-executable requires a path");
        }
        parsed.browserExecutablePath = next;
        executableExplicit = true;
        index += 1;
        break;
      case "--browser-connect-url":
        if (!next) {
          throw new Error("--browser-connect-url requires a URL");
        }
        parsed.browserConnectUrl = next;
        connectUrlExplicit = true;
        index += 1;
        break;
      case "--chromium":
        if (!next) {
          throw new Error("--chromium requires a path");
        }
        parsed.browserName = "chromium";
        parsed.browserExecutablePath = next;
        executableExplicit = true;
        if (!profileExplicit) {
          parsed.profileDir = discoverProfileDir("chromium");
        }
        if (!connectUrlExplicit) {
          parsed.browserConnectUrl = discoverBrowserConnectUrl("chromium", parsed.profileDir);
        }
        index += 1;
        break;
      case "--firefox":
        if (!next) {
          throw new Error("--firefox requires a path");
        }
        parsed.browserName = "firefox";
        parsed.browserExecutablePath = next;
        executableExplicit = true;
        if (!profileExplicit) {
          parsed.profileDir = discoverProfileDir("firefox");
        }
        if (!connectUrlExplicit) {
          parsed.browserConnectUrl = undefined;
        }
        index += 1;
        break;
      case "--profile-dir":
        if (!next) {
          throw new Error("--profile-dir requires a path");
        }
        parsed.profileDir = next;
        profileExplicit = true;
        if (!connectUrlExplicit) {
          parsed.browserConnectUrl = discoverBrowserConnectUrl(parsed.browserName, parsed.profileDir);
        }
        index += 1;
        break;
      case "--db":
        if (!next) {
          throw new Error("--db requires a path");
        }
        parsed.dbPath = next;
        index += 1;
        break;
      case "--timeout-ms":
        if (!next) {
          throw new Error("--timeout-ms requires a number");
        }
        parsed.timeoutMs = Number(next);
        if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
          throw new Error("--timeout-ms must be a positive integer");
        }
        index += 1;
        break;
      case "--headless":
        parsed.headless = true;
        break;
      case "--no-diagnostics":
        parsed.diagnosticsDir = undefined;
        break;
      case "--latest":
        parsed.latest = true;
        break;
      case "--help":
      case "-h":
        throw new Error(helpText());
      default:
        throw new Error(`Unknown argument: ${arg}\n\n${helpText()}`);
    }
  }

  if (parsed.rerun && (videoIdsExplicit || filePathExplicit)) {
    throw new Error("--rerun cannot be combined with --videos or --file.");
  }

  if (command === "run" && parsed.videoIds.length === 0 && !parsed.filePath) {
    if (!parsed.rerun) {
      throw new Error("run requires --videos, --file, config.json videoIds, or --rerun");
    }
  }

  return parsed;
}

export function helpText(): string {
  return [
    "Usage:",
    "  youtube-hdr run --videos <id,id,...> [options]",
    "  youtube-hdr run --file <videos.txt> [options]",
    "  youtube-hdr status [--latest] [--db <path>]",
    "",
    "Options:",
    "  --config <path>        Root config file (default: ./config.json)",
    "  --rerun               Rerun latest unresolved videos from SQLite, then fall back to config.json videoIds",
    "  --channel <id>         Optional YouTube channel id override",
    "  --browser <name>       Browser engine: chromium or firefox",
    "  --browser-executable <path>  Browser executable override",
    "  --browser-connect-url <url>  Attach to running Chromium via CDP",
    "  --chromium <path>      Chromium executable path",
    "  --firefox <path>       Firefox executable path",
    "  --profile-dir <path>   Browser profile directory",
    "  --db <path>            SQLite database path",
    "  --timeout-ms <ms>      Per-video Studio timeout",
    "  --headless             Run Studio automation headless",
    "  --no-diagnostics       Disable on-failure diagnostics capture",
    "  --latest               Show only the latest run in status",
  ].join("\n");
}
