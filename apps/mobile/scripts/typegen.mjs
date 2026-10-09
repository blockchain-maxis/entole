// Regenerates .expo/types/router.d.ts (expo-router typed routes) without a
// long-lived dev server. `expo start` writes the file when Metro boots (and
// skips the write when nothing changed), so this starts it, waits for the
// ready line plus a short grace period, checks the file exists, then stops it.
// Run before `tsc` so fresh clones and CI have route types for new screens.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, ".expo", "types", "router.d.ts");
const TIMEOUT_MS = 120_000;
const GRACE_MS = 4_000;

const child = spawn(
  "pnpm",
  ["exec", "expo", "start", "--offline", "--port", "8099"],
  { cwd: root, env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"], detached: true },
);

let ready = false;
const onData = (chunk) => {
  if (ready || !String(chunk).includes("Waiting on")) return;
  ready = true;
  setTimeout(() => finish(existsSync(target) ? 0 : 1), GRACE_MS);
};
child.stdout.on("data", onData);
child.stderr.on("data", onData);

const timer = setTimeout(() => {
  // A slow machine is not a reason to fail when the types are already there
  // (they only change when screens are added); a fresh clone has none, so it is.
  if (existsSync(target)) {
    console.warn("typegen: dev server was slow; keeping the existing router.d.ts");
    finish(0);
  }
  console.error("typegen: dev server did not become ready in time");
  finish(1);
}, TIMEOUT_MS);

function finish(code) {
  clearTimeout(timer);
  if (code !== 0) console.error("typegen: router.d.ts missing");
  // pnpm spawns the real server as a child, so stop the whole group.
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  process.exit(code);
}
