#!/usr/bin/env node
// Lille helper: opdater nexus.dev.json's 'local' sektion til kun at indeholde
// remoten + porten der er givet som argumenter.
//
// Brug:  node dev-tools/switch-local.mjs <remoteName> <port>

import { promises as fs } from 'node:fs';
import path from 'node:path';

const [, , remoteName, portArg] = process.argv;
if (!remoteName || !portArg) {
  console.error('Usage: node dev-tools/switch-local.mjs <remoteName> <port>');
  process.exit(1);
}
const port = Number(portArg);
if (!Number.isFinite(port) || port < 1 || port > 65535) {
  console.error(`Invalid port: ${portArg}`);
  process.exit(1);
}

const configPath = path.resolve('nexus.dev.json');
const raw = await fs.readFile(configPath, 'utf8');
const config = JSON.parse(raw);

const previous = Object.entries(config.local ?? {})
  .filter(([k]) => !k.startsWith('_'))
  .map(([k, v]) => `${k}=${v}`)
  .join(', ');

config.local = { [remoteName]: port };
await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

console.log(`[switch-local] Set local=${remoteName}:${port}${previous ? ` (replaced: ${previous})` : ''}`);
