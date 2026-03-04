<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>セットアップ完了 - がんばりクエスト</title>
</svelte:head>

<div class="text-center">
	<div class="text-5xl mb-4">🎉</div>
	<h2 class="text-xl font-bold text-gray-700 mb-2">セットアップ完了！</h2>
	<p class="text-sm text-gray-500 mb-6">
		{data.childCount}人の子供が登録されました。<br />
		管理画面にログインして、活動の設定を行いましょう。
	</p>

	<a
		href="/login"
		class="inline-block w-full py-2 bg-blue-500 text-white font-bold rounded-lg hover:bg-blue-600 transition-colors text-center"
	>
		管理画面へログイン
	</a>
</div>
