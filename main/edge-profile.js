'use strict';
// Chromium lets only one Edge instance use a profile folder. Before the AI drives Ledger's
// Edge profile, close leftovers that hold it (a hidden Edge from an earlier run, or Edge
// lingering in the background after the sign-in window was closed). Only processes whose
// command line names Ledger's profile folder are touched — never the user's normal Edge.

const { execFile } = require('child_process');

const PS = `
$ErrorActionPreference = 'SilentlyContinue'
$p = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Select-Object ProcessId, ParentProcessId, CommandLine
$out = foreach ($x in $p) {
  $h = 0
  if ($x.CommandLine -notmatch '--type=') { $h = [int64](Get-Process -Id $x.ProcessId).MainWindowHandle }
  [pscustomobject]@{ pid = $x.ProcessId; ppid = $x.ParentProcessId; cmd = [string]$x.CommandLine; hwnd = $h }
}
@($out) | ConvertTo-Json -Compress
`;

function run(file, args) {
  return new Promise((resolve) => execFile(file, args, { windowsHide: true, timeout: 20000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout)));
}

const norm = (s) => String(s || '').toLowerCase().replace(/\//g, '\\').replace(/\\+$/, '');

async function profileProcesses(profileDir) {
  const raw = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS]);
  let list = [];
  try { list = JSON.parse(raw.trim() || '[]'); } catch { return []; }
  if (!Array.isArray(list)) list = [list];
  const dir = norm(profileDir);
  return list
    .filter((p) => p && p.cmd && norm(p.cmd).includes(dir))
    .map((p) => ({
      pid: p.pid,
      browser: !/--type=/.test(p.cmd),
      automation: /--remote-debugging-pipe|--remote-debugging-port|--enable-automation|--headless/.test(p.cmd),
      hasWindow: Number(p.hwnd) !== 0,
    }));
}

/**
 * Make the profile free for the AI. Throws if a sign-in window the user is looking at is open
 * (unless force). Returns the number of Edge browser processes closed.
 */
async function releaseProfile(profileDir, { force = false } = {}) {
  if (process.platform !== 'win32') return 0;
  const procs = await profileProcesses(profileDir);
  const browsers = procs.filter((p) => p.browser);
  if (!force && browsers.some((p) => p.hasWindow && !p.automation)) {
    const e = new Error('The sign-in window is still open. Close that Edge window, then check again.');
    e.code = 'LOGIN_OPEN';
    throw e;
  }
  const targets = browsers.length ? browsers : procs; // kill the tree from the browser process
  for (const p of targets) await run('taskkill.exe', ['/PID', String(p.pid), '/T', '/F']);
  if (targets.length) await new Promise((r) => setTimeout(r, 1500)); // let Windows release the profile lock
  return browsers.length;
}

module.exports = { profileProcesses, releaseProfile };
