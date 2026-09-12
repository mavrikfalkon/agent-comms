/**
 * Prepend a `#!/usr/bin/env node` shebang to the built CLI entrypoint so npm's
 * POSIX bin-linking (for the published `agent-comms` binary) can execute it
 * directly. src/cli.ts has no shebang of its own and tsc doesn't add one, so
 * this step is the only source of it.
 *
 * Previously done with `printf '#!/usr/bin/env node\n' | cat - dist/cli.js >
 * dist/cli.tmp && mv dist/cli.tmp dist/cli.js` — printf/cat/mv don't exist
 * outside a POSIX shell, so a plain `npm run build` failed outright from
 * cmd.exe or PowerShell. A cross-platform Node script has no such dependency.
 *
 * Idempotent: running it twice does not double the shebang.
 *
 * Usage: node/tsx scripts/add-shebang.ts (run after `tsc`)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SHEBANG = "#!/usr/bin/env node\n";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(root, "dist", "cli.js");

const content = fs.readFileSync(cliPath, "utf-8");
if (!content.startsWith(SHEBANG)) {
  fs.writeFileSync(cliPath, SHEBANG + content);
}

// The mode bit only means anything on POSIX filesystems (see bug #9's
// 0o600-on-Windows finding) — Windows has no equivalent to "executable".
if (process.platform !== "win32") {
  fs.chmodSync(cliPath, 0o755);
}

console.log(`Added shebang to ${cliPath}`);
