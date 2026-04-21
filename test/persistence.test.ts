import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Persistence } from "../src/persistence.ts";

test("Persistence rerun helpers return unresolved and unreached video ids", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-hdr-db-"));
  const dbPath = path.join(tempDir, "youtube-hdr.sqlite");
  const db = await Persistence.open(dbPath);

  try {
    const runId = db.createRun({
      startedAt: "2026-04-21T00:00:00.000Z",
      channelId: "auto",
      videoCount: 3,
      headless: false,
      requestedVideoIds: ["aaa111", "bbb222", "ccc333"],
    });

    db.saveVideoResult(runId, {
      videoId: "aaa111",
      publicCheckStatus: "incomplete",
      publicSignals: [],
      studioPath: "direct_editor",
      badgeState: "unknown",
      editorState: "save_submitted",
      finalStatus: "processing_after_save",
      summary: "done",
      timestamps: {
        startedAt: "2026-04-21T00:00:00.000Z",
        finishedAt: "2026-04-21T00:01:00.000Z",
      },
    });

    db.saveVideoResult(runId, {
      videoId: "bbb222",
      publicCheckStatus: "incomplete",
      publicSignals: [],
      studioPath: "direct_editor",
      badgeState: "unknown",
      editorState: "not_available",
      finalStatus: "automation_error",
      summary: "retry me",
      timestamps: {
        startedAt: "2026-04-21T00:01:00.000Z",
        finishedAt: "2026-04-21T00:02:00.000Z",
      },
    });

    assert.deepEqual(db.getLatestRun()?.requestedVideoIds, ["aaa111", "bbb222", "ccc333"]);
    assert.deepEqual(db.getUnfinishedVideoIds(runId), ["bbb222", "ccc333"]);
  } finally {
    db.close();
  }
});
