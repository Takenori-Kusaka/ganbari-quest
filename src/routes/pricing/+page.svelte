<script lang="ts">
import Card from '$lib/ui/primitives/Card.svelte';

const plans = [
	{
		id: 'free' as const,
		name: 'フリー',
		price: '¥0',
		unit: '',
		description: '基本機能で気軽にスタート。お子さまのゲーム体験は一切制限なし。',
		features: [
			'お子さま 2人まで登録',
			'プリセット活動の利用',
			'カスタム活動 3個まで',
			'レベル・ポイント・実績・称号',
			'シールガチャ・ログインボーナス',
			'チェックリスト（テンプレート）',
			'おうえんスタンプ送信',
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
			'お子さまの登録人数：無制限',
			'オリジナル活動の作成：無制限',
			'活動アイコンの変更',
			'チェックリスト自由作成',
			'カスタム報酬設定',
			'おうえんスタンプ（全種類）',
			'週次メールレポート',
			'活動バランスの見える化',
			'1年間の履歴保持',
			'Discordサポート',
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
			'きょうだいランキング',
			'カスタムレベル称号',
			'無制限の履歴保持',
			'Discordサポート（優先対応）',
		],
	},
];

const featureDetails = [
	{
		category: '基本機能（全プラン共通）',
		items: [
			{
				name: 'プリセット活動',
				description:
					'「べんきょう」「うんどう」「おてつだい」など、最初から用意されている定番の活動です。すぐに活動記録を始められます。',
			},
			{
				name: 'レベル・ポイント',
				description:
					'活動を記録するたびにポイント（XP）がたまり、レベルが上がります。お子さまのがんばりが目に見える形で成長していきます。',
			},
			{
				name: '実績・称号',
				description:
					'「3日連続で活動を記録」「合計100ポイント達成」など、特別な条件を達成するとバッジや称号がもらえます。',
			},
			{
				name: 'シールガチャ',
				description:
					'活動を記録するとシールガチャが回せます。レア度の異なるシールを集めるコレクション要素で、お子さまの記録モチベーションを高めます。',
			},
			{
				name: 'ログインボーナス',
				description:
					'毎日アプリを開くとボーナスポイントがもらえます。連続ログインでボーナスが増えていきます。',
			},
			{
				name: 'チェックリスト（テンプレート）',
				description:
					'「おでかけのじゅんび」「あさのしたく」など、やることリストのテンプレートを使えます。項目を一つずつチェックしていく達成感が味わえます。',
			},
			{
				name: 'おうえんスタンプ',
				description:
					'保護者からお子さまへ「がんばったね！」などのスタンプを送れます。お子さまの画面に表示され、やる気アップにつながります。',
			},
		],
	},
	{
		category: 'スタンダード以上の機能',
		items: [
			{
				name: 'オリジナル活動の作成',
				description:
					'「ピアノれんしゅう」「犬のさんぽ」など、お子さまに合わせた活動を自由に追加できます。アイコンも変更可能です。',
			},
			{
				name: 'チェックリスト自由作成',
				description:
					'テンプレートだけでなく、完全オリジナルのチェックリストを作成できます。お子さまの日課や目標に合わせて項目を自由に設定できます。',
			},
			{
				name: 'カスタム報酬設定',
				description:
					'「おやつを選べる」「ゲーム30分」など、ポイントと交換できる報酬を自由に設定できます。お子さまと相談して決めるのがおすすめです。',
			},
			{
				name: '週次メールレポート',
				description:
					'1週間の活動をまとめたレポートが登録メールアドレスに届きます。忙しくてアプリを開けない日でも、お子さまのがんばりを把握できます。',
			},
			{
				name: '活動バランスの見える化',
				description:
					'「うんどう」「べんきょう」「おてつだい」など、カテゴリごとの活動量をチャートで確認できます。偏りに気づいて声かけに活かせます。',
			},
		],
	},
	{
		category: 'ファミリープランの機能',
		items: [
			{
				name: '月次比較レポート',
				description:
					'月ごとの活動量や成長の変化を比較できるレポートです。先月と今月でどれだけ成長したかが一目でわかります。',
			},
			{
				name: 'きょうだいランキング',
				description:
					'きょうだい間でポイントや活動回数を比較できるランキングです。楽しく競い合いながら、一緒にがんばれます。',
			},
			{
				name: 'カスタムレベル称号',
				description:
					'レベルに応じた称号を自由にカスタマイズできます。お子さまの好きなテーマに合わせた称号で冒険をもっと楽しく。',
			},
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
		&#x1F4A1; お子さまが楽しめる冒険の仕組み（レベル・ポイント・実績・称号・シールガチャ・コンボ）は<strong>全プラン共通</strong>で制限なし
	</p>

	<section class="feature-details mb-12">
		<h2 class="text-[1.25rem] font-bold text-[var(--color-neutral-700)] text-center mb-6">各機能のくわしい説明</h2>
		{#each featureDetails as group}
			<h3 class="text-[0.95rem] font-semibold text-[var(--color-neutral-600)] mt-6 mb-3 pl-1">{group.category}</h3>
			{#each group.items as item}
				<details class="feature-accordion">
					<summary class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] cursor-pointer py-3 px-4">
						{item.name}
					</summary>
					<p class="text-[0.85rem] text-[var(--color-neutral-500)] px-4 pb-4 leading-relaxed">{item.description}</p>
				</details>
			{/each}
		{/each}
	</section>

	<Card padding="lg" class="bg-[var(--color-surface-muted)]">
		{#snippet children()}
		<h2 class="text-[1.1rem] font-semibold text-[var(--color-neutral-700)] mb-4">よくある質問</h2>
		<dl>
			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">無料プランでも十分使えますか？</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">はい。プリセットの活動とチェックリストで基本的な機能はお使いいただけます。お子さまのゲーム体験（レベル、ポイント、実績、称号、シールガチャ）は無料でも一切制限ありません。</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">無料トライアル中にキャンセルできますか？</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">はい。トライアル期間中にキャンセルすれば一切課金されません。キャンセル後はフリープランに移行し、データはそのまま保持されます。</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">支払い方法は？</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">クレジットカード（Visa, Mastercard, JCB, American Express）に対応しています。Stripeによる安全な決済処理を使用しており、カード情報は当サービスのサーバーには保存されません。</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">課金日はいつですか？</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">お申込み日を起算日として、毎月（または毎年）自動更新されます。</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">プランの変更はできますか？</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">はい。スタンダード↔ファミリー、月額↔年額の切り替えがいつでも可能です。管理画面の「プラン・お支払い」から変更できます。</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">解約するとどうなりますか？</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">解約後も残りの課金期間は引き続きご利用いただけます。期間終了後はフリープランに移行し、30日間はデータが保持されます。その間に再開すればデータはそのまま利用できます。</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">年額プランを途中解約した場合は？</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">残りの期間は引き続きご利用いただけますが、日割りでの返金は行っておりません。</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">セルフホスト版はありますか？</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">はい。全機能を無料でお使いいただけるオープンソース版があります。DockerとNode.jsの基本的な知識が必要です。</dd>
		</dl>
		{/snippet}
	</Card>
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
	.feature-accordion {
		border-bottom: 1px solid var(--color-border-default);
	}
	.feature-accordion summary {
		list-style: none;
	}
	.feature-accordion summary::before {
		content: '▶';
		display: inline-block;
		margin-right: 8px;
		font-size: 0.7rem;
		transition: transform 0.2s;
		color: var(--color-neutral-400);
	}
	.feature-accordion[open] summary::before {
		transform: rotate(90deg);
	}
</style>
