import test from "node:test";
import assert from "node:assert/strict";
import { classifyPublicCheck } from "../src/publicCheck.ts";

test("classifies explicit HDR as hdr_present", () => {
  const result = classifyPublicCheck({
    exitCode: 0,
    stdout: JSON.stringify({
      dynamic_range: "SDR",
      formats: [
        { format_id: "137", vcodec: "avc1", dynamic_range: "SDR", resolution: "1920x1080" },
        { format_id: "401", vcodec: "vp9.2", dynamic_range: "HDR", resolution: "3840x2160" },
      ],
    }),
    stderr: "",
  });
  assert.equal(result.status, "hdr_present");
});

test("classifies degraded fallback output as incomplete", () => {
  const result = classifyPublicCheck({
    exitCode: 0,
    stdout: JSON.stringify({
      dynamic_range: "SDR",
      formats: [
        {
          format_id: "18",
          vcodec: "avc1",
          dynamic_range: "SDR",
          resolution: "640x360",
          format_note: "360p, THROTTLED",
        },
      ],
    }),
    stderr: "WARNING: [youtube] YouTube said: ERROR - Precondition check failed.",
  });
  assert.equal(result.status, "incomplete");
});

test("classifies clean non-HDR output as no_hdr", () => {
  const result = classifyPublicCheck({
    exitCode: 0,
    stdout: JSON.stringify({
      formats: [
        { format_id: "137", vcodec: "avc1", dynamic_range: "SDR", resolution: "1920x1080", format_note: "1080p" },
        { format_id: "248", vcodec: "vp9", dynamic_range: "SDR", resolution: "1920x1080", format_note: "1080p" },
      ],
    }),
    stderr: "",
  });
  assert.equal(result.status, "no_hdr");
});
