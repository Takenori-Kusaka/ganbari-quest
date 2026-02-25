<script lang="ts">
	import { enhance } from '$app/forms';
</script>

<div data-theme="admin" class="min-h-dvh bg-gradient-to-b from-blue-50 to-blue-100 p-4">
	<div class="max-w-lg mx-auto">
		<div class="text-center mb-8 pt-8">
			<h1 class="text-2xl font-bold text-gray-700">かんりがめん</h1>
			<p class="text-sm text-gray-500 mt-2">ここから設定やポイント管理ができます</p>
		</div>

		<div class="bg-white rounded-2xl p-6 shadow-sm mb-4">
			<p class="text-gray-500 text-center">管理機能は #0018 で実装予定です</p>
		</div>

		<form method="POST" action="/api/v1/auth/logout" use:enhance>
			<button
				type="submit"
				class="w-full py-3 bg-gray-200 text-gray-600 rounded-xl font-medium hover:bg-gray-300 transition-colors"
			>
				ログアウト
			</button>
		</form>
	</div>
</div>
