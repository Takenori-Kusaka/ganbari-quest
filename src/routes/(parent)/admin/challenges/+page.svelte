<script lang="ts">
import { enhance } from '$app/forms';
import Button from '$lib/ui/primitives/Button.svelte';

let { data, form } = $props();

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
	const today = new Date().toISOString().slice(0, 10);
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
		<div class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{form.error}</div>
	{/if}
	{#if form?.created}
		<div class="rounded-lg bg-green-50 p-3 text-sm text-green-700">チャレンジを作成しました</div>
	{/if}
	{#if form?.deleted}
		<div class="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">チャレンジを削除しました</div>
	{/if}

	<!-- 作成フォーム -->
	{#if creating}
		<form method="POST" action="?/create" use:enhance class="rounded-xl border bg-white p-4 space-y-3">
			<h3 class="font-bold text-sm">新規チャレンジ作成</h3>
			<div class="grid grid-cols-2 gap-3">
				<label class="block col-span-2">
					<span class="text-xs font-semibold text-gray-600">タイトル</span>
					<input name="title" type="text" placeholder="みんなで今週3回うんどう！" required
						class="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm" />
				</label>
				<label class="block col-span-2">
					<span class="text-xs font-semibold text-gray-600">説明（任意）</span>
					<input name="description" type="text" placeholder="家族みんなでうんどうしよう"
						class="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm" />
				</label>
			</div>
			<div class="grid grid-cols-3 gap-3">
				<label class="block">
					<span class="text-xs font-semibold text-gray-600">種別</span>
					<select name="challengeType" class="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm">
						<option value="cooperative">協力</option>
						<option value="competitive">競争</option>
					</select>
				</label>
				<label class="block">
					<span class="text-xs font-semibold text-gray-600">期間</span>
					<select name="periodType" class="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm">
						<option value="weekly">週間</option>
						<option value="monthly">月間</option>
						<option value="custom">カスタム</option>
					</select>
				</label>
				<label class="block">
					<span class="text-xs font-semibold text-gray-600">カテゴリ（任意）</span>
					<select name="categoryId" class="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm">
						<option value="">全カテゴリ</option>
						{#each Object.entries(categories) as [id, name]}
							<option value={id}>{name}</option>
						{/each}
					</select>
				</label>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<label class="block">
					<span class="text-xs font-semibold text-gray-600">開始日</span>
					<input name="startDate" type="date" required
						class="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm" />
				</label>
				<label class="block">
					<span class="text-xs font-semibold text-gray-600">終了日</span>
					<input name="endDate" type="date" required
						class="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm" />
				</label>
			</div>
			<div class="grid grid-cols-3 gap-3">
				<label class="block">
					<span class="text-xs font-semibold text-gray-600">目標回数</span>
					<input name="baseTarget" type="number" value="3" min="1" required
						class="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm" />
				</label>
				<label class="block">
					<span class="text-xs font-semibold text-gray-600">報酬ポイント</span>
					<input name="rewardPoints" type="number" value="50" min="1" required
						class="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm" />
				</label>
				<label class="block">
					<span class="text-xs font-semibold text-gray-600">達成メッセージ（任意）</span>
					<input name="rewardMessage" type="text" placeholder="みんなすごい！"
						class="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm" />
				</label>
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
			<p class="mt-2 text-sm font-semibold text-gray-500">チャレンジはまだありません</p>
			<p class="text-xs text-gray-400">上のボタンから作成してください</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each data.challenges as challenge (challenge.id)}
				{@const active = isCurrentlyActive(challenge)}
				{@const target = parseJSON<TargetConfig>(challenge.targetConfig, { metric: 'count', baseTarget: 0 })}
				{@const reward = parseJSON<RewardConfig>(challenge.rewardConfig, { points: 0 })}
				<div class="rounded-xl border bg-white p-4" class:border-blue-300={active}>
					<div class="flex items-start justify-between gap-2">
						<div class="flex-1">
							<h3 class="font-bold text-sm">
								{challenge.title}
								{#if challenge.allCompleted}
									<span class="ml-1 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-bold text-green-700">全員クリア！</span>
								{/if}
								{#if active}
									<span class="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">開催中</span>
								{/if}
								{#if challenge.status === 'expired'}
									<span class="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">終了</span>
								{/if}
							</h3>
							<p class="text-xs text-gray-500 mt-0.5">
								{typeLabel(challenge.challengeType)} · {periodLabel(challenge.periodType)}
								· {formatDate(challenge.startDate)} 〜 {formatDate(challenge.endDate)}
								· 目標{target.baseTarget}回
								{#if target.categoryId}
									· {categories[target.categoryId] ?? ''}
								{/if}
								· 報酬{reward.points}P
							</p>
							{#if challenge.description}
								<p class="text-xs text-gray-600 mt-1">{challenge.description}</p>
							{/if}

							<!-- 進捗表示 -->
							{#if challenge.progress.length > 0}
								<div class="mt-2 space-y-1">
									{#each challenge.progress as prog}
										{@const child = data.children.find((c: { id: number }) => c.id === prog.childId)}
										<div class="flex items-center gap-2">
											<span class="text-xs font-medium text-gray-700 w-16 truncate">
												{child?.nickname ?? `#${prog.childId}`}
											</span>
											<div class="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
												<div
													class="h-full rounded-full transition-all"
													class:bg-green-400={prog.completed === 1}
													class:bg-blue-400={prog.completed !== 1}
													style="width: {Math.min(100, Math.round((prog.currentValue / prog.targetValue) * 100))}%"
												></div>
											</div>
											<span class="text-[10px] text-gray-500 w-12 text-right">
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
</div>
