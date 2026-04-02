<script lang="ts">
const plans = [
	{
		id: 'free' as const,
		name: 'フリー',
		price: '¥0',
		unit: '',
		description: '基本機能で気軽にスタート。ゲーム体験は一切制限なし。',
		features: [
			'子供2人まで登録',
			'プリセット活動の利用',
			'カスタム活動 3個まで',
			'レベル・ポイント・実績・称号',
			'シールガチャ・ログインボーナス',
			'チェックリスト（テンプレート）',
			'90日間の履歴保持',
		],
	},
	{
		id: 'standard' as const,
		name: 'スタンダード',
		price: '¥500',
		unit: '/月',
		yearlyPrice: '年額 ¥5,000（2ヶ月分お得）',
		description: 'カスタマイズ自由自在。お子さまにぴったりの環境を。',
		features: [
			'子供 無制限',
			'カスタム活動 無制限',
			'活動アイコンの変更',
			'チェックリスト自由作成',
			'カスタム報酬設定',
			'おうえん自由テキスト',
			'週次メールレポート',
			'データエクスポート（CSV）',
			'1年間の履歴保持',
			'メールサポート',
		],
		badge: 'おすすめ',
		recommended: true,
	},
	{
		id: 'family' as const,
		name: 'ファミリー',
		price: '¥780',
		unit: '/月',
		yearlyPrice: '年額 ¥7,800（2ヶ月分お得）',
		description: '全機能解放。きょうだいの成長をまとめて見守れます。',
		features: [
			'スタンダードの全機能',
			'月次比較レポート',
			'年間サマリーレポート',
			'兄弟間比較分析',
			'カスタムレベル称号',
			'データエクスポート（PDF）',
			'無制限の履歴保持',
			'優先サポート（48h以内）',
		],
	},
];
</script>

<svelte:head>
	<title>料金プラン - がんばりクエスト</title>
</svelte:head>

<div class="pricing-page max-w-[960px] mx-auto py-8 px-4">
	<header class="text-center mb-10">
		<h1 class="text-[1.75rem] font-bold text-[var(--color-neutral-700)] mb-2">料金プラン</h1>
		<p class="text-[var(--color-neutral-500)] text-[0.95rem]">基本無料ではじめられます。有料プランはすべて<strong>7日間の無料トライアル</strong>付き</p>
	</header>

	<div class="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-6 mb-8">
		{#each plans as plan}
			<div
				class="plan-card relative bg-[var(--color-surface-card)] border-2 rounded-2xl p-6 flex flex-col"
				class:recommended={plan.recommended}
				class:default-border={!plan.recommended}
			>
				{#if plan.badge}
					<span class="absolute -top-3 left-4 bg-[var(--color-violet-500)] text-[var(--color-text-inverse)] text-xs font-bold px-3 py-0.5 rounded-full">{plan.badge}</span>
				{/if}
				<h2 class="text-[1.1rem] font-semibold text-[var(--color-neutral-700)] mb-2">{plan.name}</h2>
				<div class="mb-1">
					<span class="text-[2rem] font-bold text-[var(--color-neutral-900)]">{plan.price}</span>
					{#if plan.unit}
						<span class="text-[0.9rem] text-[var(--color-neutral-500)]">{plan.unit}</span>
					{/if}
				</div>
				{#if plan.yearlyPrice}
					<p class="text-[0.8rem] text-[var(--color-neutral-500)] mb-3">{plan.yearlyPrice}</p>
				{:else}
					<p class="text-[0.8rem] text-[var(--color-neutral-500)] mb-3">&nbsp;</p>
				{/if}
				<p class="text-[0.85rem] text-[var(--color-neutral-500)] mb-5">{plan.description}</p>

				{#if plan.id === 'free'}
					<a
						href="/auth/signup"
						class="plan-cta block text-center py-3 rounded-lg text-[0.9rem] font-semibold no-underline mb-5 transition-colors"
					>
						無料ではじめる
					</a>
				{:else}
					<a
						href="/auth/signup?plan={plan.id}"
						class="plan-cta primary block text-center py-3 rounded-lg text-[0.9rem] font-semibold no-underline mb-5 transition-colors"
					>
						7日間 無料体験
					</a>
				{/if}

				<ul class="plan-features list-none p-0 m-0 flex-1">
					{#each plan.features as feature}
						<li class="text-[0.85rem] text-[var(--color-neutral-600)] py-1.5 pl-5 relative">{feature}</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>

	<p class="text-center text-[0.85rem] text-[var(--color-neutral-500)] mb-12">
		&#x1F4A1; ゲーミフィケーション機能（レベル・ポイント・実績・称号・シールガチャ・コンボ）は<strong>全プラン共通</strong>で制限なし
	</p>

	<section class="bg-[var(--color-surface-muted)] rounded-2xl p-6">
		<h2 class="text-[1.1rem] font-semibold text-[var(--color-neutral-700)] mb-4">よくある質問</h2>
		<dl>
			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">無料プランでも十分使えますか？</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">はい。プリセットの活動とチェックリストで基本的な機能はお使いいただけます。お子さまのゲーム体験は無料でも一切制限ありません。</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">無料トライアル中にキャンセルできますか？</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">はい。トライアル期間中にキャンセルすれば一切課金されません。</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">支払い方法は？</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">クレジットカード（Visa, Mastercard, JCB, American Express）に対応しています。Stripeによる安全な決済処理を使用しています。</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">プランの変更はできますか？</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">はい。スタンダード↔ファミリー、月額↔年額の切り替えがいつでも可能です。管理画面から変更できます。</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">解約するとデータはどうなりますか？</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">解約後30日間はデータが保持されます。その間に再開すればデータはそのまま利用できます。</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">セルフホスト版はありますか？</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">はい。全機能を無料でお使いいただけるオープンソース版があります。DockerとNode.jsの基本的な知識が必要です。</dd>
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
	.plan-card.default-border {
		border-color: var(--color-border-default);
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
