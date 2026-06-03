# Nexus Developer Proxy

Run one Nexus remote locally with hot reload — proxy everything else (host, other remotes, registry) to a shared dev/staging environment.

## Quick start

```bash
# 1. Clone the project
git clone <repo>
cd nexus

# 2. Start work on a specific remote — one command:
npm run dev:remote-one

# 3. Open the browser
# http://localhost:9000   -> proxy (point your browser here)
```

That's it. No Docker, no local registry, no other remotes started locally.

## What happens behind the scenes

`npm run dev:remote-one` does:

1. Sets the `local` section in `nexus.dev.json` to `{ "remoteOne": 8666 }`
2. Starts `ng serve` for remote-one on port 8666 (with hot reload)
3. Starts the proxy server on port 9000

The proxy server routes:

| URL prefix | Destination |
|---|---|
| `/remotes/remoteOne/*` | http://localhost:8666 (local with HMR) |
| `/host/*` | shared env |
| `/remotes/remoteTwo/*` | shared env |
| `/api/*` | shared env (Nexus registry) |
| `/ws` | shared env (Nexus WebSocket broadcast) |
| Everything else | shared env (app shell) |

## Configuration: `nexus.dev.json`

```json
{
  "proxyPort": 9000,
  "local": {
    "remoteOne": 8666
  },
  "remote": {
    "url": "http://localhost:8668"
  },
  "logRouting": true
}
```

| Field | Description |
|---|---|
| `proxyPort` | Port the proxy listens on. Default 9000. |
| `local` | Map of `<remote-name>` -> `<local port>`. All entries here bypass the shared env. |
| `remote.url` | Shared environment URL — usually app's public URL. |
| `logRouting` | True to log each request's destination. |

## Pointing at a shared staging environment

Change `remote.url` to the staging URL:

```json
{
  "remote": { "url": "https://nexus-staging.yourdomain.com" }
}
```

Now you see staging data + your local changes in one browser.

## Hot reload

When you edit code in the locally running remote (e.g. `remote-one/src/...`), the Angular dev server restarts automatically. The proxy server does not need a restart — it does not read the files, only the route configuration.

Changes in other remotes on the shared environment are seen on the next navigation — the host's WebSocket connection to the shared registry's `/ws` receives the broadcast and updates routes without refresh.

## Debugging

The proxy logs each request when `logRouting: true`:

```
[nexus-proxy] GET    /remotes/remoteOne/remoteEntry.json     -> LOCAL remoteOne (http://localhost:8666)
[nexus-proxy] GET    /host/remoteEntry.json                  -> SHARED (http://localhost:8668)
[nexus-proxy] POST   /api/remotes                            -> SHARED (http://localhost:8668)
```

On errors against the shared env, a clear 502 with the error message is returned — the proxy does not crash.

## Add a new `dev:remote-X` script

In the root `package.json`:

```json
"scripts": {
  "dev:remote-three": "node dev-tools/switch-local.mjs remoteThree 8700 && concurrently \"cd remote-three && npm start\" \"npm run dev:proxy\""
}
```
