import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { Client, GatewayIntentBits, Status } from "discord.js";
import { getDashboardStats, startDashboard } from "../src/dashboard.js";
test("dashboard reads live guild availability and hides stale connection metrics", async () => {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    client.guilds.cache.set("1", { id: "1", name: "Test guild", available: true, memberCount: 12 });
    assert.equal(getDashboardStats(client).activeGuildCount, 0);
    assert.equal(getDashboardStats(client).guildCount, 1);
    assert.equal(getDashboardStats(client).uptimeMs, null);
    client.ws.status = Status.Ready;
    assert.equal(getDashboardStats(client).activeGuildCount, 1);
    client.guilds.cache.clear();
    assert.equal(getDashboardStats(client).guildCount, 0);
    await client.destroy();
});
test("local server serves the dashboard and live stats with bounded routes", async () => {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    const server = await startDashboard(client, 0);
    const address = server.address();
    assert.equal(address.address, "127.0.0.1");
    const url = `http://127.0.0.1:${address.port}`;
    try {
        const page = await fetch(url);
        assert.equal(page.status, 200);
        assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
        assert.match(await page.text(), /Bot overview/);
        const response = await fetch(`${url}/api/stats`);
        assert.equal(response.headers.get("cache-control"), "no-store");
        const stats = await response.json();
        assert.equal(stats.online, false);
        assert.deepEqual(stats.guilds, []);
        assert.equal((await fetch(`${url}/.env`)).status, 404);
        assert.equal((await fetch(`${url}/api/stats`, { method: "POST" })).status, 405);
    }
    finally {
        server.close();
        server.closeAllConnections();
        await once(server, "close");
        await client.destroy();
    }
});
test("dashboard permits framing only from the launcher's supplied localhost origin", async () => {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    const server = await startDashboard(client, 0, "http://127.0.0.1:3001");
    try {
        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}`);
        assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors http:\/\/127\.0\.0\.1:3001$/);
        await assert.rejects(startDashboard(client, 0, "https://untrusted.example"), /localhost/);
    }
    finally {
        server.close();
        server.closeAllConnections();
        await once(server, "close");
        await client.destroy();
    }
});
//# sourceMappingURL=dashboard.test.js.map