import assert from "node:assert/strict";
import { it } from "node:test";

import { loadConfig } from "../src/config.js";

it("disables member DMs by default and requires an explicit boolean flag", () => {
  const previous = process.env.ENABLE_MEMBER_DMS;
  try {
    delete process.env.ENABLE_MEMBER_DMS;
    assert.equal(loadConfig({ validateSecrets: false }).enableMemberDms, false);
    for (const value of ["true", "TRUE"]) {
      process.env.ENABLE_MEMBER_DMS = value;
      assert.equal(loadConfig({ validateSecrets: false }).enableMemberDms, true);
    }
    process.env.ENABLE_MEMBER_DMS = "false";
    assert.equal(loadConfig({ validateSecrets: false }).enableMemberDms, false);
    for (const value of ["yes", "1", "", " true "]) {
      process.env.ENABLE_MEMBER_DMS = value;
      assert.throws(() => loadConfig({ validateSecrets: false }), /ENABLE_MEMBER_DMS must be one of/);
    }
  } finally {
    if (previous === undefined) delete process.env.ENABLE_MEMBER_DMS;
    else process.env.ENABLE_MEMBER_DMS = previous;
  }
});
