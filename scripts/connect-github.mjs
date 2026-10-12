// npm run connect-github  (one time, after `gh auth login`)
// Creates the public "ledger" repo on your GitHub account, points the auto-updater at it,
// pushes the code and publishes the first release.
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const extra = ['C:\\Program Files\\nodejs', 'C:\\Program Files\\Git\\cmd', 'C:\\Program Files\\GitHub CLI'].filter(existsSync);
process.env.Path = [...extra, process.env.Path || process.env.PATH].join(';');
const out = (file, args) => execFileSync(file, args, { encoding: 'utf8' }).trim();
const run = (cmd) => { console.log(`\n> ${cmd}`); execSync(cmd, { stdio: 'inherit' }); };

const owner = out('gh', ['api', 'user', '--jq', '.login']);
console.log(`Signed in to GitHub as ${owner}`);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.build.publish = { provider: 'github', owner, repo: 'ledger', releaseType: 'release' };
pkg.repository = `https://github.com/${owner}/ledger`;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

let hasRemote = true;
try { out('git', ['remote', 'get-url', 'origin']); } catch { hasRemote = false; }
if (!hasRemote) {
  run('git add package.json');
  run(`git commit -m "Publish updates to github.com/${owner}/ledger"`);
  run(`gh repo create ledger --public --source . --remote origin --description "Ledger: college notes, schedule, Canvas/Blackboard + AI"`);
}
run('node scripts/release.mjs patch');
