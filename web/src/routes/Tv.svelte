<script lang="ts">
  import { app, teamName } from '../lib/store.svelte.ts';
  import type { TickerItem } from '../../../shared/types.ts';
  import { Beer, Bomb, Flame, LifeBuoy, Medal, Radio, Trophy, Zap } from '@lucide/svelte';

  type View = 'teams' | 'leaderboard' | 'groups' | 'bracket' | 'players';
  const TITLES: Record<View, string> = {
    teams: 'Teams',
    leaderboard: 'Leaderboard',
    groups: 'Gruppen',
    bracket: 'K.O.-Runde',
    players: 'Top-Spieler',
  };
  const ROTATE_MS = 15_000;

  const s = $derived(app.state);
  const views = $derived.by<View[]>(() => {
    if (!s) return [];
    if (s.phase === 'setup') return ['teams'];
    const list: View[] = ['leaderboard'];
    if (s.groups.length > 1) list.push('groups');
    if (s.koRounds > 0) list.push('bracket');
    list.push('players');
    return list;
  });

  let tick = $state(0);
  $effect(() => {
    const timer = setInterval(() => tick++, ROTATE_MS);
    return () => clearInterval(timer);
  });
  const view = $derived(views.length > 0 ? views[tick % views.length] : null);

  const live = $derived(s?.matches.filter((m) => m.status === 'live') ?? []);
  const koColumns = $derived.by(() => {
    if (!s) return [];
    return Array.from({ length: s.koRounds }, (_, i) => {
      const matches = s.matches.filter((m) => m.phase === 'ko' && m.round === i + 1);
      return { label: matches[0]?.label ?? '', matches };
    });
  });

  // Einblendung bei jedem neuen Treffer
  let toast = $state<TickerItem | null>(null);
  let lastSeen: number | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (!s) return;
    const newest = s.ticker[0];
    const newestId = newest?.id ?? 0;
    if (lastSeen !== null && newest && newestId > lastSeen) {
      toast = newest;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toast = null), 4000);
    }
    lastSeen = newestId;
  });

  // Nur Darstellung: Medaillenfarben für die ersten drei Plätze und Aufmachung der Treffer-Einblendung.
  const MEDAL_COLOR = ['text-gold', 'text-silver', 'text-bronze'];
  const toastLook = $derived.by(() => {
    if (!toast) return null;
    if (toast.lastCup) return { Icon: Trophy, title: 'Letzter Becher!', tone: 'bg-gold' };
    if (toast.type === 'bomb') return { Icon: Bomb, title: 'Bombe!', tone: 'bg-cup' };
    if (toast.type === 'bounce') return { Icon: Flame, title: 'Bounce!', tone: 'bg-gold' };
    return { Icon: Beer, title: 'Treffer!', tone: 'bg-gold' };
  });
</script>

{#snippet rank(i: number)}
  {#if i < 3}
    <Medal class="size-[3.4vh] {MEDAL_COLOR[i]}" strokeWidth={2.25} aria-label="Platz {i + 1}" />
  {:else}
    <span class="pl-[0.6vh] text-haze">{i + 1}</span>
  {/if}
{/snippet}

<main class="flex h-full flex-col overflow-hidden px-[3.5vh] py-[3vh] text-[2.2vh]">
  <header class="mb-[2.5vh] flex items-center justify-between gap-[3vh]">
    <h1 class="flex items-center gap-[1.6vh] font-display text-[6vh] leading-none font-black">
      <span class="flex size-[6.4vh] items-center justify-center rounded-[1.4vh] bg-gold text-ink"><Beer class="size-[4vh]" strokeWidth={2.25} /></span>
      Bierpong Turnier
    </h1>
    <nav class="flex gap-[1vh]">
      {#each views as v (v)}
        <span
          class="relative overflow-hidden rounded-full px-[2vh] py-[0.8vh] font-bold {v === view ? 'bg-gold text-ink' : 'border border-line bg-felt text-haze'}"
        >
          {TITLES[v]}
          {#if v === view && views.length > 1}
            {#key tick}
              <span
                class="absolute inset-x-0 bottom-0 h-[0.5vh] origin-left bg-ink/45"
                style="animation: rotate-progress {ROTATE_MS}ms linear"
              ></span>
            {/key}
          {/if}
        </span>
      {/each}
    </nav>
  </header>

  {#if !s}
    <p class="m-auto text-haze">Verbinde …</p>
  {:else}
    {#if s.champion !== null}
      <div class="mb-[2.5vh] flex items-center justify-center gap-[2.5vh] rounded-[2vh] bg-gold px-[3vh] py-[1.8vh] font-display text-[5.5vh] leading-none font-black text-ink">
        <Trophy class="size-[5vh] shrink-0" strokeWidth={2.25} />
        <span class="min-w-0 truncate leading-[1.2]">Turniersieger: {teamName(s.champion)}</span>
        <Trophy class="size-[5vh] shrink-0" strokeWidth={2.25} />
      </div>
    {/if}

    <section class="min-h-0 flex-1 overflow-hidden">
      {#if view === 'teams'}
        <p class="mb-[2.5vh] text-[3vh] text-haze">Das Turnier startet gleich – {s.teams.length} Teams sind dabei.</p>
        <div class="grid grid-cols-4 gap-[1.5vh]">
          {#each s.teams as team (team.id)}
            <div class="rounded-[1.5vh] border border-line bg-felt/85 px-[2vh] py-[1.6vh]">
              <div class="truncate font-display text-[3.4vh] leading-tight font-extrabold">{team.name}</div>
              <div class="truncate text-haze">{team.players.map((p) => p.name).join(' & ')}</div>
            </div>
          {/each}
        </div>
      {:else if view === 'leaderboard'}
        <table class="w-full">
          <thead class="text-left text-[1.9vh] text-haze">
            <tr>
              <th class="w-[8vh] pb-[1vh] font-semibold">Platz</th>
              <th class="w-[40%] pb-[1vh] font-semibold">Team</th>
              <th class="pb-[1vh] text-right font-semibold">Spiele</th>
              <th class="pb-[1vh] text-right font-semibold">Siege</th>
              <th class="pb-[1vh] text-right font-semibold">Niederlagen</th>
              <th class="pb-[1vh] text-right font-semibold">Becher</th>
              <th class="pb-[1vh] text-right font-semibold">Differenz</th>
            </tr>
          </thead>
          <tbody class="font-display text-[3.4vh] leading-none font-bold">
            {#each s.leaderboard.slice(0, 12) as row, i (row.teamId)}
              <tr class="border-t border-line {i === 0 ? 'text-gold' : ''}">
                <td class="py-[1vh]">{@render rank(i)}</td>
                <td class="max-w-0 truncate py-[1vh] font-extrabold">{teamName(row.teamId)}</td>
                <td class="py-[1vh] text-right tabular-nums">{row.played}</td>
                <td class="py-[1vh] text-right font-black tabular-nums">{row.wins}</td>
                <td class="py-[1vh] text-right tabular-nums">{row.losses}</td>
                <td class="py-[1vh] text-right tabular-nums">{row.cupsFor}:{row.cupsAgainst}</td>
                <td class="py-[1vh] text-right tabular-nums">{row.diff > 0 ? '+' : ''}{row.diff}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else if view === 'groups'}
        <div class="grid h-full gap-[2vh] {s.groups.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}">
          {#each s.groups as group (group.name)}
            <div class="rounded-[2vh] border border-line bg-felt/85 px-[2.5vh] py-[2vh]">
              <h2 class="mb-[1.2vh] font-display text-[3.6vh] leading-none font-black text-gold">Gruppe {group.name}</h2>
              <table class="w-full">
                <thead class="text-left text-[1.8vh] text-haze">
                  <tr>
                    <th class="pb-[0.6vh] font-semibold">Team</th>
                    <th class="pb-[0.6vh] text-right font-semibold">S</th>
                    <th class="pb-[0.6vh] text-right font-semibold">N</th>
                    <th class="pb-[0.6vh] text-right font-semibold">Diff.</th>
                  </tr>
                </thead>
                <tbody class="font-display text-[3vh] leading-none font-bold">
                  {#each group.rows as row, i (row.teamId)}
                    <tr class="border-t border-line">
                      <td class="max-w-0 truncate py-[0.9vh] font-extrabold">
                        <span class="mr-[1.2vh] inline-block size-[1.4vh] rounded-full {i < s.settings.advancePerGroup ? 'bg-mint' : 'bg-line'}"></span>{teamName(row.teamId)}
                      </td>
                      <td class="w-[6vh] text-right font-black tabular-nums">{row.wins}</td>
                      <td class="w-[6vh] text-right tabular-nums">{row.losses}</td>
                      <td class="w-[9vh] text-right tabular-nums">{row.diff > 0 ? '+' : ''}{row.diff}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/each}
        </div>
      {:else if view === 'bracket'}
        <div class="flex h-full gap-[3vh]">
          {#each koColumns as column (column.label)}
            <div class="flex min-w-0 flex-1 flex-col">
              <h2 class="mb-[1.2vh] text-center font-display text-[3.2vh] leading-none font-black text-gold">{column.label}</h2>
              <div class="flex flex-1 flex-col justify-around gap-[1.5vh]">
                {#each column.matches as m (m.id)}
                  <div class="flex flex-col gap-[0.6vh] rounded-[1.5vh] border bg-felt/85 px-[1.8vh] py-[1.3vh] {m.status === 'live' ? 'border-mint ring-2 ring-mint/40' : 'border-line'}">
                    {#each [{ id: m.teamAId, score: m.scoreA }, { id: m.teamBId, score: m.scoreB }] as side, i (i)}
                      <div class="flex items-baseline justify-between gap-[1vh] {m.winnerTeamId !== null && m.winnerTeamId === side.id ? 'font-black text-gold' : m.status === 'done' ? 'text-haze/60' : 'font-bold'}">
                        <span class="truncate">{side.id === null ? (m.isBye ? 'Freilos' : 'offen') : teamName(side.id)}</span>
                        {#if !m.isBye && m.status !== 'pending'}<span class="font-display text-[2.8vh] leading-none font-black tabular-nums">{side.score}</span>{/if}
                      </div>
                    {/each}
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {:else if view === 'players'}
        <table class="w-full">
          <thead class="text-left text-[1.9vh] text-haze">
            <tr>
              <th class="w-[8vh] pb-[1vh] font-semibold">Platz</th>
              <th class="w-[16%] pb-[1vh] font-semibold">Spieler</th>
              <th class="w-[24%] pb-[1vh] font-semibold">Team</th>
              <th class="pb-[1vh] text-right font-semibold">Becher</th>
              <th class="pb-[1vh] text-right font-semibold">Treffer</th>
              <th class="pb-[1vh] text-right font-semibold">Bounce</th>
              <th class="pb-[1vh] text-right font-semibold">Bomben</th>
              <th class="pb-[1vh] text-right font-semibold">Siegtreffer</th>
              <th class="pb-[1vh] text-right font-semibold">W/L</th>
            </tr>
          </thead>
          <tbody class="font-display text-[3.2vh] leading-none font-bold">
            {#each s.playerStats.slice(0, 12) as p, i (p.playerId)}
              <tr class="border-t border-line {i === 0 ? 'text-gold' : ''}">
                <td class="py-[1vh]">{@render rank(i)}</td>
                <td class="max-w-0 truncate py-[1vh] font-extrabold">{p.name}</td>
                <td class="max-w-0 truncate py-[1vh] font-semibold text-haze">{p.teamName}</td>
                <td class="py-[1vh] text-right font-black tabular-nums">{p.cups}</td>
                <td class="py-[1vh] text-right tabular-nums">{p.hits}</td>
                <td class="py-[1vh] text-right tabular-nums">{p.bounce}</td>
                <td class="py-[1vh] text-right tabular-nums">{p.bomb}</td>
                <td class="py-[1vh] text-right tabular-nums">{p.lastCup}</td>
                <td class="py-[1vh] text-right tabular-nums">{p.wins}/{p.losses}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>

    {#if live.length > 0}
      <footer class="mt-[2.5vh] grid gap-[1.5vh]" style="grid-template-columns: repeat({Math.min(live.length, 4)}, minmax(0, 1fr))">
        {#each live as m (m.id)}
          <div class="rounded-[1.5vh] border border-line bg-felt/85 px-[2vh] py-[1.5vh]">
            <div class="mb-[1vh] flex items-center justify-between gap-[1vh] text-[1.8vh]">
              <span class="truncate text-haze"><b class="text-foam">Tisch {m.tableNo}</b><span class="ml-[1vh]">{m.label}</span></span>
              {#if m.stage === 'redemption'}
                <span class="flex shrink-0 items-center gap-[0.6vh] font-bold text-gold"><LifeBuoy class="size-[2vh]" />Redemption</span>
              {:else if m.stage === 'sudden' || m.stage === 'confirm'}
                <span class="flex shrink-0 items-center gap-[0.6vh] font-bold text-cup"><Zap class="size-[2vh]" />Sudden Death</span>
              {:else}
                <span class="flex shrink-0 items-center gap-[0.6vh] font-bold text-mint"><Radio class="size-[2vh]" />live</span>
              {/if}
            </div>
            <div class="flex items-center gap-[1.2vh] text-[2.6vh] font-bold">
              <span class="min-w-0 flex-1 truncate text-right">{teamName(m.teamAId)}</span>
              <span class="rounded-[1vh] bg-pitch px-[1.4vh] py-[0.5vh] font-display text-[3.6vh] leading-none font-black text-gold tabular-nums">{m.scoreA} : {m.scoreB}</span>
              <span class="min-w-0 flex-1 truncate">{teamName(m.teamBId)}</span>
            </div>
          </div>
        {/each}
      </footer>
    {/if}
  {/if}

  {#if toast && toastLook}
    <div class="pointer-events-none fixed inset-x-0 top-[12vh] flex justify-center">
      {#key toast.id}
        <div
          class="rounded-[2.5vh] px-[5vh] py-[2.5vh] text-center text-ink shadow-[0_3vh_8vh_rgb(0_0_0/0.55)] {toastLook.tone}"
          style="animation: toast-in 0.35s cubic-bezier(0.2, 1.4, 0.4, 1)"
        >
          <div class="flex items-center justify-center gap-[2vh] font-display text-[7vh] leading-none font-black uppercase">
            <toastLook.Icon class="size-[6vh] shrink-0" strokeWidth={2.25} />{toastLook.title}
          </div>
          <div class="mt-[1vh] text-[3vh] font-bold">
            {#if toast.type === 'bomb'}
              {toast.teamName}: {toast.total} Becher weg
            {:else}
              {toast.playerName} ({toast.teamName}) + {toast.cups}
            {/if}
          </div>
        </div>
      {/key}
    </div>
  {/if}
</main>
