'use strict';
// Runs the Claude Code CLI or the Codex CLI headlessly. Both use the account you
// are already logged into (your subscription), never an API key: we strip API key
// variables from the child environment so the CLIs can't fall back to API billing.
//
// When `browser` is set, the CLI also gets a Playwright MCP server driving Microsoft
// Edge with Ledger's own profile (where you signed in to Canvas/Blackboard).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { releaseProfile } = require('./edge-profile');

function versionKey(name) {
  return name.split(/[^0-9]+/).filter(Boolean).map((n) => n.padStart(6, '0')).join('.');
}

function newestIn(dir, pick) {
  // Return newest match among child folders of `dir` (version folders change on update).
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    const found = [];
    for (const e of entries) {
      const p = pick(path.join(dir, e.name));
      if (p) found.push({ p, key: versionKey(e.name), mtime: fs.statSync(p).mtimeMs });
    }
    found.sort((a, b) => b.key.localeCompare(a.key) || b.mtime - a.mtime);
    return found[0] ? found[0].p : '';
  } catch {
    return '';
  }
}

function where(cmd) {
  try {
    const out = execFileSync('where', [cmd], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split(/\r?\n/).map((s) => s.trim()).find((s) => /\.(exe|cmd)$/i.test(s)) || '';
  } catch {
    return '';
  }
}

const exists = (p) => p && fs.existsSync(p);

function findClaude(override) {
  if (exists(override)) return override;
  const appData = process.env.APPDATA || '';
  const local = process.env.LOCALAPPDATA || '';
  const inVersionDir = (base) => newestIn(base, (vdir) => newestIn(vdir, (hdir) => (exists(path.join(hdir, 'claude.exe')) ? path.join(hdir, 'claude.exe') : '')));
  const candidates = [
    where('claude'),
    path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
    inVersionDir(path.join(appData, 'Claude', 'claude-code')),
  ];
  try {
    for (const pkg of fs.readdirSync(path.join(local, 'Packages')).filter((n) => n.startsWith('Claude_'))) {
      candidates.push(inVersionDir(path.join(local, 'Packages', pkg, 'LocalCache', 'Roaming', 'Claude', 'claude-code')));
    }
  } catch {}
  candidates.push(path.join(appData, 'npm', 'claude.cmd'));
  return candidates.find(exists) || '';
}

function findCodex(override) {
  if (exists(override)) return override;
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    where('codex'),
    newestIn(path.join(local, 'OpenAI', 'Codex', 'bin'), (d) => (exists(path.join(d, 'codex.exe')) ? path.join(d, 'codex.exe') : '')),
    path.join(process.env.APPDATA || '', 'npm', 'codex.cmd'),
  ];
  return candidates.find(exists) || '';
}

function findEdge() {
  const c = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  return c.find(exists) || '';
}

function detect(settings) {
  const claude = findClaude(settings.ai.claudePath);
  const codex = findCodex(settings.ai.codexPath);
  return { claude, codex, edge: findEdge() };
}

function childEnv() {
  const env = { ...process.env };
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'ELECTRON_RUN_AS_NODE']) delete env[k];
  return env;
}

// Where the Playwright MCP server lives. In the packaged app it is unpacked from the asar.
function playwrightCli() {
  // cli.js isn't in the package's "exports", so locate it next to package.json.
  const p = path.join(path.dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js');
  return p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

function browserServer({ profileDir, headless, outputDir }) {
  const args = [playwrightCli(), '--browser', 'msedge', '--user-data-dir', profileDir, '--output-dir', outputDir, '--viewport-size', '1400,1000'];
  if (headless) args.push('--headless');
  // Electron's own binary doubles as Node.js, so no separate Node install is needed.
  return { command: process.execPath, args, env: { ELECTRON_RUN_AS_NODE: '1' } };
}

const tomlStr = (s) => `'${String(s).replace(/'/g, '')}'`;

// The Windows sandbox mode from the user's Codex config ([windows] sandbox = "elevated"), carried
// over explicitly because --ignore-user-config would otherwise drop it.
function codexWindowsSandbox() {
  try {
    const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const toml = fs.readFileSync(path.join(home, 'config.toml'), 'utf8');
    const m = /^\[windows\][^[]*?^\s*sandbox\s*=\s*"([a-z]+)"/m.exec(toml);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

// `codex exec` arguments. The -c values below each go before the trailing "-" (prompt on stdin).
function codexArgs({ cwd, outFile, server }) {
  // --ignore-user-config keeps the Codex app's own browser / computer-use plugins out of the run
  // (they need interactive approval and fail headless). Login still comes from CODEX_HOME.
  const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '-s', 'read-only', '--color', 'never', '-C', cwd, '-o', outFile, ...codexConfigArgs(server)];
  args.push('-');
  return args;
}

// TOML values use single-quoted literals: Windows argument quoting can strip double quotes.
function codexConfigArgs(server) {
  const out = ['-c', "approval_policy='never'"];
  const winSandbox = codexWindowsSandbox();
  if (winSandbox) out.push('-c', `windows.sandbox='${winSandbox}'`);
  if (server) {
    out.push(
      '-c', `mcp_servers.playwright.command=${tomlStr(server.command)}`,
      '-c', `mcp_servers.playwright.args=[${server.args.map(tomlStr).join(',')}]`,
      '-c', `mcp_servers.playwright.env={${Object.entries(server.env).map(([k, v]) => `${k}=${tomlStr(v)}`).join(',')}}`,
      '-c', 'mcp_servers.playwright.startup_timeout_sec=60',
      '-c', 'mcp_servers.playwright.tool_timeout_sec=180',
      // No one is there to click "approve" in a headless run, so pre-approve this one server.
      '-c', "mcp_servers.playwright.default_tools_approval_mode='approve'",
    );
  }
  return out;
}

let browserBusy = null; // only one AI run may drive the browser profile at a time

/**
 * Run a prompt. Returns { promise, cancel }.
 * opts: { provider, settings, cwd, browser: {profileDir, headless} | null, onLog(text), timeoutMs }
 */
function run(prompt, opts) {
  const { provider, settings, cwd, onLog = () => {}, timeoutMs = 15 * 60 * 1000 } = opts;
  let child = null;
  let cancelled = false;
  let releaseBrowser = null;
  let tmp = null;

  const promise = (async () => {
    if (opts.browser) {
      while (browserBusy) {
        onLog('Waiting for another AI browser task to finish…\n');
        await browserBusy.catch(() => {});
      }
      browserBusy = new Promise((r) => (releaseBrowser = r));
    }
    try {
      // Free Ledger's Edge profile (leftover hidden/background Edge). Throws if the sign-in window is open.
      if (opts.browser) {
        const closed = await releaseProfile(opts.browser.profileDir);
        if (closed) onLog(`Closed ${closed} leftover Edge instance(s) holding Ledger's profile.\n`);
      }
      const det = detect(settings);
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-ai-'));
      let exe, args, outFile = null;
      const server = opts.browser ? browserServer({ ...opts.browser, outputDir: path.join(tmp, 'browser') }) : null;

      if (provider === 'codex') {
        exe = det.codex;
        if (!exe) throw new Error('Codex CLI not found. Install the Codex app or set its path in Settings.');
        outFile = path.join(tmp, 'answer.txt');
        args = codexArgs({ cwd, outFile, server });
      } else {
        exe = det.claude;
        if (!exe) throw new Error('Claude Code CLI not found. Install Claude Code or set its path in Settings.');
        args = ['-p', '--output-format', 'text'];
        const allowed = ['Read', 'Glob', 'Grep'];
        if (server) {
          const cfg = path.join(tmp, 'mcp.json');
          fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { playwright: server } }));
          args.push('--mcp-config', cfg, '--strict-mcp-config');
          allowed.push('mcp__playwright');
        } else {
          args.push('--strict-mcp-config');
        }
        args.push('--allowedTools', allowed.join(','));
      }

      onLog(`Running ${provider === 'codex' ? 'Codex' : 'Claude'}${server ? ' with browser access' : ''}…\n`);
      const text = await new Promise((resolve, reject) => {
        child = spawn(exe, args, { cwd, env: childEnv(), windowsHide: true, shell: /\.cmd$/i.test(exe) });
        let out = '';
        let err = '';
        const timer = setTimeout(() => { child.kill(); reject(new Error('Timed out')); }, timeoutMs);
        child.stdout.on('data', (d) => { const s = d.toString(); out += s; onLog(s); });
        child.stderr.on('data', (d) => { const s = d.toString(); err += s; onLog(s); });
        child.on('error', (e) => { clearTimeout(timer); reject(e); });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (cancelled) return reject(new Error('Cancelled'));
          let answer = out;
          if (outFile && fs.existsSync(outFile)) answer = fs.readFileSync(outFile, 'utf8');
          if (code !== 0 && !answer.trim()) return reject(new Error((err || out || `Exited with code ${code}`).trim().slice(-800)));
          resolve(answer.trim());
        });
        child.stdin.end(prompt);
      });
      return text;
    } finally {
      // Don't leave a hidden Edge holding the profile for the next run, or temp files behind.
      if (opts.browser) await releaseProfile(opts.browser.profileDir).catch(() => {});
      if (tmp) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      if (releaseBrowser) { browserBusy = null; releaseBrowser(); }
    }
  })();

  return {
    promise,
    cancel() { cancelled = true; if (child) child.kill(); },
  };
}

// Pull the JSON object out of a model reply (tolerates ```json fences and chatter).
function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[{[]/);
  if (start < 0) throw new Error('The AI did not return JSON.');
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  const end = body.lastIndexOf(close);
  return JSON.parse(body.slice(start, end + 1));
}

module.exports = { detect, run, extractJson, findEdge, codexArgs, codexConfigArgs, browserServer };
