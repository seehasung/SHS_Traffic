import path from 'node:path';
import fs from 'node:fs';

function getElectronApp() {
  try {
    return require('electron').app;
  } catch {
    return null;
  }
}

export function userDataDir(): string {
  const electronApp = getElectronApp();
  let dir: string;

  if (process.env.DATA_DIR) {
    dir = process.env.DATA_DIR;
  } else if (electronApp?.isReady?.()) {
    dir = electronApp.getPath('userData');
  } else {
    dir = path.join(process.cwd(), '.agent-data');
  }

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return path.join(userDataDir(), 'data.db');
}

export function jwtSecretPath(): string {
  return path.join(userDataDir(), 'jwt.secret');
}

export function staticWebDir(): string {
  if (process.env.AGENT_DEV === '1') {
    return '';
  }

  if (typeof process.resourcesPath === 'string') {
    const packed = path.join(process.resourcesPath, 'web-dist');
    if (fs.existsSync(packed)) return packed;
  }

  const candidate = path.resolve(__dirname, '..', '..', '..', 'web-dist');
  if (fs.existsSync(candidate)) return candidate;

  const rootCandidate = path.resolve(process.cwd(), 'web-dist');
  if (fs.existsSync(rootCandidate)) return rootCandidate;

  return '';
}
