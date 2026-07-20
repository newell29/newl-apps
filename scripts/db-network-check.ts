import net from "node:net";
import dns from "node:dns/promises";

function readDatabaseUrl() {
  const rawUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

  if (!rawUrl) {
    throw new Error("DATABASE_URL or POSTGRES_URL is required for the database network check.");
  }

  try {
    return new URL(rawUrl);
  } catch {
    throw new Error("DATABASE_URL/POSTGRES_URL is not a valid URL.");
  }
}

function defaultPortForProtocol(protocol: string) {
  return protocol === "postgres:" || protocol === "postgresql:" ? 5432 : 0;
}

async function checkTcp(host: string, port: number) {
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out connecting to ${host}:${port}.`));
    }, 10_000);

    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.end();
      resolve();
    });

    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function main() {
  const url = readDatabaseUrl();
  const host = url.hostname;
  const port = Number(url.port || defaultPortForProtocol(url.protocol));
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, "")) || "(none)";

  if (!host || !port) {
    throw new Error(`Unable to determine database host/port from ${url.protocol} URL.`);
  }

  console.log("Database network check");
  console.log(`Target: host=${host} port=${port} database=${database}`);

  const addresses = await dns.lookup(host, { all: true });
  console.log(`DNS: ${addresses.map((address) => `${address.address}/${address.family}`).join(", ")}`);

  await checkTcp(host, port);
  console.log(`TCP connection to ${host}:${port} succeeded.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
