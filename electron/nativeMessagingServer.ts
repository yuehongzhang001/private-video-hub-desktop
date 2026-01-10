import * as http from 'http';

const DEFAULT_NATIVE_MESSAGING_PORT = 32145;
const MAX_BODY_SIZE = 1024 * 512;

type NativeMessageHandler = (payload: unknown) => void;

const readJsonBody = (req: http.IncomingMessage) => new Promise<{ ok: true; data: unknown } | { ok: false; error: string }>((resolve) => {
  let total = 0;
  const chunks: Buffer[] = [];

  req.on('data', (chunk: Buffer) => {
    total += chunk.length;
    if (total > MAX_BODY_SIZE) {
      resolve({ ok: false, error: 'payload_too_large' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) {
      resolve({ ok: false, error: 'empty_body' });
      return;
    }
    try {
      resolve({ ok: true, data: JSON.parse(raw) });
    } catch {
      resolve({ ok: false, error: 'invalid_json' });
    }
  });

  req.on('error', () => resolve({ ok: false, error: 'read_error' }));
});

export const startNativeFavoritesServer = (handler: NativeMessageHandler, port = DEFAULT_NATIVE_MESSAGING_PORT) => {
  const server = http.createServer(async (req, res) => {
    if (!req.url || req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
      return;
    }

    if (req.url !== '/favorites/import') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not_found' }));
      return;
    }

    const result = await readJsonBody(req);
    if (!result.ok) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: result.error }));
      return;
    }

    handler(result.data);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  server.listen(port, '127.0.0.1');
  return {
    port,
    close: () => server.close()
  };
};

export { DEFAULT_NATIVE_MESSAGING_PORT };
