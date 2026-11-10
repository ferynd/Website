/** #76 dry-run entry: `npx --no-install vite-node scripts/nutrition/dryRunPilotCli.ts -- --date YYYY-MM-DD [--check]`. */
import { dryRunPilotCli } from './dryRunPilot';

dryRunPilotCli(process.argv.slice(2)).catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
