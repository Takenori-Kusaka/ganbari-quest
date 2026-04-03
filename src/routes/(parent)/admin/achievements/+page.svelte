<script lang="ts">
import { enhance } from '$app/forms';
import { ErrorAlert, SuccessAlert } from '$lib/ui/components';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data, form } = $props();

// ユーザー選択を保持。undefined = デフォルト（先頭の子供）
let childIdOverride = $state<number | undefined>(undefined);
const selectedChildId = $derived(
	childIdOverride !== undefined && data.children.some((c) => c.id === childIdOverride)
		? childIdOverride
		: (data.children[0]?.id ?? 0),
);
let grantSuccess = $state(false);
let showCustomForm = $state(false);
let showTitleForm = $state(false);

const selectedChild = $derived(data.children.find((c) => c.id === selectedChildId));

const conditionTypeLabels: Record<string, string> = {
	total_count: '活動 総回数',
	activity_count: '特定活動 回数',
	category_count: 'カテゴリ かいすう',
	streak_days: '連続日数',
	activity_streak: '活動連続',
};

const titleConditionLabels: Record<string, string> = {
	level_reach: 'レベル とうたつ',
	achievement_count: '実績回数',
	activity_count: '活動回数',
	streak_days: '連続日数',
};
</script>

<svelte:head>
	<title>実績管理 - がんばりクエスト</title>
</svelte:head>

<div class="space-y-6">
	<!-- 子供選択 -->
	{#if data.children.length > 0}
		<div class="flex gap-2 mb-6 overflow-x-auto pb-2">
			{#each data.children as child (child.id)}
				<Button
					type="button"
					variant={selectedChildId === child.id ? 'primary' : 'outline'}
					size="sm"
					class="whitespace-nowrap {selectedChildId === child.id ? '' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}"
					onclick={() => {
						childIdOverride = child.id;
						grantSuccess = false;
					}}
				>
					{child.nickname}
					<span class="text-xs opacity-75">({child.unlockedCount}/{child.totalCount})</span>
				</Button>
			{/each}
		</div>

		{#if selectedChild}
			<!-- ライフイベント付与 -->
			<Card variant="default" padding="md" class="mb-6">
				{#snippet children()}
				<h3 class="text-lg font-bold text-gray-700 mb-3">🎓 ライフイベント付与</h3>
				<p class="text-sm text-gray-500 mb-3">
					保育園卒園・小学校卒業などの節目を記録し、ボーナスポイントを付与します。
				</p>

				{#if grantSuccess}
					<SuccessAlert message="ライフイベントを付与しました！" />
				{/if}

				{#if form?.error}
					<ErrorAlert message={form.error} severity="warning" />
				{/if}

				<div class="flex flex-col gap-2">
					{#each data.lifeEvents as event (event.id)}
						{@const alreadyGranted = selectedChild.achievements.find(
							(a) => a.id === event.id && a.unlockedAt !== null,
						)}
						<div
							class="flex items-center justify-between p-3 rounded-lg border
								{alreadyGranted ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-200'}"
						>
							<div class="flex items-center gap-3">
								<span class="text-2xl">{event.icon}</span>
								<div>
									<p class="font-bold text-gray-700">{event.name}</p>
									<p class="text-xs text-gray-500">
										+{event.bonusPoints}P
									</p>
								</div>
							</div>
							{#if alreadyGranted}
								<span class="text-sm text-yellow-600 font-bold">付与済み ✅</span>
							{:else}
								<form
									method="POST"
									action="?/grantLifeEvent"
									use:enhance={() => {
										grantSuccess = false;
										return async ({ result, update }) => {
											if (result.type === 'success') {
												grantSuccess = true;
											}
											await update();
										};
									}}
								>
									<input type="hidden" name="childId" value={selectedChildId} />
									<input type="hidden" name="achievementId" value={event.id} />
									<Button
										type="submit"
										variant="primary"
										size="sm"
									>
										付与する
									</Button>
								</form>
							{/if}
						</div>
					{/each}
				</div>
				{/snippet}
			</Card>

			<!-- 実績一覧 -->
			<Card variant="default" padding="md">
				{#snippet children()}
				<h3 class="text-lg font-bold text-gray-700 mb-3">
					{selectedChild.nickname}の実績
				</h3>

				<div class="flex flex-col gap-2">
					{#each selectedChild.achievements as achievement (achievement.id)}
						{@const unlocked =
							achievement.unlockedAt !== null ||
							achievement.highestUnlockedMilestone !== null}
						<div
							class="flex items-center gap-3 p-3 rounded-lg border
								{unlocked ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}"
						>
							<span class="text-2xl {unlocked ? '' : 'grayscale opacity-50'}">
								{achievement.icon}
							</span>
							<div class="flex-1 min-w-0">
								<p class="font-bold text-sm text-gray-700 truncate">
									{achievement.name}
								</p>
								<p class="text-xs text-gray-500">
									{#if achievement.repeatable && achievement.highestUnlockedMilestone}
										最高: {achievement.highestUnlockedMilestone}
										{#if achievement.nextMilestone}
											→ 次: {achievement.nextMilestone}
										{:else}
											（全達成）
										{/if}
									{:else if unlocked}
										達成済み
									{:else}
										{achievement.conditionLabel}
									{/if}
								</p>
							</div>
							<div class="text-right">
								<p class="text-xs font-bold text-blue-500">
									+{achievement.bonusPoints}P
								</p>
								{#if unlocked && achievement.unlockedAt}
									<p class="text-[10px] text-gray-400">
										{new Date(achievement.unlockedAt).toLocaleDateString('ja-JP')}
									</p>
								{/if}
							</div>
						</div>
					{/each}
				</div>
				{/snippet}
			</Card>
		{/if}
		<!-- カスタム実績 -->
		{#if data.isPremium && selectedChild}
			<Card variant="default" padding="md">
				{#snippet children()}
				<div class="flex items-center justify-between mb-3">
					<h3 class="text-lg font-bold text-gray-700">🏅 カスタム実績</h3>
					<Button type="button" variant="outline" size="sm" onclick={() => { showCustomForm = !showCustomForm; }}>
						{showCustomForm ? '閉じる' : '+ 作成'}
					</Button>
				</div>

				{#if showCustomForm}
					<form method="POST" action="?/createCustomAchievement" use:enhance class="space-y-3 mb-4 p-3 bg-gray-50 rounded-lg">
						<input type="hidden" name="childId" value={selectedChildId} />
						<FormField id="ca-name" label="実績名">
							<input id="ca-name" name="name" type="text" required maxlength="30" class="w-full px-3 py-2 border rounded-lg text-sm" placeholder="ピアノ100回マスター" />
						</FormField>
						<FormField id="ca-desc" label="説明（任意）">
							<input id="ca-desc" name="description" type="text" maxlength="50" class="w-full px-3 py-2 border rounded-lg text-sm" placeholder="ピアノの練習を100回がんばった！" />
						</FormField>
						<div class="grid grid-cols-2 gap-3">
							<FormField id="ca-icon" label="アイコン">
								<input id="ca-icon" name="icon" type="text" value="🏅" maxlength="4" class="w-full px-3 py-2 border rounded-lg text-sm" />
							</FormField>
							<FormField id="ca-bonus" label="ボーナスPT">
								<input id="ca-bonus" name="bonusPoints" type="number" value="100" min="0" max="1000" class="w-full px-3 py-2 border rounded-lg text-sm" />
							</FormField>
						</div>
						<FormField id="ca-condType" label="条件タイプ">
							<select id="ca-condType" name="conditionType" class="w-full px-3 py-2 border rounded-lg text-sm">
								<option value="total_count">活動 総回数</option>
								<option value="activity_count">特定活動の回数</option>
								<option value="category_count">カテゴリ回数</option>
								<option value="streak_days">連続日数</option>
								<option value="activity_streak">特定活動の連続日数</option>
							</select>
						</FormField>
						<FormField id="ca-condValue" label="目標値">
							<input id="ca-condValue" name="conditionValue" type="number" required min="1" max="9999" class="w-full px-3 py-2 border rounded-lg text-sm" placeholder="100" />
						</FormField>
						<Button type="submit" variant="primary" size="sm" class="w-full">作成する</Button>
					</form>
				{/if}

				{#if selectedChild.customAchievements.length === 0}
					<p class="text-sm text-gray-400 text-center py-2">カスタム実績はまだありません</p>
				{:else}
					<div class="flex flex-col gap-2">
						{#each selectedChild.customAchievements as ca (ca.id)}
							<div class="flex items-center justify-between p-3 rounded-lg border {ca.unlockedAt ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-200'}">
								<div class="flex items-center gap-3">
									<span class="text-2xl">{ca.icon}</span>
									<div>
										<p class="font-bold text-sm text-gray-700">{ca.name}</p>
										<p class="text-xs text-gray-500">
											{conditionTypeLabels[ca.conditionType] ?? ca.conditionType}: {ca.conditionValue}
											{#if ca.unlockedAt}
												<span class="text-yellow-600 font-bold ml-1">達成済み ✅</span>
											{/if}
										</p>
									</div>
								</div>
								<form method="POST" action="?/deleteCustomAchievement" use:enhance>
									<input type="hidden" name="id" value={ca.id} />
									<button type="submit" class="text-xs text-red-400 hover:text-red-600">削除</button>
								</form>
							</div>
						{/each}
					</div>
				{/if}
				{/snippet}
			</Card>

			<!-- カスタム称号 -->
			<Card variant="default" padding="md">
				{#snippet children()}
				<div class="flex items-center justify-between mb-3">
					<h3 class="text-lg font-bold text-gray-700">📛 カスタム称号</h3>
					<Button type="button" variant="outline" size="sm" onclick={() => { showTitleForm = !showTitleForm; }}>
						{showTitleForm ? '閉じる' : '+ 作成'}
					</Button>
				</div>

				{#if showTitleForm}
					<form method="POST" action="?/createCustomTitle" use:enhance class="space-y-3 mb-4 p-3 bg-gray-50 rounded-lg">
						<input type="hidden" name="childId" value={selectedChildId} />
						<FormField id="ct-name" label="称号名">
							<input id="ct-name" name="name" type="text" required maxlength="20" class="w-full px-3 py-2 border rounded-lg text-sm" placeholder="ピアノのめいじん" />
						</FormField>
						<div class="grid grid-cols-2 gap-3">
							<FormField id="ct-icon" label="アイコン">
								<input id="ct-icon" name="icon" type="text" value="📛" maxlength="4" class="w-full px-3 py-2 border rounded-lg text-sm" />
							</FormField>
							<FormField id="ct-condType" label="条件タイプ">
								<select id="ct-condType" name="conditionType" class="w-full px-3 py-2 border rounded-lg text-sm">
									<option value="level_reach">レベル到達</option>
									<option value="achievement_count">実績獲得数</option>
									<option value="activity_count">活動回数</option>
									<option value="streak_days">連続日数</option>
								</select>
							</FormField>
						</div>
						<FormField id="ct-condValue" label="目標値">
							<input id="ct-condValue" name="conditionValue" type="number" required min="1" max="9999" class="w-full px-3 py-2 border rounded-lg text-sm" placeholder="50" />
						</FormField>
						<Button type="submit" variant="primary" size="sm" class="w-full">作成する</Button>
					</form>
				{/if}

				{#if selectedChild.customTitles.length === 0}
					<p class="text-sm text-gray-400 text-center py-2">カスタム称号はまだありません</p>
				{:else}
					<div class="flex flex-col gap-2">
						{#each selectedChild.customTitles as ct (ct.id)}
							<div class="flex items-center justify-between p-3 rounded-lg border {ct.unlockedAt ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-200'}">
								<div class="flex items-center gap-3">
									<span class="text-2xl">{ct.icon}</span>
									<div>
										<p class="font-bold text-sm text-gray-700">{ct.name}</p>
										<p class="text-xs text-gray-500">
											{titleConditionLabels[ct.conditionType] ?? ct.conditionType}: {ct.conditionValue}
											{#if ct.unlockedAt}
												<span class="text-purple-600 font-bold ml-1">解放済み ✅</span>
											{/if}
										</p>
									</div>
								</div>
								<form method="POST" action="?/deleteCustomTitle" use:enhance>
									<input type="hidden" name="id" value={ct.id} />
									<button type="submit" class="text-xs text-red-400 hover:text-red-600">削除</button>
								</form>
							</div>
						{/each}
					</div>
				{/if}
				{/snippet}
			</Card>
		{:else if !data.isPremium}
			<Card variant="default" padding="md">
				{#snippet children()}
				<div class="text-center py-4">
					<p class="text-2xl mb-2">🏅</p>
					<p class="font-bold text-gray-700 mb-1">カスタム実績・称号</p>
					<p class="text-sm text-gray-500 mb-3">お子さまだけのオリジナル実績を作成できます</p>
					<a href="/admin/license" class="text-sm text-blue-500 hover:underline">プレミアムプランで利用可能 →</a>
				</div>
				{/snippet}
			</Card>
		{/if}

	{:else}
		<div class="text-center text-gray-500 py-12">
			<p class="text-4xl mb-2">👧</p>
			<p class="font-bold">子供が登録されていません</p>
		</div>
	{/if}
</div>
