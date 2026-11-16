<script lang="ts">
  import { api, app, teamName, THROW_LABEL } from '../lib/store.svelte.ts';
  import type { ThrowType } from '../../../shared/types.ts';
  import { Beer, Bomb, CircleAlert, Flag, Hourglass, LifeBuoy, Trophy, Undo2, Wifi, WifiOff, X, Zap } from '@lucide/svelte';

  let { tableNo }: { tableNo: number } = $props();

  const s = $derived(app.state);
  const match = $derived(s?.matches.find((m) => m.status === 'live' && m.tableNo === tableNo) ?? null);
  const sides = $derived.by(() => {
    if (!s || !match) return [];
    const find = (id: number | null) => s.teams.find((t) => t.id === id);
    const a = find(match.teamAId);
    const b = find(match.teamBId);
    if (!a || !b) return [];
    return [
      { team: a, score: match.scoreA, color: 'amber' as const },
      { team: b, score: match.scoreB, color: 'sky' as const },
    ];
  });
  const lastThrow = $derived(s && match ? (s.ticker.find((t) => t.matchId === match.id) ?? null) : null);
  const lastThrowText = $derived.by(() => {
    if (!lastThrow) return 'noch kein Treffer';
    if (lastThrow.type === 'bomb') return `Bombe: ${lastThrow.total} Becher`;
    return `${lastThrow.playerName}: ${THROW_LABEL[lastThrow.type] ?? 'Treffer'} + ${lastThrow.cups}`;
  });
  // Läuft das Turnier, aber hier kein Spiel: Dieser Tisch wartet auf die anderen.
  const othersPlaying = $derived(s?.matches.some((m) => m.status === 'live') ?? false);

  let error = $state('');
  let busy = $state(false);
  let flash = $state<number | null>(null);

  // Bomben-Dialog: erst die Becherzahl wählen, dann den Spieler, der als Zweites getroffen hat.
  let bombTeamId = $state<number | null>(null);
  let bombCups = $state<number | null>(null);
  const bombSide = $derived(sides.find((side) => side.team.id === bombTeamId) ?? null);
  // Bei einer Bombe gehen höchstens 7 Becher weg (der Server prüft dieselbe Grenze).
  const bombRemaining = $derived(s && bombSide ? Math.min(7, s.settings.cupsToWin - bombSide.score) : 0);

  function openBomb(teamId: number) {
    bombTeamId = teamId;
    bombCups = null;
  }
  function closeBomb() {
    bombTeamId = null;
    bombCups = null;
  }

  async function send(action: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await action();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  // Nach dem letzten Becher entscheidet der Tisch, ob der Gegner eine Redemption bekommt.
  // finisher ist das Team, das zuerst alle Becher getroffen hat, redeemer das Team, das ausgleichen darf.
  // Nach einem Treffer im Sudden Death ('confirm') ist finisher das Team mit diesem Treffer.
  const stage = $derived(match?.stage ?? 'normal');
  const finisher = $derived(
    stage === 'decide' || stage === 'redemption' || stage === 'confirm'
      ? (sides.find((side) => sides.every((other) => other === side || other.score < side.score)) ?? null)
      : null,
  );
  const redeemer = $derived(finisher ? (sides.find((side) => side !== finisher) ?? null) : null);

  function redemption(grant: boolean) {
    if (!match) return;
    const matchId = match.id;
    pendingWin = null;
    void send(() => api(`/table/${tableNo}/redemption`, { matchId, grant }));
  }

  // Der Fehlwurf in der Redemption beendet das Spiel sofort und wird deshalb erst in einem Dialog bestätigt. Der Dialog gilt nur für das Spiel und den Abschnitt,
  // in dem er geöffnet wurde: entscheidet inzwischen ein anderes Handy, verschwindet er.
  let pendingWin = $state<{ matchId: number; stage: string; winner: string; text: string; run: () => void } | null>(null);
  const confirmWin = $derived(pendingWin && match && pendingWin.matchId === match.id && pendingWin.stage === stage ? pendingWin : null);

  function askWin(winner: string, text: string, run: () => void) {
    if (!match) return;
    pendingWin = { matchId: match.id, stage, winner, text, run };
  }
  function confirmPendingWin() {
    const run = confirmWin?.run;
    pendingWin = null;
    run?.();
  }

  function hit(playerId: number, type: ThrowType, cups: number) {
    if (!s || !match) return;
    const matchId = match.id;
    closeBomb();
    void send(async () => {
      await api(`/table/${tableNo}/throw`, { matchId, playerId, type, bombCups: type === 'bomb' ? cups : undefined });
      flash = playerId;
      navigator.vibrate?.(type === 'bomb' ? [60, 40, 120] : 40);
      setTimeout(() => (flash = null), 350);
    });
  }

  function undo() {
    if (!match) return;
    const matchId = match.id;
    void send(() => api(`/table/${tableNo}/undo`, { matchId }));
  }

  function finishEarly() {
    if (!match) return;
    const matchId = match.id;
    const leader = match.scoreA > match.scoreB ? match.teamAId : match.teamBId;
    if (!confirm(`Spiel vorzeitig beenden? ${teamName(leader)} gewinnt.`)) return;
    void send(() => api(`/table/${tableNo}/finish`, { matchId }));
  }

  // Nur Darstellung: Becher als Dreieck aufstellen, wenn die Anzahl das hergibt (3, 6, 10, 15), sonst in Fünferreihen.
  function rackRows(count: number): number[][] {
    let rows = 0;
    let total = 0;
    while (total < count) total += ++rows;
    const sizes =
      total === count
        ? Array.from({ length: rows }, (_, i) => rows - i)
        : Array.from({ length: Math.ceil(count / 5) }, (_, i) => Math.min(5, count - i * 5));
    let next = 0;
    return sizes.map((size) => Array.from({ length: size }, () => next++));
  }
  const rack = $derived(s ? rackRows(s.settings.cupsToWin) : []);
  const TEAM_COLOR = { amber: 'var(--color-gold)', sky: 'var(--color-cup)' };
</script>

<main class="mx-auto flex min-h-full max-w-lg flex-col gap-4 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
  <header class="flex items-center justify-between gap-3">
    <h1 class="flex items-center gap-2.5 font-display text-3xl leading-none font-black">
      <span class="flex size-9 items-center justify-center rounded-lg bg-gold text-ink"><Beer size={20} strokeWidth={2.25} /></span>
      Tisch {tableNo}
    </h1>
    <span class="flex items-center gap-1.5 text-sm font-semibold {app.connected ? 'text-mint' : 'text-cup'}">
      {#if app.connected}<Wifi size={16} />verbunden{:else}<WifiOff size={16} />keine Verbindung{/if}
    </span>
  </header>

  {#if error}
    <button class="alert text-sm" onclick={() => (error = '')}>
      <CircleAlert class="mt-0.5 shrink-0 text-cup" size={18} />
      <span class="min-w-0 flex-1">{error}</span>
      <X class="mt-0.5 shrink-0 text-haze" size={16} />
    </button>
  {/if}

  {#if !s}
    <p class="mt-20 text-center text-haze">Lade …</p>
  {:else if !match}
    <div class="mt-16 flex flex-col items-center gap-4 px-4 text-center">
      <span class="flex size-20 items-center justify-center rounded-full border border-line bg-felt text-gold">
        {#if s.phase === 'done'}<Trophy size={40} />{:else}<Hourglass size={40} />{/if}
      </span>
      <h2 class="font-display text-4xl leading-none font-extrabold">Kein Spiel an diesem Tisch</h2>
      <p class="max-w-xs leading-relaxed text-haze">
        {#if s.phase === 'setup'}
          Das Turnier hat noch nicht begonnen.
        {:else if s.phase === 'done'}
          Das Turnier ist beendet. Sieger: <b class="text-gold">{teamName(s.champion)}</b>
        {:else if othersPlaying}
          Die nächsten Spiele starten, sobald alle Tische fertig sind.
        {:else}
          Sobald hier ein Spiel startet, erscheint es automatisch.
        {/if}
      </p>
    </div>
  {:else}
    <p class="text-center text-sm font-semibold text-haze">{match.label}</p>

    {#if stage === 'redemption' && redeemer}
      <div class="flex items-start gap-3 rounded-2xl border border-gold/50 bg-gold/10 px-4 py-3.5">
        <LifeBuoy class="mt-0.5 shrink-0 text-gold" size={24} />
        <div class="min-w-0">
          <h2 class="font-display text-2xl leading-tight font-extrabold">Redemption für {redeemer.team.name}</h2>
          <p class="text-sm leading-relaxed text-haze">Weiterwerfen, bis ein Wurf danebengeht. Sind alle Becher weg, folgt ein Sudden Death.</p>
        </div>
      </div>
    {:else if stage === 'sudden' || stage === 'confirm'}
      <div class="flex items-start gap-3 rounded-2xl border border-cup/55 bg-cup/12 px-4 py-3.5">
        <Zap class="mt-0.5 shrink-0 text-cup" size={24} />
        <div class="min-w-0">
          <h2 class="font-display text-2xl leading-tight font-extrabold">Sudden Death</h2>
          <p class="text-sm leading-relaxed text-haze">Jedes Team hat noch einen Becher. Wer ihn zuerst trifft, gewinnt.</p>
        </div>
      </div>
    {/if}

    {#each sides as { team, score, color } (team.id)}
      {@const waiting = stage === 'redemption' && score >= s.settings.cupsToWin}
      <section class="rounded-3xl border-2 border-(--team)/45 bg-(--team)/7 p-4" style="--team: {TEAM_COLOR[color]}">
        <div class="mb-4 flex items-center justify-between gap-4">
          <div class="min-w-0">
            <h2 class="truncate font-display text-3xl leading-tight font-extrabold">{team.name}</h2>
            <p class="font-display text-5xl leading-none font-black text-(--team) tabular-nums">
              {score}<span class="text-2xl font-bold text-haze"> / {s.settings.cupsToWin}</span>
            </p>
          </div>
          <div class="flex shrink-0 flex-col items-center gap-1" aria-hidden="true">
            {#each rack as row, r (r)}
              <div class="flex gap-1">
                {#each row as i (i)}
                  <span class="size-4 rounded-full border-2 {i < score ? 'border-(--team) bg-(--team)' : 'border-line bg-pitch/60'}"></span>
                {/each}
              </div>
            {/each}
          </div>
        </div>

        {#if waiting}
          <p class="flex items-center gap-2 text-sm font-semibold text-haze">
            <Trophy class="shrink-0 text-(--team)" size={18} />Alle Becher getroffen. Gewinnt, sobald die Redemption danebengeht.
          </p>
        {:else}
        <div class="grid grid-cols-2 gap-3">
          {#each team.players as player (player.id)}
            <div class="flex flex-col gap-2">
              <button
                class="rounded-2xl px-3 py-5 text-ink transition active:scale-95 {flash === player.id ? 'bg-foam' : 'bg-(--team)'}"
                disabled={busy}
                onclick={() => hit(player.id, 'hit', 1)}
              >
                <span class="block truncate font-display text-3xl leading-tight font-black">{player.name}</span>
                <span class="block text-sm font-semibold opacity-75">Treffer + 1</span>
              </button>
              {#if stage !== 'sudden' && stage !== 'confirm'}
                <button class="btn btn-ghost text-sm" disabled={busy} onclick={() => hit(player.id, 'bounce', s.settings.cupsBounce)}>
                  Bounce + {s.settings.cupsBounce}
                </button>
              {/if}
            </div>
          {/each}
        </div>
        {#if stage !== 'sudden' && stage !== 'confirm'}
          <button class="btn btn-ghost mt-3 w-full flex-wrap gap-y-0.5 py-3" disabled={busy} onclick={() => openBomb(team.id)}>
            <Bomb size={18} />Bombe <span class="text-sm font-normal text-haze">(beide im selben Becher)</span>
          </button>
        {/if}
        {/if}
      </section>
    {/each}

    <div class="grid grid-cols-2 gap-3">
      <button class="rounded-2xl border border-line bg-felt-2 p-4 text-left font-bold" disabled={busy || !lastThrow} onclick={undo}>
        <span class="flex items-center gap-2"><Undo2 class="shrink-0" size={18} />Rückgängig</span>
        <span class="mt-1 block truncate text-xs font-normal text-haze">{lastThrowText}</span>
      </button>
      {#if stage === 'redemption' && finisher}
        <button
          class="rounded-2xl border border-cup/55 bg-cup/12 p-4 text-left font-bold"
          disabled={busy}
          onclick={() => askWin(finisher.team.name, `Die Redemption von ${redeemer?.team.name ?? 'dem Gegner'} ging daneben.`, () => redemption(false))}
        >
          <span class="flex items-center gap-2"><X class="shrink-0" size={18} />Daneben</span>
          <span class="mt-1 block truncate text-xs font-normal text-haze">{finisher.team.name} gewinnt</span>
        </button>
      {:else}
        <button
          class="rounded-2xl border border-line bg-felt-2 p-4 text-left font-bold"
          disabled={busy || match.scoreA === match.scoreB}
          onclick={finishEarly}
        >
          <span class="flex items-center gap-2"><Flag class="shrink-0" size={18} />Spiel beenden</span>
          <span class="mt-1 block text-xs font-normal text-haze">vorzeitig, Führender gewinnt</span>
        </button>
      {/if}
    </div>
  {/if}
</main>

{#if bombSide}
  <div class="fixed inset-0 z-10 flex items-center justify-center p-4 bg-pitch/80 backdrop-blur-sm" role="presentation" onclick={closeBomb}>
    <div
      class="max-h-full w-full max-w-lg overflow-y-auto rounded-3xl border border-line bg-felt p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Bombe eintragen"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.key === 'Escape' && closeBomb()}
    >
      <h2 class="flex items-center gap-3 font-display text-3xl leading-none font-black">
        <Bomb class="shrink-0 text-gold" size={28} /><span class="min-w-0 truncate">Bombe für {bombSide.team.name}</span>
      </h2>

      <p class="mt-5 font-bold">1. Wie viele Becher gehen insgesamt weg?</p>
      <p class="mt-1 mb-3 text-sm text-haze">Der getroffene Becher zählt mit.</p>
      <div class="grid grid-cols-5 gap-2">
        {#each { length: bombRemaining } as _, i (i)}
          <button
            class="rounded-xl py-3 font-display text-3xl leading-none font-black {bombCups === i + 1 ? 'bg-gold text-ink' : 'border border-line bg-felt-2'}"
            onclick={() => (bombCups = i + 1)}
          >
            {i + 1}
          </button>
        {/each}
      </div>

      <p class="mt-6 mb-3 font-bold">2. Wer hat als Zweites getroffen?</p>
      <div class="grid grid-cols-2 gap-3">
        {#each bombSide.team.players as player, i (player.id)}
          {@const other = bombSide.team.players[1 - i]}
          <button
            class="rounded-2xl bg-gold px-3 py-4 text-ink active:scale-95"
            disabled={busy || bombCups === null}
            onclick={() => bombCups !== null && hit(player.id, 'bomb', bombCups)}
          >
            <span class="block truncate font-display text-3xl leading-tight font-black">{player.name}</span>
            {#if bombCups !== null}
              <span class="block truncate text-xs font-semibold opacity-75">
                {player.name} + {bombCups - Math.floor(bombCups / 2)}, {other.name} + {Math.floor(bombCups / 2)}
              </span>
            {/if}
          </button>
        {/each}
      </div>

      <button class="btn btn-ghost mt-5 w-full" onclick={closeBomb}>Abbrechen</button>
    </div>
  </div>
{/if}

{#if stage === 'decide' && finisher && redeemer}
  <div class="fixed inset-0 z-20 flex items-center justify-center p-4 bg-pitch/85 backdrop-blur-sm">
    <div
      class="max-h-full w-full max-w-lg overflow-y-auto rounded-3xl border border-line bg-felt p-5"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="decide-title"
      aria-describedby="decide-text"
    >
      <h2 id="decide-title" class="flex items-center gap-3 font-display text-4xl leading-none font-black">
        <Trophy class="shrink-0 text-gold" size={32} />Letzter Becher!
      </h2>
      <p id="decide-text" class="mt-3 leading-relaxed text-haze">
        <b class="text-foam">{finisher.team.name}</b> hat alle Becher getroffen. Bekommt
        <b class="text-foam">{redeemer.team.name}</b> noch eine Redemption?
      </p>

      <div class="mt-5 flex flex-col gap-3">
        <button class="rounded-2xl border border-line bg-felt-2 px-4 py-4 text-left" disabled={busy} onclick={() => redemption(true)}>
          <span class="flex items-center gap-2.5 text-lg font-bold">
            <LifeBuoy class="shrink-0 text-gold" size={22} /><span class="min-w-0 truncate">Redemption für {redeemer.team.name}</span>
          </span>
          <span class="mt-1 block text-sm text-haze">Wirft weiter, bis ein Wurf danebengeht.</span>
        </button>
        <button class="rounded-2xl bg-gold px-4 py-4 text-left text-ink" disabled={busy} onclick={() => redemption(false)}>
          <span class="flex items-center gap-2.5 text-lg font-bold">
            <Trophy class="shrink-0" size={22} /><span class="min-w-0 truncate">{finisher.team.name} gewinnt</span>
          </span>
          <span class="mt-1 block text-sm opacity-75">Keine Redemption, das Spiel ist beendet.</span>
        </button>
      </div>

      <button class="btn btn-ghost mt-5 w-full" disabled={busy} onclick={undo}><Undo2 size={18} />Treffer zurücknehmen</button>
    </div>
  </div>
{/if}

{#if stage === 'confirm' && finisher}
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-pitch/85 p-4 backdrop-blur-sm">
    <div
      class="max-h-full w-full max-w-lg overflow-y-auto rounded-3xl border border-line bg-felt p-5"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sudden-title"
      aria-describedby="sudden-text"
    >
      <h2 id="sudden-title" class="flex items-center gap-3 font-display text-4xl leading-none font-black">
        <Zap class="shrink-0 text-cup" size={32} />Sudden Death entschieden!
      </h2>
      <p id="sudden-text" class="mt-3 leading-relaxed text-haze">
        <b class="text-foam">{finisher.team.name}</b> hat den letzten Becher zuerst getroffen. Ist das Spiel damit beendet?
      </p>

      <div class="mt-5 flex flex-col gap-3">
        <button class="rounded-2xl bg-gold px-4 py-4 text-left text-ink" disabled={busy} onclick={() => redemption(false)}>
          <span class="flex items-center gap-2.5 text-lg font-bold">
            <Trophy class="shrink-0" size={22} /><span class="min-w-0 truncate">{finisher.team.name} gewinnt</span>
          </span>
          <span class="mt-1 block text-sm opacity-75">Das Spiel ist beendet.</span>
        </button>
        <button class="btn btn-ghost w-full" disabled={busy} onclick={undo}><Undo2 size={18} />Treffer zurücknehmen</button>
      </div>
    </div>
  </div>
{/if}

{#if confirmWin}
  <div class="fixed inset-0 z-30 flex items-center justify-center bg-pitch/85 p-4 backdrop-blur-sm">
    <div
      class="max-h-full w-full max-w-lg overflow-y-auto rounded-3xl border border-line bg-felt p-5"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-text"
    >
      <h2 id="confirm-title" class="flex items-center gap-3 font-display text-4xl leading-none font-black">
        <Trophy class="shrink-0 text-gold" size={32} /><span class="min-w-0">Spiel beenden?</span>
      </h2>
      <p id="confirm-text" class="mt-3 leading-relaxed text-haze">
        {confirmWin.text} <b class="text-foam">{confirmWin.winner}</b> gewinnt damit das Spiel.
      </p>
      <div class="mt-5 flex flex-col gap-3">
        <button class="btn btn-gold py-4 text-lg" disabled={busy} onclick={confirmPendingWin}>
          <Trophy class="shrink-0" size={22} /><span class="min-w-0 truncate">Ja, {confirmWin.winner} gewinnt</span>
        </button>
        <button class="btn btn-ghost" onclick={() => (pendingWin = null)}>Zurück zum Spiel</button>
      </div>
    </div>
  </div>
{/if}
