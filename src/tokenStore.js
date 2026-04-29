import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.resolve('data');
const TOKEN_FILE = path.join(DATA_DIR, 'token-store.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(TOKEN_FILE)) {
    fs.writeFileSync(
      TOKEN_FILE,
      JSON.stringify(
        {
          userToken: null,
          tokenType: null,
          expiresAt: null,
          updatedAt: null,
          meta: {}
        },
        null,
        2
      ),
      'utf8'
    );
  }
}

export function readTokenStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch {
    return {
      userToken: null,
      tokenType: null,
      expiresAt: null,
      updatedAt: null,
      meta: {}
    };
  }
}

export function writeTokenStore(next) {
  ensureStore();
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function saveUserToken({
  userToken,
  tokenType = 'user',
  expiresIn = null,
  meta = {}
}) {
  const now = Date.now();
  const expiresAt =
    typeof expiresIn === 'number' && Number.isFinite(expiresIn)
      ? new Date(now + expiresIn * 1000).toISOString()
      : null;

  return writeTokenStore({
    userToken,
    tokenType,
    expiresAt,
    updatedAt: new Date(now).toISOString(),
    meta
  });
}

export function getStoredUserToken() {
  const store = readTokenStore();
  return store?.userToken || null;
}

export function clearStoredUserToken() {
  return writeTokenStore({
    userToken: null,
    tokenType: null,
    expiresAt: null,
    updatedAt: new Date().toISOString(),
    meta: {}
  });
}