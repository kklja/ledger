// npm run release [patch|minor|major]
// Tests, bumps the version, commits + tags + pushes to GitHub, builds the installer, then creates
// ONE GitHub Release with the installer, its blockmap and latest.yml (the file the updater reads).
// Installed copies of Ledger pick it up automatically.
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const extra = ['C:\Program Files\nodejs', 'C:\Program Files\Git\cmd', 'C:\Program Files\GitHub CLI'].filter(existsSync);
process.env.Path = [...extra, process.env.Path || process.env.PATH].join(';');
const run = (cmd) => { console.log(`\n> ${cmd}`); execSync(cmd, { stdio: 'inherit' }); };

const bump = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major'].includes(bump)) throw new Error('usage: npm run release [patch|minor|major]');
if (!execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()) throw new Error('Not signed in to GitHub. Run: gh auth login');

run('npm test');
run(`npm version ${bump} --no-git-tag-version`);
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
run('git add -A');
run(`git commit -m "Release v${version}" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`);
run(`git tag v${version}`);
run('git push origin HEAD --tags');
run('node build.mjs');
// Build only; electron-builder's own publishing uploads files in parallel and can create duplicate releases.
run('npx electron-builder --win nsis --publish never');
const files = [`release/Ledger-Setup-${version}.exe`, `release/Ledger-Setup-${version}.exe.blockmap`, 'release/latest.yml'];
for (const f of files) if (!existsSync(f)) throw new Error(`Missing build output: ${f}`);
run(`gh release create v${version} ${files.map((f) => `"${f}"`).join(' ')} --title "Ledger ${version}" --notes "Ledger ${version}. Installed copies update automatically."`);
console.log(`\nPublished Ledger v${version}. Installed copies update within ~2 hours (or Settings → Check for updates).`);
