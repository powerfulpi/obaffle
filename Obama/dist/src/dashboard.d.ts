import { type Server } from "node:http";
import type { Client } from "discord.js";
export declare function getDashboardStats(client: Client): {
    online: boolean;
    name: string;
    guildCount: number;
    activeGuildCount: number;
    uptimeMs: number | null;
    pingMs: number | null;
    updatedAt: string;
    guilds: {
        id: string;
        name: string;
        available: boolean;
        members: number;
    }[];
};
export declare function startDashboard(client: Client, port?: number, controlOrigin?: string): Promise<Server>;
