import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const entry = process.argv.includes("--dev") ? "scripts/dev.mjs" : "dist/src/index.js";
let child;
let stopping = false;

function launch() {
  child = spawn(process.execPath, [entry], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, OBAMA_SUPERVISED: "1" },
  });
  child.once("error", (error) => {
    console.error("Could not start Obama:", error.message);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (!stopping && code === 75) {
      console.log("Restarting Obama…");
      launch();
    } else {
      process.exitCode = stopping ? 0 : (code ?? (signal ? 1 : 0));
    }
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    child?.kill(signal);
    const deadline = setTimeout(() => child?.kill("SIGKILL"), 5_000);
    deadline.unref();
  });
}
launch();
