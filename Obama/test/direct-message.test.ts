import assert from "node:assert/strict";
import { it } from "node:test";
import { ObamaBot } from "../src/bot.js";
import { parseCommand } from "../src/commands.js";

const userId = "123456789012345678";
const execute = (ObamaBot.prototype as unknown as {
  executeCommand(message: unknown, command: unknown): Promise<void>;
}).executeCommand;

it("parses DM mentions and IDs while preserving message formatting", () => {
  for (const target of [userId, `<@${userId}>`, `<@!${userId}>`]) {
    assert.deepEqual(parseCommand(`oBaMaDM ${target} Hello  there\nNext line`), {
      kind: "command", command: { name: "dm", userId, text: "Hello  there\nNext line" },
    });
  }
});

it("requires an unambiguous person and a message within Discord's limit", () => {
  for (const args of ["", userId, `${userId}   `, "Alex hello", "123 hello", `<@&${userId}> hello`, `${userId} ${"x".repeat(2001)}`]) {
    assert.equal(parseCommand(`ObamaDM ${args}`).kind, "error", args);
  }
  assert.equal(parseCommand(`ObamaDM ${userId} ${"x".repeat(2000)}`).kind, "command");
});

function fixture(options: { owner?: boolean; bot?: boolean; fetchFails?: boolean; sendFails?: boolean } = {}) {
  const fetched: string[] = [];
  const sends: unknown[] = [];
  const replies: unknown[] = [];
  const message = {
    member: { id: options.owner === false ? "other" : "owner" },
    guild: { ownerId: "owner", members: { async fetch(id: string) {
      fetched.push(id);
      if (options.fetchFails) throw new Error("fetch failed");
      return { id, user: { bot: options.bot ?? false }, async send(payload: unknown) {
        sends.push(payload);
        if (options.sendFails) throw new Error("private request data");
      } };
    } } },
    async reply(payload: unknown) { replies.push(payload); },
  };
  return { fetched, sends, replies, run: () => execute.call({}, message, { name: "dm", userId, text: "Hello @everyone" }) };
}

it("sends only to the selected member without the broadcast intent or mention pings", async () => {
  const f = fixture();
  await f.run();
  assert.deepEqual(f.fetched, [userId]);
  assert.deepEqual(f.sends, [{ content: "Hello @everyone", allowedMentions: { parse: [] } }]);
  assert.deepEqual(f.replies, [{ content: `DM sent to <@${userId}>.`, allowedMentions: { parse: [], repliedUser: false } }]);
});

it("rejects unauthorized callers before looking up the recipient", async () => {
  const f = fixture({ owner: false });
  await f.run();
  assert.deepEqual(f.fetched, []);
  assert.deepEqual(f.sends, []);
  assert.match(String(f.replies[0]), /server owner/);
});

it("reports missing members, bot recipients and delivery failures without claiming success", async () => {
  for (const [options, expected] of [
    [{ fetchFails: true }, /could not find/],
    [{ bot: true }, /choose a person/],
    [{ sendFails: true }, /could not deliver/],
  ] as const) {
    const f = fixture(options);
    await f.run();
    assert.equal(f.sends.length, "sendFails" in options ? 1 : 0);
    assert.equal(f.replies.length, 1);
    assert.match(String(f.replies[0]), expected);
    assert.doesNotMatch(JSON.stringify(f.replies), /private request data/);
  }
});
