<script lang="ts">
let { data } = $props();

const license = $derived(data.license);

const planLabel = (plan: string) => {
	switch (plan) {
		case 'monthly':
			return '月額プラン';
		case 'yearly':
			return '年額プラン';
		case 'lifetime':
			return '永久ライセンス';
		case 'free':
			return '無料プラン';
		default:
			return plan;
	}
};

const statusLabel = (status: string) => {
	switch (status) {
		case 'active':
			return { text: '有効', color: 'bg-green-100 text-green-700', icon: '✅' };
		case 'grace_period':
			return { text: '猶予期間', color: 'bg-yellow-100 text-yellow-700', icon: '⚠️' };
		case 'suspended':
			return { text: '停止中', color: 'bg-orange-100 text-orange-700', icon: '⏸️' };
		case 'terminated':
			return { text: '解約済み', color: 'bg-red-100 text-red-700', icon: '❌' };
		default:
			return { text: status, color: 'bg-gray-100 text-gray-700', icon: '❓' };
	}
};

const status = $derived(statusLabel(license.status));
</script>

<svelte:head>
	<title>ライセンス管理 - がんばりクエスト</title>
</svelte:head>

<div class="space-y-6">
	<h2 class="text-xl font-bold text-gray-700">ライセンス管理</h2>

	<!-- 現在のプラン -->
	<section class="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
		<h3 class="text-lg font-semibold text-gray-600 mb-4">現在のプラン</h3>

		<div class="grid gap-4">
			<div class="flex items-center justify-between py-2 border-b border-gray-50">
				<span class="text-sm text-gray-500">プラン</span>
				<span class="text-sm font-semibold text-gray-700">{planLabel(license.plan ?? 'free')}</span>
			</div>

			<div class="flex items-center justify-between py-2 border-b border-gray-50">
				<span class="text-sm text-gray-500">ステータス</span>
				<span class="text-xs font-medium px-2.5 py-1 rounded-full {status.color}">
					{status.icon} {status.text}
				</span>
			</div>

			{#if license.licenseKey}
				<div class="flex items-center justify-between py-2 border-b border-gray-50">
					<span class="text-sm text-gray-500">ライセンスキー</span>
					<code class="text-xs bg-gray-50 px-2 py-1 rounded font-mono text-gray-600">
						{license.licenseKey}
					</code>
				</div>
			{/if}

			<div class="flex items-center justify-between py-2 border-b border-gray-50">
				<span class="text-sm text-gray-500">家族名</span>
				<span class="text-sm text-gray-700">{license.tenantName}</span>
			</div>

			<div class="flex items-center justify-between py-2">
				<span class="text-sm text-gray-500">登録日</span>
				<span class="text-sm text-gray-700">
					{new Date(license.createdAt).toLocaleDateString('ja-JP')}
				</span>
			</div>
		</div>
	</section>

	<!-- ステータス別メッセージ -->
	{#if license.status === 'grace_period'}
		<section class="bg-yellow-50 rounded-xl p-4 border border-yellow-200">
			<h3 class="text-sm font-semibold text-yellow-800 mb-1">⚠️ 猶予期間中</h3>
			<p class="text-sm text-yellow-700">
				お支払いの確認が取れていません。猶予期間内にお支払いを完了してください。
				期間を過ぎるとサービスが停止されます。
			</p>
		</section>
	{:else if license.status === 'suspended'}
		<section class="bg-orange-50 rounded-xl p-4 border border-orange-200">
			<h3 class="text-sm font-semibold text-orange-800 mb-1">⏸️ サービス停止中</h3>
			<p class="text-sm text-orange-700">
				ライセンスが停止されています。データは保持されていますが、
				新しい活動の記録やポイントの付与はできません。
				お支払いを完了するとサービスが再開されます。
			</p>
		</section>
	{:else if license.status === 'terminated'}
		<section class="bg-red-50 rounded-xl p-4 border border-red-200">
			<h3 class="text-sm font-semibold text-red-800 mb-1">❌ 解約済み</h3>
			<p class="text-sm text-red-700">
				このアカウントは解約されています。データは一定期間保持されますが、
				その後削除されます。再開をご希望の場合はお問い合わせください。
			</p>
		</section>
	{/if}

	<!-- 操作ボタン -->
	<section class="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
		<h3 class="text-lg font-semibold text-gray-600 mb-4">プラン管理</h3>

		<div class="grid gap-3">
			<button
				disabled
				class="w-full px-4 py-3 bg-gray-100 text-gray-400 text-sm font-medium rounded-lg cursor-not-allowed"
			>
				プラン変更（準備中）
			</button>
			<button
				disabled
				class="w-full px-4 py-3 bg-gray-100 text-gray-400 text-sm font-medium rounded-lg cursor-not-allowed"
			>
				支払い情報の更新（準備中）
			</button>
			<button
				disabled
				class="w-full px-4 py-3 bg-gray-100 text-gray-400 text-sm font-medium rounded-lg cursor-not-allowed"
			>
				解約（準備中）
			</button>
		</div>

		<p class="text-xs text-gray-400 mt-3 text-center">
			決済機能は近日対応予定です
		</p>
	</section>

	<!-- 支払い履歴 -->
	<section class="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
		<h3 class="text-lg font-semibold text-gray-600 mb-4">支払い履歴</h3>
		<p class="text-sm text-gray-400 text-center py-4">
			支払い履歴はまだありません
		</p>
	</section>
</div>
