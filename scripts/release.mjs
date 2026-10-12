// npm run release [patch|minor|major]
// Tests, bumps the version, commits + tags + pushes to GitHub, then builds the installer and
// publishes it as a GitHub Release. Installed copies of Ledger pick it up automatically.
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const extra = ['C:\\Program Files\\nodejs', 'C:\\Program Files\\Git\\cmd', 'C:\\Program Files\\GitHub CLI'].filter(existsSync);
process.env.Path = [...extra, process.env.Path || process.env.PATH].join(';');
const run = (cmd, env) => { console.log(`\n> ${cmd}`); execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } }); };

const bump = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major'].includes(bump)) throw new Error('usage: npm run release [patch|minor|major]');
const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
if (!token) throw new Error('Not signed in to GitHub. Run: gh auth login');

run('npm test');
run(`npm version ${bump} --no-git-tag-version`);
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
run('git add -A');
run(`git commit -m "Release v${version}"`);
run(`git tag v${version}`);
run('git push origin HEAD --tags');
run('node build.mjs');
run('npx electron-builder --win nsis --publish always', { GH_TOKEN: token });
console.log(`\nPublished Ledger v${version}. Installed copies update within ~2 hours (or Settings → Check for updates).`);
