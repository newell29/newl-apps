import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("passes the Python pilot recovery, budget, evidence, and permission scenarios", () => {
  const result = spawnSync("python3", ["tests/hunter_pilot_test.py"], {
    cwd: process.cwd(), encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
