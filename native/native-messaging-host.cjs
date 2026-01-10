const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.VHUB_NATIVE_PORT || 32145);
const ENDPOINT = '/favorites/import';

let buffer = Buffer.alloc(0);

const logFile = path.join(os.tmpdir(), 'private-video-hub-native.log');
const log = (message) => {
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {
    // ignore logging failures
  }
};

log('native host start');

const writeMessage = (message) => {
  const json = JSON.stringify(message);
  const body = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
};

const postToApp = (payload) => new Promise((resolve) => {
  const body = JSON.stringify(payload);
  const req = http.request(
    {
      hostname: HOST,
      port: PORT,
      path: ENDPOINT,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    },
    (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          const parsed = text ? JSON.parse(text) : {};
          resolve({ ok: res.statusCode === 200, response: parsed });
        } catch {
          resolve({ ok: res.statusCode === 200, response: {} });
        }
      });
    }
  );

  req.on('error', (err) => resolve({ ok: false, error: err.message }));
  req.write(body);
  req.end();
});

const handleMessage = async (raw) => {
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    writeMessage({ ok: false, error: 'invalid_json' });
    log('invalid_json');
    return;
  }

  log('received message');
  const result = await postToApp({
    source: 'video-info-extension',
    payload
  });
  if (!result.ok) {
    log(`post failed: ${result.error || 'unknown'}`);
  }
  writeMessage(result.ok ? { ok: true } : { ok: false, error: result.error || 'app_unreachable' });
};

const processBuffer = () => {
  while (buffer.length >= 4) {
    const messageLength = buffer.readUInt32LE(0);
    if (buffer.length < 4 + messageLength) return;
    const message = buffer.slice(4, 4 + messageLength);
    buffer = buffer.slice(4 + messageLength);
    handleMessage(message.toString('utf8'));
  }
};

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  processBuffer();
});

process.stdin.on('end', () => {
  log('stdin end');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  log(`uncaughtException: ${err && err.message ? err.message : String(err)}`);
  process.exit(1);
});
