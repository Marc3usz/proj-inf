<script lang="ts">
  export let title: string;
  export let rows: Record<string, unknown>[] = [];
  export let label: string;
  export let value: string;
</script>

<section>
  <h3>{title}</h3>
  {#if rows.length === 0}
    <p>No data yet.</p>
  {:else}
    <ul>
      {#each rows as row}
        <li>
          <span>{String(row[label] ?? 'Unknown')}</span>
          <strong>{String(row[value] ?? 0)}</strong>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  section { background: #0f1a2a; border: 1px solid rgba(255,255,255,.08); border-radius: 18px; padding: 16px; }
  h3 { margin: 0 0 12px; }
  ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 9px; }
  li { display: flex; justify-content: space-between; gap: 14px; padding: 9px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
  li:last-child { border-bottom: 0; }
  span { color: #cbd5e1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  strong { color: #fef08a; }
  p { color: #93a4b8; margin-bottom: 0; }
</style>
