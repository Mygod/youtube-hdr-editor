import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadRuntimeDefaults } from "../src/config.ts";

test("loadRuntimeDefaults merges config.json values", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-hdr-config-"));
  const configPath = path.join(tempDir, "config.json");

  await fs.writeFile(
    configPath,
    JSON.stringify({
      videoIds: ["abc123", "def456"],
      browserName: "chromium",
      browserExecutablePath: "/usr/bin/chromium",
      profileDir: "./browser-data",
      browserConnectUrl: "http://127.0.0.1:9222",
      dbPath: "./custom.sqlite",
      timeoutMs: 12345,
      headless: true,
    }),
    "utf8",
  );

  const { defaults } = await loadRuntimeDefaults(configPath);

  assert.deepEqual(defaults.videoIds, ["abc123", "def456"]);
  assert.equal(defaults.browserName, "chromium");
  assert.equal(defaults.browserExecutablePath, "/usr/bin/chromium");
  assert.equal(defaults.profileDir, path.join(tempDir, "browser-data"));
  assert.equal(defaults.browserConnectUrl, "http://127.0.0.1:9222");
  assert.equal(defaults.dbPath, path.join(tempDir, "custom.sqlite"));
  assert.equal(defaults.timeoutMs, 12345);
  assert.equal(defaults.headless, true);
});
