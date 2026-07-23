const { spawn } = require("node:child_process");
const path = require("node:path");

const nextCli = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextCli, "dev"], {
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    NEXT_DIST_DIR: ".next-dev"
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
