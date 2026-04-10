<script lang="ts">
import { enhance } from '$app/forms';
import type { BattleResult } from '$lib/domain/battle-types';
import BattlePage from '$lib/features/battle/BattlePage.svelte';

let { data } = $props();

let battleResult = $state<BattleResult | null>(null);
let loading = $state(false);
</script>

<form
	method="POST"
	action="?/executeBattle"
	use:enhance={() => {
		loading = true;
		return async ({ result }) => {
			loading = false;
			if (result.type === 'success' && result.data?.success) {
				battleResult = result.data.battleResult as BattleResult;
			}
		};
	}}
>
	<BattlePage {data} {battleResult} {loading} />
</form>
