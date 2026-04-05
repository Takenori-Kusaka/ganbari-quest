<script lang="ts">
import { enhance } from '$app/forms';
import { goto } from '$app/navigation';
import { formatChildName } from '$lib/domain/child-display';
import Button from '$lib/ui/primitives/Button.svelte';

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
		<div class="mb-2">
			<span class="celebration-emoji text-[4rem] inline-block">🎉</span>
		</div>

		<h2 class="text-xl font-bold text-gray-700 mt-4 mb-2">
			{formatChildName(child?.nickname, 'vocative')}すごい！
		</h2>

		<p class="text-sm text-gray-500 mb-4">
			「{resultName}」をきろくしたよ！
		</p>

		<div class="points-display border-2 border-[var(--color-gold-600)] rounded-2xl p-4 my-4">
			<div class="text-[2rem] font-extrabold text-[var(--color-gold-700)]">+{resultPoints}pt</div>
			<div class="text-sm text-[var(--color-gold-700)] font-semibold">ポイントゲット！</div>
		</div>

		{#if resultLevelUp}
			<div class="my-3">
				<div class="flex items-center justify-center gap-2 text-xl font-bold">
					<span class="text-[var(--color-neutral-400)]">Lv.{resultLevelUp.levelBefore}</span>
					<span class="text-[var(--color-gold-600)]">→</span>
					<span class="text-[var(--color-gold-600)] text-2xl">Lv.{resultLevelUp.levelAfter}</span>
				</div>
				<p class="text-sm text-amber-600 font-bold">レベルアップ！</p>
			</div>
		{/if}

		<Button onclick={goToComplete} variant="primary" size="md" class="w-full mt-6 text-sm">
			ぼうけんをはじめる！
		</Button>
	</div>
{:else}
	<!-- 活動選択画面 -->
	<div class="text-center mb-4">
		<div class="text-3xl mb-2">⚔️</div>
		<h2 class="text-lg font-bold text-gray-700">はじめてのぼうけん！</h2>
		<p class="text-sm text-gray-500 mt-1">
			{formatChildName(child?.nickname, 'vocative')}さいしょのがんばりを<br />いっしょにきろくしよう！
		</p>
	</div>

	{#if data.activities.length === 0}
		<!-- 活動未登録の場合はスキップ -->
		<div class="text-center">
			<p class="text-sm text-gray-400 mb-4">
				まだ活動が登録されていません。あとから管理画面で追加できます。
			</p>
			<form method="POST" action="?/skip">
				<Button type="submit" variant="primary" size="md" class="w-full text-sm">次へすすむ</Button>
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

			<div class="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2">
				{#each data.activities as activity (activity.id)}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onclick={() => selectActivity(activity.id)}
						class="flex flex-col items-center gap-1 px-2 py-4 border-2 rounded-2xl bg-white cursor-pointer transition-all duration-150 h-auto {selectedActivityId === activity.id ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-200)] shadow-[0_0_0_3px_rgba(59,130,246,0.2)]' : 'border-[var(--color-neutral-200)] hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]'}"
					>
						<span class="text-[2rem]">{activity.icon || '⭐'}</span>
						<span class="text-xs font-semibold text-[var(--color-text)] text-center leading-tight">{activity.name}</span>
						<span class="text-[0.625rem] text-[var(--color-gold-600)] font-bold">+{activity.basePoints}pt</span>
					</Button>
				{/each}
			</div>

			{#if selectedActivityId}
				<Button
					type="submit"
					variant="success"
					size="md"
					disabled={submitting}
					class="w-full mt-4 text-sm record-button"
				>
					{#if submitting}
						きろくちゅう...
					{:else}
						タップしてきろく！
					{/if}
				</Button>
			{:else}
				<p class="text-xs text-gray-400 text-center mt-4">
					がんばりをえらんでね！
				</p>
			{/if}
		</form>

		<div class="text-center mt-3">
			<form method="POST" action="?/skip">
				<Button type="submit" variant="ghost" size="sm" class="text-xs underline">
					あとでやる（スキップ）
				</Button>
			</form>
		</div>
	{/if}
{/if}

<style>
	.points-display { background: var(--gradient-gold); }
	.celebration-emoji { animation: bounce 0.6s ease-in-out infinite alternate; }
	@keyframes bounce {
		from { transform: translateY(0); }
		to { transform: translateY(-12px); }
	}
	.success-screen { animation: fadeIn 0.3s ease-out; }
	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(8px); }
		to { opacity: 1; transform: translateY(0); }
	}
	:global(.record-button) { animation: pulse 1.5s ease-in-out infinite; }
	@keyframes pulse {
		0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
		50% { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
	}
</style>
