import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { ObamaBot } from "../src/bot.js";
import { PermissionFlagsBits } from "discord.js";
it("only administrators and server owners can restart, after acknowledgment", async () => {
    const execute = ObamaBot.prototype.executeCommand;
    for (const role of ["member", "manager", "admin", "owner"]) {
        const events = [];
        const context = { restart: async () => { events.push("restart"); }, logger: { info() { } } };
        const message = {
            guild: { id: "guild", ownerId: "owner" },
            member: { id: role, permissions: { has: (flag) => role === "admin" && flag === PermissionFlagsBits.Administrator } },
            reply: async () => { events.push("reply"); },
        };
        await execute.call(context, message, { name: "restart" });
        assert.deepEqual(events, role === "admin" || role === "owner" ? ["reply", "restart"] : ["reply"]);
    }
});
it("launcher relaunches on restart code and stops after a normal exit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "obama-restart-"));
    try {
        await mkdir(join(directory, "scripts"));
        await mkdir(join(directory, "dist/src"), { recursive: true });
        await copyFile("scripts/run.mjs", join(directory, "scripts/run.mjs"));
        await writeFile(join(directory, "package.json"), '{"type":"module"}');
        await writeFile(join(directory, "dist/src/index.js"), `
      import { existsSync, writeFileSync, appendFileSync } from 'node:fs';
      if (process.env.OBAMA_SUPERVISED !== '1') process.exit(1);
      if (!existsSync('runs')) { writeFileSync('runs', 'first\\n'); process.exit(75); }
      appendFileSync('runs', 'second\\n');
    `);
        await promisify(execFile)(process.execPath, [join(directory, "scripts/run.mjs")], { timeout: 10_000 });
        assert.equal(await readFile(join(directory, "runs"), "utf8"), "first\nsecond\n");
    }
    finally {
        await rm(directory, { recursive: true, force: true });
    }
});
//# sourceMappingURL=restart.test.js.map