import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

async function check(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${item.name}`;
    if (item.isDirectory()) await check(path);
    else if (path.endsWith('.js')) execFileSync(process.execPath, ['--check', path], { stdio: 'inherit' });
  }
}
await check('src');
await check('scripts');
execFileSync(process.execPath, ['--check', 'server.js'], { stdio: 'inherit' });
console.log('JavaScript syntax checks passed.');
