import { generateDependencyReport } from "@discordjs/voice";
import { getCiphers } from "node:crypto";

import { loadConfig, validateSecrets } from "./config.js";

const errors: string[] = [];
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  errors.push(`Node.js 22.12+ is required; found ${process.versions.node}`);
}

let config;
try {
  config = loadConfig({ validateSecrets: false });
  validateSecrets(config);
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}

if (!getCiphers().includes("aes-256-gcm")) {
  errors.push("This Node.js build does not support aes-256-gcm.");
}

console.log(generateDependencyReport());
if (config) {
  console.log(`AI provider: ${config.aiProvider}`);
  console.log(`Speech-recognition provider: ${config.sttProvider}`);
  console.log(`Settings directory: ${config.dataDir}`);
}

if (errors.length > 0) {
  console.error("\nConfiguration problems:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("\nConfiguration looks ready.");
}
