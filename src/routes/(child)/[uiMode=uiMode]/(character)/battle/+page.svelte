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
		return async ({ result, update }) => {
			loading = false;
			if (result.type === 'success' && result.data?.success) {
				battleResult = result.data.battleResult as BattleResult;
				// #4681: 報酬は point_ledger に計上済み。layout の残高 (ヘッダー) を再取得して
				// 「+N ポイント」表示と残高を同じ画面で一致させる (reload 不要)。
				// reset:false で form 状態を保ち、battleResult (結果演出) は local state なので残る。
				await update({ reset: false });
			}
		};
	}}
>
	<BattlePage {data} {battleResult} {loading} />
</form>
