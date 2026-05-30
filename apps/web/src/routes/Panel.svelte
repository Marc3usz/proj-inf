<script lang="ts">
  export let title: string;
</script>

<section>
  <h2>{title}</h2>
  <slot />
</section>

<style>
  section { margin-top: 22px; background: rgba(23, 33, 43, .92); border: 1px solid rgba(255,255,255,.08); border-radius: 22px; padding: 22px; box-shadow: 0 18px 55px rgba(0,0,0,.18); }
  h2 { margin-top: 0; }
</style>
