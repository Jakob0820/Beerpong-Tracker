import { io } from 'socket.io-client';
import type { State, ThrowType } from '../../../shared/types.ts';

/** Aktueller Turnierstand; der Server schickt ihn nach jeder Änderung neu. */
export const app = $state<{ state: State | null; connected: boolean }>({ state: null, connected: false });

const socket = io();
socket.on('connect', () => (app.connected = true));
socket.on('disconnect', () => (app.connected = false));
socket.on('state', (state: State) => (app.state = state));

// Meldet der Server nach einem Neustart eine andere Version der Oberfläche, wird die Seite neu geladen.
// Sonst liefe ein offenes Handy mit der alten Version weiter und könnte neue Abfragen nicht anzeigen.
let build: string | null = null;
socket.on('build', (id: string) => {
  if (build !== null && build !== id) location.reload();
  build = id;
});

const PIN_KEY = 'bierpong-admin-pin';
export const pin = {
  get: () => {
    try {
      return localStorage.getItem(PIN_KEY) ?? '';
    } catch {
      return '';
    }
  },
  set: (value: string) => {
    try {
      localStorage.setItem(PIN_KEY, value);
    } catch {
      // ohne localStorage (z.B. privater Modus) gilt die PIN nur bis zum Neuladen
    }
    memoryPin = value;
  },
};
let memoryPin = pin.get();

export async function api<T = { ok: true }>(path: string, body: unknown = {}, method = 'POST'): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-admin-pin': memoryPin },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Etwas ist schiefgelaufen.');
  return data as T;
}

export function teamName(id: number | null): string {
  if (id === null) return '—';
  return app.state?.teams.find((t) => t.id === id)?.name ?? '?';
}

export const THROW_LABEL: Record<ThrowType, string> = {
  hit: 'Treffer',
  bounce: 'Bounce',
  bomb: 'Bombe',
};
