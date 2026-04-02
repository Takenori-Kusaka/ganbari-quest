<script lang="ts">
import { AGE_TIER_CONFIG, type UiMode } from '$lib/domain/validation/age-tier';

let { data } = $props();

// 最初の子供の画面URL を算出
const firstChild = $derived(data.children[0]);
const childHomeUrl = $derived(firstChild ? `/${firstChild.uiMode}/home` : '/switch');
const childLabel = $derived(
	firstChild ? (AGE_TIER_CONFIG[firstChild.uiMode as UiMode]?.label ?? firstChild.uiMode) : '',
);
</script>

<svelte:head>
	<title>ぼうけんのはじまり！ - がんばりクエスト</title>
</svelte:head>

<div class="text-center complete-screen">
	<div class="text-4xl mb-2">⚔️</div>
	<h2 class="text-xl font-bold text-gray-700 mb-1">ぼうけんのはじまり！</h2>
	<p class="text-sm text-gray-500 mb-4">
		{firstChild?.nickname ?? ''}ちゃんのぼうけんじゅんびが<br />かんりょうしたよ！
	</p>

	<!-- ステータスサマリ -->
	<div class="status-cards">
		<div class="status-card">
			<div class="status-icon">👦</div>
			<div class="status-value">{data.childCount}人</div>
			<div class="status-label">こども</div>
		</div>
		{#if data.importedActivities > 0}
			<div class="status-card">
				<div class="status-icon">📋</div>
				<div class="status-value">{data.importedActivities}こ</div>
				<div class="status-label">かつどう</div>
			</div>
		{/if}
	</div>

	<!-- 次のミッション -->
	<div class="mission-card">
		<p class="mission-title">つぎのミッション</p>
		<p class="mission-text">
			「きょうの がんばりを 3つ きろくしよう！」
		</p>
	</div>

	<!-- CTA ボタン -->
	<div class="cta-group">
		<a href={childHomeUrl} class="cta-primary">
			こどもがめんをひらく
		</a>
		<a href="/admin" class="cta-secondary">
			おやのせっていをみる
		</a>
	</div>

	<!-- PINヒント -->
	<p class="pin-hint">
		💡 管理画面の「せってい」からPINコードを設定すると、おやの画面を守れるよ
	</p>
</div>

<style>
	.complete-screen {
		animation: fadeIn 0.3s ease-out;
	}

	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(8px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.status-cards {
		display: flex;
		gap: 12px;
		justify-content: center;
		margin-bottom: 20px;
	}

	.status-card {
		flex: 1;
		max-width: 120px;
		background: var(--color-brand-50);
		border: 1px solid var(--color-brand-200);
		border-radius: 12px;
		padding: 12px 8px;
	}

	.status-icon {
		font-size: 1.5rem;
		margin-bottom: 4px;
	}

	.status-value {
		font-size: 1.25rem;
		font-weight: 800;
		color: var(--color-brand-800);
	}

	.status-label {
		font-size: 0.625rem;
		color: var(--color-text-muted);
	}

	.mission-card {
		background: var(--gradient-gold);
		border: 1px solid var(--color-gold-400);
		border-radius: 12px;
		padding: 12px 16px;
		margin-bottom: 20px;
	}

	.mission-title {
		font-size: 0.625rem;
		font-weight: 700;
		color: var(--color-gold-700);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 4px 0;
	}

	.mission-text {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-gold-700);
		margin: 0;
	}

	.cta-group {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 16px;
	}

	.cta-primary {
		display: block;
		padding: 14px;
		background: var(--gradient-brand);
		color: white;
		font-weight: 700;
		font-size: 0.9375rem;
		text-decoration: none;
		border-radius: 12px;
		transition: opacity 0.15s;
	}

	.cta-primary:hover {
		opacity: 0.9;
	}

	.cta-secondary {
		display: block;
		padding: 12px;
		background: var(--color-neutral-100);
		color: var(--color-neutral-600);
		font-weight: 600;
		font-size: 0.8125rem;
		text-decoration: none;
		border-radius: 12px;
		transition: background 0.15s;
	}

	.cta-secondary:hover {
		background: var(--color-neutral-200);
	}

	.pin-hint {
		font-size: 0.6875rem;
		color: var(--color-neutral-400);
		margin-top: 8px;
	}
</style>
