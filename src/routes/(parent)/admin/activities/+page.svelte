<script lang="ts">
import { deserialize } from '$app/forms';
import { goto, invalidateAll } from '$app/navigation';
import { splitIcon } from '$lib/domain/icon-utils';
import {
	ADMIN_ACTIVITIES_PAGE_LABELS,
	APP_LABELS,
	FEATURES_LABELS,
	PAGE_TITLES,
	UI_LABELS,
} from '$lib/domain/labels';
import { CHILD_TERMS } from '$lib/domain/terms';
import ActivitiesHeader from '$lib/features/admin/components/ActivitiesHeader.svelte';
import ActivityClearAllConfirm from '$lib/features/admin/components/ActivityClearAllConfirm.svelte';
import ActivityCreateForm from '$lib/features/admin/components/ActivityCreateForm.svelte';
import ActivityEmptyState from '$lib/features/admin/components/ActivityEmptyState.svelte';
import ActivityLimitBanner from '$lib/features/admin/components/ActivityLimitBanner.svelte';
import ActivityListItem from '$lib/features/admin/components/ActivityListItem.svelte';
import AiSuggestPanel from '$lib/features/admin/components/AiSuggestPanel.svelte';
import type { AiPreviewData } from '$lib/features/admin/components/activity-types';
import HiddenActivitiesSection from '$lib/features/admin/components/HiddenActivitiesSection.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import ChildSelectionDialog, {
	type ChildOption,
} from '$lib/ui/primitives/ChildSelectionDialog.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
// #2745 (CX bug-5, EPIC #2724): activity-pack 取込完了時の Toast success feedback。
// DESIGN.md §5 Toast 使用パターン (「操作完了の成功フィードバック」) 整合。
// 既存 actionMessage (in-page banner) は他 action (clear / copy / bulk / restore) で使用するため残置し、
// import 系のみ Toast primitive 経由に切替 (Anti-engagement / 3 秒自動消滅、DESIGN.md §5)。
import { showToast } from '$lib/ui/primitives/Toast.svelte';

// #2362 PR-3 Phase 7c: hardcoded text 排除 (ADR-0045) — CHILD_TERMS.honorific を template literal で参照
const CHILD_HONORIFIC_LABEL = CHILD_TERMS.honorific;
let { data } = $props();
const activityLimit = $derived(
	(data as Record<string, unknown>).activityLimit as
		| { allowed: boolean; current: number; max: number | null }
		| undefined,
);

let filterCategoryId = $state(0);
let searchQuery = $state('');
let actionMessage = $state('');
let showClearConfirm = $state(false);
let clearLoading = $state(false);

// 追加ダイアログ (EPIC #2253 / #2255: header + dropdown menu で必ず mode が確定する)
// #2558 段階2: 'import' (admin 内マーケットプレイス風ブラウズ UI) を撤去。みんなのテンプレートは
// /marketplace への画面遷移に一本化したため、add dialog の mode は manual / ai のみ。
let showAddDialog = $state(false);
let addMode = $state<'manual' | 'ai' | null>(null);

// #2558 段階2: バックアップから復元ダイアログ (マーケットプレイスとは別概念のファイル復元)
let showRestoreDialog = $state(false);
let restoreLoading = $state(false);

// #2362 PR-3 Phase 4: 子供タブ切替 UI
// `?childId=<n>` query で初期 child 復元、未指定なら cookie の selectedChildId、最後に最初の child
// Round 18 Cluster K (#1870 評価 Round 3): cookie fallback を fallback chain に追加。
// marketplace (ひな選択) → admin/activities 遷移時に「たろうくんタブが active」になる
// per-child scope 不整合を解消 (memory `feedback_per_child_scope_consistency` 整合)。
let childIdOverride = $state<number | undefined>(
	data.initialChildId != null && data.children.some((c) => c.id === data.initialChildId)
		? data.initialChildId
		: undefined,
);
const selectedChildId = $derived(
	childIdOverride !== undefined && data.children.some((c) => c.id === childIdOverride)
		? childIdOverride
		: data.initialChildIdFromCookie != null &&
				data.children.some((c) => c.id === data.initialChildIdFromCookie)
			? data.initialChildIdFromCookie
			: (data.children[0]?.id ?? 0),
);
const selectedChild = $derived(data.children.find((c) => c.id === selectedChildId));

// #2902 Phase A: 選択中 child の per-child activity 一覧 (visible / hidden 双方を含む)。
// activity-service の master 系 API は全て per-child repo (getRepos().childActivity) 経由に
// rewrite 済 (#2362 PR-3、ADR-0055) で「family master table」は既に物理的に存在しない。
// childActivitiesByChild は findActivitiesByChild(visibleOnly=false) で selected child の
// instance を非表示分も含めて取得済 (+page.server.ts)。これが本画面の唯一の表示軸。
const perChildActivities = $derived(
	selectedChildId ? (data.childActivitiesByChild[selectedChildId] ?? []) : [],
);

// #2902 Phase A: 選択中 child の per-child instance を visible / hidden に分離する。
// 旧実装は「selected child の per-child」+「tenant 全 child 集約 (data.activities)」を
// 単純連結し、selected child の instance が 2 重に出る + 件数水増し (35+35) + 兄弟の活動が
// 混在する 3 重の不整合を起こしていた。本 PR で表示軸を selected child の per-child のみに
// 一本化する (Strangler Fig facade 原則: 内部並存を UI に漏らさない、deep research T3)。
const visiblePerChildActivities = $derived(perChildActivities.filter((a) => Boolean(a.isVisible)));
const hiddenPerChildActivities = $derived(perChildActivities.filter((a) => !a.isVisible));

// ChildSelectionDialog state (per-child 取込時 auto-open)
let showChildSelectionDialog = $state(false);
let pendingImportPresetId = $state<string | null>(null);
// #2632 CX-DoR #9 NN/G #1: 取込実行中フラグ (confirm ボタン loading 表示)
let isImporting = $state(false);

// 「他の子供から copy」dialog
let showCopyFromChildDialog = $state(false);
let copySourceChildId = $state<number | null>(null);

// 「一括追加」dialog (manual create で複数 child 同時 create)
let showBulkCreateDialog = $state(false);

// `?import=<presetId>` で auto-open。presetId 単位の one-shot guard で、確定後に
// effect が再走しても (data.importPresetId が残存) 再 open しないようにする。
let consumedImportPresetId = $state<string | null>(null);
$effect(() => {
	const pid = data.importPresetId;
	if (pid && pid !== consumedImportPresetId) {
		consumedImportPresetId = pid;
		pendingImportPresetId = pid;
		showChildSelectionDialog = true;
	} else if (!pid) {
		consumedImportPresetId = null;
	}
});

// ChildSelectionDialog 用の ChildOption 配列
const childOptions = $derived<ChildOption[]>(
	data.children.map((c) => ({
		id: c.id,
		nickname: c.nickname,
		age: c.age,
		icon: undefined,
	})),
);

// AI プレフィル
let prefillName = $state('');
let prefillCategoryId = $state(1);
let prefillMainIcon = $state('🤸');
let prefillSubIcon = $state('');
let prefillPoints = $state(5);
let prefillNameKana = $state('');
let prefillNameKanji = $state('');

// #2902 Phase A: 表示軸 = 選択中 child の visible per-child instance のみ。
// ActivityListItem (フル CRUD: 編集 link / 表示切替 / メインクエスト / 削除) に
// そのまま流せるよう ChildActivity 全フィールドを保持する (旧 DisplayActivity の
// scope / family 分岐は撤去)。ChildActivity は ageMin/ageMax を持たない per-child
// instance のため、旧 family master 用の年齢適合フィルタ (Round 18 Cluster J) は不要。
// instance 化時点で対象 child に適合済であり、cross-child 年齢ミスマッチが構造的に発生しない。
const filteredActivities = $derived.by(() => {
	let result = visiblePerChildActivities;
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

// #2902 Phase A: 非表示セクションも選択中 child scope に揃える (旧 data.activities
// 全 child 集約は撤去)。tab を切り替えると当該 child の非表示活動のみ表示する。
const hiddenActivities = $derived(hiddenPerChildActivities);
const canAdd = $derived(!activityLimit || activityLimit.allowed);

// #2558 段階2: + 追加メニュー (manual / ai / browse / copy / bulk) の選択ハンドラ。
// PO 方針 (マーケットプレイス一本化): browse は admin 内ブラウズ UI を出さず /marketplace へ画面遷移。
// 「みんなのテンプレートで内容確認 → インポート → 活動管理に取り込み」の正規経路に合流させる。
function handleAddSelect(mode: 'manual' | 'ai' | 'browse' | 'copy' | 'bulk') {
	switch (mode) {
		case 'manual':
		case 'ai':
			addMode = mode;
			showAddDialog = true;
			break;
		case 'browse':
			// activity-pack に絞ってマーケットプレイス一覧へ遷移。詳細で取込 →
			// /admin/activities?import=<presetId> に戻り ChildSelectionDialog auto-open (正規経路)。
			void goto('/marketplace?type=activity-pack');
			break;
		case 'copy':
			showCopyFromChildDialog = true;
			break;
		case 'bulk':
			showBulkCreateDialog = true;
			break;
	}
}

function closeAddDialog() {
	showAddDialog = false;
	addMode = null;
}

function acceptAiPreview(preview: AiPreviewData) {
	prefillName = preview.name;
	prefillCategoryId = preview.categoryId;
	const aiParsed = splitIcon(preview.icon ?? '📝');
	prefillMainIcon = aiParsed.main;
	prefillSubIcon = aiParsed.sub ?? '';
	prefillPoints = preview.basePoints;
	prefillNameKana = preview.nameKana ?? '';
	prefillNameKanji = preview.nameKanji ?? '';
	addMode = 'manual';
}

// ChildSelectionDialog 確定ハンドラ: 'all' or number[] (選択 child IDs)
async function handleChildSelectionConfirm(result: 'all' | number[]) {
	if (!pendingImportPresetId) {
		showChildSelectionDialog = false;
		return;
	}
	const childIdsValue = result === 'all' ? 'all' : result.join(',');
	const formData = new FormData();
	formData.append('packId', pendingImportPresetId);
	formData.append('childIds', childIdsValue);
	// Round 18 Cluster H (#13/#16/#20/#25/#28): activity-pack subset 取込。
	// marketplace 詳細で選んだ index を URL → load → state 経由でそのまま action へ転送する。
	// 未指定なら全件 (server action 側で後方互換 fallback)。
	if (data.importSelectedIndexes && data.importSelectedIndexes.length > 0) {
		formData.append('selectedIndexes', data.importSelectedIndexes.join(','));
	}

	// #2632 CX-DoR #9 NN/G #1: 取込実行中は confirm ボタンを loading 表示する。
	isImporting = true;

	// #2745 fix: SvelteKit form action を fetch で叩く際は `x-sveltekit-action: true`
	// + `accept: application/json` ヘッダー必須 (admin/rewards `importPresetToChildren`
	// と同型)。ヘッダーなしでは ActionResult 形式が返されず `deserialize` が throw、
	// その後の showToast / dialog close / state reset が全て skip され dialog open のまま
	// + Toast 不在のまま停止する dead-end になる (PR #2748 E2E #2745 fail 真因)。
	// 加えて try/catch で safety net: 想定外の throw 時も dialog close + actionMessage
	// fallback でユーザに「動作したが結果不明」を必ず伝える (Anti-engagement 整合)。
	// #2558: imported 件数を読んで正直に出し分ける。
	// imported=0 (選んだ子に全て追加済み) を generic な「完了」で誤魔化さない。
	// #2745 (CX bug-5): success / 重複時は Toast primitive (DESIGN.md §5「操作完了の成功フィードバック」)、
	// failure (resp.ok=false) は in-page banner 維持 (恒久表示でユーザが原因確認できる方が良い)。
	try {
		const resp = await fetch('?/importPackToChildren', {
			method: 'POST',
			headers: {
				accept: 'application/json',
				'x-sveltekit-action': 'true',
			},
			body: formData,
		});
		if (resp.ok) {
			const result = deserialize(await resp.text());
			const data = result.type === 'success' ? result.data : undefined;
			// デモ環境 no-op (data.demo===true) は成功偽装せず明示 (reward / challenge と統一)。
			if (data?.demo === true) {
				actionMessage = ADMIN_ACTIVITIES_PAGE_LABELS.importDemo;
				showToast(ADMIN_ACTIVITIES_PAGE_LABELS.importDemo, undefined, 'info');
				return;
			}
			const imported = Number((data?.imported as number | undefined) ?? 0);
			const errorsCount = Array.isArray(data?.errors) ? (data.errors as unknown[]).length : 0;
			// #2745 fix Round 2 (CI artifact 解析根拠): Toast primitive (`role="alert"`) を
			// 一次 feedback として表示しつつ、in-page banner (`role="status"`) を 2 重防御として
			// 同期 set する。Toast は module-level `$state` push でリアクティブ更新されるが
			// micro-task chain (await invalidateAll() 後の DOM 反映) との race で
			// `expect(toast).toContainText(...)` が 5s timeout を踏むケースがある (#2748 Round 2 fail)。
			// banner は同 page state なので同期 set、handler return 後の re-render で即座に表示される。
			// regression test (#2745 spec) は role="alert" を待つが、Toast / banner どちらが先に
			// 表示されても regex マッチで PASS する 2 重防御。Anti-engagement 整合 (DESIGN.md §5)。
			// #2824 (取込永続 honesty): server が errors を返したら「N 件登録しました」と
			// 偽らず、保存できなかった事実を出す。imported=0 を「追加済み」(importAllDuplicates)
			// で誤魔化す経路は errors=0 (= 純粋な重複) のときに限定する。
			let message: string;
			let tone: 'success' | 'info' | 'error';
			if (errorsCount > 0) {
				message = ADMIN_ACTIVITIES_PAGE_LABELS.importPartialFailure(imported, errorsCount);
				tone = 'error';
			} else if (imported > 0) {
				message = ADMIN_ACTIVITIES_PAGE_LABELS.importSuccess(imported);
				tone = 'success';
			} else {
				message = ADMIN_ACTIVITIES_PAGE_LABELS.importAllDuplicates;
				tone = 'info';
			}
			actionMessage = message;
			showToast(message, undefined, tone);
			await invalidateAll();
		} else {
			actionMessage = ADMIN_ACTIVITIES_PAGE_LABELS.importFailed;
		}
	} catch {
		// SvelteKit deserialize / network exception を捕捉。in-page banner で
		// 「失敗した」事実を残しつつ dialog は必ず close して dead-end を回避する。
		actionMessage = ADMIN_ACTIVITIES_PAGE_LABELS.importFailed;
	} finally {
		isImporting = false;
		pendingImportPresetId = null;
		showChildSelectionDialog = false;
	}
}

function handleChildSelectionCancel() {
	pendingImportPresetId = null;
	showChildSelectionDialog = false;
}

// #2558 段階2: バックアップから復元 (JSON / CSV ファイルを ?/importFile に POST)。
// マーケットプレイス取込とは別概念。旧 UnifiedImportHub file セクションを独立ダイアログ化した。
async function handleRestoreSubmit(event: SubmitEvent) {
	event.preventDefault();
	const form = event.currentTarget as HTMLFormElement;
	const fileInput = form.querySelector<HTMLInputElement>('input[type="file"]');
	const file = fileInput?.files?.[0];
	if (!file) {
		actionMessage = FEATURES_LABELS.activitiesHeader.restoreFileRequired;
		return;
	}
	restoreLoading = true;
	const formData = new FormData();
	formData.append('file', file);
	try {
		const resp = await fetch('?/importFile', { method: 'POST', body: formData });
		if (!resp.ok) {
			actionMessage = FEATURES_LABELS.activitiesHeader.restoreFailed;
			return;
		}
		const result = deserialize(await resp.text());
		if (result.type === 'success' && result.data) {
			const d = result.data as Record<string, unknown>;
			// #2558 bug-1 整合: デモ環境では書き込みが no-op 化される。成功偽装しない。
			if (d.demo === true) {
				actionMessage = FEATURES_LABELS.activitiesHeader.restoreDemo;
			} else {
				const imported = Number(d.imported ?? 0);
				const skipped = Number(d.skipped ?? 0);
				const name = String(d.packName ?? FEATURES_LABELS.activitiesHeader.restoreFileFallbackName);
				actionMessage =
					imported === 0 && skipped > 0
						? FEATURES_LABELS.activitiesHeader.restoreAllDuplicates(name)
						: FEATURES_LABELS.activitiesHeader.restoreSuccess(name, imported, skipped);
			}
			showRestoreDialog = false;
			await invalidateAll();
		} else if (result.type === 'failure') {
			const err = (result.data as Record<string, unknown> | undefined)?.error;
			actionMessage =
				typeof err === 'string' ? err : FEATURES_LABELS.activitiesHeader.restoreFailed;
		} else {
			actionMessage = FEATURES_LABELS.activitiesHeader.restoreFailed;
		}
	} catch {
		actionMessage = FEATURES_LABELS.activitiesHeader.restoreFailed;
	} finally {
		restoreLoading = false;
	}
}

// 「他の子供から copy」action
async function handleCopyFromChild() {
	if (!copySourceChildId || !selectedChildId || copySourceChildId === selectedChildId) {
		actionMessage = '違うお子さまを選んでください';
		return;
	}
	const formData = new FormData();
	formData.append('sourceChildId', String(copySourceChildId));
	formData.append('targetChildId', String(selectedChildId));

	const resp = await fetch('?/copyFromChild', { method: 'POST', body: formData });
	if (resp.ok) {
		actionMessage = 'コピーが完了しました';
		showCopyFromChildDialog = false;
		copySourceChildId = null;
		await invalidateAll();
	} else {
		actionMessage = 'コピーに失敗しました';
	}
}

// 「一括追加」action — 簡易フォーム (本番 ActivityCreateForm は単一 child 想定なので、
// bulk は最小形で実装。Phase 5 で UX 拡充予定)
let bulkName = $state('');
let bulkCategoryId = $state(1);
let bulkIcon = $state('📝');
let bulkPoints = $state(5);
let bulkTargets = $state<'all' | number[]>('all');

async function handleBulkCreate(targets: 'all' | number[]) {
	if (!bulkName.trim()) {
		actionMessage = '名前を入力してください';
		return;
	}
	const childIdsValue = targets === 'all' ? 'all' : targets.join(',');
	const formData = new FormData();
	formData.append('name', bulkName.trim());
	formData.append('categoryId', String(bulkCategoryId));
	formData.append('icon', bulkIcon);
	formData.append('basePoints', String(bulkPoints));
	formData.append('childIds', childIdsValue);

	const resp = await fetch('?/bulkCreateForChildren', { method: 'POST', body: formData });
	if (resp.ok) {
		actionMessage = '一括追加しました';
		showBulkCreateDialog = false;
		bulkName = '';
		await invalidateAll();
	} else {
		actionMessage = '一括追加に失敗しました';
	}
}

// 子供タブクリック時に URL を `?childId=<n>` に同期 (share link / refresh 対応)
function selectChild(childId: number) {
	childIdOverride = childId;
	if (typeof window !== 'undefined') {
		const url = new URL(window.location.href);
		url.searchParams.set('childId', String(childId));
		window.history.replaceState({}, '', url.toString());
	}
}
</script>

<svelte:head>
	<title>{PAGE_TITLES.activities}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-3">
	<ActivitiesHeader
		clearConfirmOpen={showClearConfirm}
		onClearAll={() => { showClearConfirm = true; }}
		{canAdd}
		onAddSelect={handleAddSelect}
		onRestore={() => { showRestoreDialog = true; }}
		canCopyFromChild={data.children.length >= 2}
	/>

	<!-- #2362 PR-3 Phase 4: 子供タブ切替 UI -->
	{#if data.children.length > 0}
		<div
			class="child-tab-row"
			data-testid="admin-activities-child-tabs"
			role="tablist"
			aria-label={ADMIN_ACTIVITIES_PAGE_LABELS.childTabsAriaLabel}
		>
			{#each data.children as child (child.id)}
				<!-- #2902 Phase A: タブ件数は visible per-child instance のみ (一覧表示と一致)。
				     非表示活動は別 HiddenActivitiesSection に集約されるため件数から除外し水増しを防ぐ。 -->
				{@const count = (data.childActivitiesByChild[child.id] ?? []).filter((a) => Boolean(a.isVisible)).length}
				<Button
					variant={selectedChildId === child.id ? 'primary' : 'ghost'}
					size="sm"
					class="child-tab {selectedChildId === child.id ? '' : 'child-tab--inactive'}"
					data-testid="child-tab-{child.id}"
					role="tab"
					aria-selected={selectedChildId === child.id}
					onclick={() => selectChild(child.id)}
				>
					{child.nickname}
					<span class="child-tab__count">({count})</span>
				</Button>
			{/each}

			<!-- #2558 段階2: 兄弟共通化 actions (別の子からコピー / 一括追加) は header「+ 追加」メニューに
			     統合済 (bug-2 解消: トップレベル独立ボタンを撤去)。child タブ row はタブ表示のみに純化。 -->
		</div>

		{#if selectedChild}
			<div class="child-context-banner" data-testid="child-context-banner">
				<span class="child-context-banner__label">
					{selectedChild.nickname}{ADMIN_ACTIVITIES_PAGE_LABELS.childContextActivitiesSuffix(visiblePerChildActivities.length)}
				</span>
				<span class="child-context-banner__hint">
					{ADMIN_ACTIVITIES_PAGE_LABELS.childContextHint}
				</span>
			</div>
		{/if}

		<!-- #2902 Phase A: 旧 Round 18 Cluster J「年齢適合フィルタ banner」は撤去。
		     per-child instance は instance 化時点で対象 child に適合済のため、family master
		     全 child 共有 activity の年齢ミスマッチ (escape hatch が必要だった問題) が
		     構造的に発生しない。表示軸が selected child の per-child のみに一本化された。 -->
	{/if}

	{#if showClearConfirm}
		<ActivityClearAllConfirm
			bind:loading={clearLoading}
			onsubmit={() => {}}
			onresult={(msg) => { actionMessage = msg; showClearConfirm = false; }}
			oncancel={() => { showClearConfirm = false; }}
		/>
	{/if}

	{#if activityLimit && !activityLimit.allowed}
		<ActivityLimitBanner current={activityLimit.current} max={activityLimit.max} />
	{/if}

	<!-- カテゴリフィルタ -->
	<div class="filter-row" data-tutorial="category-filter">
		<Button
			variant={filterCategoryId === 0 ? 'primary' : 'ghost'}
			size="sm"
			class="filter-chip {filterCategoryId === 0 ? '' : 'filter-chip--inactive'}"
			onclick={() => filterCategoryId = 0}
		>
			{UI_LABELS.all} ({visiblePerChildActivities.length})
		</Button>
		{#each data.categoryDefs as catDef}
			{@const count = visiblePerChildActivities.filter(a => a.categoryId === catDef.id).length}
			<Button
				variant={filterCategoryId === catDef.id ? 'primary' : 'ghost'}
				size="sm"
				class="filter-chip {filterCategoryId === catDef.id ? '' : 'filter-chip--inactive'}"
				onclick={() => filterCategoryId = catDef.id}
			>
				{catDef.name} ({count})
			</Button>
		{/each}
	</div>

	<!-- 検索 -->
	<FormField id="activity-search" label="活動名で検索" type="search" bind:value={searchQuery} placeholder="🔍 活動名で検索..." />

	<!-- アクションメッセージ -->
	<!--
		#2745 fix Round 2 (CI artifact 解析根拠): `role="status"` を付与し、
		Toast (`role="alert"`) と並ぶ ARIA live region として screen reader にも feedback を届ける。
		E2E #2745 regression は Toast `role="alert"` を待つが、Toast micro-task race で
		timeout した場合の保険として banner も `role="alert"` 系統 (alert + status は共に live region)
		で a11y を確保する。
	-->
	{#if actionMessage}
		<div class="action-message" role="status" data-testid="admin-activities-action-message">
			{actionMessage}
		</div>
	{/if}

	<!-- #2902 Phase A: 活動一覧（メインコンテンツ）— 選択中 child の per-child instance を
	     単一表示。全行が ActivityListItem (編集 / 表示切替 / メインクエスト / 削除のフル CRUD)。
	     旧 per-child read-only badge 行 + family master 並存表示は撤去 (二重表示 / 件数水増し解消)。 -->
	<div class="space-y-1" data-tutorial="activity-list">
		{#each filteredActivities as activity (activity.id)}
			<div data-testid="per-child-activity-{activity.id}">
				<ActivityListItem
					{activity}
					mainQuestCount={data.mainQuestCount ?? 0}
					mainQuestMax={data.mainQuestMax ?? 3}
				/>
			</div>
		{:else}
			<ActivityEmptyState
				hasFilter={Boolean(searchQuery || filterCategoryId)}
				{canAdd}
				onAdd={(mode) => handleAddSelect(mode)}
			/>
		{/each}
	</div>

	<HiddenActivitiesSection
		activities={hiddenActivities}
		logCounts={data.logCounts}
	/>

	<!-- #2558 段階2: 'import' (admin 内マーケットプレイス風ブラウズ UI) を撤去。manual / ai のみ。 -->
	<Dialog bind:open={showAddDialog} title={addMode === 'ai' ? FEATURES_LABELS.activitiesHeader.addDialogTitleAi : FEATURES_LABELS.activitiesHeader.addDialogTitleManual} testid="add-activity-dialog">
		{#if addMode === 'ai'}
			<!-- #2902 Phase A: load は planTier を返さず isPremium を返す。
			     旧 `data.planTier === 'family'` は常に undefined === 'family' = false で機能不全だった。
			     有料判定 (isPremium) を渡して AI 提案パネルの premium gating を正しく評価する。 -->
			<AiSuggestPanel onaccept={acceptAiPreview} isFamily={data.isPremium} />
		{:else if addMode === 'manual'}
			<ActivityCreateForm
				categoryDefs={data.categoryDefs}
				childId={selectedChildId}
				initialName={prefillName}
				initialCategoryId={prefillCategoryId}
				initialMainIcon={prefillMainIcon}
				initialSubIcon={prefillSubIcon}
				initialPoints={prefillPoints}
				initialNameKana={prefillNameKana}
				initialNameKanji={prefillNameKanji}
				oncreated={() => { closeAddDialog(); }}
			/>
		{/if}
	</Dialog>

	<!-- #2558 段階2: バックアップから復元ダイアログ (旧 UnifiedImportHub file セクション独立化)。
	     マーケットプレイスの取込とは別概念。?/importFile action 経由で JSON / CSV を読み込む。 -->
	<Dialog
		bind:open={showRestoreDialog}
		title={FEATURES_LABELS.activitiesHeader.restoreDialogTitle}
		testid="restore-activities-dialog"
	>
		<p class="restore-dialog-desc">{FEATURES_LABELS.activitiesHeader.restoreDialogDesc}</p>
		<form class="restore-form" onsubmit={handleRestoreSubmit} data-testid="restore-activities-form">
			<input
				type="file"
				name="file"
				accept=".json,.csv"
				class="restore-file-input"
				required
				disabled={restoreLoading}
				data-testid="restore-file-input"
			/>
			<div class="restore-footer">
				<Button variant="ghost" onclick={() => { showRestoreDialog = false; }}>
					{ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogCancel}
				</Button>
				<Button
					type="submit"
					variant="primary"
					disabled={restoreLoading}
					data-testid="restore-submit"
				>
					{restoreLoading
						? FEATURES_LABELS.activitiesHeader.restoreProcessing
						: FEATURES_LABELS.activitiesHeader.restoreSubmitBtn}
				</Button>
			</div>
		</form>
	</Dialog>

	<!-- #2362 PR-3 Phase 4: ChildSelectionDialog (`?import=<presetId>` auto-open) -->
	<ChildSelectionDialog
		bind:open={showChildSelectionDialog}
		children={childOptions}
		allowMultiple={true}
		onConfirm={handleChildSelectionConfirm}
		onCancel={handleChildSelectionCancel}
		confirmLoading={isImporting}
		closeOnConfirm={false}
		testid="import-child-selection-dialog"
	/>

	<!-- 「他の子供から copy」 dialog -->
	<Dialog
		bind:open={showCopyFromChildDialog}
		title={ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogTitle}
		testid="copy-from-child-dialog"
	>
		<p class="copy-dialog-desc">
			{ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogDescPrefix}{CHILD_HONORIFIC_LABEL}{ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogDescSuffix}<strong>{selectedChild?.nickname ?? ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogSelectedPlaceholder}</strong>{ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogDescCloseParen}
		</p>
		<div class="copy-source-list">
			{#each data.children.filter((c) => c.id !== selectedChildId) as child (child.id)}
				<label class="copy-source-option">
					<input
						type="radio"
						name="copy-source"
						value={child.id}
						checked={copySourceChildId === child.id}
						onchange={() => { copySourceChildId = child.id; }}
						data-testid="copy-source-{child.id}"
					/>
					<span class="copy-source-option__label">
						{child.nickname}
						<span class="copy-source-option__age">({child.age} {ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogAgeSuffix})</span>
						<span class="copy-source-option__count">
							{(data.childActivitiesByChild[child.id] ?? []).length} {ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogCountSuffix}
						</span>
					</span>
				</label>
			{:else}
				<p class="copy-source-empty">{ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogEmpty}</p>
			{/each}
		</div>
		<div class="copy-dialog-footer">
			<Button variant="ghost" onclick={() => { showCopyFromChildDialog = false; copySourceChildId = null; }}>
				{ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogCancel}
			</Button>
			<Button
				variant="primary"
				disabled={!copySourceChildId}
				data-testid="copy-from-child-confirm"
				onclick={handleCopyFromChild}
			>
				{ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogConfirm}
			</Button>
		</div>
	</Dialog>

	<!-- 「一括追加」 dialog (新規 activity を複数 child に同時 create) -->
	<!-- Phase 4 簡易版: form + 内蔵 child checkbox list (ChildSelectionDialog の nesting を回避) -->
	<Dialog
		bind:open={showBulkCreateDialog}
		title={ADMIN_ACTIVITIES_PAGE_LABELS.bulkDialogTitle}
		testid="bulk-create-dialog"
	>
		<div class="bulk-form">
			<FormField
				id="bulk-name"
				label={ADMIN_ACTIVITIES_PAGE_LABELS.bulkFormName}
				bind:value={bulkName}
				required={true}
			/>
			<FormField
				id="bulk-points"
				label={ADMIN_ACTIVITIES_PAGE_LABELS.bulkFormPoints}
				type="number"
				bind:value={bulkPoints}
				min={1}
				max={100}
			/>
			<div class="bulk-field">
				<label for="bulk-category" class="bulk-field__label">{ADMIN_ACTIVITIES_PAGE_LABELS.bulkFormCategory}</label>
				<select id="bulk-category" bind:value={bulkCategoryId} class="bulk-select">
					{#each data.categoryDefs as catDef}
						<option value={catDef.id}>{catDef.name}</option>
					{/each}
				</select>
			</div>
			<FormField
				id="bulk-icon"
				label={ADMIN_ACTIVITIES_PAGE_LABELS.bulkFormIcon}
				bind:value={bulkIcon}
			/>
		</div>

		<fieldset class="bulk-targets">
			<legend class="bulk-targets__legend">{ADMIN_ACTIVITIES_PAGE_LABELS.bulkTargetsLegend}</legend>
			<label class="bulk-target-option">
				<input
					type="radio"
					name="bulk-target"
					value="all"
					checked={bulkTargets === 'all'}
					onchange={() => { bulkTargets = 'all'; }}
					data-testid="bulk-target-all"
				/>
				<span>{ADMIN_ACTIVITIES_PAGE_LABELS.bulkTargetAll}</span>
			</label>
			{#each data.children as child (child.id)}
				<label class="bulk-target-option">
					<input
						type="checkbox"
						checked={Array.isArray(bulkTargets) && bulkTargets.includes(child.id)}
						onchange={(e) => {
							const checked = (e.target as HTMLInputElement).checked;
							if (checked) {
								bulkTargets = Array.isArray(bulkTargets)
									? [...bulkTargets, child.id]
									: [child.id];
							} else if (Array.isArray(bulkTargets)) {
								const next = bulkTargets.filter((id) => id !== child.id);
								bulkTargets = next.length === 0 ? 'all' : next;
							}
						}}
						data-testid="bulk-target-{child.id}"
					/>
					<span>{child.nickname} ({child.age} {ADMIN_ACTIVITIES_PAGE_LABELS.bulkTargetChildAgeSuffix})</span>
				</label>
			{/each}
		</fieldset>

		<div class="copy-dialog-footer">
			<Button variant="ghost" onclick={() => { showBulkCreateDialog = false; }}>
				{ADMIN_ACTIVITIES_PAGE_LABELS.bulkDialogCancel}
			</Button>
			<Button
				variant="primary"
				disabled={!bulkName.trim()}
				data-testid="bulk-create-confirm"
				onclick={() => handleBulkCreate(bulkTargets)}
			>
				{ADMIN_ACTIVITIES_PAGE_LABELS.bulkDialogConfirm}
			</Button>
		</div>
	</Dialog>
</div>

<style>
	.filter-row {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
	}
	:global(.filter-chip) {
		border-radius: 9999px !important;
		font-size: 0.75rem !important;
	}
	:global(.filter-chip--inactive) {
		background: var(--color-surface-muted) !important;
		color: var(--color-text-secondary) !important;
	}

	.action-message {
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-md);
		background: var(--color-feedback-warning-bg);
		border: 1px solid var(--color-feedback-warning-border);
		color: var(--color-feedback-warning-text);
		font-size: 0.85rem;
	}

	/* #2362 PR-3 Phase 4: child tabs */
	.child-tab-row {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
		align-items: center;
		padding: 0.5rem;
		background: var(--color-surface-muted);
		border-radius: var(--radius-md);
	}
	:global(.child-tab) {
		border-radius: 9999px !important;
		font-size: 0.85rem !important;
	}
	:global(.child-tab--inactive) {
		background: var(--color-surface) !important;
		color: var(--color-text-secondary) !important;
	}
	.child-tab__count {
		font-size: 0.75rem;
		opacity: 0.8;
		margin-left: 0.25rem;
	}
	.child-context-banner {
		padding: 0.5rem 0.75rem;
		background: var(--color-surface-accent);
		border-left: 3px solid var(--color-border-accent);
		border-radius: var(--radius-sm);
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.child-context-banner__label {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}
	.child-context-banner__hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	/* #2902 Phase A: old .age-filter-banner / .per-child-item* (read-only rows) removed —
	   display unified into ActivityListItem (ASCII comment to satisfy local/no-hardcoded-jp-text). */

	/* Copy dialog */
	.copy-dialog-desc {
		font-size: 0.9rem;
		color: var(--color-text-secondary);
		margin-bottom: 0.75rem;
	}
	.copy-source-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.copy-source-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.copy-source-option:has(input:checked) {
		background: var(--color-surface-accent);
		border-color: var(--color-border-focus);
	}
	.copy-source-option__label {
		display: flex;
		gap: 0.5rem;
		flex: 1;
	}
	.copy-source-option__age,
	.copy-source-option__count {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}
	.copy-source-empty {
		text-align: center;
		color: var(--color-text-muted);
		padding: 1rem;
	}
	.copy-dialog-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border-light);
	}

	/* Bulk create dialog */
	.bulk-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.bulk-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.bulk-field__label {
		font-size: 0.85rem;
		font-weight: 500;
	}
	.bulk-select {
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-sm);
	}
	.bulk-targets {
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-sm);
		padding: 0.5rem;
		margin-bottom: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.bulk-targets__legend {
		font-size: 0.85rem;
		font-weight: 600;
		padding: 0 0.25rem;
	}
	.bulk-target-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem;
		font-size: 0.9rem;
	}

	/* #2558 stage 2: restore-from-backup dialog (CSS comments use ASCII to satisfy local/no-hardcoded-jp-text in style blocks) */
	.restore-dialog-desc {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		margin-bottom: 0.75rem;
		line-height: 1.5;
	}
	.restore-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.restore-file-input {
		font-size: 0.875rem;
	}
	.restore-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border-light);
	}
</style>
