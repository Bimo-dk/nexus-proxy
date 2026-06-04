import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Socket } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import express, { type Request, type Response, type NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type * as http from 'node:http';

interface DevConfig {
  proxyPort?: number;
  local: Record<string, number | string>;
  remote: {
    url: string;
    registryApiPath?: string;
  };
  logRouting?: boolean;
}

interface RegistryRemote {
  name: string;
  routePath: string;
  upstreamUrl?: string;
}

const CONFIG_PATH = path.resolve(process.cwd(), 'nexus.dev.json');

async function loadConfig(): Promise<DevConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as DevConfig;
    if (!parsed.remote?.url) throw new Error('nexus.dev.json missing "remote.url"');
    if (!parsed.local || typeof parsed.local !== 'object') {
      parsed.local = {};
    }
    parsed.local = Object.fromEntries(
      Object.entries(parsed.local).filter(([k, v]) => !k.startsWith('_') && (typeof v === 'number' || typeof v === 'string') && String(v).length > 0),
    );
    return parsed;
  } catch (err) {
    console.error(`[nexus-proxy] Failed to load ${CONFIG_PATH}:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

function logRoute(label: string, target: string, req: Request): void {
  console.log(`[nexus-proxy] ${req.method.padEnd(6)} ${req.url.padEnd(40)} -> ${label} (${target})`);
}

async function fetchRegistryRemotes(registryBase: string, token?: string): Promise<RegistryRemote[]> {
  const headers: Record<string, string> = {};
  if (token) headers['X-Nexus-Token'] = token;
  try {
    const res = await fetch(`${registryBase}/remotes`, { headers });
    if (!res.ok) return [];
    const data = await res.json() as { remotes?: RegistryRemote[] };
    return Array.isArray(data.remotes) ? data.remotes : [];
  } catch {
    return [];
  }
}

function buildRemoteNames(remotes: RegistryRemote[]): Set<string> {
  return new Set(remotes.map(r => r.name));
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const port = config.proxyPort ?? 9000;
  const verbose = config.logRouting !== false;
  const sharedTarget = config.remote.url.replace(/\/$/, '');
  const registryBase = `${sharedTarget}${config.remote.registryApiPath ?? '/api'}`;

  const app = express();

  // CORS for Angular dev-server
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Nexus-Token, X-Request-ID');
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-ID');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // ----- LOCAL remotes (mounted BEFORE shared remote-catch-all) -----
  for (const [name, portValue] of Object.entries(config.local)) {
    const localPort = Number(portValue);
    const target = `http://localhost:${localPort}`;
    const route = `/remotes/${name}`;
    const proxy = createProxyMiddleware({
      target,
      changeOrigin: true,
      ws: true,
      pathRewrite: { [`^/remotes/${name}`]: '' },
      on: {
        error: (err: Error, _req: IncomingMessage, res: ServerResponse | Socket) => {
          if (verbose) console.error(`[nexus-proxy] LOCAL ${name} unreachable at ${target}: ${err.message}`);
          const httpRes = res as ServerResponse;
          if (httpRes && !httpRes.headersSent && typeof httpRes.writeHead === 'function') {
            httpRes.writeHead(502, { 'Content-Type': 'application/json' });
            httpRes.end(JSON.stringify({
              error: 'local_remote_unreachable',
              remote: name,
              target,
              message: err.message,
            }));
          }
        },
      },
    });
    app.use(route, (req, res, next) => {
      if (verbose) logRoute(`LOCAL ${name}`, target, req);
      proxy(req, res, next);
    });
    console.log(`[nexus-proxy] LOCAL  /remotes/${name}/* -> ${target}`);
  }

  // ----- SHARED environment (everything else) -----
  const sharedProxy = createProxyMiddleware({
    target: sharedTarget,
    changeOrigin: true,
    ws: true,
    on: {
      proxyReq: (proxyReq: http.ClientRequest, req: IncomingMessage) => {
        const incomingToken = req.headers['x-nexus-token'];
        if (incomingToken) proxyReq.setHeader('X-Nexus-Token', String(incomingToken));
        const incomingReqId = req.headers['x-request-id'];
        if (incomingReqId) proxyReq.setHeader('X-Request-ID', String(incomingReqId));
      },
      error: (err: Error, req: IncomingMessage, res: ServerResponse | Socket) => {
        if (verbose) console.error(`[nexus-proxy] SHARED ${sharedTarget} unreachable: ${err.message}`);
        const httpRes = res as ServerResponse;
        if (httpRes && !httpRes.headersSent && typeof httpRes.writeHead === 'function') {
          httpRes.writeHead(502, { 'Content-Type': 'application/json' });
          httpRes.end(JSON.stringify({
            error: 'shared_environment_unreachable',
            target: sharedTarget,
            message: err.message,
            path: req.url,
          }));
        }
      },
    },
  });

  app.use((req, res, next) => {
    if (verbose) logRoute('SHARED', sharedTarget, req);
    sharedProxy(req, res, next);
  });

  // ----- Start listener -----
  const initialRemotes = await fetchRegistryRemotes(registryBase);
  let knownRemoteNames = buildRemoteNames(initialRemotes);

  const server = app.listen(port, () => {
    console.log('');
    console.log(`╭───────────────────────────────────────────────────────────`);
    console.log(`│  Nexus Dev Proxy                                         `);
    console.log(`├───────────────────────────────────────────────────────────`);
    console.log(`│  Listening:  http://localhost:${port}`);
    console.log(`│  Shared:     ${sharedTarget}`);
    console.log(`│  Registry:   ${registryBase}`);
    console.log(`│  Local:      ${Object.keys(config.local).length === 0 ? '(none — all proxied to shared)' : ''}`);
    for (const [name, p] of Object.entries(config.local)) {
      console.log(`│    /remotes/${name}/* -> http://localhost:${p}`);
    }
    if (initialRemotes.length > 0) {
      console.log(`│  Registry remotes:`);
      const localNames = new Set(Object.keys(config.local));
      for (const r of initialRemotes) {
        const overridden = localNames.has(r.name) ? ' (overridden locally)' : '';
        console.log(`│    ${r.name}${overridden}`);
      }
    } else {
      console.log(`│  Registry:   (no remotes registered or registry unreachable)`);
    }
    console.log(`╰───────────────────────────────────────────────────────────`);
    console.log('');
  });

  // Poll registry for new remotes and log them for developer awareness
  setInterval(async () => {
    const remotes = await fetchRegistryRemotes(registryBase);
    const currentNames = buildRemoteNames(remotes);
    const localNames = new Set(Object.keys(config.local));

    for (const name of currentNames) {
      if (!knownRemoteNames.has(name)) {
        const override = localNames.has(name) ? ' (overridden locally)' : ' — add to local block to develop locally';
        console.log(`[nexus-proxy] New remote registered: ${name}${override}`);
      }
    }

    knownRemoteNames = currentNames;
  }, 15_000);

  // Hot reload for WebSocket connections
  server.on('upgrade', (req, socket, head) => {
    sharedProxy.upgrade?.(req, socket as Socket, head);
  });
}

main().catch((err) => {
  console.error('[nexus-proxy] FAILED:', err);
  process.exit(1);
});
