<script lang="ts">
import { enhance } from '$app/forms';
import type { ActivityPackInfo } from './activity-types';

interface Props {
	activityPacks: ActivityPackInfo[];
	onimported: (message: string) => void;
	onclose: () => void;
}

let { activityPacks, onimported, onclose }: Props = $props();

let importLoading = $state(false);
let fileImportLoading = $state(false);
</script>

<div class="bg-green-50 rounded-xl p-4 shadow-sm space-y-3 border border-green-200">
	<h3 class="font-bold text-green-700">📥 活動パックからインポート</h3>
	<p class="text-xs text-green-600">おすすめの活動セットを一括追加できます（重複はスキップ）</p>
	{#if activityPacks.length === 0}
		<p class="text-sm text-gray-500">利用可能なパックがありません</p>
	{:else}
		<div class="grid grid-cols-1 gap-2">
			{#each activityPacks as pack}
				<form
					method="POST"
					action="?/importPack"
					use:enhance={() => {
						importLoading = true;
						return async ({ result, update }) => {
							importLoading = false;
							if (result.type === 'success' && result.data && 'importResult' in result.data) {
								const d = result.data as Record<string, unknown>;
								onimported(`📦 「${d.packName}」: ${d.imported}件追加、${d.skipped}件スキップ`);
								onclose();
							}
							await update({ reset: false });
						};
					}}
				>
					<input type="hidden" name="packId" value={pack.packId} />
					<button
						type="submit"
						disabled={importLoading}
						class="w-full flex items-center gap-3 p-3 bg-white rounded-lg border border-green-200 hover:border-green-400 hover:bg-green-50 transition-colors text-left"
					>
						<span class="text-2xl">{pack.icon}</span>
						<div class="flex-1 min-w-0">
							<p class="font-bold text-sm text-gray-800">{pack.packName}</p>
							<p class="text-xs text-gray-500">{pack.activityCount}件 ・ {pack.targetAgeMin}〜{pack.targetAgeMax}歳</p>
						</div>
						<span class="text-xs font-bold text-green-600 shrink-0">
							{importLoading ? '処理中...' : '追加'}
						</span>
					</button>
				</form>
			{/each}
		</div>
	{/if}

	<!-- ファイルからインポート -->
	<div class="border-t border-green-200 pt-3 mt-3">
		<h4 class="font-bold text-green-700 text-sm mb-2">📁 ファイルからインポート</h4>
		<p class="text-xs text-green-600 mb-2">JSON または CSV ファイルから活動を一括追加（重複はスキップ）</p>
		<form
			method="POST"
			action="?/importFile"
			enctype="multipart/form-data"
			use:enhance={() => {
				fileImportLoading = true;
				return async ({ result, update }) => {
					fileImportLoading = false;
					if (result.type === 'success' && result.data && 'importResult' in result.data) {
						const d = result.data as Record<string, unknown>;
						onimported(`📁 「${d.packName}」: ${d.imported}件追加、${d.skipped}件スキップ`);
						onclose();
					}
					await update({ reset: false });
				};
			}}
		>
			<div class="flex gap-2 items-center">
				<input type="file" name="file" accept=".json,.csv" class="flex-1 text-sm file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-green-100 file:text-green-700 file:font-bold file:text-xs" required />
				<button type="submit" disabled={fileImportLoading} class="px-4 py-2 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 disabled:opacity-50">
					{fileImportLoading ? '処理中...' : 'インポート'}
				</button>
			</div>
		</form>
	</div>
</div>
