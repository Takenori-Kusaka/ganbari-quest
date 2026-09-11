<script lang="ts">
import { enhance } from '$app/forms';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { formatChildName } from '$lib/domain/child-display';
import type { ActivityId } from '$lib/domain/ids';
import {
	APP_LABELS,
	PAGE_TITLES,
	SETUP_FIRST_ADVENTURE_LABELS,
	SETUP_LABELS,
} from '$lib/domain/labels';
// #4908: server が返す levelUp の実体は LevelUpInfo (oldLevel/newLevel)。型で結び、
// フィールド名の無音の食い違い (levelBefore/levelAfter) を二度と作らない。
import type { LevelUpInfo } from '$lib/server/services/status-service';
import { ErrorAlert } from '$lib/ui/components';
import Button from '$lib/ui/primitives/Button.svelte';

let { data, form } = $props();
let submitting = $state(false);
let selectedActivityId = $state<ActivityId | null>(null);

const child = $derived(data.child);

// 失敗 banner を「押したボタンの視界」に必ず入れる。
// `use:enhance` の失敗は navigation を起こさないためスクロール位置が据え置きになり、
// banner を描いただけでは画面外に置ける (= 修正前と同じ「無反応」に見える)。
// 出た瞬間に focus を移して scroll する = WCAG 3.3.1 のエラーサマリ定石 (GOV.UK パターン)。
let errorBanner = $state<HTMLElement | null>(null);
let lastFocusedError = $state<string | null>(null);
$effect(() => {
	const message = (form as { error?: string } | null)?.error ?? null;
	if (!message) {
		lastFocusedError = null;
		return;
	}
	if (message === lastFocusedError || !errorBanner) return;
	lastFocusedError = message;
	errorBanner.focus();
	// jsdom / 一部の古いブラウザは scrollIntoView を持たない。focus だけでも
	// ブラウザ既定のスクロールが働くので、無い環境で落とさない。
	errorBanner.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
});

// 記録成功後の演出状態
const recorded = $derived(form?.success === true);
const resultName = $derived(
	((form as Record<string, unknown> | null)?.activityName as string) ?? '',
);
const resultPoints = $derived(
	((form as Record<string, unknown> | null)?.totalPoints as number) ?? 0,
);
const resultLevelUp = $derived(
	((form as Record<string, unknown> | null)?.levelUp as LevelUpInfo | null) ?? null,
);
// #4908: カードは記録前に活動の基礎点 (倍率適用前) を表示しているため、記録後の合計点が
// ストリーク / 習熟 / ボーナスルール等で膨らむと「10 と言ったのに 20」に見える。server が返す
// `basePoints` (倍率適用後の基礎点、streak/mastery/ボーナスルール抜き) と `totalPoints` が
// 食い違うときだけ内訳を出す (ADR-0062 §1 類似: 表示された約束と実結果の不一致は必ず説明を添える)。
const resultBasePoints = $derived(
	((form as Record<string, unknown> | null)?.basePoints as number) ?? resultPoints,
);
const resultPointsBreakdown = $derived(
	resultBasePoints !== resultPoints
		? SETUP_FIRST_ADVENTURE_LABELS.pointsBreakdown(resultBasePoints, resultPoints)
		: null,
);

function selectActivity(id: ActivityId) {
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
	<title>{PAGE_TITLES.setupFirstAdventure}{APP_LABELS.setupPageTitleSuffix}</title>
</svelte:head>

{#if recorded}
	<!-- 成功演出 -->
	<div class="text-center success-screen">
		<div class="mb-2">
			<span class="celebration-emoji text-[4rem] inline-block">🎉</span>
		</div>

		<h2 class="text-xl font-bold text-[var(--color-text)] mt-4 mb-2">
			{SETUP_FIRST_ADVENTURE_LABELS.successTitle(formatChildName(child?.nickname, 'vocative'))}
		</h2>

		<p class="text-sm text-[var(--color-text-muted)] mb-4">
			{SETUP_FIRST_ADVENTURE_LABELS.recordedDesc(resultName)}
		</p>

		<div
			class="points-display border-2 border-[var(--color-gold-600)] rounded-2xl p-4 my-4"
			data-testid="first-adventure-points-display"
		>
			<div class="text-[2rem] font-extrabold text-[var(--color-text-gold)]">+{resultPoints}pt</div>
			{#if resultPointsBreakdown}
				<div class="text-xs text-[var(--color-text-gold)]">{resultPointsBreakdown}</div>
			{/if}
			<div class="text-sm text-[var(--color-text-gold)] font-semibold">{SETUP_FIRST_ADVENTURE_LABELS.pointsGetLabel}</div>
		</div>

		{#if resultLevelUp}
			<div class="my-3">
				<div class="flex items-center justify-center gap-2 text-xl font-bold">
					<span class="text-[var(--color-neutral-400)]">Lv.{resultLevelUp.oldLevel}</span>
					<span class="text-[var(--color-text-gold)]">→</span>
					<span class="text-[var(--color-text-gold)] text-2xl">Lv.{resultLevelUp.newLevel}</span>
				</div>
				<p class="text-sm text-[var(--color-feedback-warning-text)] font-bold">{SETUP_FIRST_ADVENTURE_LABELS.levelUpLabel}</p>
			</div>
		{/if}

		<Button onclick={goToComplete} variant="primary" size="md" class="w-full mt-6 text-sm">
			{SETUP_FIRST_ADVENTURE_LABELS.startAdventureButton}
		</Button>
	</div>
{:else}
	<!-- #4512 の失敗が画面に出ていなかった (form.error を一度も描画していなかった) ため、
	     同日 2 回目 / 上限到達で「押しても何も起きない」になっていた。setup/children と同じ形で出す
	     (ADR-0062 §1: 状態起因 = Banner + 次アクション、role="alert" は ErrorAlert が持つ)。 -->
	{#if form?.error}
		<!-- tabindex="-1" はエラーサマリへ focus を移すため (tab 順には入らない) -->
		<div bind:this={errorBanner} tabindex="-1" data-testid="first-adventure-error">
			<ErrorAlert message={form.error} severity="warning" />
		</div>
	{/if}

	<!-- #4868 adversarial: 直前の step (チャレンジ) の結果を出す。旧実装は
	     `?challengesAdded=N` を付けて redirect しながら**どこでも読んでいなかった**ので、
	     親は「追加する」を押しても効いたのか分からなかった (ADR-0062 §1 未達)。
	     2 周目は必ず 0 件になるため、歩き直した親には無反応に見えていた。
	     飛ばした人には出さない (`challengesRequested === 0`)。 -->
	{#if data.challengesRequested > 0}
		{#if data.challengesFailed > 0}
			<!-- 失敗を含むときは成功文言と同じ見た目にしない (ADR-0062 §1: サーバ内部起因は
			     Alert 側)。部分失敗も「入らなかった分がある」ことを必ず出す。 -->
			<div data-testid="first-adventure-challenges-notice">
				<ErrorAlert
					message={data.challengesAdded > 0
						? SETUP_FIRST_ADVENTURE_LABELS.challengesPartialNotice(
								data.challengesAdded,
								data.challengesFailed,
							)
						: SETUP_FIRST_ADVENTURE_LABELS.challengesFailedNotice}
					severity="warning"
				/>
			</div>
		{:else}
			<p
				class="text-sm text-[var(--color-text-muted)] text-center mb-3"
				role="status"
				data-testid="first-adventure-challenges-notice"
			>
				{data.challengesAdded > 0
					? SETUP_FIRST_ADVENTURE_LABELS.challengesAddedNotice(data.challengesAdded)
					: SETUP_FIRST_ADVENTURE_LABELS.challengesAlreadyNotice}
			</p>
		{/if}
	{/if}

	<!-- PO 決裁 2026-09-10 決定 8: だれと一緒にやるかを選ばせる。
	     きょうだいが 2 人以上いるときだけ出す (1 人の家庭に選択肢を見せない)。
	     GET form にしているのは、活動が per-child で選び直すたびに一覧を取り直すため
	     (client state で持つと、選んだ子と表示中の活動がずれる)。 -->
	{#if data.children.length > 1}
		<div class="mb-4" data-testid="first-adventure-child-picker">
			<div class="text-xs text-[var(--color-text-muted)] mb-1">
				{SETUP_FIRST_ADVENTURE_LABELS.childPickerLabel}
			</div>
			<form method="GET" class="flex flex-wrap gap-2">
				{#each data.children as pickChild (pickChild.id)}
					<Button
						type="submit"
						name="childId"
						value={String(pickChild.id)}
						variant="ghost"
						size="sm"
						class="px-3 py-2 rounded-lg border-2 text-sm {pickChild.id === child?.id
							? 'border-[var(--color-brand-600)] bg-[var(--color-brand-200)] text-[var(--color-text)] font-bold'
							: 'border-[var(--color-border-default)] bg-[var(--color-surface-card)] text-[var(--color-text-muted)]'}"
					>
						{pickChild.nickname}
					</Button>
				{/each}
			</form>
			<!-- 選ばせると今度は「1 人しか選べないのか」が不安になるので必ず添える (決定 8) -->
			<p class="mt-2 mb-0 text-xs text-[var(--color-text-muted)]" data-testid="first-adventure-child-picker-reassurance">
				{SETUP_FIRST_ADVENTURE_LABELS.childPickerReassurance}
			</p>
		</div>
	{/if}

	<!-- 活動選択画面 -->
	<div class="text-center mb-4">
		<div class="text-3xl mb-2">⚔️</div>
		<h2 class="text-lg font-bold text-[var(--color-text)]">{SETUP_FIRST_ADVENTURE_LABELS.selectActivityTitle}</h2>
		<p class="text-sm text-[var(--color-text-muted)] mt-1">
			{formatChildName(child?.nickname, 'vocative')}{SETUP_FIRST_ADVENTURE_LABELS.selectActivityDescPart1}<br />
			{SETUP_FIRST_ADVENTURE_LABELS.selectActivityDescPart2}
		</p>
	</div>

	{#if data.activities.length === 0}
		<!-- 活動未登録の場合はスキップ -->
		<div class="text-center">
			<p class="text-sm text-[var(--color-neutral-400)] mb-4">
				{SETUP_FIRST_ADVENTURE_LABELS.noActivitiesMsg}
			</p>
			<form method="POST" action="?/skip">
				<Button type="submit" variant="primary" size="md" class="w-full text-sm">{SETUP_FIRST_ADVENTURE_LABELS.nextButton}</Button>
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
						{SETUP_FIRST_ADVENTURE_LABELS.recordingLabel}
					{:else}
						{SETUP_FIRST_ADVENTURE_LABELS.recordButton}
					{/if}
				</Button>
			{:else}
				<p class="text-xs text-[var(--color-neutral-400)] text-center mt-4">
					{SETUP_FIRST_ADVENTURE_LABELS.selectActivityHint}
				</p>
			{/if}
		</form>

		<div class="text-center mt-3">
			<!-- #4863: 戻る導線が無かった step。戻り先は step 連鎖の 1 つ前 = challenges。 -->
			<a
				href={resolve('/setup/challenges')}
				class="block py-2 text-center text-xs font-bold text-[var(--color-text-muted)] underline hover:text-[var(--color-text-secondary)]"
				data-testid="setup-back-link"
			>
				&larr; {SETUP_LABELS.backButton}
			</a>
			<form method="POST" action="?/skip">
				<Button type="submit" variant="ghost" size="sm" class="text-xs underline">
					{SETUP_FIRST_ADVENTURE_LABELS.skipButton}
				</Button>
			</form>
		</div>
	{/if}
{/if}

<style>
	/* #4908: --gradient-gold (gold-600→gold-400) は文字と組んで AA (4.5:1) に届かない
	   (実測: gold-700 で 1.3〜2.2:1)。--color-text-gold (gold-800) は白 / gold-100 の上で
	   AA を満たすことが tests/unit/architecture/color-contrast-tokens.test.ts で固定されている
	   ため、背景を gold-100 (装飾の gold-600 枠線はそのまま残す) に変える。 */
	.points-display { background: var(--color-gold-100); }
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
