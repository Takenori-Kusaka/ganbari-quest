<script lang="ts">
import { enhance } from '$app/forms';
import { todayDateJST } from '$lib/domain/date-utils';
import ProgressFill from '$lib/ui/components/ProgressFill.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data, form } = $props();

const isFamily = $derived(data.planTier === 'family');
let creating = $state(false);

interface TargetConfig {
	metric: string;
	baseTarget: number;
	categoryId?: number;
}
interface RewardConfig {
	points: number;
	message?: string;
}

function parseJSON<T>(json: string, fallback: T): T {
	try {
		return JSON.parse(json);
	} catch {
		return fallback;
	}
}

function formatDate(d: string): string {
	return d.replace(/-/g, '/');
}

function isCurrentlyActive(challenge: {
	isActive: number;
	status: string;
	startDate: string;
	endDate: string;
}): boolean {
	const today = todayDateJST();
	return (
		challenge.isActive === 1 &&
		challenge.status === 'active' &&
		challenge.startDate <= today &&
		challenge.endDate >= today
	);
}

const typeLabel = (t: string) => (t === 'cooperative' ? '協力' : '競争');
const periodLabel = (t: string) => {
	switch (t) {
		case 'weekly':
			return '週間';
		case 'monthly':
			return '月間';
		default:
			return 'カスタム';
	}
};

const categories: Record<number, string> = {
	1: 'うんどう',
	2: 'べんきょう',
	3: 'せいかつ',
	4: 'こうりゅう',
	5: 'そうぞう',
};
</script>

<svelte:head>
	<title>きょうだいチャレンジ - がんばりクエスト</title>
</svelte:head>

<div class="space-y-4">
	<!-- Family Streak -->
	{#if data.familyStreak && data.familyStreak.currentStreak > 0}
		<div class="rounded-xl border bg-white p-4">
			<div class="flex items-center gap-2 mb-2">
				<span class="text-xl">🔥</span>
				<h3 class="font-bold text-sm">家族ストリーク: {data.familyStreak.currentStreak}日</h3>
			</div>
			<p class="text-xs text-[var(--color-text-muted)]">
				{data.familyStreak.hasRecordedToday
					? `今日は${data.familyStreak.todayRecorders.length}人が記録済み`
					: '今日はまだ誰も記録していません'}
			</p>
			{#if data.familyStreak.nextMilestone}
				<p class="text-xs text-[var(--color-text-tertiary)] mt-1">
					あと{data.familyStreak.nextMilestone.remaining}日で{data.familyStreak.nextMilestone.days}日ボーナス（+{data.familyStreak.nextMilestone.points}P）
				</p>
			{/if}
		</div>
	{/if}

	{#if !isFamily}
		<div class="rounded-xl border border-[var(--color-feedback-warning-border)] bg-[var(--color-feedback-warning-bg)] p-4 text-center">
			<p class="text-sm font-bold text-[var(--color-feedback-warning-text)]">👨‍👩‍👧‍👦 ファミリープラン限定機能</p>
			<p class="text-xs text-[var(--color-feedback-warning-text)] mt-1">きょうだいチャレンジと家族ストリークはファミリープランでご利用いただけます</p>
			<a href="/admin/license" class="inline-block mt-2 px-3 py-1 text-xs font-bold rounded-lg bg-[var(--color-stat-amber)] text-white">
				プランを確認
			</a>
		</div>
	{:else}

	<div class="flex items-center justify-between">
		<h2 class="text-lg font-bold">👥 きょうだいチャレンジ</h2>
		<Button
			variant={creating ? 'ghost' : 'primary'}
			size="sm"
			onclick={() => { creating = !creating; }}
		>
			{creating ? 'キャンセル' : '＋ 新規チャレンジ'}
		</Button>
	</div>

	{#if form?.error}
		<div class="rounded-lg bg-[var(--color-feedback-error-bg)] p-3 text-sm text-[var(--color-feedback-error-text)]">{form.error}</div>
	{/if}
	{#if form?.created}
		<div class="rounded-lg bg-[var(--color-feedback-success-bg)] p-3 text-sm text-[var(--color-feedback-success-text)]">チャレンジを作成しました</div>
	{/if}
	{#if form?.deleted}
		<div class="rounded-lg bg-[var(--color-surface-muted)] p-3 text-sm text-[var(--color-text-primary)]">チャレンジを削除しました</div>
	{/if}

	<!-- 作成フォーム -->
	{#if creating}
		<form method="POST" action="?/create" use:enhance class="rounded-xl border bg-white p-4 space-y-3">
			<h3 class="font-bold text-sm">新規チャレンジ作成</h3>
			<div class="grid grid-cols-2 gap-3">
				<FormField label="タイトル" type="text" name="title" placeholder="みんなで今週3回うんどう！" required class="col-span-2" />
				<FormField label="説明（任意）" type="text" name="description" placeholder="家族みんなでうんどうしよう" class="col-span-2" />
			</div>
			<div class="grid grid-cols-3 gap-3">
				<FormField label="種別">
					{#snippet children()}
						<select name="challengeType" class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm">
							<option value="cooperative">協力</option>
							<option value="competitive">競争</option>
						</select>
					{/snippet}
				</FormField>
				<FormField label="期間">
					{#snippet children()}
						<select name="periodType" class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm">
							<option value="weekly">週間</option>
							<option value="monthly">月間</option>
							<option value="custom">カスタム</option>
						</select>
					{/snippet}
				</FormField>
				<FormField label="カテゴリ（任意）">
					{#snippet children()}
						<select name="categoryId" class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm">
							<option value="">全カテゴリ</option>
							{#each Object.entries(categories) as [id, name]}
								<option value={id}>{name}</option>
							{/each}
						</select>
					{/snippet}
				</FormField>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<FormField label="開始日" type="date" name="startDate" required />
				<FormField label="終了日" type="date" name="endDate" required />
			</div>
			<div class="grid grid-cols-3 gap-3">
				<FormField label="目標回数" type="number" name="baseTarget" value={3} min={1} required />
				<FormField label="報酬ポイント" type="number" name="rewardPoints" value={50} min={1} required />
				<FormField label="達成メッセージ（任意）" type="text" name="rewardMessage" placeholder="みんなすごい！" />
			</div>
			<input type="hidden" name="metric" value="count" />
			<Button type="submit" variant="primary" size="sm" class="w-full">
				作成
			</Button>
		</form>
	{/if}

	<!-- チャレンジ一覧 -->
	{#if data.challenges.length === 0}
		<div class="rounded-xl border bg-white p-8 text-center">
			<p class="text-2xl">👥</p>
			<p class="mt-2 text-sm font-semibold text-[var(--color-text-muted)]">チャレンジはまだありません</p>
			<p class="text-xs text-[var(--color-text-tertiary)]">上のボタンから作成してください</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each data.challenges as challenge (challenge.id)}
				{@const active = isCurrentlyActive(challenge)}
				{@const target = parseJSON<TargetConfig>(challenge.targetConfig, { metric: 'count', baseTarget: 0 })}
				{@const reward = parseJSON<RewardConfig>(challenge.rewardConfig, { points: 0 })}
				<div class="rounded-xl border bg-white p-4" class:border-[var(--color-feedback-info-border)]={active}>
					<div class="flex items-start justify-between gap-2">
						<div class="flex-1">
							<h3 class="font-bold text-sm">
								{challenge.title}
								{#if challenge.allCompleted}
									<span class="ml-1 rounded bg-[var(--color-feedback-success-bg-strong)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-feedback-success-text)]">全員クリア！</span>
								{/if}
								{#if active}
									<span class="ml-1 rounded bg-[var(--color-feedback-info-bg-strong)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-feedback-info-text)]">開催中</span>
								{/if}
								{#if challenge.status === 'expired'}
									<span class="ml-1 rounded bg-[var(--color-surface-secondary)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-text-muted)]">終了</span>
								{/if}
							</h3>
							<p class="text-xs text-[var(--color-text-muted)] mt-0.5">
								{typeLabel(challenge.challengeType)} · {periodLabel(challenge.periodType)}
								· {formatDate(challenge.startDate)} 〜 {formatDate(challenge.endDate)}
								· 目標{target.baseTarget}回
								{#if target.categoryId}
									· {categories[target.categoryId] ?? ''}
								{/if}
								· 報酬{reward.points}P
							</p>
							{#if challenge.description}
								<p class="text-xs text-[var(--color-text-secondary)] mt-1">{challenge.description}</p>
							{/if}

							<!-- 進捗表示 -->
							{#if challenge.progress.length > 0}
								<div class="mt-2 space-y-1">
									{#each challenge.progress as prog}
										{@const child = data.children.find((c: { id: number }) => c.id === prog.childId)}
										<div class="flex items-center gap-2">
											<span class="text-xs font-medium text-[var(--color-text-primary)] w-16 truncate">
												{child?.nickname ?? `#${prog.childId}`}
											</span>
											<div class="flex-1 h-2 bg-[var(--color-surface-secondary)] rounded-full overflow-hidden">
												<ProgressFill
													pct={Math.min(100, Math.round((prog.currentValue / prog.targetValue) * 100))}
													class="h-full rounded-full transition-all {prog.completed === 1 ? 'bg-[var(--color-feedback-success-border)]' : 'bg-[var(--color-feedback-info-border)]'}"
												/>
											</div>
											<span class="text-[10px] text-[var(--color-text-muted)] w-12 text-right">
												{prog.currentValue}/{prog.targetValue}
												{#if prog.completed === 1}✅{/if}
											</span>
										</div>
									{/each}
								</div>
							{/if}
						</div>
						<form method="POST" action="?/delete" use:enhance
							onsubmit={(e) => { if (!confirm(`「${challenge.title}」を削除しますか？`)) e.preventDefault(); }}
						>
							<input type="hidden" name="id" value={challenge.id} />
							<Button type="submit" variant="danger" size="sm">削除</Button>
						</form>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{/if}<!-- /isFamily -->
</div>
