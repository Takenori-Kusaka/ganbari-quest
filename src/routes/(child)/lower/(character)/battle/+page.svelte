<script lang="ts">
import BattlePage from '$lib/features/battle/BattlePage.svelte';

let { data } = $props();
</script>

<BattlePage {data} />
