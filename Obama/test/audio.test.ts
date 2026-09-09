import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  analyzePcm16,
  pcmMonoToStereo,
  pcmStereoToWav,
  speechText,
} from "../src/audio.js";

describe("PCM helpers", () => {
  it("duplicates each mono sample into left and right channels", () => {
    const mono = Buffer.alloc(4);
    mono.writeInt16LE(123, 0);
    mono.writeInt16LE(-456, 2);
    const stereo = pcmMonoToStereo(mono);
    assert.deepEqual(
      [
        stereo.readInt16LE(0),
        stereo.readInt16LE(2),
        stereo.readInt16LE(4),
        stereo.readInt16LE(6),
      ],
      [123, 123, -456, -456],
    );
  });

  it("writes a valid 48 kHz stereo WAV header", () => {
    const wav = pcmStereoToWav(Buffer.alloc(16));
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.toString("ascii", 8, 12), "WAVE");
    assert.equal(wav.readUInt16LE(22), 2);
    assert.equal(wav.readUInt32LE(24), 48_000);
    assert.equal(wav.readUInt32LE(40), 16);
  });

  it("reports silent PCM as having no measurable audio level", () => {
    const activity = analyzePcm16(Buffer.alloc(48_000 * 2 * 2));
    assert.equal(activity.durationMs, 1_000);
    assert.equal(activity.rmsDbfs, Number.NEGATIVE_INFINITY);
    assert.equal(activity.peakDbfs, Number.NEGATIVE_INFINITY);
  });

  it("measures the RMS level of PCM samples", () => {
    const pcm = Buffer.alloc(48_000 * 2 * 2);
    for (let offset = 0; offset < pcm.length; offset += 2) {
      pcm.writeInt16LE(3_277, offset);
    }
    const activity = analyzePcm16(pcm);
    assert.ok(Math.abs(activity.rmsDbfs - -20) < 0.02);
    assert.ok(Math.abs(activity.peakDbfs - -20) < 0.02);
  });
});

describe("speechText", () => {
  it("removes common markdown before TTS", () => {
    assert.equal(
      speechText("**Hello** [friend](https://example.com) `now`"),
      "Hello friend now",
    );
  });
});
