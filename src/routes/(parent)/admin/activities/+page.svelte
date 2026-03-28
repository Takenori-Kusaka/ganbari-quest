<script lang="ts">
import { enhance } from '$app/forms';
import { joinIcon, splitIcon } from '$lib/domain/icon-utils';
import {
	CATEGORY_DEFS,
	getActivityDisplayNameForAdult,
	getCategoryById,
} from '$lib/domain/validation/activity';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import ProgressMessage from '$lib/ui/components/ProgressMessage.svelte';

let { data } = $props();

let showAddForm = $state(false);
let filterCategoryId = $state(0);
let searchQuery = $state('');
let aiMode = $state(false);
let aiInput = $state('');
let aiLoading = $state(false);
let aiError = $state('');
let aiPreview = $state<{
	name: string;
	categoryId: number;
	icon: string;
	basePoints: number;
	nameKana: string | null;
	nameKanji: string | null;
	source: string;
} | null>(null);

// フォーム入力値
let formName = $state('');
let formCategoryId = $state(1);
let formMainIcon = $state('🤸');
let formSubIcon = $state('');
const formIcon = $derived(joinIcon(formMainIcon, formSubIcon || null));
let formPoints = $state(5);
let formAgeMin = $state('');
let formAgeMax = $state('');
let formDailyLimit = $state<string>('');
let formNameKana = $state('');
let formNameKanji = $state('');
let formTriggerHint = $state('');

// 編集・削除状態
let editingId = $state<number | null>(null);
let editName = $state('');
let editCategoryId = $state(0);
let editMainIcon = $state('');
let editSubIcon = $state('');
const editIcon = $derived(joinIcon(editMainIcon, editSubIcon || null));
let editPoints = $state(5);
let editAgeMin = $state('');
let editAgeMax = $state('');
let editDailyLimit = $state<string>('');
let editNameKana = $state('');
let editNameKanji = $state('');
let editTriggerHint = $state('');
let deleteConfirmId = $state<number | null>(null);
let actionMessage = $state('');

function startEdit(activity: (typeof data.activities)[0]) {
	editingId = activity.id;
	editName = activity.name;
	editCategoryId = activity.categoryId;
	const parsed = splitIcon(activity.icon);
	editMainIcon = parsed.main;
	editSubIcon = parsed.sub ?? '';
	editPoints = activity.basePoints;
	editAgeMin = activity.ageMin != null ? String(activity.ageMin) : '';
	editAgeMax = activity.ageMax != null ? String(activity.ageMax) : '';
	editDailyLimit = activity.dailyLimit != null ? String(activity.dailyLimit) : '';
	editNameKana = activity.nameKana ?? '';
	editNameKanji = activity.nameKanji ?? '';
	editTriggerHint = activity.triggerHint ?? '';
	deleteConfirmId = null;
}

function cancelEdit() {
	editingId = null;
}

function dailyLimitLabel(val: number | null): string {
	if (val === null) return '1回/日';
	if (val === 0) return '無制限';
	return `${val}回/日`;
}

let showHidden = $state(false);

const filteredActivities = $derived.by(() => {
	let result = data.activities.filter((a) => a.isVisible);
	if (filterCategoryId) {
		result = result.filter((a) => a.categoryId === filterCategoryId);
	}
	if (searchQuery.trim()) {
		const q = searchQuery.trim().toLowerCase();
		result = result.filter(
			(a) =>
				a.name.toLowerCase().includes(q) ||
				a.nameKanji?.toLowerCase().includes(q) ||
				a.nameKana?.toLowerCase().includes(q),
		);
	}
	return result;
});

const hiddenActivities = $derived(data.activities.filter((a) => !a.isVisible));

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
/** サブアイコンのプリセット候補 */
const SUB_ICON_PRESETS = [
	'🧹',
	'💧',
	'✨',
	'🎯',
	'📝',
	'🔥',
	'⭐',
	'🎵',
	'💪',
	'🧠',
	'❤️',
	'🌟',
	'🎁',
	'🏠',
	'👆',
	'🤲',
];

function onCategoryChange(catId: number) {
	formCategoryId = catId;
	const catDef = getCategoryById(catId);
	const info = catDef ? categoryInfo[catDef.name] : undefined;
	if (info?.icons[0]) {
		formMainIcon = info.icons[0];
	}
}

/** AI推定で活動情報を取得 */
async function suggestFromAI() {
	if (!aiInput.trim()) return;
	aiLoading = true;
	aiError = '';
	aiPreview = null;
	try {
		const res = await fetch('/api/v1/activities/suggest', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: aiInput }),
		});
		const json = await res.json();
		if (res.ok) {
			aiPreview = json;
		} else {
			aiError = json.error?.message ?? '推定に失敗しました';
		}
	} catch {
		aiError = 'ネットワークエラーが発生しました';
	} finally {
		aiLoading = false;
	}
}

/** プレビューの提案を採用してフォームに反映 */
function acceptPreview() {
	if (!aiPreview) return;
	formName = aiPreview.name;
	formCategoryId = aiPreview.categoryId;
	const aiParsed = splitIcon(aiPreview.icon ?? '📝');
	formMainIcon = aiParsed.main;
	formSubIcon = aiParsed.sub ?? '';
	formPoints = aiPreview.basePoints;
	formNameKana = aiPreview.nameKana ?? '';
	formNameKanji = aiPreview.nameKanji ?? '';
	aiMode = false;
	aiPreview = null;
	showAddForm = true;
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
					{#if aiLoading}
					<span class="ai-spinner" aria-hidden="true"></span>
					考え中...
				{:else}
					提案する
				{/if}
				</button>
			</div>
			{#if aiLoading}
				<ProgressMessage
					messages={['AIに聞いています...', 'もうちょっと待ってね...', 'あとすこし...']}
					intervalMs={3000}
				/>
			{/if}
			{#if aiError}
				<p class="text-red-500 text-sm">{aiError}</p>
			{/if}

			<!-- AI提案プレビュー -->
			{#if aiPreview}
				<div class="bg-white rounded-lg p-3 space-y-2 border border-purple-200">
					{#if aiPreview.source === 'fallback'}
						<p class="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">AI APIが利用できなかったため、キーワードベースで推定しました</p>
					{/if}
					<div class="flex items-center gap-3">
						<CompoundIcon icon={aiPreview.icon} size="lg" />
						<div class="flex-1">
							<p class="font-bold text-gray-700">{aiPreview.nameKanji || aiPreview.name}</p>
							<p class="text-xs text-gray-400">
								{getCategoryById(aiPreview.categoryId)?.name ?? ''} / {aiPreview.basePoints}P
							</p>
							{#if aiPreview.nameKana || aiPreview.nameKanji}
								<p class="text-xs text-gray-400 mt-0.5">
									{#if aiPreview.nameKana}ひらがな: {aiPreview.nameKana}{/if}
									{#if aiPreview.nameKana && aiPreview.nameKanji} / {/if}
									{#if aiPreview.nameKanji}漢字: {aiPreview.nameKanji}{/if}
								</p>
							{/if}
						</div>
					</div>
					<div class="flex gap-2">
						<button
							type="button"
							class="flex-1 py-2 bg-green-500 text-white rounded-lg font-bold text-sm hover:bg-green-600 transition-colors"
							onclick={acceptPreview}
						>
							この内容で追加フォームを開く
						</button>
						<button
							type="button"
							class="px-4 py-2 bg-gray-200 rounded-lg font-bold text-sm hover:bg-gray-300 transition-colors"
							onclick={() => aiPreview = null}
						>
							やり直す
						</button>
					</div>
				</div>
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
						formCategoryId = 1;
						formMainIcon = '🤸';
						formSubIcon = '';
						formPoints = 5;
						formAgeMin = '';
						formAgeMax = '';
						formDailyLimit = '';
						formNameKana = '';
						formNameKanji = '';
						formTriggerHint = '';
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
					{#each data.categoryDefs as catDef}
						{@const info = categoryInfo[catDef.name]}
						<button
							type="button"
							class="px-2 py-2 rounded-lg text-xs font-bold transition-colors text-center
								{formCategoryId === catDef.id ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
							onclick={() => onCategoryChange(catDef.id)}
						>
							{info?.icons[0] ?? '📝'} {catDef.name}
						</button>
					{/each}
				</div>
				{#if categoryInfo[getCategoryById(formCategoryId)?.name ?? '']?.desc}
					<p class="text-xs text-gray-400 mt-1">{categoryInfo[getCategoryById(formCategoryId)?.name ?? '']?.desc}</p>
				{/if}
				<input type="hidden" name="categoryId" value={formCategoryId} />
			</div>

			<!-- アイコン選択 -->
			<div>
				<span class="block text-xs font-bold text-gray-500 mb-1">メインアイコン</span>
				{#if categoryInfo[getCategoryById(formCategoryId)?.name ?? '']?.icons}
					<div class="flex flex-wrap gap-1 mb-2">
						{#each categoryInfo[getCategoryById(formCategoryId)?.name ?? '']?.icons ?? [] as ic}
							<button
								type="button"
								class="w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-colors
									{formMainIcon === ic ? 'bg-blue-100 ring-2 ring-blue-400' : 'bg-gray-50 hover:bg-gray-100'}"
								onclick={() => formMainIcon = ic}
							>
								{ic}
							</button>
						{/each}
					</div>
				{/if}
				<p class="text-xs text-gray-400 mb-3">直接入力:
					<input type="text" class="w-10 px-1 border rounded text-center text-sm inline-block"
						value={formMainIcon}
						oninput={(e) => { const v = (e.target as HTMLInputElement).value; if (v) formMainIcon = v; }}
					/>
				</p>

				<span class="block text-xs font-bold text-gray-500 mb-1">サブアイコン（任意）</span>
				<div class="flex flex-wrap gap-1 mb-2">
					<button type="button"
						class="w-9 h-9 rounded-lg text-xs flex items-center justify-center transition-colors
							{formSubIcon === '' ? 'bg-blue-100 ring-2 ring-blue-400' : 'bg-gray-50 hover:bg-gray-100'}"
						onclick={() => formSubIcon = ''}
					>なし</button>
					{#each SUB_ICON_PRESETS as ic}
						<button type="button"
							class="w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-colors
								{formSubIcon === ic ? 'bg-blue-100 ring-2 ring-blue-400' : 'bg-gray-50 hover:bg-gray-100'}"
							onclick={() => formSubIcon = ic}
						>{ic}</button>
					{/each}
				</div>
				<p class="text-xs text-gray-400 mb-2">直接入力:
					<input type="text" class="w-10 px-1 border rounded text-center text-sm inline-block"
						value={formSubIcon}
						oninput={(e) => { formSubIcon = (e.target as HTMLInputElement).value; }}
					/>
				</p>

				<div class="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
					<span class="text-xs text-gray-400">プレビュー:</span>
					<CompoundIcon icon={formIcon} size="lg" />
				</div>
				<input type="hidden" name="icon" value={formIcon} />
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

			<!-- 1日の回数制限 -->
			<div>
				<span class="block text-xs font-bold text-gray-500 mb-1">1日の回数制限</span>
				<div class="flex gap-1">
					{#each [{ val: '', label: '1回' }, { val: '2', label: '2回' }, { val: '3', label: '3回' }, { val: '0', label: '無制限' }] as opt}
						<button
							type="button"
							class="flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors
								{formDailyLimit === opt.val ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}"
							onclick={() => formDailyLimit = opt.val}
						>
							{opt.label}
						</button>
					{/each}
				</div>
				<p class="text-xs text-gray-400 mt-1">「無制限」なら何回でも記録できます</p>
				<input type="hidden" name="dailyLimit" value={formDailyLimit} />
			</div>


			<!-- ひらがな・漢字表記 -->
			<div>
				<span class="block text-xs font-bold text-gray-500 mb-1">ひらがな表記（省略可）</span>
				<input
					type="text" name="nameKana" bind:value={formNameKana}
					class="w-full px-3 py-2 border rounded-lg text-sm"
					placeholder="例: おかたづけした"
				/>
				<p class="text-xs text-gray-400 mt-1">6歳未満の子供に表示する名前</p>
			</div>
			<div>
				<span class="block text-xs font-bold text-gray-500 mb-1">漢字表記（省略可）</span>
				<input
					type="text" name="nameKanji" bind:value={formNameKanji}
					class="w-full px-3 py-2 border rounded-lg text-sm"
					placeholder="例: お片付けをした"
				/>
				<p class="text-xs text-gray-400 mt-1">6歳以上の子供に表示する名前</p>
			</div>

			<!-- トリガーヒント -->
			<div>
				<span class="block text-xs font-bold text-gray-500 mb-1">トリガーヒント（省略可）</span>
				<input
					type="text" name="triggerHint" bind:value={formTriggerHint} maxlength="30"
					class="w-full px-3 py-2 border rounded-lg text-sm"
					placeholder="例: はみがきが終わったら押してね"
				/>
				<p class="text-xs text-gray-400 mt-1">カードに小さく表示される声かけ文（30文字以内）</p>
			</div>

			<button type="submit" class="w-full py-2 bg-green-500 text-white rounded-lg font-bold text-sm hover:bg-green-600 transition-colors">
				{formIcon} {formName || '活動'} を追加する
			</button>
		</form>
	{/if}

	<!-- 活動紹介フロー -->
	<a
		href="/admin/activities/introduce"
		class="block bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 rounded-xl p-4 hover:shadow-md transition-shadow"
	>
		<div class="flex items-center gap-3">
			<span class="text-2xl">📖</span>
			<div class="flex-1">
				<p class="font-bold text-gray-700 text-sm">活動の紹介スライド</p>
				<p class="text-xs text-gray-500 mt-0.5">お子さんと一緒に各活動の内容や記録方法を確認できます</p>
			</div>
			<span class="text-gray-400 text-sm">→</span>
		</div>
	</a>

	<!-- Search -->
	<div class="relative">
		<input
			type="search"
			bind:value={searchQuery}
			placeholder="活動名で検索..."
			class="w-full px-3 py-2 pl-9 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
		/>
		<span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
	</div>

	<!-- Filter -->
	<div class="flex gap-2 flex-wrap">
		<button
			class="px-3 py-1 rounded-full text-xs font-bold transition-colors
				{filterCategoryId === 0 ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}"
			onclick={() => filterCategoryId = 0}
		>
			すべて ({data.activities.filter(a => a.isVisible).length})
		</button>
		{#each data.categoryDefs as catDef}
			{@const count = data.activities.filter(a => a.categoryId === catDef.id && a.isVisible).length}
			<button
				class="px-3 py-1 rounded-full text-xs font-bold transition-colors
					{filterCategoryId === catDef.id ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}"
				onclick={() => filterCategoryId = catDef.id}
			>
				{catDef.name} ({count})
			</button>
		{/each}
	</div>

	<!-- Action message -->
	{#if actionMessage}
		<div class="bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2 rounded-lg text-sm">
			{actionMessage}
		</div>
	{/if}

	<!-- Activity List -->
	<div class="space-y-1">
		{#each filteredActivities as activity (activity.id)}
			<div class="bg-white rounded-lg shadow-sm {activity.isVisible ? '' : 'opacity-50'}">
				<div class="px-3 py-2 flex items-center gap-3">
					<CompoundIcon icon={activity.icon} size="md" />
					<div class="flex-1 min-w-0">
						<p class="text-sm font-bold text-gray-700 truncate">{getActivityDisplayNameForAdult(activity)}</p>
						<p class="text-xs text-gray-400">
							{getCategoryById(activity.categoryId)?.name ?? ''} / {activity.basePoints}P
							{#if activity.dailyLimit !== null}
								/ {dailyLimitLabel(activity.dailyLimit)}
							{/if}
							{#if activity.ageMin != null || activity.ageMax != null}
								/ {activity.ageMin ?? 0}-{activity.ageMax ?? 18}歳
							{/if}
						</p>
					</div>
					<div class="flex gap-1">
						<button
							type="button"
							class="px-2 py-1 rounded text-xs font-bold bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
							onclick={() => editingId === activity.id ? cancelEdit() : startEdit(activity)}
						>
							{editingId === activity.id ? '閉じる' : '編集'}
						</button>
						<form method="POST" action="?/toggleVisibility" use:enhance>
							<input type="hidden" name="id" value={activity.id} />
							<input type="hidden" name="visible" value={activity.isVisible ? 'false' : 'true'} />
							<button
								type="submit"
								class="px-2 py-1 rounded text-xs font-bold transition-colors
									{activity.isVisible ? 'bg-green-100 text-green-600 hover:bg-green-200' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}"
							>
								{activity.isVisible ? '表示' : '非表示'}
							</button>
						</form>
					</div>
				</div>

				<!-- Inline edit form -->
				{#if editingId === activity.id}
					<div class="border-t px-3 py-3 space-y-3 bg-gray-50 rounded-b-lg">
						<form
							method="POST"
							action="?/edit"
							use:enhance={() => {
								return async ({ result, update }) => {
									if (result.type === 'success') {
										editingId = null;
									}
									await update();
								};
							}}
							class="space-y-3"
						>
							<input type="hidden" name="id" value={activity.id} />
							<div class="grid grid-cols-[1fr,auto] gap-2">
								<label class="block">
									<span class="text-xs font-bold text-gray-500">名前</span>
									<input type="text" name="name" bind:value={editName} required class="w-full px-2 py-1.5 border rounded text-sm" />
								</label>
								<div>
									<span class="text-xs font-bold text-gray-500">アイコン</span>
									<div class="flex gap-1 items-center mt-0.5">
										<input type="text" class="w-10 px-1 py-1.5 border rounded text-sm text-center"
											value={editMainIcon}
											oninput={(e) => { const v = (e.target as HTMLInputElement).value; if (v) editMainIcon = v; }}
										/>
										<span class="text-xs text-gray-400">+</span>
										<input type="text" class="w-10 px-1 py-1.5 border rounded text-sm text-center" placeholder="サブ"
											value={editSubIcon}
											oninput={(e) => { editSubIcon = (e.target as HTMLInputElement).value; }}
										/>
										<CompoundIcon icon={editIcon} size="md" />
									</div>
									<div class="flex flex-wrap gap-0.5 mt-1">
										<button type="button" class="w-7 h-7 rounded text-xs flex items-center justify-center {editSubIcon === '' ? 'bg-blue-100' : 'bg-gray-50 hover:bg-gray-100'}" onclick={() => editSubIcon = ''}>なし</button>
										{#each SUB_ICON_PRESETS.slice(0, 8) as ic}
											<button type="button" class="w-7 h-7 rounded text-sm flex items-center justify-center {editSubIcon === ic ? 'bg-blue-100' : 'bg-gray-50 hover:bg-gray-100'}" onclick={() => editSubIcon = ic}>{ic}</button>
										{/each}
									</div>
									<input type="hidden" name="icon" value={editIcon} />
								</div>
							</div>
							<div class="grid grid-cols-2 gap-2">
								<label class="block">
									<span class="text-xs font-bold text-gray-500">カテゴリ</span>
									<select name="categoryId" bind:value={editCategoryId} class="w-full px-2 py-1.5 border rounded text-sm">
										{#each data.categoryDefs as catDef}
											<option value={catDef.id}>{catDef.name}</option>
										{/each}
									</select>
								</label>
								<label class="block">
									<span class="text-xs font-bold text-gray-500">ポイント</span>
									<input type="number" name="basePoints" bind:value={editPoints} min="1" max="100" class="w-full px-2 py-1.5 border rounded text-sm" />
								</label>
							</div>
							<div class="grid grid-cols-2 gap-2">
								<label class="block">
									<span class="text-xs font-bold text-gray-500">対象年齢（下限）</span>
									<input type="number" name="ageMin" bind:value={editAgeMin} min="0" max="18" class="w-full px-2 py-1.5 border rounded text-sm" placeholder="なし" />
								</label>
								<label class="block">
									<span class="text-xs font-bold text-gray-500">対象年齢（上限）</span>
									<input type="number" name="ageMax" bind:value={editAgeMax} min="0" max="18" class="w-full px-2 py-1.5 border rounded text-sm" placeholder="なし" />
								</label>
							</div>
							<!-- dailyLimit -->
							<div>
								<span class="text-xs font-bold text-gray-500">1日の回数制限</span>
								<div class="flex gap-1 mt-1">
									{#each [{ val: '', label: '1回' }, { val: '2', label: '2回' }, { val: '3', label: '3回' }, { val: '0', label: '無制限' }] as opt}
										<button
											type="button"
											class="flex-1 py-1 rounded text-xs font-bold transition-colors
												{editDailyLimit === opt.val ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}"
											onclick={() => editDailyLimit = opt.val}
										>
											{opt.label}
										</button>
									{/each}
								</div>
								<input type="hidden" name="dailyLimit" value={editDailyLimit} />
							</div>

							<!-- ひらがな・漢字表記 -->
							<div class="grid grid-cols-2 gap-2">
								<label class="block">
									<span class="text-xs font-bold text-gray-500">ひらがな表記</span>
									<input type="text" name="nameKana" bind:value={editNameKana} class="w-full px-2 py-1.5 border rounded text-sm" placeholder="省略可" />
								</label>
								<label class="block">
									<span class="text-xs font-bold text-gray-500">漢字表記</span>
									<input type="text" name="nameKanji" bind:value={editNameKanji} class="w-full px-2 py-1.5 border rounded text-sm" placeholder="省略可" />
								</label>
							</div>
							<!-- トリガーヒント -->
							<label class="block">
								<span class="text-xs font-bold text-gray-500">子供へのヒント（いつ押すか）</span>
								<input type="text" name="triggerHint" bind:value={editTriggerHint} maxlength="30" class="w-full px-2 py-1.5 border rounded text-sm" placeholder="はみがきが終わったら押してね" />
								<span class="text-[10px] text-gray-400">カードの下に小さく表示されます（30文字まで）</span>
							</label>
							<div class="flex gap-2">
								<button type="submit" class="flex-1 py-2 bg-blue-500 text-white rounded-lg font-bold text-sm hover:bg-blue-600 transition-colors">
									保存
								</button>
								<button
									type="button"
									class="px-4 py-2 bg-red-100 text-red-600 rounded-lg font-bold text-sm hover:bg-red-200 transition-colors"
									onclick={() => deleteConfirmId = deleteConfirmId === activity.id ? null : activity.id}
								>
									削除
								</button>
							</div>
						</form>

						<!-- Delete confirmation -->
						{#if deleteConfirmId === activity.id}
							{@const logCount = data.logCounts[activity.id] ?? 0}
							<div class="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
								{#if logCount > 0}
									<p class="text-sm text-amber-700 font-bold">この活動には {logCount} 件の記録があります</p>
									<p class="text-xs text-amber-600">記録を保護するため、完全削除ではなく「非表示」にします。非表示の活動は子供の画面に表示されなくなりますが、過去の記録はそのまま残ります。</p>
								{:else}
									<p class="text-sm text-red-700 font-bold">本当に削除しますか？</p>
									<p class="text-xs text-red-500">この活動は完全に削除されます。この操作は取り消せません。</p>
								{/if}
								<div class="flex gap-2">
									<form
										method="POST"
										action="?/delete"
										class="flex-1"
										use:enhance={() => {
											return async ({ result, update }) => {
												if (result.type === 'success') {
													editingId = null;
													deleteConfirmId = null;
													if (result.data && 'hidden' in result.data) {
														actionMessage = '記録があるため非表示にしました';
														setTimeout(() => { actionMessage = ''; }, 5000);
													}
												}
												await update();
											};
										}}
									>
										<input type="hidden" name="id" value={activity.id} />
										<button type="submit" class="w-full py-2 {logCount > 0 ? 'bg-amber-500 hover:bg-amber-600' : 'bg-red-500 hover:bg-red-600'} text-white rounded-lg font-bold text-sm transition-colors">
											{logCount > 0 ? '非表示にする' : '削除する'}
										</button>
									</form>
									<button
										type="button"
										class="flex-1 py-2 bg-gray-200 rounded-lg font-bold text-sm hover:bg-gray-300 transition-colors"
										onclick={() => deleteConfirmId = null}
									>
										キャンセル
									</button>
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Hidden activities section -->
	{#if hiddenActivities.length > 0}
		<div class="mt-6">
			<button
				type="button"
				class="w-full flex items-center justify-between px-4 py-3 bg-gray-100 rounded-lg text-sm font-bold text-gray-500 hover:bg-gray-200 transition-colors"
				onclick={() => showHidden = !showHidden}
			>
				<span>非表示の活動 ({hiddenActivities.length}件)</span>
				<span class="text-xs">{showHidden ? '▲ 閉じる' : '▼ 開く'}</span>
			</button>
			{#if showHidden}
				<div class="mt-2 space-y-1">
					{#each hiddenActivities as activity (activity.id)}
						{@const logCount = data.logCounts[activity.id] ?? 0}
						<div class="bg-gray-50 rounded-lg shadow-sm border border-gray-200">
							<div class="px-3 py-2 flex items-center gap-3">
								<div class="opacity-50">
									<CompoundIcon icon={activity.icon} size="md" />
								</div>
								<div class="flex-1 min-w-0">
									<p class="text-sm font-bold text-gray-400 truncate">{getActivityDisplayNameForAdult(activity)}</p>
									<p class="text-xs text-gray-400">
										{getCategoryById(activity.categoryId)?.name ?? ''} / {activity.basePoints}P
										{#if logCount > 0}
											/ 記録 {logCount}件
										{/if}
									</p>
								</div>
								<div class="flex gap-1">
									<form method="POST" action="?/toggleVisibility" use:enhance>
										<input type="hidden" name="id" value={activity.id} />
										<input type="hidden" name="visible" value="true" />
										<button
											type="submit"
											class="px-2 py-1 rounded text-xs font-bold bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors"
										>
											復活
										</button>
									</form>
									{#if logCount === 0}
										<form
											method="POST"
											action="?/delete"
											use:enhance={() => {
												return async ({ update }) => { await update(); };
											}}
										>
											<input type="hidden" name="id" value={activity.id} />
											<button
												type="submit"
												class="px-2 py-1 rounded text-xs font-bold bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
											>
												完全削除
											</button>
										</form>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.ai-spinner {
		display: inline-block;
		width: 1em;
		height: 1em;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
		vertical-align: middle;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
