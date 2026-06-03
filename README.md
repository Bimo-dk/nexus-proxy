# Nexus Developer Proxy

Kør én Nexus remote lokalt med hot reload — proxy alt andet (host, andre remotes, registry) til shared dev/staging-miljø.

## Quick start

```bash
# 1. Klon projektet
git clone <repo>
cd nexus

# 2. Start arbejdet på en specifik remote — én kommando:
npm run dev:remote-one

# 3. Åbn browseren
# http://localhost:9000   ← proxy (peg din browser hertil)
```

Det er det. Ingen Docker, ingen lokal registry, ingen andre remotes startes lokalt.

## Hvad sker der bag kulisserne

`npm run dev:remote-one` gør:

1. Skifter `local` sektionen i `nexus.dev.json` til `{ "remoteOne": 8666 }`
2. Starter `ng serve` for remote-one på port 8666 (med hot reload)
3. Starter proxy-serveren på port 9000

Proxy-serveren router:

| URL-prefix | Destination |
|---|---|
| `/remotes/remoteOne/*` | http://localhost:8666 (lokal med HMR) |
| `/host/*` | shared env |
| `/remotes/remoteTwo/*` | shared env |
| `/api/*` | shared env (Nexus registry) |
| `/ws` | shared env (Nexus WebSocket broadcast) |
| Alt andet | shared env (app shell) |

## Konfiguration: `nexus.dev.json`

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

| Felt | Beskrivelse |
|---|---|
| `proxyPort` | Port hvor proxyen lytter. Default 9000. |
| `local` | Map af `<remote-navn>` → `<lokal port>`. Alle her bypasses shared env. |
| `remote.url` | Shared environment URL — som regel app's offentlige URL. |
| `logRouting` | True for at logge hvert request's destination. |

## Pege mod et delt staging-miljø

Skift `remote.url` til staging-URL'en:

```json
{
  "remote": { "url": "https://nexus-staging.dintid.dk" }
}
```

Nu ser du staging-data + dine lokale ændringer i én browser.

## Hot reload

Når du redigerer kode i den lokalt-kørende remote (fx `remote-one/src/...`), genstarter Angular dev-serveren automatisk. Proxy-serveren behøver ikke restart — den læser ikke filerne, kun route-konfigurationen.

Ændringer i andre remotes på det delte miljø ses ved næste navigation — host's WebSocket-forbindelse til shared registry's `/ws` modtager broadcast og opdaterer routes uden refresh.

## Debugging

Proxyen logger hver request hvis `logRouting: true`:

```
[nexus-proxy] GET    /remotes/remoteOne/remoteEntry.json     → LOCAL remoteOne (http://localhost:8666)
[nexus-proxy] GET    /host/remoteEntry.json                  → SHARED (http://localhost:8668)
[nexus-proxy] POST   /api/remotes                            → SHARED (http://localhost:8668)
```

Ved fejl mod shared env returneres en tydelig 502 med fejlbeskeden — proxyen crasher ikke.

## Tilføj en ny `dev:remote-X` script

I rod-`package.json`:

```json
"scripts": {
  "dev:remote-three": "node dev-tools/switch-local.mjs remoteThree 8700 && concurrently \"cd remote-three && npm start\" \"npm run dev:proxy\""
}
```
