<script lang="ts">
let { data } = $props();
</script>

<svelte:head>
	<title>セットアップ完了 - がんばりクエスト</title>
</svelte:head>

<div class="text-center">
	<div class="text-5xl mb-4">🎉</div>
	<h2 class="text-xl font-bold text-gray-700 mb-2">セットアップ完了！</h2>
	<p class="text-sm text-gray-500 mb-4">
		{data.childCount}人の子供が登録されました。
	</p>

	{#if data.importedActivities > 0}
		<div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
			<p class="text-sm text-green-700 font-medium">
				{data.importedActivities}件の活動を追加しました
			</p>
			{#if data.skippedActivities > 0}
				<p class="text-xs text-green-600 mt-1">
					（{data.skippedActivities}件は既に登録済みのためスキップ）
				</p>
			{/if}
		</div>
	{/if}

	<p class="text-sm text-gray-500 mb-6">
		管理画面にログインして、活動の設定を行いましょう。
	</p>

	<a
		href="/login"
		class="inline-block w-full py-2 bg-blue-500 text-white font-bold rounded-lg hover:bg-blue-600 transition-colors text-center"
	>
		管理画面へログイン
	</a>
</div>
