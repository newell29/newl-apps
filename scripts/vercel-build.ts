import { spawnSync } from "node:child_process";

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    env: process.env,
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const vercelEnv = process.env.VERCEL_ENV ?? "local";

console.log(`Starting Vercel build for ${vercelEnv}.`);

run("npm", ["run", "prisma:generate"]);

if (vercelEnv === "preview") {
  console.log("Preview deployment detected. Checking database identity before applying migrations.");
  run("npm", ["run", "db:safety-check", "--", "--require-preview-db"]);
  run("npm", ["run", "prisma:migrate:deploy"]);
  run("npm", ["run", "preview:provision-teamship-user"]);
} else {
  console.log(
    "Skipping prisma migrate deploy. Production migrations must be run intentionally; Preview migrations run only after the preview database safety check."
  );
}

run("next", ["build"]);
