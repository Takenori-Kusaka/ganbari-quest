<script lang="ts">
import { enhance } from '$app/forms';
import { goto } from '$app/navigation';

let { data, form } = $props();
let submitting = $state(false);
let selectedActivityId = $state<number | null>(null);

const child = $derived(data.child);

// 記録成功後の演出状態
const recorded = $derived(form?.success === true);
const resultName = $derived(
	((form as Record<string, unknown> | null)?.activityName as string) ?? '',
);
const resultPoints = $derived(
	((form as Record<string, unknown> | null)?.totalPoints as number) ?? 0,
);
const resultLevelUp = $derived(
	((form as Record<string, unknown> | null)?.levelUp as {
		levelBefore: number;
		levelAfter: number;
	} | null) ?? null,
);

function selectActivity(id: number) {
	if (!recorded) {
		selectedActivityId = id;
	}
}

function goToComplete() {
	const params = new URLSearchParams();
	if (data.imported > 0) params.set('imported', String(data.imported));
	if (data.skipped > 0) params.set('skipped', String(data.skipped));
	const qs = params.toString();
	goto(`/setup/complete${qs ? `?${qs}` : ''}`);
}
</script>

<svelte:head>
	<title>はじめてのぼうけん - がんばりクエスト セットアップ</title>
</svelte:head>

{#if recorded}
	<!-- 成功演出 -->
	<div class="text-center success-screen">
		<div class="celebration">
			<span class="celebration-emoji">🎉</span>
		</div>

		<h2 class="text-xl font-bold text-gray-700 mt-4 mb-2">
			{child?.nickname}ちゃん すごい！
		</h2>

		<p class="text-sm text-gray-500 mb-4">
			「{resultName}」をきろくしたよ！
		</p>

		<div class="points-display">
			<div class="points-value">+{resultPoints}pt</div>
			<div class="points-label">ポイントゲット！</div>
		</div>

		{#if resultLevelUp}
			<div class="level-up-display">
				<div class="level-badge">
					<span class="level-before">Lv.{resultLevelUp.levelBefore}</span>
					<span class="level-arrow">→</span>
					<span class="level-after">Lv.{resultLevelUp.levelAfter}</span>
				</div>
				<p class="text-sm text-amber-600 font-bold">レベルアップ！</p>
			</div>
		{/if}

		<button
			onclick={goToComplete}
			class="w-full mt-6 py-3 bg-blue-500 text-white font-bold rounded-lg hover:bg-blue-600 transition-colors text-sm"
		>
			ぼうけんをはじめる！
		</button>
	</div>
{:else}
	<!-- 活動選択画面 -->
	<div class="text-center mb-4">
		<div class="text-3xl mb-2">⚔️</div>
		<h2 class="text-lg font-bold text-gray-700">はじめてのぼうけん！</h2>
		<p class="text-sm text-gray-500 mt-1">
			{child?.nickname}ちゃん、さいしょのがんばりを<br />いっしょにきろくしよう！
		</p>
	</div>

	{#if data.activities.length === 0}
		<!-- 活動未登録の場合はスキップ -->
		<div class="text-center">
			<p class="text-sm text-gray-400 mb-4">
				まだ活動が登録されていません。あとから管理画面で追加できます。
			</p>
			<form method="POST" action="?/skip">
				<button
					type="submit"
					class="w-full py-2 bg-blue-500 text-white font-bold rounded-lg hover:bg-blue-600 transition-colors text-sm"
				>
					次へすすむ
				</button>
			</form>
		</div>
	{:else}
		<form
			method="POST"
			action="?/record"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					submitting = false;
					await update();
				};
			}}
		>
			<input type="hidden" name="childId" value={child?.id ?? ''} />
			<input type="hidden" name="activityId" value={selectedActivityId ?? ''} />

			<div class="activity-grid">
				{#each data.activities as activity (activity.id)}
					<button
						type="button"
						onclick={() => selectActivity(activity.id)}
						class="activity-card"
						class:activity-card--selected={selectedActivityId === activity.id}
					>
						<span class="activity-icon">{activity.icon || '⭐'}</span>
						<span class="activity-name">{activity.name}</span>
						<span class="activity-points">+{activity.basePoints}pt</span>
					</button>
				{/each}
			</div>

			{#if selectedActivityId}
				<button
					type="submit"
					disabled={submitting}
					class="w-full mt-4 py-3 bg-green-500 text-white font-bold rounded-xl hover:bg-green-600 transition-all disabled:opacity-50 text-sm record-button"
				>
					{#if submitting}
						きろくちゅう...
					{:else}
						タップしてきろく！
					{/if}
				</button>
			{:else}
				<p class="text-xs text-gray-400 text-center mt-4">
					がんばりをえらんでね！
				</p>
			{/if}
		</form>

		<div class="text-center mt-3">
			<form method="POST" action="?/skip">
				<button
					type="submit"
					class="text-xs text-gray-400 hover:text-gray-600 underline"
				>
					あとでやる（スキップ）
				</button>
			</form>
		</div>
	{/if}
{/if}

<style>
	.celebration {
		margin-bottom: 8px;
	}

	.celebration-emoji {
		font-size: 4rem;
		display: inline-block;
		animation: bounce 0.6s ease-in-out infinite alternate;
	}

	@keyframes bounce {
		from { transform: translateY(0); }
		to { transform: translateY(-12px); }
	}

	.success-screen {
		animation: fadeIn 0.3s ease-out;
	}

	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(8px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.points-display {
		background: linear-gradient(135deg, #fef3c7, #fde68a);
		border: 2px solid #f59e0b;
		border-radius: 16px;
		padding: 16px;
		margin: 16px 0;
	}

	.points-value {
		font-size: 2rem;
		font-weight: 800;
		color: #b45309;
	}

	.points-label {
		font-size: 0.875rem;
		color: #92400e;
		font-weight: 600;
	}

	.level-up-display {
		margin: 12px 0;
	}

	.level-badge {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		font-size: 1.25rem;
		font-weight: 700;
	}

	.level-before {
		color: #9ca3af;
	}

	.level-arrow {
		color: #f59e0b;
	}

	.level-after {
		color: #f59e0b;
		font-size: 1.5rem;
	}

	.activity-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
		gap: 8px;
	}

	.activity-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 16px 8px;
		border: 2px solid #e5e7eb;
		border-radius: 16px;
		background: white;
		cursor: pointer;
		transition: all 0.15s;
	}

	.activity-card:hover {
		border-color: #93c5fd;
		background: #eff6ff;
	}

	.activity-card--selected {
		border-color: #3b82f6;
		background: #dbeafe;
		box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
	}

	.activity-icon {
		font-size: 2rem;
	}

	.activity-name {
		font-size: 0.75rem;
		font-weight: 600;
		color: #374151;
		text-align: center;
		line-height: 1.2;
	}

	.activity-points {
		font-size: 0.625rem;
		color: #f59e0b;
		font-weight: 700;
	}

	.record-button {
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
		50% { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
	}
</style>
