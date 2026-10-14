import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const cloudflared = join(process.cwd(), ".local", "bin", "cloudflared");
if (!existsSync(cloudflared)) throw new Error("Install cloudflared at Obama/.local/bin/cloudflared first");
const token = process.env.CLOUDFLARE_TUNNEL_TOKEN;
if (!token) throw new Error("Add CLOUDFLARE_TUNNEL_TOKEN to Obama/.env from the Cloudflare tunnel dashboard");
if (process.env.PHONE_PUBLIC_URL !== "https://phone.shantry.com") {
  throw new Error("Set PHONE_PUBLIC_URL=https://phone.shantry.com in Obama/.env");
}

const { CLOUDFLARE_TUNNEL_TOKEN: _secret, ...tunnelEnv } = process.env;
const phone = spawn(process.execPath, ["dist/src/phone.js"], { stdio: "inherit", env: tunnelEnv });
const tunnel = spawn(cloudflared, ["tunnel", "--no-autoupdate", "run"], {
  stdio: "inherit",
  env: { ...tunnelEnv, TUNNEL_TOKEN: token },
});
let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  phone.kill(signal);
  tunnel.kill(signal);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(signal));
for (const child of [phone, tunnel]) {
  child.on("error", (error) => { console.error(error); stop(); process.exitCode = 1; });
  child.on("exit", (code) => {
    if (!stopping) { stop(); process.exitCode = code || 1; }
  });
}
