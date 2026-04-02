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

<div class="pricing-page">
	<header class="pricing-header">
		<h1>料金プラン</h1>
		<p>すべてのプランに<strong>7日間の無料トライアル</strong>が付きます</p>
	</header>

	<div class="plans-grid">
		{#each plans as plan}
			<div class="plan-card" class:recommended={plan.recommended}>
				{#if plan.badge}
					<span class="plan-badge">{plan.badge}</span>
				{/if}
				<h2 class="plan-name">{plan.name}</h2>
				<div class="plan-price">
					<span class="amount">{plan.price}</span>
					<span class="unit">{plan.unit}</span>
				</div>
				<p class="plan-desc">{plan.description}</p>

				<a href="/auth/signup" class="plan-cta" class:primary={plan.recommended}>
					無料で始める
				</a>

				<ul class="plan-features">
					{#each plan.features as feature}
						<li>{feature}</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>

	<section class="pricing-faq">
		<h2>よくある質問</h2>
		<dl>
			<dt>無料トライアル中にキャンセルできますか？</dt>
			<dd>はい。トライアル期間中にキャンセルすれば一切課金されません。</dd>

			<dt>支払い方法は？</dt>
			<dd>クレジットカード（Visa, Mastercard, JCB, American Express）に対応しています。Stripeによる安全な決済処理を使用しています。</dd>

			<dt>プランの変更はできますか？</dt>
			<dd>はい。月額から年額への変更、またはその逆が可能です。管理画面からいつでも変更できます。</dd>

			<dt>解約するとデータはどうなりますか？</dt>
			<dd>解約後30日間はデータが保持されます。その間に再開すればデータはそのまま利用できます。</dd>
		</dl>
	</section>
</div>

<style>
	.pricing-page {
		/* Page-scoped accent tokens (purple for recommended plan) */
		--color-pricing-accent: var(--color-violet-500);
		--color-pricing-accent-hover: var(--color-violet-600);

		max-width: 800px;
		margin: 0 auto;
		padding: 2rem 1rem;
	}

	.pricing-header {
		text-align: center;
		margin-bottom: 2.5rem;
	}

	.pricing-header h1 {
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--color-neutral-700);
		margin-bottom: 0.5rem;
	}

	.pricing-header p {
		color: var(--color-neutral-500);
		font-size: 0.95rem;
	}

	.plans-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 1.5rem;
		margin-bottom: 3rem;
	}

	.plan-card {
		position: relative;
		background: var(--color-surface-card);
		border: 2px solid var(--color-border-default);
		border-radius: 1rem;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
	}

	.plan-card.recommended {
		border-color: var(--color-pricing-accent);
		box-shadow: 0 4px 14px rgba(139, 92, 246, 0.15);
	}

	.plan-badge {
		position: absolute;
		top: -0.75rem;
		left: 1rem;
		background: var(--color-pricing-accent);
		color: var(--color-text-inverse);
		font-size: 0.75rem;
		font-weight: 700;
		padding: 0.2rem 0.75rem;
		border-radius: 999px;
	}

	.plan-name {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--color-neutral-700);
		margin-bottom: 0.5rem;
	}

	.plan-price {
		margin-bottom: 0.5rem;
	}

	.plan-price .amount {
		font-size: 2rem;
		font-weight: 700;
		color: var(--color-neutral-900);
	}

	.plan-price .unit {
		font-size: 0.9rem;
		color: var(--color-neutral-500);
	}

	.plan-desc {
		font-size: 0.85rem;
		color: var(--color-neutral-500);
		margin-bottom: 1.25rem;
	}

	.plan-cta {
		display: block;
		text-align: center;
		padding: 0.75rem;
		border-radius: 0.5rem;
		font-size: 0.9rem;
		font-weight: 600;
		text-decoration: none;
		background: var(--color-neutral-100);
		color: var(--color-neutral-700);
		transition: background 0.15s;
		margin-bottom: 1.25rem;
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

	.plan-features {
		list-style: none;
		padding: 0;
		margin: 0;
		flex: 1;
	}

	.plan-features li {
		font-size: 0.85rem;
		color: var(--color-neutral-600);
		padding: 0.35rem 0;
		padding-left: 1.25rem;
		position: relative;
	}

	.plan-features li::before {
		content: '\2713';
		position: absolute;
		left: 0;
		color: var(--color-success);
		font-weight: 700;
	}

	.pricing-faq {
		background: var(--color-surface-muted);
		border-radius: 1rem;
		padding: 1.5rem;
	}

	.pricing-faq h2 {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--color-neutral-700);
		margin-bottom: 1rem;
	}

	.pricing-faq dt {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-neutral-700);
		margin-top: 1rem;
	}

	.pricing-faq dd {
		font-size: 0.85rem;
		color: var(--color-neutral-500);
		margin: 0.25rem 0 0;
	}
</style>
