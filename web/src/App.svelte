<script lang="ts">
  import Tv from './routes/Tv.svelte';
  import Table from './routes/Table.svelte';
  import Admin from './routes/Admin.svelte';
  import { Beer, MonitorPlay, ShieldCheck } from '@lucide/svelte';

  const path = location.pathname.replace(/\/+$/, '');
  const tableMatch = path.match(/^\/t\/(\d+)$/);
</script>

{#if path === '/tv'}
  <Tv />
{:else if tableMatch}
  <Table tableNo={Number(tableMatch[1])} />
{:else if path === '/admin'}
  <Admin />
{:else}
  <main class="mx-auto flex min-h-full max-w-md flex-col justify-center gap-4 p-6">
    <h1 class="mb-4 flex items-center justify-center gap-3 font-display text-5xl leading-none font-black">
      <Beer class="text-gold" size={44} strokeWidth={2.25} />Bierpong Tracker
    </h1>
    <a class="btn btn-gold py-5 text-xl" href="/tv"><MonitorPlay size={24} />TV-Ansicht</a>
    <a class="btn btn-ghost py-5 text-xl" href="/admin"><ShieldCheck size={24} />Admin</a>
    <p class="mt-2 text-center text-haze">Zum Eintragen den QR-Code am Tisch scannen.</p>
  </main>
{/if}
