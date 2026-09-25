import assert from "node:assert/strict";
import { it } from "node:test";
import { Collection } from "discord.js";
import { DmBroadcastService } from "../src/dm-broadcast.js";
import { Logger } from "../src/logger.js";
function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}
function fixture(sendActions = [async () => undefined]) {
    const sends = [];
    const replies = [];
    const members = new Collection();
    for (const [index, action] of sendActions.entries()) {
        members.set(String(index), {
            user: { bot: action === "bot" },
            send: async (payload) => {
                sends.push({ member: index, payload });
                if (action !== "bot")
                    return action();
            },
        });
    }
    let fetches = 0;
    const message = {
        author: { username: "Server Owner" },
        guild: { id: "guild", name: "Friendly Server", members: {
                fetch: async () => { fetches++; return members; },
            } },
        reply: async (payload) => { replies.push(payload.content); },
    };
    const delays = [];
    const logger = new Logger("error");
    const service = new DmBroadcastService(logger, {
        sleep: async (milliseconds) => { delays.push(milliseconds); },
    });
    return { sends, replies, members, message, delays, logger, service,
        asMessage: message, fetches: () => fetches };
}
it("fetches every member, skips bots, attributes the DM, paces attempts and continues after a closed DM", async () => {
    const f = fixture([async () => undefined, "bot", async () => { throw { code: 50007, status: 403 }; }, async () => undefined]);
    await f.service.start(f.asMessage, "You're appreciated! @everyone");
    assert.equal(f.fetches(), 1);
    assert.deepEqual(f.sends.map((send) => send.member), [0, 2, 3]);
    assert.deepEqual(f.delays, [1_000, 1_000]);
    assert.match(f.sends[0].payload.content, /Server Owner, owner of Friendly Server/);
    assert.match(f.sends[0].payload.content, /You're appreciated! @everyone$/);
    assert.deepEqual(f.sends[0].payload.allowedMentions, { parse: [] });
    assert.match(f.replies[0], /to 3 members; skipping 1 bots/);
    assert.match(f.replies.at(-1), /complete.*Sent: 2\. Failed: 1\. Skipped bots: 1\. Remaining: 0/);
    await f.service.status(f.asMessage);
    assert.match(f.replies.at(-1), /complete.*Sent: 2/);
});
it("reserves a guild during member enumeration and reports progress without starting duplicate jobs", async () => {
    const f = fixture();
    const fetched = deferred();
    f.message.guild.members.fetch = () => fetched.promise;
    const run = f.service.start(f.asMessage, "Hello");
    await f.service.start(f.asMessage, "Duplicate");
    await f.service.status(f.asMessage);
    assert.match(f.replies[0], /already running/);
    assert.match(f.replies[1], /fetching members/);
    assert.equal(f.sends.length, 0);
    fetched.resolve(f.members);
    await run;
    assert.equal(f.sends.length, 1);
});
it("does not send to a partial cache after enumeration fails and releases the guild", async () => {
    const f = fixture();
    f.message.guild.members.fetch = async () => { throw new Error("private token or contents"); };
    await f.service.start(f.asMessage, "Hello");
    assert.equal(f.sends.length, 0);
    assert.match(f.replies.at(-1), /Server Members Intent.*restart/);
    f.message.guild.members.fetch = async () => f.members;
    await f.service.start(f.asMessage, "Try again");
    assert.equal(f.sends.length, 1);
});
it("allows independent servers to run without sharing their status or cancellation", async () => {
    const f = fixture();
    const fetched = deferred();
    f.message.guild.members.fetch = () => fetched.promise;
    const run = f.service.start(f.asMessage, "Hello");
    const other = {
        ...f.message,
        guild: { ...f.message.guild, id: "other-guild", members: { fetch: async () => f.members } },
    };
    await f.service.start(other, "From another server");
    assert.equal(f.sends.length, 1);
    await f.service.cancel(other);
    assert.match(f.replies.at(-1), /No DM broadcast is running/);
    await f.service.status(f.asMessage);
    assert.match(f.replies.at(-1), /fetching members/);
    fetched.resolve(f.members);
    await run;
    assert.equal(f.sends.length, 2);
});
it("does not send DMs if the initial channel acknowledgement cannot be delivered", async () => {
    const f = fixture();
    f.message.reply = async () => { throw { status: 403, code: 50013 }; };
    await f.service.start(f.asMessage, "Hello");
    assert.equal(f.sends.length, 0);
});
it("cancels during member enumeration without sending", async () => {
    const f = fixture();
    const fetched = deferred();
    f.message.guild.members.fetch = () => fetched.promise;
    const run = f.service.start(f.asMessage, "Hello");
    await f.service.cancel(f.asMessage);
    fetched.resolve(f.members);
    await run;
    assert.equal(f.sends.length, 0);
    assert.match(f.replies.at(-1), /cancelled/);
});
it("cancels an abortable pacing delay and does not attempt the next recipient", async () => {
    const f = fixture([async () => undefined, async () => undefined]);
    const waiting = deferred();
    const service = new DmBroadcastService(f.logger, {
        sleep: async (_milliseconds, signal) => {
            waiting.resolve();
            await new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        },
    });
    const run = service.start(f.asMessage, "Hello");
    await waiting.promise;
    await service.cancel(f.asMessage);
    await run;
    assert.equal(f.sends.length, 1);
    assert.ok(f.replies.some((reply) => /cancelled.*Sent: 1.*Remaining: 1/.test(reply)));
});
it("keeps a cancelled in-flight send reserved until it finishes", async () => {
    const sending = deferred();
    const finish = deferred();
    const f = fixture([async () => { sending.resolve(); await finish.promise; }, async () => undefined]);
    const run = f.service.start(f.asMessage, "Hello");
    await sending.promise;
    await f.service.cancel(f.asMessage);
    await f.service.start(f.asMessage, "Duplicate");
    assert.match(f.replies.at(-1), /already running/);
    finish.resolve();
    await run;
    assert.equal(f.sends.length, 1);
    assert.match(f.replies.at(-1), /cancelled.*Sent: 1.*Remaining: 1/);
});
it("shutdown suppresses later sends and updates after an in-flight send completes", async () => {
    const sending = deferred();
    const finish = deferred();
    const f = fixture([async () => { sending.resolve(); await finish.promise; }, async () => undefined]);
    const run = f.service.start(f.asMessage, "Hello");
    await sending.promise;
    f.service.stop();
    const replyCount = f.replies.length;
    finish.resolve();
    await run;
    await f.service.start(f.asMessage, "After shutdown");
    await f.service.status(f.asMessage);
    await f.service.cancel(f.asMessage);
    assert.equal(f.sends.length, 1);
    assert.equal(f.replies.length, replyCount);
});
it("shutdown while enumerating never starts a send or posts an update", async () => {
    const f = fixture();
    const fetched = deferred();
    f.message.guild.members.fetch = () => fetched.promise;
    const run = f.service.start(f.asMessage, "Hello");
    f.service.stop();
    fetched.resolve(f.members);
    await run;
    assert.equal(f.sends.length, 0);
    assert.equal(f.replies.length, 0);
});
it("stops on authentication, global permissions and escaped rate limiting without retrying", async () => {
    for (const error of [{ status: 401 }, { status: 403, code: 50013 }, { status: 429 }, { code: 40003 }, { name: "RateLimitError" }]) {
        const f = fixture([async () => { throw error; }, async () => undefined]);
        await f.service.start(f.asMessage, "Hello");
        assert.equal(f.sends.length, 1);
        assert.match(f.replies.at(-1), /stopped.*Sent: 0\. Failed: 1.*Remaining: 1/);
    }
});
it("paces every member-specific refusal and continues through the full member list", async () => {
    const f = fixture(Array.from({ length: 11 }, () => async () => { throw { code: 50007, status: 403 }; }));
    await f.service.start(f.asMessage, "Hello");
    assert.equal(f.sends.length, 11);
    assert.deepEqual(f.delays, Array(10).fill(1_000));
    assert.match(f.replies.at(-1), /complete.*Failed: 11.*Remaining: 0/);
});
it("stays within Discord's message limit and rejects oversized messages before enumeration", async () => {
    const f = fixture();
    f.message.author.username = "a".repeat(100);
    f.message.guild.name = "s".repeat(200);
    await f.service.start(f.asMessage, "x".repeat(1_800));
    assert.ok(f.sends[0].payload.content.length <= 2_000);
    await f.service.start(f.asMessage, "x".repeat(1_801));
    assert.equal(f.fetches(), 1);
    assert.equal(f.sends.length, 1);
});
it("does not expose request data or recipients in logs when a send fails", async () => {
    const f = fixture([async () => { throw { status: 401, token: "private-token", message: "private-content" }; }]);
    const logs = [];
    f.logger.info = (...args) => { logs.push(args); };
    f.logger.warn = (...args) => { logs.push(args); };
    await f.service.start(f.asMessage, "secret-message");
    const serialized = JSON.stringify(logs);
    assert.doesNotMatch(serialized, /private-token|private-content|secret-message|Server Owner/);
    assert.match(serialized, /"failed":1/);
});
//# sourceMappingURL=dm-broadcast.test.js.map