<script lang="ts">
  import { api, app, pin, teamName } from '../lib/store.svelte.ts';
  import type { Settings } from '../../../shared/types.ts';
  import { Beer, CircleAlert, FlaskConical, LogIn, Play, Plus, Printer, QrCode, Radio, RotateCcw, Settings2, Shuffle, Swords, Trash2, Trophy, Users, X } from '@lucide/svelte';

  const s = $derived(app.state);

  let authed = $state(false);
  let pinInput = $state(pin.get());
  let error = $state('');
  let busy = $state(false);
  let baseUrl = $state('');

  let teamForm = $state({ name: '', player1: '', player2: '' });
  let groupCount = $state(1);
  let startTable = $state<Record<number, number>>({});

  async function act(fn: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await fn();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function login() {
    pin.set(pinInput);
    await act(async () => {
      await api('/admin/login');
      authed = true;
      baseUrl = (await api<{ baseUrl: string }>('/info', undefined, 'GET')).baseUrl;
    });
  }
  if (pin.get()) void login();

  const addTeam = () =>
    act(async () => {
      await api('/admin/teams', teamForm);
      teamForm = { name: '', player1: '', player2: '' };
    });

  const setSetting = (patch: Partial<Settings>) => act(() => api('/admin/settings', patch));

  function reset(deleteTeams: boolean) {
    const question = deleteTeams
      ? 'Wirklich ALLES löschen, auch Teams und Spieler?'
      : 'Alle Spiele und Treffer löschen? Die Teams bleiben erhalten.';
    if (confirm(question)) void act(() => api('/admin/reset', { deleteTeams }));
  }

  const multiGroup = $derived((s?.groups.length ?? 0) > 1);
  const phaseLabel = $derived(
    !s ? '' : { setup: 'Vorbereitung', group: multiGroup ? 'Gruppenphase' : 'Jeder gegen jeden', ko: 'K.O.-Runde', done: 'Beendet' }[s.phase],
  );

  // Ohne Gruppen: alle Teams kommen in eine gemeinsame Tabelle, der Spielplan ist jeder gegen jeden.
  const startLeague = () =>
    act(async () => {
      await api('/admin/draw', { groups: 1 });
      await api('/admin/start-groups');
    });

  function finishWithoutKo() {
    if (confirm('Turnier ohne K.O.-Runde beenden? Der Tabellenerste ist dann Turniersieger.')) void act(() => api('/admin/finish'));
  }
  const STATUS_LABEL = { pending: 'wartet', live: 'läuft', done: 'beendet' };
  const openGroupMatches = $derived(s?.matches.filter((m) => m.phase === 'group' && m.status !== 'done').length ?? 0);
  const drawn = $derived(!!s && s.teams.length > 0 && s.teams.every((t) => t.group));
  const tables = $derived(Array.from({ length: s?.settings.tables ?? 0 }, (_, i) => i + 1));

  const numberSettings: { key: Exclude<keyof Settings, 'autoAssign'>; label: string; setupOnly?: boolean }[] = [
    { key: 'tables', label: 'Anzahl Tische' },
    { key: 'cupsToWin', label: 'Becher pro Spiel', setupOnly: true },
    { key: 'advancePerGroup', label: 'K.O.-Plätze pro Gruppe' },
    { key: 'cupsBounce', label: 'Becher für Bounce' },
  ];

  const card = 'panel print:hidden';
  const input = 'field';
  const primary = 'btn btn-gold';
  const secondary = 'btn btn-ghost';
  const heading = 'flex items-center gap-2.5 font-display text-2xl leading-none font-extrabold';
</script>

<main class="mx-auto flex max-w-3xl flex-col gap-5 px-4 pt-6 pb-16 sm:px-6">
  <header class="flex items-center gap-3 print:hidden">
    <span class="flex size-11 items-center justify-center rounded-xl bg-gold text-ink"><Beer size={24} strokeWidth={2.25} /></span>
    <h1 class="font-display text-4xl leading-none font-black">Turnierleitung</h1>
  </header>

  {#if error}
    <button class="alert print:hidden" onclick={() => (error = '')}>
      <CircleAlert class="mt-0.5 shrink-0 text-cup" size={20} />
      <span class="min-w-0 flex-1">{error}</span>
      <X class="mt-0.5 shrink-0 text-haze" size={18} />
    </button>
  {/if}

  {#if !authed}
    <form class={card} onsubmit={(e) => { e.preventDefault(); void login(); }}>
      <label class="mb-2 block font-bold" for="pin">Admin-PIN</label>
      <div class="flex gap-3">
        <input id="pin" class={input} type="password" inputmode="numeric" autocomplete="off" bind:value={pinInput} />
        <button class="{primary} shrink-0" disabled={busy}><LogIn size={18} />Anmelden</button>
      </div>
    </form>
  {:else if !s}
    <p class="text-haze">Lade …</p>
  {:else}
    <section class={card}>
      <div class="mb-4 flex items-center justify-between gap-3">
        <h2 class={heading}><Trophy class="text-gold" size={22} />Turnier</h2>
        <span class="rounded-full bg-gold px-3 py-1 text-sm font-bold text-ink">{phaseLabel}</span>
      </div>

      {#if s.phase === 'setup'}
        <div class="flex flex-wrap items-end gap-3">
          <label class="text-sm">
            <span class="mb-1.5 block text-haze">Gruppen</span>
            <input class="{input} w-24" type="number" min="1" max="8" bind:value={groupCount} />
          </label>
          {#if groupCount > 1}
            <button class={secondary} disabled={busy || s.teams.length < 2} onclick={() => act(() => api('/admin/draw', { groups: groupCount }))}>
              <Shuffle size={18} />{drawn ? 'Neu auslosen' : 'Gruppen auslosen'}
            </button>
            <button class={primary} disabled={busy || !drawn} onclick={() => act(() => api('/admin/start-groups'))}>
              <Play size={18} />Turnier starten
            </button>
          {:else}
            <button class={primary} disabled={busy || s.teams.length < 2} onclick={startLeague}><Play size={18} />Turnier starten</button>
          {/if}
        </div>
        <p class="mt-3 max-w-prose text-sm leading-relaxed text-haze">
          {s.teams.length} Teams angelegt.
          {groupCount > 1
            ? 'Erst auslosen, dann starten. In jeder Gruppe spielt jeder gegen jeden.'
            : 'Mit 1 Gruppe spielt jedes Team gegen jedes andere.'}
          Die nächsten Spiele starten immer erst, wenn alle Tische fertig sind.
        </p>
      {:else if s.phase === 'group'}
        <div class="flex flex-wrap gap-3">
          <button class={primary} disabled={busy || openGroupMatches > 0} onclick={finishWithoutKo}><Trophy size={18} />Turnier beenden</button>
          <button class={secondary} disabled={busy || openGroupMatches > 0} onclick={() => act(() => api('/admin/start-ko'))}>
            <Swords size={18} />K.O.-Runde starten
          </button>
        </div>
        <p class="mt-3 max-w-prose text-sm leading-relaxed text-haze">
          {openGroupMatches > 0
            ? `Noch ${openGroupMatches} Spiele offen.`
            : `Alle Spiele sind beendet. Entweder das Turnier beenden (der Tabellenerste gewinnt) oder eine K.O.-Runde mit den besten ${s.settings.advancePerGroup}${multiGroup ? ' jeder Gruppe' : ''} starten.`}
        </p>
      {:else if s.phase === 'ko'}
        <p class="text-haze">Die K.O.-Runde läuft.</p>
      {:else}
        <p class="flex items-center gap-3 font-display text-3xl leading-none font-extrabold text-gold">
          <Trophy size={28} />Sieger: {teamName(s.champion)}
        </p>
      {/if}
    </section>

    <section class={card}>
      <h2 class="{heading} mb-4"><Settings2 class="text-gold" size={22} />Einstellungen</h2>
      <div class="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
        {#each numberSettings as item (item.key)}
          <label class="flex flex-col justify-end text-sm">
            <span class="mb-1.5 block text-haze">{item.label}</span>
            <input
              class={input}
              type="number"
              min="1"
              value={s.settings[item.key]}
              disabled={busy || (item.setupOnly && s.phase !== 'setup')}
              onchange={(e) => setSetting({ [item.key]: Number(e.currentTarget.value) })}
            />
          </label>
        {/each}
      </div>
      <label class="mt-4 flex items-center gap-3">
        <input type="checkbox" class="size-5 shrink-0 accent-gold" checked={s.settings.autoAssign} onchange={(e) => setSetting({ autoAssign: e.currentTarget.checked })} />
        Nächste Spiele automatisch starten, sobald alle Tische fertig sind (zufällige Tische)
      </label>
    </section>

    <section class={card}>
      <h2 class="{heading} mb-4">
        <Users class="text-gold" size={22} />Teams
        <span class="rounded-full bg-felt-2 px-2.5 py-0.5 font-body text-sm font-bold text-haze">{s.teams.length}</span>
      </h2>
      {#if s.phase === 'setup'}
        <form class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]" onsubmit={(e) => { e.preventDefault(); void addTeam(); }}>
          <input class={input} placeholder="Teamname" bind:value={teamForm.name} />
          <input class={input} placeholder="Spieler 1" bind:value={teamForm.player1} />
          <input class={input} placeholder="Spieler 2" bind:value={teamForm.player2} />
          <button class={primary} disabled={busy}><Plus size={18} />Hinzufügen</button>
        </form>
      {/if}
      <ul class="divide-y divide-line">
        {#each s.teams as team (team.id)}
          <li class="flex items-center gap-3 py-2.5">
            {#if team.group}
              <span class="flex size-7 shrink-0 items-center justify-center rounded-md bg-gold/15 font-display text-lg font-extrabold text-gold">{team.group}</span>
            {/if}
            <span class="min-w-0 flex-1 truncate">
              <b>{team.name}</b>
              <span class="ml-2 text-sm text-haze">{team.players.map((p) => p.name).join(' & ')}</span>
            </span>
            {#if s.phase === 'setup'}
              <button
                class="flex size-9 shrink-0 items-center justify-center rounded-lg text-cup hover:bg-cup/15"
                disabled={busy}
                aria-label="{team.name} löschen"
                onclick={() => act(() => api(`/admin/teams/${team.id}`, {}, 'DELETE'))}
              >
                <X size={18} />
              </button>
            {/if}
          </li>
        {:else}
          <li class="py-2.5 text-haze">Noch keine Teams.</li>
        {/each}
      </ul>
      {#if s.phase === 'setup' && s.teams.length === 0}
        <button class="{secondary} mt-3" disabled={busy} onclick={() => act(() => api('/admin/demo'))}><FlaskConical size={18} />8 Demo-Teams anlegen</button>
      {/if}
    </section>

    {#if s.matches.length > 0}
      <section class={card}>
        <h2 class="{heading} mb-3"><Swords class="text-gold" size={22} />Spiele</h2>
        <ul class="divide-y divide-line text-sm">
          {#each s.matches.filter((m) => !m.isBye) as m (m.id)}
            <li class="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              <span class="w-24 shrink-0 text-haze">{m.label}</span>
              <span class="min-w-0 flex-1 basis-48">
                <b class={m.winnerTeamId !== null && m.winnerTeamId === m.teamAId ? 'text-gold' : ''}>{teamName(m.teamAId)}</b>
                <span class="mx-1.5 font-display text-lg font-extrabold tabular-nums">{m.scoreA}:{m.scoreB}</span>
                <b class={m.winnerTeamId !== null && m.winnerTeamId === m.teamBId ? 'text-gold' : ''}>{teamName(m.teamBId)}</b>
              </span>
              <span class="flex items-center gap-1.5 {m.status === 'live' ? 'font-bold text-mint' : 'text-haze'}">
                {#if m.status === 'live'}<Radio size={16} />{/if}
                {STATUS_LABEL[m.status]}{m.status === 'live' ? `, Tisch ${m.tableNo}` : ''}{m.status === 'live' && m.stage === 'redemption' ? ', Redemption' : m.status === 'live' && (m.stage === 'sudden' || m.stage === 'confirm') ? ', Sudden Death' : ''}
              </span>
              {#if m.status === 'pending' && m.teamAId !== null && m.teamBId !== null}
                <span class="flex gap-2">
                  <select class="h-9 rounded-[0.625rem] border border-line bg-pitch px-2" bind:value={() => startTable[m.id] ?? 1, (v) => (startTable[m.id] = v)}>
                    {#each tables as n (n)}<option value={n}>Tisch {n}</option>{/each}
                  </select>
                  <button class="btn btn-ghost btn-sm" disabled={busy} onclick={() => act(() => api(`/admin/matches/${m.id}/start`, { tableNo: startTable[m.id] ?? 1 }))}><Play size={15} />Start</button>
                </span>
              {:else if m.status === 'done'}
                <button
                  class="btn btn-ghost btn-sm"
                  disabled={busy}
                  onclick={() => confirm('Spiel wieder öffnen? Der letzte Siegtreffer wird entfernt.') && act(() => api(`/admin/matches/${m.id}/reopen`))}
                >
                  <RotateCcw size={15} />Wieder öffnen
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section class="panel print:border-0 print:bg-white print:p-0">
      <div class="mb-3 flex items-center justify-between gap-3 print:hidden">
        <h2 class={heading}><QrCode class="text-gold" size={22} />QR-Codes für die Tische</h2>
        <button class={secondary} onclick={() => window.print()}><Printer size={18} />Drucken</button>
      </div>
      <p class="mb-4 max-w-prose text-sm leading-relaxed text-haze print:hidden">
        Die Codes zeigen auf <b class="text-foam">{baseUrl}</b>. Handys müssen im selben WLAN sein. Ändert sich die IP des Laptops, müssen die Codes neu gedruckt werden.
      </p>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-2">
        {#each tables as n (n)}
          <div class="break-inside-avoid rounded-2xl bg-white p-4 text-center text-ink print:border print:border-stone-300">
            <div class="flex items-center justify-center gap-2 font-display text-3xl leading-none font-black"><Beer size={24} />Tisch {n}</div>
            <img class="mx-auto my-2 w-full max-w-64" src="/api/qr/{n}" alt="QR-Code für Tisch {n}" />
            <div class="text-sm font-semibold">Scannen und Treffer eintragen</div>
            <div class="mt-1 text-xs break-all text-stone-500">{baseUrl}/t/{n}</div>
          </div>
        {/each}
      </div>
    </section>

    <section class="{card} border-cup/35">
      <h2 class="{heading} mb-4"><Trash2 class="text-cup" size={22} />Zurücksetzen</h2>
      <div class="flex flex-wrap gap-3">
        <button class="btn btn-danger" disabled={busy} onclick={() => reset(false)}><RotateCcw size={18} />Spiele löschen, Teams behalten</button>
        <button class="btn btn-danger" disabled={busy} onclick={() => reset(true)}><Trash2 size={18} />Alles löschen</button>
      </div>
    </section>
  {/if}
</main>
