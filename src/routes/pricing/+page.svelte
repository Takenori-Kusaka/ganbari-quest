<script lang="ts">
const plans = [
	{
		id: 'monthly' as const,
		name: '月額プラン',
		price: '¥500',
		unit: '/月',
		description: '全機能利用可能。毎月自動更新。',
		features: [
			'子供の活動記録・ポイント管理',
			'ゲーミフィケーション（レベル・実績・称号）',
			'家族メンバー招待・共同管理',
			'活動カテゴリカスタマイズ',
			'チェックリスト・デイリーミッション',
			'アバター・ごほうび機能',
		],
	},
	{
		id: 'yearly' as const,
		name: '年額プラン',
		price: '¥5,000',
		unit: '/年',
		description: '全機能利用可能。2ヶ月分お得。毎年自動更新。',
		badge: '2ヶ月分お得',
		features: ['月額プランの全機能', '年間で¥1,000お得（月額比）'],
		recommended: true,
	},
];
</script>

<svelte:head>
	<title>料金プラン - がんばりクエスト</title>
</svelte:head>

<div class="pricing-page max-w-[800px] mx-auto py-8 px-4">
	<header class="text-center mb-10">
		<h1 class="text-[1.75rem] font-bold text-[var(--color-neutral-700)] mb-2">料金プラン</h1>
		<p class="text-[var(--color-neutral-500)] text-[0.95rem]">すべてのプランに<strong>7日間の無料トライアル</strong>が付きます</p>
	</header>

	<div class="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-6 mb-12">
		{#each plans as plan}
			<div
				class="plan-card relative bg-[var(--color-surface-card)] border-2 border-[var(--color-border-default)] rounded-2xl p-6 flex flex-col"
				class:recommended={plan.recommended}
			>
				{#if plan.badge}
					<span class="absolute -top-3 left-4 bg-[var(--color-violet-500)] text-[var(--color-text-inverse)] text-xs font-bold px-3 py-0.5 rounded-full">{plan.badge}</span>
				{/if}
				<h2 class="text-[1.1rem] font-semibold text-[var(--color-neutral-700)] mb-2">{plan.name}</h2>
				<div class="mb-2">
					<span class="text-[2rem] font-bold text-[var(--color-neutral-900)]">{plan.price}</span>
					<span class="text-[0.9rem] text-[var(--color-neutral-500)]">{plan.unit}</span>
				</div>
				<p class="text-[0.85rem] text-[var(--color-neutral-500)] mb-5">{plan.description}</p>

				<a
					href="/auth/signup"
					class="plan-cta block text-center py-3 rounded-lg text-[0.9rem] font-semibold no-underline mb-5 transition-colors"
					class:primary={plan.recommended}
				>
					無料で始める
				</a>

				<ul class="plan-features list-none p-0 m-0 flex-1">
					{#each plan.features as feature}
						<li class="text-[0.85rem] text-[var(--color-neutral-600)] py-1.5 pl-5 relative">{feature}</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>

	<section class="bg-[var(--color-surface-muted)] rounded-2xl p-6">
		<h2 class="text-[1.1rem] font-semibold text-[var(--color-neutral-700)] mb-4">よくある質問</h2>
		<dl>
			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">無料トライアル中にキャンセルできますか？</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">はい。トライアル期間中にキャンセルすれば一切課金されません。</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">支払い方法は？</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">クレジットカード（Visa, Mastercard, JCB, American Express）に対応しています。Stripeによる安全な決済処理を使用しています。</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">プランの変更はできますか？</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">はい。月額から年額への変更、またはその逆が可能です。管理画面からいつでも変更できます。</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">解約するとデータはどうなりますか？</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">解約後30日間はデータが保持されます。その間に再開すればデータはそのまま利用できます。</dd>
		</dl>
	</section>
</div>

<style>
	.pricing-page {
		--color-pricing-accent: var(--color-violet-500);
		--color-pricing-accent-hover: var(--color-violet-600);
	}
	.plan-card.recommended {
		border-color: var(--color-pricing-accent);
		box-shadow: 0 4px 14px rgba(139, 92, 246, 0.15);
	}
	.plan-cta {
		background: var(--color-neutral-100);
		color: var(--color-neutral-700);
	}
	.plan-cta:hover {
		background: var(--color-border-default);
	}
	.plan-cta.primary {
		background: var(--color-pricing-accent);
		color: var(--color-text-inverse);
	}
	.plan-cta.primary:hover {
		background: var(--color-pricing-accent-hover);
	}
	.plan-features li::before {
		content: '\2713';
		position: absolute;
		left: 0;
		color: var(--color-success);
		font-weight: 700;
	}
</style>
