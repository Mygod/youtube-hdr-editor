import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStudioEditorUrl,
  hasInlineEditProcessingSignal,
  hasYouTubeSignInPrompt,
  isSignInRequiredUrl,
} from "../src/studioWorker.ts";

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

test("detects Google sign-in URLs before waiting for editor controls", () => {
  assert.equal(
    isSignInRequiredUrl(
      "https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fstudio.youtube.com%2Fvideo%2Fabc123%2Feditor",
    ),
    true,
  );
});

test("detects YouTube sign-in prompt body", () => {
  assert.equal(
    hasYouTubeSignInPrompt("Sign in\nto continue to YouTube\nEmail or phone\nForgot email?"),
    true,
  );
});

test("does not treat ordinary Studio page text as sign-in prompt", () => {
  assert.equal(
    hasYouTubeSignInPrompt("YouTube Studio Video details Editor Analytics Comments"),
    false,
  );
});
