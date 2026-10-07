// Find the local runtimes the settings page can offer. OpenAI servers the user
// named are stored separately; this only reports what is installed or listening.

import { access } from 'fs/promises';
import { constants } from 'fs';
import { execFile } from 'child_process';
import http from 'http';
import os from 'os';
import path from 'path';
import { OLLAMA_URL, LMSTUDIO_URL } from './runtimes.mjs';

const DETECTED_HTTP = [
  { id: 'ollama', name: 'Ollama', baseUrl: OLLAMA_URL },
  { id: 'lmstudio', name: 'LM Studio', baseUrl: LMSTUDIO_URL },
];

function candidateBins(name) {
  const home = os.homedir();
  return [
    path.join(home, '.local', 'bin', name),
    path.join('/usr/local/bin', name),
    path.join('/opt/homebrew/bin', name),
  ];
}

async function findBin(name) {
  for (const bin of candidateBins(name)) {
    try {
      await access(bin, constants.X_OK);
      return bin;
    } catch {
      /* try the next location */
    }
  }
  return new Promise((resolve) => {
    execFile('which', [name], { timeout: 1500 }, (err, stdout) => {
      if (err) return resolve(null);
      const found = String(stdout || '')
        .trim()
        .split('\n')[0];
      resolve(found || null);
    });
  });
}

export function probeModels(baseUrl, timeoutMs = 700) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    let urlp;
    try {
      urlp = new URL(String(baseUrl).replace(/\/$/, '') + '/models');
    } catch {
      return finish(false);
    }
    const req = http.get(
      {
        hostname: urlp.hostname,
        port: urlp.port || 80,
        path: urlp.pathname + urlp.search,
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        finish(res.statusCode === 200);
      }
    );
    req.on('timeout', () => {
      req.destroy();
      finish(false);
    });
    req.on('error', () => finish(false));
  });
}

export async function detectRuntimes() {
  const [ollamaUp, lmUp, claudeBin, cursorBin] = await Promise.all([
    probeModels(OLLAMA_URL),
    probeModels(LMSTUDIO_URL),
    findBin('claude'),
    findBin('cursor-agent'),
  ]);
  const found = [];
  if (claudeBin)
    found.push({
      id: 'claude',
      name: 'Claude',
      kind: 'claude',
      detected: true,
      available: true,
      bin: claudeBin,
    });
  if (cursorBin)
    found.push({
      id: 'cursor',
      name: 'Cursor',
      kind: 'cursor',
      detected: true,
      available: true,
      bin: cursorBin,
    });
  const httpUp = { ollama: ollamaUp, lmstudio: lmUp };
  for (const entry of DETECTED_HTTP) {
    if (!httpUp[entry.id]) continue;
    found.push({
      id: entry.id,
      name: entry.name,
      kind: 'openai',
      detected: true,
      available: true,
      baseUrl: entry.baseUrl,
      accessToken: '',
    });
  }
  return found;
}
