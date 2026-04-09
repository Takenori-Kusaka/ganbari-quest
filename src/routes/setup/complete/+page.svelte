<script lang="ts">
import { formatChildName } from '$lib/domain/child-display';

let { data } = $props();

// 最初の子供の画面URL を算出
const firstChild = $derived(data.children[0]);
const childHomeUrl = $derived(firstChild ? `/${firstChild.uiMode}/home` : '/switch');
</script>

<svelte:head>
	<title>ぼうけんのはじまり！ - がんばりクエスト</title>
</svelte:head>

<div class="text-center complete-screen">
	<div class="text-4xl mb-2">⚔️</div>
	<h2 class="text-xl font-bold text-gray-700 mb-1">ぼうけんのはじまり！</h2>
	<p class="text-sm text-gray-500 mb-4">
		{formatChildName(firstChild?.nickname, 'possessive')}ぼうけんじゅんびが<br />かんりょうしたよ！
	</p>

	<!-- ステータスサマリ -->
	<div class="flex gap-3 justify-center mb-5">
		<div class="flex-1 max-w-[120px] bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] rounded-xl py-3 px-2">
			<div class="text-2xl mb-1">👦</div>
			<div class="text-xl font-extrabold text-[var(--color-brand-800)]">{data.childCount}人</div>
			<div class="text-[0.625rem] text-[var(--color-text-muted)]">こども</div>
		</div>
		{#if data.importedActivities > 0}
			<div class="flex-1 max-w-[120px] bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] rounded-xl py-3 px-2">
				<div class="text-2xl mb-1">📋</div>
				<div class="text-xl font-extrabold text-[var(--color-brand-800)]">{data.importedActivities}こ</div>
				<div class="text-[0.625rem] text-[var(--color-text-muted)]">かつどう</div>
			</div>
		{/if}
	</div>

	<!-- 次のミッション -->
	<div class="bg-[var(--gradient-gold)] border border-[var(--color-gold-400)] rounded-xl py-3 px-4 mb-5">
		<p class="text-[0.625rem] font-bold text-[var(--color-gold-700)] uppercase tracking-wide m-0 mb-1">つぎのミッション</p>
		<p class="text-sm font-semibold text-[var(--color-gold-700)] m-0">
			「きょうの がんばりを 3つ きろくしよう！」
		</p>
	</div>

	<!-- CTA ボタン -->
	<div class="flex flex-col gap-2 mb-4">
		<a href={childHomeUrl} class="cta-primary">
			こどもがめんをひらく
		</a>
		<a href="/admin" class="cta-secondary">
			おやのせっていをみる
		</a>
	</div>

	<!-- PINヒント -->
	<p class="text-[0.6875rem] text-[var(--color-neutral-400)] mt-2">
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
</style>
