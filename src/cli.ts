#!/usr/bin/env node

import { access } from "node:fs/promises";
import process from "node:process";
import { parseArgs } from "./args.ts";
import {
  discoverBrowserConnectUrl,
  discoverBrowserExecutable,
  discoverProfileDir,
} from "./browserPreferences.ts";
import { findRequestedConfigPath, loadRuntimeDefaults } from "./config.ts";
import { readVideoIdsFromFile } from "./fs-utils.ts";
import { Persistence } from "./persistence.ts";
import { runBatch } from "./runner.ts";
import { renderStatus } from "./status.ts";

async function main(): Promise<void> {
  try {
    const argv = process.argv.slice(2);
    const requestedConfigPath = findRequestedConfigPath(argv);
    const { defaults } = await loadRuntimeDefaults(requestedConfigPath);
    const args = parseArgs(argv, defaults);

    if (args.command === "status") {
      console.log(await renderStatus(args.dbPath, args.latest));
      return;
    }

    const browserConnectUrl =
      args.browserConnectUrl ?? discoverBrowserConnectUrl(args.browserName, args.profileDir);
    if (browserConnectUrl && args.browserName !== "chromium") {
      throw new Error("browserConnectUrl / --browser-connect-url is only supported for Chromium.");
    }

    const profileDir = args.profileDir ?? discoverProfileDir(args.browserName);
    let browserExecutablePath = args.browserExecutablePath;
    if (!browserConnectUrl) {
      browserExecutablePath ??= discoverBrowserExecutable(args.browserName);
      if (!browserExecutablePath) {
        throw new Error(
          `Could not discover a ${args.browserName} executable. Install the Playwright ${args.browserName} browser or set browserExecutablePath in config.json or pass --browser-executable.`,
        );
      }
      if (!profileDir) {
        throw new Error(
          `Could not discover a ${args.browserName} profile directory. Set profileDir in config.json or pass --profile-dir.`,
        );
      }
      await access(browserExecutablePath);
    }

    const inputVideoIds = await resolveInputVideoIds(args);
    const videoIds = [...new Set(inputVideoIds)];
    if (videoIds.length === 0) {
      throw new Error("No video ids were provided after parsing the input.");
    }

    const { runId, results } = await runBatch({
      videoIds,
      channelId: args.channelId,
      browserName: args.browserName,
      browserExecutablePath,
      profileDir,
      browserConnectUrl,
      dbPath: args.dbPath,
      headless: args.headless,
      timeoutMs: args.timeoutMs,
      diagnosticsDir: args.diagnosticsDir,
    });

    console.log(`Run #${runId} completed with ${args.browserName}.`);
    for (const result of results) {
      console.log(
        [
          result.videoId,
          `public=${result.publicCheckStatus}`,
          `studio=${result.studioPath}`,
          `badge=${result.badgeState}`,
          `editor=${result.editorState}`,
          `final=${result.finalStatus}`,
        ].join(" "),
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

await main();

async function resolveInputVideoIds(args: ReturnType<typeof parseArgs>): Promise<string[]> {
  if (!args.rerun) {
    return args.filePath ? await readVideoIdsFromFile(args.filePath) : args.videoIds;
  }

  const db = await Persistence.open(args.dbPath);
  try {
    const latestRun = db.getLatestRun();
    if (latestRun) {
      const unfinishedVideoIds = db.getUnfinishedVideoIds(latestRun.id);
      if (unfinishedVideoIds.length > 0) {
        console.log(`Rerunning ${unfinishedVideoIds.length} unresolved video(s) from Run #${latestRun.id}.`);
        return unfinishedVideoIds;
      }
      console.log(`Run #${latestRun.id} has no unresolved videos; falling back to configured defaults.`);
    } else {
      console.log("No previous runs found; using configured default video IDs.");
    }
  } finally {
    db.close();
  }

  return args.videoIds;
}
