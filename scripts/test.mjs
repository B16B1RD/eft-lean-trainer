import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const profile = await mkdtemp(join(tmpdir(), 'eft-chrome-'));
const page = pathToFileURL(fileURLToPath(new URL('../index.html', import.meta.url))).href;
const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, page,
], { stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; }
    catch { if (chrome.exitCode !== null) throw new Error(`Chrome exited: ${chrome.exitCode}`); await delay(100); }
  }
  if (!port) throw new Error('Chrome did not start DevTools');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find(t => t.type === 'page' && t.url === page);
  if (!target) throw new Error(`Page target missing: ${JSON.stringify(targets)}`);
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') console.error('Browser exception:', JSON.stringify(msg.params.exceptionDetails));
    if (msg.method === 'Runtime.consoleAPICalled') {
      const line = msg.params.args.map(a => a.value ?? a.description).join(' ');
      if (line.includes('[FAIL]')) console.error(line);
    }
  };
  const send = (method, params = {}) => new Promise(resolve => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable');
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Self-tests timed out')), 60000);
  });
  let result;
  try {
    result = await Promise.race([
      send('Runtime.evaluate', { expression: 'window.EFTTrainer.runTests()', awaitPromise: true, returnByValue: true }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
  if (result.error || result.result?.exceptionDetails) throw new Error(JSON.stringify(result));
  const value = result.result.result.value;
  for (const [name, item] of Object.entries(value)) {
    if (item && typeof item === 'object' && 'total' in item) console.log(`${name}: ${item.passed}/${item.total}`);
  }
  console.log(`TOTAL: ${value.totalPassed}/${value.totalTests}`);
  if (value.totalPassed !== value.totalTests || value.audioResumeResults.total === 0) process.exitCode = 1;
} finally {
  ws?.close();
  chrome.kill();
  await new Promise(resolve => { if (chrome.exitCode !== null) resolve(); else chrome.once('exit', resolve); });
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
