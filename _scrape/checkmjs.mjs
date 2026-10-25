/* Parse-check ES modules without resolving their imports.
   Usage: node --experimental-vm-modules _scrape/checkmjs.mjs <files...> */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const files = process.argv.slice(2);
let bad = 0;
for (const f of files) {
  try {
    new vm.SourceTextModule(readFileSync(f, 'utf8'), { identifier: f });
    console.log('OK   ' + f);
  } catch (e) {
    bad += 1;
    console.log('FAIL ' + f + '\n     ' + e.message);
  }
}
console.log(bad ? `\n${bad} file(s) failed to parse` : `\nall ${files.length} modules parse`);
process.exit(bad ? 1 : 0);
