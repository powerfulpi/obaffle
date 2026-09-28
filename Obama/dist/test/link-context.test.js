import assert from "node:assert/strict";
import { it } from "node:test";
import { extractLinks, isPublicAddress, loadLinkContext, pageText, readPublicLink } from "../src/link-context.js";
import { ConversationService } from "../src/conversation-service.js";
import { ConversationMemory } from "../src/memory.js";
import { SettingsStore } from "../src/settings-store.js";
import { Logger } from "../src/logger.js";
it("extracts bounded unique links from Discord/Markdown and preserves balanced URL parentheses", () => {
    assert.deepEqual(extractLinks(["See <https://example.com/a>. [wiki](https://example.com/wiki/Foo_(bar)) and `https://example.com/a`", "https://example.org/three https://example.org/four"]), ["https://example.com/a", "https://example.com/wiki/Foo_(bar)", "https://example.org/three"]);
    assert.deepEqual(extractLinks(["No link, ftp://example.com/"]), []);
});
it("blocks loopback, private, mapped, metadata and reserved addresses", async () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.31.0.1", "192.168.0.1", "169.254.169.254", "100.100.100.200", "0.0.0.0", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2002:7f00:1::", "2001:db8::1"]) {
        assert.equal(isPublicAddress(ip), false, ip);
        const url = `http://${ip.includes(":") ? `[${ip}]` : ip}/`;
        await assert.rejects(readPublicLink(url), /Private or reserved/);
    }
    assert.equal(isPublicAddress("8.8.8.8"), true);
    assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
    for (const url of ["file:///etc/passwd", "https://user:password@example.com/", "https://example.com:3000/"]) {
        await assert.rejects(readPublicLink(url), /public HTTP/);
    }
});
it("extracts titles, descriptions and page text without scripts/styles and bounds excerpts", () => {
    const text = pageText({ url: "https://example.com", contentType: "text/html", bytes: Buffer.from('<title>Cats &amp; Dogs</title><meta name="description" content="Animal news"><script>secret()</script><style>bad</style><p>A &#x1f408; story</p><!-- hidden -->') });
    assert.equal(text, "Cats & Dogs Animal news A 🐈 story");
    assert.equal(pageText({ url: "", contentType: "text/plain", bytes: Buffer.from("a".repeat(10000)) }).length, 8000);
    assert.throws(() => pageText({ url: "", contentType: "application/pdf", bytes: Buffer.from("pdf") }), /file type/);
});
it("link failures are explicit and do not discard readable pages or direct images", async () => {
    const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const read = async (url) => {
        if (url.endsWith("/bad"))
            throw new Error("timeout");
        return { url, contentType: url.endsWith("/image") ? "image/png" : "text/html", bytes: url.endsWith("/image") ? image : Buffer.from("<h1>Article title</h1><p>Article details</p>") };
    };
    const result = await loadLinkContext(["https://example.com/bad https://example.com/page https://example.com/image"], 1, read);
    assert.match(result.text, /unavailable; contents unknown/);
    assert.match(result.text, /Article details/);
    assert.deepEqual(result.images, [{ mimeType: "image/png", data: image.toString("base64") }]);
    const limited = await loadLinkContext(["https://example.com/image"], 0, read);
    assert.deepEqual(limited.images, []);
    assert.match(limited.text, /not inspected/);
});
it("every conversational source receives link context without persisting fetched pages", async () => {
    const requests = [];
    const calls = [];
    const memory = new ConversationMemory(20);
    const service = new ConversationService({ aiProvider: "gemini", defaultInstructions: "Be friendly", maxResponseCharacters: 2000 }, { async generate(request) { requests.push(request); return "Reply"; } }, new SettingsStore("unused", "voice"), memory, new Logger("error"), async (texts) => { calls.push(texts); return { text: "\nFetched page details", images: [] }; });
    for (const source of ["text", "speak", "voice", "image", "conversation"]) {
        await service.reply({ guildId: "g", channelId: source, displayName: "Test", prompt: "What is https://example.com?", source });
        assert.match(requests.at(-1).messages.at(-1).content, /Fetched page details/);
        assert.match(requests.at(-1).instructions, /untrusted source data/);
        assert.equal(JSON.stringify(memory.get(`g:${source}`)).includes("Fetched page details"), false);
    }
    assert.equal(calls.length, 5);
    await service.reply({ guildId: "g", channelId: "status", displayName: "Test", prompt: "https://example.com", source: "status" });
    assert.equal(calls.length, 5);
    await service.reply({ guildId: "g", channelId: "plain", displayName: "Test", prompt: "hello", source: "text" });
    assert.equal(calls.length, 5);
});
it("pins validated DNS results, follows public redirects and blocks private redirect destinations", async (t) => {
    const { default: dns } = await import("node:dns/promises");
    const { default: https } = await import("node:https");
    const { EventEmitter } = await import("node:events");
    const { Readable } = await import("node:stream");
    t.mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
    const visited = [];
    let redirect = "https://example.org/final";
    t.mock.method(https, "request", (url, options, receive) => {
        visited.push(url.href);
        options.lookup("example.org", { all: true }, (error, addresses) => {
            assert.equal(error, null);
            assert.deepEqual(addresses, [{ address: "8.8.8.8", family: 4 }]);
        });
        const req = new EventEmitter();
        req.end = () => {
            const response = Readable.from([Buffer.from("A readable page")]);
            response.statusCode = url.pathname === "/start" ? 302 : 200;
            response.headers = response.statusCode === 302 ? { location: redirect } : { "content-type": "text/plain" };
            receive(response);
        };
        return req;
    });
    assert.equal((await readPublicLink("https://example.org/start")).bytes.toString(), "A readable page");
    assert.deepEqual(visited, ["https://example.org/start", "https://example.org/final"]);
    redirect = "https://127.0.0.1/private";
    await assert.rejects(readPublicLink("https://example.org/start"), /Private or reserved/);
    assert.equal(visited.at(-1), "https://example.org/start");
    t.mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]);
    const count = visited.length;
    await assert.rejects(readPublicLink("https://example.org/"), /Private or reserved/);
    assert.equal(visited.length, count);
});
it("bounds streamed downloads, redirect loops, HTTP failures and DNS timeouts", async (t) => {
    const { default: dns } = await import("node:dns/promises");
    const { default: https } = await import("node:https");
    const { EventEmitter } = await import("node:events");
    const { Readable } = await import("node:stream");
    t.mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
    let status = 200;
    let calls = 0;
    t.mock.method(https, "request", (_url, _options, receive) => {
        calls++;
        const req = new EventEmitter();
        req.end = () => {
            const response = Readable.from([Buffer.alloc(513 * 1024)]);
            response.statusCode = status;
            response.headers = status === 302 ? { location: "/loop" } : { "content-type": "text/html" };
            receive(response);
        };
        return req;
    });
    await assert.rejects(readPublicLink("https://example.org/"), /too large/);
    status = 403;
    await assert.rejects(readPublicLink("https://example.org/"), /HTTP 403/);
    status = 302;
    calls = 0;
    await assert.rejects(readPublicLink("https://example.org/"), /redirected too many/);
    assert.equal(calls, 4);
    t.mock.method(dns, "lookup", () => new Promise(() => { }));
    const controller = new AbortController();
    const pending = readPublicLink("https://example.org/", controller.signal);
    controller.abort();
    await assert.rejects(pending, /timed out/);
});
//# sourceMappingURL=link-context.test.js.map