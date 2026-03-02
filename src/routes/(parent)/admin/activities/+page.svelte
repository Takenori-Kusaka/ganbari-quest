<script lang="ts">
import { enhance } from '$app/forms';

let { data } = $props();

let showAddForm = $state(false);
let filterCategory = $state('');
let aiMode = $state(false);
let aiInput = $state('');
let aiLoading = $state(false);
let aiError = $state('');

// フォーム入力値
let formName = $state('');
let formCategory = $state('うんどう');
let formIcon = $state('🤸');
let formPoints = $state(5);
let formAgeMin = $state('');
let formAgeMax = $state('');

const filteredActivities = $derived(
	filterCategory ? data.activities.filter((a) => a.category === filterCategory) : data.activities,
);

/** カテゴリ別の説明とアイコン候補 */
const categoryInfo: Record<string, { label: string; desc: string; icons: string[] }> = {
	うんどう: {
		label: 'うんどう',
		desc: '体を動かす活動（走る、泳ぐ、ボール遊びなど）',
		icons: ['🤸', '⚽', '🏃', '🏊', '🚴', '⚾', '🎾', '🏀', '🤾', '🧗', '🥋', '💃'],
	},
	べんきょう: {
		label: 'べんきょう',
		desc: '頭を使う活動（読書、計算、ひらがな練習など）',
		icons: ['📖', '✏️', '🔢', '📝', '🧮', '📚', '🔬', '🌍', '💡', '🎵', '🇦', '🗣️'],
	},
	せいかつ: {
		label: 'せいかつ',
		desc: '生活習慣（歯みがき、片付け、お手伝いなど）',
		icons: ['🪥', '🧹', '👕', '🍽️', '🛏️', '🧺', '🚿', '🌱', '🐕', '🗑️', '👟', '💊'],
	},
	こうりゅう: {
		label: 'こうりゅう',
		desc: '人との関わり（あいさつ、お友達と遊ぶなど）',
		icons: ['🤝', '👋', '💬', '🎉', '👫', '🤗', '📱', '✉️', '🎭', '🙏', '🫂', '👨‍👩‍👧'],
	},
	そうぞう: {
		label: 'そうぞう',
		desc: '創造的活動（お絵描き、工作、音楽など）',
		icons: ['🎨', '✂️', '🎹', '🎸', '📷', '🏗️', '🧩', '🎤', '🖍️', '🎲', '📐', '🪡'],
	},
};

/** ポイント基準ガイド */
const pointGuide = [
	{
		points: 3,
		label: 'かんたん',
		desc: '毎日できること（あいさつ、歯みがきなど）',
		color: 'bg-green-100 text-green-700',
	},
	{
		points: 5,
		label: 'ふつう',
		desc: 'ちょっとがんばること（お手伝い、読書など）',
		color: 'bg-blue-100 text-blue-700',
	},
	{
		points: 8,
		label: 'がんばる',
		desc: '時間がかかること（宿題、習い事の練習など）',
		color: 'bg-purple-100 text-purple-700',
	},
	{
		points: 10,
		label: 'すごい',
		desc: '特別なチャレンジ（発表、大会参加など）',
		color: 'bg-amber-100 text-amber-700',
	},
];

/** カテゴリ変更時にアイコンを先頭候補に設定 */
function onCategoryChange(cat: string) {
	formCategory = cat;
	const info = categoryInfo[cat];
	if (info && info.icons[0]) {
		formIcon = info.icons[0];
	}
}

/** AI推定で活動情報を取得 */
async function suggestFromAI() {
	if (!aiInput.trim()) return;
	aiLoading = true;
	aiError = '';
	try {
		const res = await fetch('/api/v1/activities/suggest', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: aiInput }),
		});
		const json = await res.json();
		if (res.ok) {
			formName = json.name ?? aiInput;
			formCategory = json.category ?? 'せいかつ';
			formIcon = json.icon ?? '📝';
			formPoints = json.basePoints ?? 5;
			aiMode = false;
			showAddForm = true;
		} else {
			aiError = json.error?.message ?? '推定に失敗しました';
		}
	} catch {
		aiError = 'ネットワークエラーが発生しました';
	} finally {
		aiLoading = false;
	}
}
</script>

<svelte:head>
	<title>活動管理 - がんばりクエスト</title>
</svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-lg font-bold text-gray-700">活動管理</h2>
		<div class="flex gap-2">
			<button
				class="px-4 py-2 bg-purple-500 text-white rounded-lg text-sm font-bold hover:bg-purple-600 transition-colors"
				onclick={() => { aiMode = !aiMode; showAddForm = false; }}
			>
				{aiMode ? 'キャンセル' : '✨ AI追加'}
			</button>
			<button
				class="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-bold hover:bg-blue-600 transition-colors"
				onclick={() => { showAddForm = !showAddForm; aiMode = false; }}
			>
				{showAddForm ? 'キャンセル' : '+ 手動追加'}
			</button>
		</div>
	</div>

	<!-- AI入力モード -->
	{#if aiMode}
		<div class="bg-purple-50 rounded-xl p-4 shadow-sm space-y-3 border border-purple-200">
			<h3 class="font-bold text-purple-700">✨ やりたいことを教えてください</h3>
			<p class="text-xs text-purple-600">
				やりたい活動を自由に入力すると、カテゴリ・ポイント・アイコンを自動で提案します
			</p>
			<div class="flex gap-2">
				<input
					type="text"
					bind:value={aiInput}
					placeholder="例: ピアノの練習をした、公園で走った、折り紙を作った"
					class="flex-1 px-3 py-2 border rounded-lg text-sm"
					onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); suggestFromAI(); } }}
				/>
				<button
					type="button"
					class="px-4 py-2 bg-purple-500 text-white rounded-lg text-sm font-bold hover:bg-purple-600 transition-colors disabled:opacity-50"
					disabled={aiLoading || !aiInput.trim()}
					onclick={suggestFromAI}
				>
					{aiLoading ? '考え中...' : '提案する'}
				</button>
			</div>
			{#if aiError}
				<p class="text-red-500 text-sm">{aiError}</p>
			{/if}
		</div>
	{/if}

	<!-- 手動追加フォーム -->
	{#if showAddForm}
		<form
			method="POST"
			action="?/create"
			use:enhance={() => {
				return async ({ result, update }) => {
					if (result.type === 'success') {
						showAddForm = false;
						formName = '';
						formCategory = 'うんどう';
						formIcon = '🤸';
						formPoints = 5;
						formAgeMin = '';
						formAgeMax = '';
					}
					await update();
				};
			}}
			class="bg-white rounded-xl p-4 shadow-sm space-y-4"
		>
			<h3 class="font-bold text-gray-600">活動を追加</h3>

			<!-- 名前 -->
			<label class="block">
				<span class="block text-xs font-bold text-gray-500 mb-1">活動名</span>
				<input
					type="text" name="name" bind:value={formName} required
					class="w-full px-3 py-2 border rounded-lg text-sm"
					placeholder="例: おさんぽ、ピアノれんしゅう"
				/>
			</label>

			<!-- カテゴリ選択 -->
			<div>
				<span class="block text-xs font-bold text-gray-500 mb-1">カテゴリ</span>
				<div class="grid grid-cols-5 gap-1">
					{#each data.categories as cat}
						{@const info = categoryInfo[cat]}
						<button
							type="button"
							class="px-2 py-2 rounded-lg text-xs font-bold transition-colors text-center
								{formCategory === cat ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
							onclick={() => onCategoryChange(cat)}
						>
							{info?.icons[0] ?? '📝'} {cat}
						</button>
					{/each}
				</div>
				{#if categoryInfo[formCategory]?.desc}
					<p class="text-xs text-gray-400 mt-1">{categoryInfo[formCategory]?.desc}</p>
				{/if}
				<input type="hidden" name="category" value={formCategory} />
			</div>

			<!-- アイコン選択 -->
			<div>
				<span class="block text-xs font-bold text-gray-500 mb-1">アイコン</span>
				{#if categoryInfo[formCategory]?.icons}
					<div class="flex flex-wrap gap-1 mb-2">
						{#each categoryInfo[formCategory]?.icons ?? [] as icon}
							<button
								type="button"
								class="w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-colors
									{formIcon === icon ? 'bg-blue-100 ring-2 ring-blue-400' : 'bg-gray-50 hover:bg-gray-100'}"
								onclick={() => formIcon = icon}
							>
								{icon}
							</button>
						{/each}
					</div>
				{/if}
				<input type="hidden" name="icon" value={formIcon} />
				<p class="text-xs text-gray-400">選択: {formIcon}　（上から選ぶか、絵文字を直接入力できます:
					<input
						type="text"
						class="w-10 px-1 border rounded text-center text-sm inline-block"
						value={formIcon}
						oninput={(e) => { const v = (e.target as HTMLInputElement).value; if (v) formIcon = v; }}
					/>）
				</p>
			</div>

			<!-- ポイント -->
			<div>
				<span class="block text-xs font-bold text-gray-500 mb-1">ポイント</span>
				<div class="flex gap-1 mb-2">
					{#each pointGuide as guide}
						<button
							type="button"
							class="flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors text-center
								{formPoints === guide.points ? guide.color + ' ring-2 ring-offset-1 ring-blue-400' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}"
							onclick={() => formPoints = guide.points}
						>
							{guide.points}P<br /><span class="font-normal">{guide.label}</span>
						</button>
					{/each}
				</div>
				{#if pointGuide.find(g => g.points === formPoints)?.desc}
					<p class="text-xs text-gray-400">{pointGuide.find(g => g.points === formPoints)?.desc}</p>
				{/if}
				<input type="hidden" name="basePoints" value={formPoints} />
			</div>

			<!-- 年齢範囲 -->
			<div>
				<span class="block text-xs font-bold text-gray-500 mb-1">対象年齢（省略可）</span>
				<div class="flex gap-1 items-center">
					<input type="number" name="ageMin" bind:value={formAgeMin} min="0" max="18" class="w-16 px-2 py-2 border rounded-lg text-sm" placeholder="0" aria-label="最小年齢" />
					<span class="text-gray-400">〜</span>
					<input type="number" name="ageMax" bind:value={formAgeMax} min="0" max="18" class="w-16 px-2 py-2 border rounded-lg text-sm" placeholder="18" aria-label="最大年齢" />
					<span class="text-xs text-gray-400">歳</span>
				</div>
			</div>

			<button type="submit" class="w-full py-2 bg-green-500 text-white rounded-lg font-bold text-sm hover:bg-green-600 transition-colors">
				{formIcon} {formName || '活動'} を追加する
			</button>
		</form>
	{/if}

	<!-- Filter -->
	<div class="flex gap-2 flex-wrap">
		<button
			class="px-3 py-1 rounded-full text-xs font-bold transition-colors
				{filterCategory === '' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}"
			onclick={() => filterCategory = ''}
		>
			すべて ({data.activities.length})
		</button>
		{#each data.categories as cat}
			{@const count = data.activities.filter(a => a.category === cat).length}
			<button
				class="px-3 py-1 rounded-full text-xs font-bold transition-colors
					{filterCategory === cat ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}"
				onclick={() => filterCategory = cat}
			>
				{cat} ({count})
			</button>
		{/each}
	</div>

	<!-- Activity List -->
	<div class="space-y-1">
		{#each filteredActivities as activity (activity.id)}
			<div class="bg-white rounded-lg px-3 py-2 shadow-sm flex items-center gap-3 {activity.isVisible ? '' : 'opacity-50'}">
				<span class="text-xl">{activity.icon}</span>
				<div class="flex-1 min-w-0">
					<p class="text-sm font-bold text-gray-700 truncate">{activity.name}</p>
					<p class="text-xs text-gray-400">
						{activity.category} / {activity.basePoints}P
						{#if activity.ageMin != null || activity.ageMax != null}
							/ {activity.ageMin ?? 0}-{activity.ageMax ?? 18}歳
						{/if}
					</p>
				</div>
				<form method="POST" action="?/toggleVisibility" use:enhance>
					<input type="hidden" name="id" value={activity.id} />
					<input type="hidden" name="visible" value={activity.isVisible ? 'false' : 'true'} />
					<button
						type="submit"
						class="px-3 py-1 rounded text-xs font-bold transition-colors
							{activity.isVisible ? 'bg-green-100 text-green-600 hover:bg-green-200' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}"
					>
						{activity.isVisible ? '表示中' : '非表示'}
					</button>
				</form>
			</div>
		{/each}
	</div>
</div>
