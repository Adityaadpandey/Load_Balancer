import os from "os";
import yargs from "yargs-parser";
import { app, instanceId, startedAt } from ".";

const rawArgs = Bun.argv.slice(2);
const args = yargs(rawArgs, {
  alias: { p: "port" },
  configuration: { "camel-case-expansion": false },
});

const portRaw = args.port ?? args._[0] ?? 3000;
const port = typeof portRaw === "string" ? parseInt(portRaw, 10) : portRaw;

// Fancy logging
const green = "\x1b[32m";
const reset = "\x1b[0m";
const cyan = "\x1b[36m";
const gray = "\x1b[90m";

app.listen(port, () => {
  console.log(
    `${green}[✅ Spawned]${reset} Backend server running on ${cyan}http://localhost:${port}${reset}`
  );
  console.log(`${gray}  ↪ Instance ID: ${instanceId}`);
  console.log(`  ↪ Started At : ${startedAt}`);
  console.log(`  ↪ Hostname   : ${os.hostname()}${reset}`);
});
