<script lang="ts">
/**
 * CheckoutReconciliationBanner.svelte — checkout 完了照合の結果表示 (#3958)
 *
 * Stripe checkout の success_url (`/admin/subscription?session_id=cs_…`) から戻ったとき、
 * サーバー側 (`+page.server.ts` の load → `reconcileCheckoutSession`) が照合した結果を伝える。
 *
 * 表示責務:
 *   - 反映済み  → 完了を伝え、URL から session_id を落として最新状態で再描画する
 *   - 確認中    → 「最新の状態を確認」で再照合できるようにし、その間は進行中を可視化する (NN/G #1)
 *   - 確認不可  → 既存のプラン表示にフォールバックしていることを伝える (500 にしない)
 *
 * 内部事情 (webhook 未達 / Stripe API / session_id) は顧客に露出させない。
 */
import { onMount } from 'svelte';
import { invalidateAll, replaceState } from '$app/navigation';
import { resolve } from '$app/paths';
import { page } from '$app/state';
import type {
	CheckoutReconciliationResult,
	CheckoutReconciliationStatus,
} from '$lib/domain/checkout-reconciliation';
import { CHECKOUT_RECONCILIATION_LABELS } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';

let { result }: { result: CheckoutReconciliationResult | null } = $props();

// 反映確定後は URL から session_id を落とすので load は `null` を返す。props をそのまま
// 描画すると「反映しました」が即座に消えるため、確定した結果だけ保持する。
let pinned = $state<CheckoutReconciliationStatus | null>(null);
let rechecking = $state(false);

const status = $derived(pinned ?? result?.status ?? null);
const terminal = $derived(status === 'applied' || status === 'already_applied');

function display(): { variant: 'success' | 'info' | 'warning'; message: string } | null {
	switch (status) {
		case 'applied':
			return { variant: 'success', message: CHECKOUT_RECONCILIATION_LABELS.applied };
		case 'already_applied':
			return { variant: 'success', message: CHECKOUT_RECONCILIATION_LABELS.alreadyApplied };
		case 'pending':
			return { variant: 'info', message: CHECKOUT_RECONCILIATION_LABELS.pending };
		case 'tenant_mismatch':
		case 'not_found':
			return { variant: 'warning', message: CHECKOUT_RECONCILIATION_LABELS.unresolved };
		default:
			// unavailable (Stripe 無効環境) は顧客に伝えることがないため何も出さない
			return null;
	}
}

const view = $derived(display());

/** 再照合。session_id を保持したまま load を再実行する (Stripe に再度問い合わせる) */
async function recheck() {
	rechecking = true;
	try {
		await invalidateAll();
	} finally {
		rechecking = false;
	}
}

onMount(() => {
	// 反映が確定したら session_id を URL から外す。残したままだと再読込のたびに
	// Stripe へ照会が飛ぶうえ、共有・ブックマークで決済 ID が持ち回られる。
	// URL 更新後に再読込することで、ヘッダー等の他 load も反映後の状態に揃う。
	// SvelteKit router の外 (Storybook 等) では page.url を持たないため、URL 操作は行わない
	const currentUrl: URL | undefined = page.url;
	if (!terminal || !currentUrl?.searchParams.has('session_id')) return;
	pinned = status;
	replaceState(resolve('/admin/subscription'), page.state);
	void invalidateAll();
});
</script>

{#if view}
	<Alert variant={view.variant} data-testid="checkout-reconciliation-banner">
		<p>{view.message}</p>
		{#if !terminal}
			<div class="mt-2">
				<Button
					variant="secondary"
					size="sm"
					loading={rechecking}
					onclick={recheck}
					data-testid="checkout-reconciliation-recheck"
				>
					{rechecking
						? CHECKOUT_RECONCILIATION_LABELS.rechecking
						: CHECKOUT_RECONCILIATION_LABELS.recheckButton}
				</Button>
			</div>
		{/if}
	</Alert>
{/if}
