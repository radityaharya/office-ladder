const apiPort = process.env.API_PORT ?? "3073";

const server = Bun.spawn({
  cmd: ["bun", "--watch", "run", "src/serve.ts"],
  cwd: "apps/server",
  env: { ...process.env, PORT: apiPort },
  stdio: ["inherit", "inherit", "inherit"],
});

const web = Bun.spawn({
  cmd: ["bun", "run", "dev"],
  cwd: "apps/web",
  env: { ...process.env, API_PORT: apiPort },
  stdio: ["inherit", "inherit", "inherit"],
});

function shutdown() {
  server.kill();
  web.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await Promise.race([server.exited, web.exited]);
shutdown();
