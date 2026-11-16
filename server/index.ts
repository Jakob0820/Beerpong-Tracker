import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tx } from './db.ts';
import * as t from './tournament.ts';
import type { Settings, ThrowType } from '../shared/types.ts';

const PORT = Number(process.env.PORT ?? 3000);
const ADMIN_PIN = process.env.ADMIN_PIN ?? '1234';
const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');

function lanIp(): string {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address);
  return addresses.find((a) => /^(192\.168|10|172\.(1[6-9]|2\d|3[01]))\./.test(a)) ?? addresses[0] ?? 'localhost';
}
const baseUrl = () => process.env.PUBLIC_URL ?? `http://${lanIp()}:${PORT}`;

const app = Fastify();
const io = new Server(app.server);

// Kennung der ausgelieferten Oberfläche. Ändert sie sich nach einem Neustart, laden offene
// Seiten (Handys an den Tischen, TV) von selbst neu, statt mit der alten Version weiterzulaufen.
const indexFile = resolve(distDir, 'index.html');
const buildId = existsSync(indexFile) ? createHash('sha1').update(readFileSync(indexFile)).digest('hex') : 'dev';

io.on('connection', (socket) => {
  socket.emit('build', buildId);
  socket.emit('state', t.buildState());
});

/** Änderung in einer Transaktion ausführen und den neuen Stand an alle Geräte schicken. */
function mutate(fn: () => void) {
  tx(fn);
  io.emit('state', t.buildState());
  return { ok: true };
}

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof t.AppError) return reply.code(400).send({ error: err.message });
  const status = (err as { statusCode?: number }).statusCode;
  if (status && status < 500) return reply.code(status).send({ error: 'Ungültige Anfrage.' });
  console.error(err);
  return reply.code(500).send({ error: 'Interner Fehler.' });
});

app.addHook('preHandler', async (req, reply) => {
  if (req.url.startsWith('/api/admin') && req.headers['x-admin-pin'] !== ADMIN_PIN) {
    return reply.code(401).send({ error: 'Falsche PIN.' });
  }
});

// ---------- Öffentlich ----------

app.get('/api/state', () => t.buildState());
app.get('/api/info', () => ({ baseUrl: baseUrl() }));

app.get<{ Params: { table: string } }>('/api/qr/:table', async (req, reply) => {
  const table = Number.parseInt(req.params.table, 10);
  if (!Number.isInteger(table) || table < 1) return reply.code(400).send({ error: 'Ungültiger Tisch.' });
  const svg = await QRCode.toString(`${baseUrl()}/t/${table}`, { type: 'svg', margin: 1 });
  return reply.type('image/svg+xml').header('cache-control', 'no-store').send(svg);
});

// ---------- Tisch-Eingabe ----------

type TableParams = { Params: { table: string } };

app.post<TableParams & { Body: { matchId: number; playerId: number; type: ThrowType; bombCups?: number } }>(
  '/api/table/:table/throw',
  (req) =>
    mutate(() =>
      t.addThrow(Number(req.params.table), Number(req.body?.matchId), Number(req.body?.playerId), req.body?.type, req.body?.bombCups),
    ),
);
app.post<TableParams & { Body: { matchId: number } }>('/api/table/:table/undo', (req) =>
  mutate(() => t.undoThrow(Number(req.params.table), Number(req.body?.matchId))),
);
app.post<TableParams & { Body: { matchId: number } }>('/api/table/:table/finish', (req) =>
  mutate(() => t.finishMatchEarly(Number(req.params.table), Number(req.body?.matchId))),
);

app.post<TableParams & { Body: { matchId: number; grant: boolean } }>('/api/table/:table/redemption', (req) =>
  mutate(() => t.decideRedemption(Number(req.params.table), Number(req.body?.matchId), req.body?.grant === true)),
);

// ---------- Admin ----------

app.post('/api/admin/login', () => ({ ok: true }));
app.post<{ Body: { name: string; player1: string; player2: string } }>('/api/admin/teams', (req) =>
  mutate(() => t.addTeam(req.body?.name, req.body?.player1, req.body?.player2)),
);
app.delete<{ Params: { id: string } }>('/api/admin/teams/:id', (req) => mutate(() => t.deleteTeam(Number(req.params.id))));
app.post<{ Body: Partial<Settings> }>('/api/admin/settings', (req) => mutate(() => t.updateSettings(req.body ?? {})));
app.post<{ Body: { groups: number } }>('/api/admin/draw', (req) => mutate(() => t.drawGroups(Number(req.body?.groups))));
app.post('/api/admin/start-groups', () => mutate(() => t.startGroups()));
app.post('/api/admin/start-ko', () => mutate(() => t.startKo()));
app.post('/api/admin/finish', () => mutate(() => t.finishTournament()));
app.post<{ Params: { id: string }; Body: { tableNo: number } }>('/api/admin/matches/:id/start', (req) =>
  mutate(() => t.startMatch(Number(req.params.id), Number(req.body?.tableNo))),
);
app.post<{ Params: { id: string } }>('/api/admin/matches/:id/reopen', (req) =>
  mutate(() => t.reopenMatch(Number(req.params.id))),
);
app.post('/api/admin/demo', () => mutate(() => t.seedDemo()));
app.post<{ Body: { deleteTeams?: boolean } }>('/api/admin/reset', (req) =>
  mutate(() => t.resetTournament(!!req.body?.deleteTeams)),
);

// ---------- Frontend ausliefern ----------

if (existsSync(distDir)) {
  await app.register(fastifyStatic, { root: distDir });
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api')) return reply.code(404).send({ error: 'Nicht gefunden.' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`
🍺 Bierpong Tracker läuft

   TV-Ansicht:  ${baseUrl()}/tv
   Admin:       ${baseUrl()}/admin   (PIN: ${ADMIN_PIN})
   Tische:      ${baseUrl()}/t/1, /t/2, ...
`);
