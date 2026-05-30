<script lang="ts">
  export let countries: { country: string | null; count: number }[] = [];

  const positions = [
    { x: 52, y: 35 },
    { x: 45, y: 38 },
    { x: 23, y: 42 },
    { x: 62, y: 48 },
    { x: 72, y: 55 },
    { x: 34, y: 66 },
    { x: 82, y: 72 },
    { x: 16, y: 58 }
  ];

  $: max = Math.max(1, ...countries.map((row) => row.count));
</script>

<section>
  <div class="map" aria-label="World map click distribution">
    {#each countries.slice(0, 8) as row, index}
      <span
        class="dot"
        style={`--x:${positions[index]?.x ?? 50}%;--y:${positions[index]?.y ?? 50}%;--size:${12 + (row.count / max) * 34}px`}
        title={`${row.country ?? 'Unknown'}: ${row.count}`}
      >{row.country ?? '?'}</span>
    {/each}
  </div>
  <p>Click geography by country. Bubble size reflects relative click volume.</p>
</section>

<style>
  section { background: #0f1a2a; border: 1px solid rgba(255,255,255,.08); border-radius: 18px; padding: 16px; }
  .map { position: relative; height: 230px; border-radius: 18px; overflow: hidden; background: radial-gradient(circle at 20% 45%, rgba(125, 211, 252, .22), transparent 16%), radial-gradient(circle at 50% 38%, rgba(125, 211, 252, .18), transparent 18%), radial-gradient(circle at 70% 58%, rgba(125, 211, 252, .2), transparent 15%), linear-gradient(135deg, #132238, #0b1220); border: 1px solid rgba(125,211,252,.16); }
  .map::before { content: ''; position: absolute; inset: 18% 7%; border: 1px dashed rgba(255,255,255,.12); border-radius: 48%; }
  .dot { position: absolute; left: var(--x); top: var(--y); width: var(--size); height: var(--size); transform: translate(-50%, -50%); display: grid; place-items: center; border-radius: 999px; background: #fef08a; color: #422006; font-size: 11px; font-weight: 900; box-shadow: 0 0 0 8px rgba(254,240,138,.12); }
  p { color: #93a4b8; margin: 12px 0 0; }
</style>
