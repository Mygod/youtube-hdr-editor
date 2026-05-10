import test from "node:test";
import assert from "node:assert/strict";
import { buildStudioEditorUrl, hasInlineEditProcessingSignal } from "../src/studioWorker.ts";

test("detects inline edit processing status from page payload", () => {
  assert.equal(
    hasInlineEditProcessingSignal(
      "{\"inlineEditProcessingStatus\":\"VIDEO_PROCESSING_STATUS_PROCESSING\"}",
    ),
    true,
  );
});

test("detects inline edit processing checks summary from page payload", () => {
  assert.equal(
    hasInlineEditProcessingSignal(
      "{\"checksSummary\":{\"status\":\"UPLOAD_CHECKS_DATA_SUMMARY_STATUS_INLINE_EDIT_IN_PROGRESS\"}}",
    ),
    true,
  );
});

test("ignores unrelated payload content", () => {
  assert.equal(
    hasInlineEditProcessingSignal("{\"status\":\"VIDEO_STATUS_PROCESSED\"}"),
    false,
  );
});

test("buildStudioEditorUrl carries YouTube Studio browser access approval", () => {
  assert.equal(
    buildStudioEditorUrl("abc123"),
    "https://studio.youtube.com/video/abc123/editor?approve_browser_access=true",
  );
});
