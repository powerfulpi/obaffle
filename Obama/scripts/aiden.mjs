#!/usr/bin/env node
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

const message = process.argv.slice(2).join(" ").trim();
if (!message) {
  console.error("Usage: aiden <message>");
  process.exit(1);
}

const socket = connect(join(homedir(), ".local", "share", "obama", "aiden.sock"));
socket.setEncoding("utf8");
socket.on("connect", () => socket.write(`${message}\n`));
socket.on("data", (response) => {
  const output = response.trim();
  if (output.startsWith("Error:") || output.startsWith("Usage:")) process.exitCode = 1;
  console.log(output);
});
socket.on("error", () => {
  console.error("Obama is not running, or its local command socket is unavailable.");
  process.exitCode = 1;
});
