import { createServer } from "node:http";
import { dashboardHtml } from "./dashboard-page.js";
export function getDashboardStats(client) {
    const online = client.isReady();
    const guilds = [...client.guilds.cache.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((guild) => ({
        id: guild.id,
        name: guild.name,
        available: online && guild.available,
        members: guild.memberCount,
    }));
    return {
        online,
        name: client.user?.username ?? "Obama",
        guildCount: guilds.length,
        activeGuildCount: guilds.filter((guild) => guild.available).length,
        uptimeMs: online ? client.uptime : null,
        pingMs: online && client.ws.ping >= 0 ? Math.round(client.ws.ping) : null,
        updatedAt: new Date().toISOString(),
        guilds,
    };
}
export async function startDashboard(client, port = 3000, controlOrigin) {
    // Only the local launcher may opt into embedding; standalone use stays unframed.
    //if (controlOrigin && !/^http:\/\/(0\.0\.0\.0|localhost):\d{1,5}$/.test(controlOrigin)) {
    //throw new Error("Dashboard frame origin must be a localhost HTTP origin");
    //}
    const server = createServer((request, response) => {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors ${controlOrigin ?? "'none'"}`);
        if (request.method !== "GET" && request.method !== "HEAD") {
            response.writeHead(405, { Allow: "GET, HEAD" });
            response.end();
            return;
        }
        const path = request.url?.split("?")[0];
        if (path !== "/" && path !== "/api/stats") {
            response.writeHead(404);
            response.end();
            return;
        }
        response.setHeader("Content-Type", path === "/" ? "text/html; charset=utf-8" : "application/json; charset=utf-8");
        response.end(request.method === "HEAD" ? undefined : path === "/" ? dashboardHtml : JSON.stringify(getDashboardStats(client)));
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "0.0.0.0", () => {
            server.removeListener("error", reject);
            resolve();
        });
    });
    return server;
}
//# sourceMappingURL=dashboard.js.map