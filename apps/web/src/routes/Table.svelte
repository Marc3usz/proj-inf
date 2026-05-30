<script lang="ts">
  export let rows: Record<string, unknown>[] = [];
  $: keys = rows[0] ? Object.keys(rows[0]).slice(0, 8) : [];
</script>

{#if rows.length === 0}
  <p>No rows yet.</p>
{:else}
  <div class="wrap"><table><thead><tr>{#each keys as key}<th>{key}</th>{/each}</tr></thead><tbody>{#each rows as row}<tr>{#each keys as key}<td>{String(row[key] ?? '')}</td>{/each}</tr>{/each}</tbody></table></div>
{/if}

<style>
  .wrap { overflow: auto; }
  table { border-collapse: collapse; min-width: 760px; width: 100%; }
  th, td { text-align: left; padding: 10px; border-bottom: 1px solid rgba(255,255,255,.08); font-size: 14px; }
  th { color: #7dd3fc; }
</style>
