import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConversationMemory } from "../src/memory.js";
describe("ConversationMemory", () => {
    it("keeps only complete recent exchanges", () => {
        const memory = new ConversationMemory(3);
        memory.addExchange("guild:channel", "one", "reply one");
        memory.addExchange("guild:channel", "two", "reply two");
        assert.deepEqual(memory.get("guild:channel"), [
            { role: "user", content: "two" },
            { role: "assistant", content: "reply two" },
        ]);
    });
    it("clears only the selected guild", () => {
        const memory = new ConversationMemory(10);
        memory.addExchange("guild-a:one", "a", "b");
        memory.addExchange("guild-b:one", "c", "d");
        assert.equal(memory.clearGuild("guild-a"), 1);
        assert.deepEqual(memory.get("guild-a:one"), []);
        assert.equal(memory.get("guild-b:one").length, 2);
    });
});
//# sourceMappingURL=memory.test.js.map