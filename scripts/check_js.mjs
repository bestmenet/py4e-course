/* Parse frontend files as ES modules, just as the browser does. */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

let checked = 0;
function check(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const path = new URL(entry.name, directory);
    if (entry.isDirectory()) check(new URL(`${entry.name}/`, directory));
    else if (entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
        input: fs.readFileSync(path), encoding: 'utf8',
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        console.error(path.pathname, result.stderr);
        process.exit(result.status || 1);
      }
      checked++;
    }
  }
}
check(new URL('../web/assets/js/', import.meta.url));
console.log(`PASS: ${checked} frontend ES modules parse`);
