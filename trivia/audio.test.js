import test from "node:test";
import assert from "node:assert/strict";
import { intensityLevel } from "./public/audio.js";

test("music intensity follows time remaining rather than question length", () => {
  assert.deepEqual([60, 50, 40, 30, 20, 10].map(intensityLevel), [1, 2, 3, 4, 5, 6]);
  assert.equal(intensityLevel(120), 1);
  assert.equal(intensityLevel(59), 1);
  assert.equal(intensityLevel(15), 5);
  assert.equal(intensityLevel(5), 6);
  assert.equal(intensityLevel(0), 6);
});
