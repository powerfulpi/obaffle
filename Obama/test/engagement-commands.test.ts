import assert from "node:assert/strict";
import { it } from "node:test";
import { GatewayIntentBits, PermissionFlagsBits } from "discord.js";
import { ObamaBot } from "../src/bot.js";
import { loadConfig } from "../src/config.js";
import { Logger } from "../src/logger.js";
import { SettingsStore } from "../src/settings-store.js";

const methods = ObamaBot.prototype as unknown as {
  executeCommand(message: unknown, command: unknown): Promise<void>;
  handleMessage(message: unknown): Promise<void>;
  handleConversationCommand(message: unknown, command: unknown): Promise<void>;
};

it("only the server owner can send, inspect or cancel a broadcast", async () => {
  for (const role of ["member", "manager", "admin", "owner"]) {
    for (const action of ["send", "status", "cancel"]) {
      const actions: string[] = [];
      const context = {
        config: { enableMemberDms: true },
        dmBroadcasts: {
          async start(_message: unknown, text: string) { actions.push(`send:${text}`); },
          async status() { actions.push("status"); },
          async cancel() { actions.push("cancel"); },
        },
      };
      const message = {
        guild: { ownerId: "owner" },
        member: { id: role, permissions: { has: () => true } },
        async reply() { actions.push("reply"); },
      };
      await methods.executeCommand.call(context, message, { name: "dm-all", action, text: "You matter!" });
      assert.deepEqual(actions, role === "owner" ? [action === "send" ? "send:You matter!" : action] : ["reply"]);
    }
  }
});

it("explains DM setup before any member fetch when the feature is disabled", async () => {
  const replies: string[] = [];
  await methods.executeCommand.call({ config: { enableMemberDms: false } }, {
    guild: { ownerId: "owner" }, member: { id: "owner" },
    async reply(text: string) { replies.push(text); },
  }, { name: "dm-all", action: "send", text: "You matter!" });
  assert.match(replies[0]!, /Server Members Intent/);
  assert.match(replies[0]!, /ENABLE_MEMBER_DMS=true/);
});

it("requests the privileged member intent only when explicitly enabled", async () => {
  const base = loadConfig({ validateSecrets: false });
  for (const enabled of [false, true]) {
    const bot = new ObamaBot({ ...base, openaiApiKey: "test-key", geminiApiKey: "test-key", enableMemberDms: enabled }, new Logger("error"));
    assert.equal(bot.client.options.intents.has(GatewayIntentBits.GuildMembers), enabled);
    await bot.stop();
  }
});

it("routes only ordinary human guild messages to conversation mode", async () => {
  const events: string[] = [];
  const context = {
    client: { user: { id: "12345" } },
    conversationMode: { async handleMessage() { events.push("ambient"); } },
    async executeCommand() { events.push("command"); },
  };
  const human = {
    author: { bot: false }, member: {}, webhookId: null, inGuild: () => true,
    content: "How is everyone's day?", async reply() { events.push("parse error"); },
  };
  await methods.handleMessage.call(context, human);
  await methods.handleMessage.call(context, { ...human, content: "ObamaText Hi" });
  await methods.handleMessage.call(context, { ...human, content: "ObamaConversation invalid" });
  await methods.handleMessage.call(context, { ...human, author: { bot: true } });
  await methods.handleMessage.call(context, { ...human, webhookId: "webhook" });
  await methods.handleMessage.call(context, { ...human, inGuild: () => false });
  assert.deepEqual(events, ["ambient", "command", "parse error"]);
});

it("conversation settings are channel-scoped, manager-controlled, and invalidate pending replies", async () => {
  const store = new SettingsStore("unused", "voice");
  const invalidated: string[] = [];
  const replies: string[] = [];
  const context = {
    settings: {
      get: store.get.bind(store),
      async mutate(guildId: string, change: (settings: ReturnType<SettingsStore["get"]>) => void) {
        change(store.get(guildId));
      },
    },
    client: { user: { id: "bot" } },
    conversationMode: { invalidate(channel: string) { invalidated.push(channel); } },
  };
  const message = {
    guild: { id: "guild", ownerId: "owner" },
    member: { id: "manager", guild: { ownerId: "owner" }, permissions: { has: (flag: bigint) => flag === PermissionFlagsBits.ManageGuild } },
    channel: { id: "one", isThread: () => false, permissionsFor: () => ({ has: () => true }) },
    async reply(text: string) { replies.push(text); },
  };
  await methods.handleConversationCommand.call(context, message, { name: "conversation", action: "on" });
  assert.deepEqual(store.get("guild").conversationChannels.one, { chancePercent: 5, cooldownSeconds: 60 });
  assert.equal(store.get("guild").conversationChannels.two, undefined);
  await methods.handleConversationCommand.call(context, message, { name: "conversation", action: "on", chancePercent: 2.5, cooldownSeconds: 120 });
  await methods.handleConversationCommand.call(context, message, { name: "conversation", action: "on" });
  assert.deepEqual(store.get("guild").conversationChannels.one, { chancePercent: 2.5, cooldownSeconds: 120 });
  const unauthorized = { ...message, member: { ...message.member, permissions: { has: () => false } } };
  await assert.rejects(methods.handleConversationCommand.call(context, unauthorized, { name: "conversation", action: "off" }), /MANAGE_GUILD_REQUIRED/);
  await methods.handleConversationCommand.call(context, unauthorized, { name: "conversation", action: "status" });
  assert.match(replies.at(-1)!, /2.5%/);
  await methods.handleConversationCommand.call(context, message, { name: "conversation", action: "off" });
  assert.equal(store.get("guild").conversationChannels.one, undefined);
  assert.deepEqual(invalidated, ["one", "one", "one", "one"]);
});

it("requires history and thread send permissions before enabling conversation mode", async () => {
  const store = new SettingsStore("unused", "voice");
  const replies: string[] = [];
  let checked: bigint[] = [];
  await methods.handleConversationCommand.call({ settings: store, client: { user: { id: "bot" } } }, {
    guild: { id: "guild" },
    member: { id: "owner", guild: { ownerId: "owner" } },
    channel: {
      id: "thread", isThread: () => true,
      permissionsFor: () => ({ has(flags: bigint[]) { checked = flags; return false; } }),
    },
    async reply(text: string) { replies.push(text); },
  }, { name: "conversation", action: "on" });
  assert.deepEqual(checked, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessagesInThreads]);
  assert.equal(store.get("guild").conversationChannels.thread, undefined);
  assert.match(replies[0]!, /Read Message History/);
});
