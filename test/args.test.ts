import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/args.ts";
import type { RuntimeDefaults } from "../src/config.ts";

test("parseArgs defaults to chromium-backed browser preferences", () => {
  const args = parseArgs(["run", "--videos", "abc123"]);

  assert.equal(args.browserName, "chromium");
  assert.ok(
    args.browserExecutablePath === undefined ||
      args.browserExecutablePath.includes("chrom") ||
      args.browserExecutablePath.includes("chrome"),
  );
});

test("parseArgs supports firefox browser selection", () => {
  const args = parseArgs([
    "run",
    "--videos",
    "abc123",
    "--browser",
    "firefox",
    "--profile-dir",
    "/tmp/firefox-profile",
    "--browser-executable",
    "/usr/bin/firefox",
  ]);

  assert.equal(args.browserName, "firefox");
  assert.equal(args.profileDir, "/tmp/firefox-profile");
  assert.equal(args.browserExecutablePath, "/usr/bin/firefox");
});

test("parseArgs supports chromium attach URL", () => {
  const args = parseArgs([
    "run",
    "--videos",
    "abc123",
    "--browser-connect-url",
    "http://127.0.0.1:9222",
  ]);

  assert.equal(args.browserName, "chromium");
  assert.equal(args.browserConnectUrl, "http://127.0.0.1:9222");
});

test("parseArgs keeps chromium compatibility flag", () => {
  const args = parseArgs([
    "run",
    "--videos",
    "abc123",
    "--chromium",
    "/usr/bin/chromium",
  ]);

  assert.equal(args.browserName, "chromium");
  assert.equal(args.browserExecutablePath, "/usr/bin/chromium");
});

test("parseArgs preserves configured firefox profile when browser stays firefox", () => {
  const defaults: RuntimeDefaults = {
    videoIds: [],
    channelId: "UCexamplechannelid",
    browserName: "firefox",
    browserExecutablePath: "/custom/firefox",
    profileDir: "/custom/profile",
    browserConnectUrl: undefined,
    dbPath: "/tmp/youtube-hdr.sqlite",
    headless: false,
    timeoutMs: 30000,
    diagnosticsDir: "/tmp/diagnostics",
  };

  const args = parseArgs([
    "run",
    "--videos",
    "abc123",
    "--browser",
    "firefox",
  ], defaults);

  assert.equal(args.browserExecutablePath, "/custom/firefox");
  assert.equal(args.profileDir, "/custom/profile");
});

test("parseArgs supports rerun with config-backed default video ids", () => {
  const defaults: RuntimeDefaults = {
    videoIds: ["abc123", "def456"],
    channelId: undefined,
    browserName: "chromium",
    browserExecutablePath: "/usr/bin/chromium",
    profileDir: "/tmp/chromium-profile",
    browserConnectUrl: undefined,
    dbPath: "/tmp/youtube-hdr.sqlite",
    headless: false,
    timeoutMs: 30000,
    diagnosticsDir: "/tmp/diagnostics",
  };

  const args = parseArgs(["run", "--rerun"], defaults);

  assert.equal(args.rerun, true);
  assert.deepEqual(args.videoIds, ["abc123", "def456"]);
});
