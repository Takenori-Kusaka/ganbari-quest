<script lang="ts">
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

interface Props {
	onclose: () => void;
}

let { onclose }: Props = $props();
let open = $state(true);

function handleOpenChange(details: { open: boolean }) {
	if (!details.open) {
		onclose();
	}
}
</script>

<Dialog bind:open onOpenChange={handleOpenChange} title="⭐ プランをアップグレード" testid="premium-modal">
	<p class="modal-description">
		カスタマイズ機能でお子さまにぴったりの環境を作りましょう！
	</p>

	<!-- スタンダードプラン -->
	<div class="plan-card">
		<div class="plan-header">
			<h3 class="plan-name">スタンダード</h3>
			<span class="plan-price">¥500<span class="plan-price-unit">/月〜</span></span>
		</div>
		<ul class="plan-features">
			<li>✅ オリジナル活動の追加・編集</li>
			<li>✅ チェックリストのカスタマイズ</li>
			<li>✅ ごほうびリストの自由設定</li>
			<li>✅ 子供の登録無制限</li>
			<li>✅ データのエクスポート</li>
		</ul>
	</div>

	<!-- ファミリープラン -->
	<div class="plan-card plan-card--family">
		<div class="plan-header">
			<h3 class="plan-name">ファミリー</h3>
			<span class="plan-price">¥780<span class="plan-price-unit">/月〜</span></span>
		</div>
		<ul class="plan-features">
			<li>✅ スタンダードの全機能</li>
			<li>✅ 無制限の履歴保持</li>
			<li>✅ 兄弟間比較分析</li>
			<li>✅ 年間サマリーレポート</li>
		</ul>
	</div>

	<p class="trial-note">7日間の無料トライアル付き</p>

	<div class="modal-actions">
		<Button variant="primary" size="lg" class="w-full" onclick={() => { window.location.href = '/admin/license'; }}>
			アップグレードする
		</Button>
		<button type="button" class="later-link" onclick={onclose}>
			あとで
		</button>
	</div>
</Dialog>

<style>
	.modal-description {
		color: var(--color-text-muted);
		font-size: 0.9rem;
		margin-bottom: var(--sp-md);
	}

	.plan-card {
		border: 2px solid var(--color-premium-bg);
		border-radius: var(--radius-md);
		padding: var(--sp-md);
		margin-bottom: var(--sp-sm);
	}

	.plan-card--family {
		border-color: var(--color-premium);
		background: var(--color-premium-bg);
	}

	.plan-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--sp-sm);
	}

	.plan-name {
		font-weight: 700;
		font-size: 1rem;
		color: var(--color-premium);
	}

	.plan-price {
		font-weight: 700;
		font-size: 1.1rem;
		color: var(--color-text);
	}

	.plan-price-unit {
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.plan-features {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 0.85rem;
	}

	.trial-note {
		text-align: center;
		color: var(--color-premium);
		font-size: 0.85rem;
		font-weight: 600;
		margin: var(--sp-md) 0;
	}

	.modal-actions {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-sm);
	}

	.later-link {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 0.85rem;
		cursor: pointer;
		text-decoration: underline;
	}

	.later-link:hover {
		color: var(--color-text);
	}
</style>
