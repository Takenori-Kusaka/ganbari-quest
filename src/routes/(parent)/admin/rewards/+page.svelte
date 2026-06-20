<script lang="ts">
// /admin/rewards — ごほうび管理 (#2362 PR-4: per-child UX 整備、ADR-0055)
//
// PR-4 (2026-05-25):
// - 子供別タブ切替 (PR-3 ADMIN_ACTIVITIES_PAGE_LABELS 同型)
// - ChildSelectionDialog auto-open (`?import=<presetId>` 経由)
// - 「他の子供から copy」action (兄弟共通化 UX、User §3 reward use case R6)
// - marketplace 取込フロー: child 情報を URL/body に露出させない (CWE-598 / User §7.3)
//
// 既存 (#2268): CRUD + 命名訂正 + 検索 + grant→add リネーム + 申請タブ削除

import { deserialize, enhance } from '$app/forms';
import { goto, invalidateAll } from '$app/navigation';
import { getActionErrorDisplay, getErrorMessage } from '$lib/domain/errors';
import {
	ADMIN_REWARDS_PAGE_LABELS,
	APP_LABELS,
	BACKUP_RESTORE_LABELS,
	PAGE_TITLES,
	PLAN_GATE_LABELS,
	REWARDS_LABELS,
} from '$lib/domain/labels';
import { CHILD_TERMS, CONCEPT_ICONS, REWARD_TERMS, TEMPLATE_TERMS } from '$lib/domain/terms';
import AdminResourceHeader from '$lib/features/admin/components/AdminResourceHeader.svelte';
import type { RewardPreviewData } from '$lib/features/admin/components/AiSuggestRewardPanel.svelte';
import AiSuggestRewardPanel from '$lib/features/admin/components/AiSuggestRewardPanel.svelte';
// CX-DoR #9・#11 横展開 (Round 18): empty state を共通 SSOT に統一 (NN/G #4 consistency)
import { resolveImportFeedback } from '$lib/marketplace/ui/import-feedback';
import UnifiedEmptyState from '$lib/marketplace/ui/UnifiedEmptyState.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import ChildSelectionDialog, {
	type ChildOption,
} from '$lib/ui/primitives/ChildSelectionDialog.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import Menu, { type MenuItem } from '$lib/ui/primitives/Menu.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';
// CX-DoR #9 NN/G #4 consistency (Round 18): 取込/copy 結果を Toast primitive で一次通知。
// admin/activities (#2745/#2748 fix) と同型の 2 層防御 — Toast (`role="alert"`) を primary、
// in-page banner (`role="status"`) を Toast micro-task race の保険として同期 set する。
import { showToast } from '$lib/ui/primitives/Toast.svelte';

// #2362 PR-4: hardcoded text 排除 (ADR-0045) — CHILD_TERMS.honorific を template literal で参照
const CHILD_HONORIFIC_LABEL = CHILD_TERMS.honorific;

let { data, form } = $props();
// #787: form.error が string | PlanLimitError どちらでも表示できるよう正規化
const errorMessage = $derived(getErrorMessage(form?.error));

// #2362 PR-4: 子供タブ切替 UI
//   `?childId=<n>` query で初期 child 復元、未指定なら最初の child
let childIdOverride = $state<number | undefined>(
	data.initialChildId != null && data.children.some((c) => c.id === data.initialChildId)
		? data.initialChildId
		: undefined,
);
const selectedChildId = $derived(
	childIdOverride !== undefined && data.children.some((c) => c.id === childIdOverride)
		? childIdOverride
		: (data.children[0]?.id ?? 0),
);
const selectedChild = $derived(data.children.find((c) => c.id === selectedChildId));

// 選択中 child の per-child reward 一覧
const perChildRewards = $derived(
	selectedChildId ? (data.childRewardsByChild[selectedChildId] ?? []) : [],
);

// #2362 PR-4: ChildSelectionDialog state (per-child 取込時 auto-open)
let showChildSelectionDialog = $state(false);
let pendingImportPresetId = $state<string | null>(null);
let actionMessage = $state('');
// #2894 AC3: PlanLimitError 受領時のアップグレード導線 URL (null=非表示)。
// banner / toast 文字列化壊れ (`[object Object]`) を getActionErrorDisplay で根治し、
// free tier の取込失敗時に /admin/subscription へのリンクを併記する (NN/G #9)。
let actionUpgradeUrl = $state<string | null>(null);
// #2632 CX-DoR #9 NN/G #1: 取込実行中フラグ (confirm ボタン loading 表示)
let isImporting = $state(false);

// #2362 PR-4: 「他の子供から copy」dialog
let showCopyFromChildDialog = $state(false);
let copySourceChildId = $state<number | null>(null);

// #3079: バックアップから復元 dialog (preview → 実行の 2 段)。resource noun = REWARD_TERMS.canonical
let showRestoreDialog = $state(false);
let restoreLoading = $state(false);
let restoreFile = $state<File | null>(null);
let restorePreview = $state<{ total: number; newItems: number; duplicates: number } | null>(null);

// #2832: reward 編集 / 削除 dialog state
type PerChildReward = (typeof perChildRewards)[number];
let editingReward = $state<PerChildReward | null>(null);
let showEditDialog = $state(false);
let editTitle = $state('');
let editPoints = $state(100);
let editIcon = $state('🎁');
// #3154: 編集時もショップ陳列系統を変更可能にする ('' = 自動振り分け → null)
let editShopCategory = $state('');
let isSavingEdit = $state(false);
let deletingReward = $state<PerChildReward | null>(null);
let showDeleteDialog = $state(false);
let isDeleting = $state(false);

// #2832 AC2: pending redemption が存在する reward か (編集 note / 処理待ちバッジ表示用)
function hasPendingRedemption(rewardId: number): boolean {
	return data.pendingRewardIds.includes(rewardId);
}

function openEditDialog(reward: PerChildReward) {
	editingReward = reward;
	editTitle = reward.title;
	editPoints = reward.points;
	editIcon = reward.icon ?? '🎁';
	// #3154: 既存の陳列系統を初期選択 (null/未指定は '' = 自動振り分け)
	editShopCategory = reward.shopCategory ?? '';
	showEditDialog = true;
}

function openDeleteDialog(reward: PerChildReward) {
	deletingReward = reward;
	showDeleteDialog = true;
}

// #2832: 編集確定。fetch + deserialize は handleCopyFromChild と同型
// (`x-sveltekit-action` header 必須、#2474 must-2)。
async function handleEditConfirm() {
	if (!editingReward) return;
	const formData = new FormData();
	formData.append('rewardId', String(editingReward.id));
	formData.append('childId', String(editingReward.childId));
	formData.append('title', editTitle);
	formData.append('points', String(editPoints));
	formData.append('icon', editIcon);
	// #3154: 陳列系統 ('' = 自動振り分け → server 側で null 正規化)
	formData.append('shopCategory', editShopCategory);
	isSavingEdit = true;
	actionUpgradeUrl = null;
	try {
		const resp = await fetch('?/update', {
			method: 'POST',
			headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
			body: formData,
		});
		const actionResult = deserialize(await resp.text()) as
			| { type: 'success'; data?: Record<string, unknown> }
			| { type: 'failure'; data?: { error?: unknown } }
			| { type: 'redirect'; location: string }
			| { type: 'error'; error: unknown };

		if (actionResult.type === 'success') {
			// 2 層 feedback (DESIGN.md §5): Toast (primary) + in-page banner (保険)
			actionMessage = ADMIN_REWARDS_PAGE_LABELS.editSuccess;
			showToast(ADMIN_REWARDS_PAGE_LABELS.editSuccess, undefined, 'success');
			showEditDialog = false;
			editingReward = null;
			await invalidateAll();
		} else if (actionResult.type === 'failure') {
			const display = getActionErrorDisplay(
				actionResult.data?.error,
				ADMIN_REWARDS_PAGE_LABELS.editFailed,
			);
			actionMessage = display.message;
			actionUpgradeUrl = display.upgradeUrl;
			showToast(actionMessage, undefined, 'error');
		} else {
			actionMessage = ADMIN_REWARDS_PAGE_LABELS.editFailed;
			showToast(ADMIN_REWARDS_PAGE_LABELS.editFailed, undefined, 'error');
		}
	} catch {
		actionMessage = ADMIN_REWARDS_PAGE_LABELS.editFailed;
		showToast(ADMIN_REWARDS_PAGE_LABELS.editFailed, undefined, 'error');
	} finally {
		isSavingEdit = false;
	}
}

// #2832 AC1: 削除確定。pending redemption あり → server が 409 (deletePendingBlocked) を返し
// 2 層 feedback (Toast + banner) でエラー表示する。
async function handleDeleteConfirm() {
	if (!deletingReward) return;
	const formData = new FormData();
	formData.append('rewardId', String(deletingReward.id));
	formData.append('childId', String(deletingReward.childId));
	isDeleting = true;
	try {
		const resp = await fetch('?/delete', {
			method: 'POST',
			headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
			body: formData,
		});
		const actionResult = deserialize(await resp.text()) as
			| { type: 'success'; data?: Record<string, unknown> }
			| { type: 'failure'; data?: { error?: unknown } }
			| { type: 'redirect'; location: string }
			| { type: 'error'; error: unknown };

		if (actionResult.type === 'success') {
			actionMessage = ADMIN_REWARDS_PAGE_LABELS.deleteSuccess;
			showToast(ADMIN_REWARDS_PAGE_LABELS.deleteSuccess, undefined, 'success');
			showDeleteDialog = false;
			deletingReward = null;
			await invalidateAll();
		} else if (actionResult.type === 'failure') {
			const display = getActionErrorDisplay(
				actionResult.data?.error,
				ADMIN_REWARDS_PAGE_LABELS.deleteFailed,
			);
			actionMessage = display.message;
			showToast(actionMessage, undefined, 'error');
			// 削除拒否 (pending ガード) は dialog を閉じ、banner + toast でガイダンスを示す
			showDeleteDialog = false;
			deletingReward = null;
		} else {
			actionMessage = ADMIN_REWARDS_PAGE_LABELS.deleteFailed;
			showToast(ADMIN_REWARDS_PAGE_LABELS.deleteFailed, undefined, 'error');
		}
	} catch {
		actionMessage = ADMIN_REWARDS_PAGE_LABELS.deleteFailed;
		showToast(ADMIN_REWARDS_PAGE_LABELS.deleteFailed, undefined, 'error');
	} finally {
		isDeleting = false;
	}
}

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

// #2362 PR-4: 取込失敗 / invalid preset の guidance
// #2998 fix: 旧実装は invalid 時に毎 effect 実行で `actionMessage` set + `showToast` を呼び、
//   `showToast` の module-level $state push と effect 再評価が hydration / preview で
//   `effect_update_depth_exceeded` を起こしていた (develop で再現する pre-existing 不具合、
//   /admin/rewards が「無反応」化し tab 同期 / copy dialog / action message が全て壊れる)。
//   one-shot guard (handledInvalidPreset) で同一 invalid 状態に 1 回だけ反映してループを断つ
//   (import auto-open effect の consumedImportPresetId と同型の guard)。
let handledInvalidPreset = $state(false);
$effect(() => {
	if (data.importPresetInvalid) {
		if (!handledInvalidPreset) {
			handledInvalidPreset = true;
			actionMessage = ADMIN_REWARDS_PAGE_LABELS.importInvalidPreset;
			showToast(ADMIN_REWARDS_PAGE_LABELS.importInvalidPreset, undefined, 'info');
		}
	} else {
		handledInvalidPreset = false;
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

// #2268: 検索 UI 状態
let searchQuery = $state('');

// #2998 (EPIC #2897): 「+ 追加」dropdown → Dialog 起動方式に統一 (activities / checklists と同型)。
//   manual = 手動追加フォーム (template grid + custom form) を Dialog で開く。
//   ai     = AI 提案パネルを Dialog で開く (旧: 本文直置きを撤去)。
//   browse = /marketplace?type=reward-set へ画面遷移 (admin 内 browse UI を出さない)。
let showAddDialog = $state(false);
let addMode = $state<'manual' | 'ai' | null>(null);

function handleAddSelect(mode: 'manual' | 'ai' | 'browse') {
	switch (mode) {
		case 'manual':
		case 'ai':
			addMode = mode;
			showAddDialog = true;
			break;
		case 'browse':
			void goto('/marketplace?type=reward-set');
			break;
	}
}

function closeAddDialog() {
	showAddDialog = false;
	addMode = null;
}

// 「+ 追加」dropdown menu items。先頭 3 種 (manual / ai / browse) を activities / checklists と
// 同一 id・同一順序で揃える (admin-add-path-isomorphism.spec.ts AC6 同型性固定)。
const addMenuItems = $derived<MenuItem[]>([
	{
		id: 'manual',
		label: ADMIN_REWARDS_PAGE_LABELS.addManualLabel,
		icon: ADMIN_REWARDS_PAGE_LABELS.addManualIcon,
		disabled: !data.isPremium,
		onSelect: () => handleAddSelect('manual'),
	},
	{
		id: 'ai',
		label: ADMIN_REWARDS_PAGE_LABELS.addAiLabel,
		icon: ADMIN_REWARDS_PAGE_LABELS.addAiIcon,
		onSelect: () => handleAddSelect('ai'),
	},
	{
		id: 'browse',
		label: ADMIN_REWARDS_PAGE_LABELS.addBrowseTemplatesLabel,
		icon: ADMIN_REWARDS_PAGE_LABELS.addBrowseTemplatesIcon,
		onSelect: () => handleAddSelect('browse'),
	},
]);

// #2998: AI 提案を採用したら Dialog を manual フォーム表示に切り替える (activities acceptAiPreview と同型)。
//   prefill 後に manual フォームを見せて内容確認 → 「追加する」で確定できる流れ。
function acceptAiRewardThenSwitch(preview: RewardPreviewData) {
	acceptAiReward(preview);
	addMode = 'manual';
}

// --- ごほうび追加フォーム ---
let selectedTemplate = $state<{
	title: string;
	points: number;
	icon: string;
	category: string;
} | null>(null);
let customTitle = $state('');
let customPoints = $state(100);
let customIcon = $state('🎁');
let customCategory = $state('とくべつ');
// #3147: ショップ陳列系統 (physical/money/privilege)。'' = 自動振り分け (表示側 deriveShopCategory)
let customShopCategory = $state('');
let grantSuccess = $state(false);

// #3147: ショップ陳列系統セレクトの選択肢 ('' = 自動振り分け先頭)
const shopCategoryOptions = [
	{ value: '', label: ADMIN_REWARDS_PAGE_LABELS.shopCategoryAuto },
	{ value: 'physical', label: ADMIN_REWARDS_PAGE_LABELS.shopCategoryPhysical },
	{ value: 'money', label: ADMIN_REWARDS_PAGE_LABELS.shopCategoryMoney },
	{ value: 'privilege', label: ADMIN_REWARDS_PAGE_LABELS.shopCategoryPrivilege },
];

function selectTemplate(tmpl: { title: string; points: number; icon?: string; category: string }) {
	selectedTemplate = { ...tmpl, icon: tmpl.icon ?? '🎁' };
	customTitle = tmpl.title;
	customPoints = tmpl.points;
	customIcon = tmpl.icon ?? '🎁';
	customCategory = tmpl.category;
}

const categoryLabels: Record<string, string> = {
	うんどう: 'うんどう',
	べんきょう: 'べんきょう',
	せいかつ: 'せいかつ',
	こうりゅう: 'こうりゅう',
	そうぞう: 'そうぞう',
	とくべつ: 'とくべつ',
};

/** AI提案からカテゴリをフォームのカテゴリラベルにマッピング */
const rewardGroupToCategory: Record<string, string> = {
	もの: 'とくべつ',
	たいけん: 'こうりゅう',
	おこづかい: 'とくべつ',
	とくべつ: 'とくべつ',
};

function acceptAiReward(preview: RewardPreviewData) {
	customTitle = preview.title;
	customPoints = preview.points;
	customIcon = preview.icon;
	customCategory = rewardGroupToCategory[preview.category] ?? preview.category;
	selectedTemplate = {
		title: preview.title,
		points: preview.points,
		icon: preview.icon,
		category: customCategory,
	};
}

// #2268: 検索 filter (テンプレ + プリセット両方に適用)
const filteredTemplates = $derived(
	searchQuery.trim()
		? data.templates.filter((t) => t.title.toLowerCase().includes(searchQuery.trim().toLowerCase()))
		: data.templates,
);
const hasSearchActive = $derived(searchQuery.trim().length > 0);
// #2558 段階2 横展開: 旧 in-page preset browse UI 撤去に伴い、
// allEmpty 判定は user-created templates のみで行う。
const allEmpty = $derived(hasSearchActive && filteredTemplates.length === 0);

// #2268: overflow menu (申請承認等) + #3079: 個別 backup/restore (活動と同順序: 復元 → エクスポート)
const overflowMenuItems = $derived<MenuItem[]>([
	{
		id: 'requests',
		label:
			data.pendingRequestsCount > 0
				? REWARDS_LABELS.requestsMenuLabel(data.pendingRequestsCount)
				: REWARDS_LABELS.requestsMenuLabelEmpty,
		icon: '📋',
		onSelect: () => goto('/admin/rewards/requests'),
	},
	{
		id: 'restore',
		label: BACKUP_RESTORE_LABELS.restoreLabel,
		icon: BACKUP_RESTORE_LABELS.restoreIcon,
		onSelect: openRestoreDialog,
	},
	{
		id: 'export',
		label: BACKUP_RESTORE_LABELS.exportLabel,
		icon: BACKUP_RESTORE_LABELS.exportIcon,
		onSelect: exportRewards,
	},
]);

// #3079: エクスポート — 選択中 child の reward を v2 envelope JSON でダウンロード
function exportRewards() {
	if (!selectedChildId) return;
	const a = document.createElement('a');
	a.href = `/api/v1/special-rewards/export?childId=${selectedChildId}`;
	a.download = 'rewards-export.json';
	document.body.appendChild(a);
	a.click();
	a.remove();
}

// #3079: バックアップから復元 — dialog を開く (state リセット)
function openRestoreDialog() {
	restoreFile = null;
	restorePreview = null;
	showRestoreDialog = true;
}

function onRestoreFileChange(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	restoreFile = input.files?.[0] ?? null;
	restorePreview = null;
}

// 2 段フロー step 1: preview (dryRun) — 件数 / 重複を取得
async function handleRestorePreview() {
	if (!restoreFile) {
		actionMessage = BACKUP_RESTORE_LABELS.fileRequired;
		return;
	}
	if (!selectedChildId) return;
	restoreLoading = true;
	try {
		const formData = new FormData();
		formData.append('childId', String(selectedChildId));
		formData.append('file', restoreFile);
		const resp = await fetch('?/restorePreview', {
			method: 'POST',
			headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
			body: formData,
		});
		const r = deserialize(await resp.text()) as
			| { type: 'success'; data?: { total?: number; newItems?: number; duplicates?: number } }
			| { type: 'failure'; data?: { error?: string } }
			| { type: 'redirect'; location: string }
			| { type: 'error'; error: unknown };
		if (r.type === 'success' && r.data) {
			restorePreview = {
				total: r.data.total ?? 0,
				newItems: r.data.newItems ?? 0,
				duplicates: r.data.duplicates ?? 0,
			};
		} else if (r.type === 'failure') {
			actionMessage = r.data?.error ?? BACKUP_RESTORE_LABELS.restoreFailed;
			showToast(actionMessage, undefined, 'error');
		} else {
			actionMessage = BACKUP_RESTORE_LABELS.restoreFailed;
		}
	} catch {
		actionMessage = BACKUP_RESTORE_LABELS.restoreFailed;
	} finally {
		restoreLoading = false;
	}
}

// 2 段フロー step 2: 実行 — 実 DB write
async function handleRestoreConfirm() {
	if (!restoreFile || !selectedChildId) return;
	restoreLoading = true;
	try {
		const formData = new FormData();
		formData.append('childId', String(selectedChildId));
		formData.append('file', restoreFile);
		const resp = await fetch('?/restoreFile', {
			method: 'POST',
			headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
			body: formData,
		});
		const r = deserialize(await resp.text()) as
			| {
					type: 'success';
					data?: { fileName?: string; imported?: number; skipped?: number; total?: number };
			  }
			| { type: 'failure'; data?: { error?: string } }
			| { type: 'redirect'; location: string }
			| { type: 'error'; error: unknown };
		if (r.type === 'success' && r.data) {
			const name = r.data.fileName ?? BACKUP_RESTORE_LABELS.fileFallbackName;
			const imported = r.data.imported ?? 0;
			const skipped = r.data.skipped ?? 0;
			actionMessage =
				imported === 0 && skipped > 0
					? BACKUP_RESTORE_LABELS.restoreAllDuplicatesResult(name, REWARD_TERMS.canonical)
					: BACKUP_RESTORE_LABELS.restoreSuccess(name, imported, skipped);
			showToast(actionMessage, undefined, 'success');
			showRestoreDialog = false;
			await invalidateAll();
		} else if (r.type === 'failure') {
			actionMessage = r.data?.error ?? BACKUP_RESTORE_LABELS.restoreFailed;
			showToast(actionMessage, undefined, 'error');
		} else {
			actionMessage = BACKUP_RESTORE_LABELS.restoreFailed;
		}
	} catch {
		actionMessage = BACKUP_RESTORE_LABELS.restoreFailed;
	} finally {
		restoreLoading = false;
	}
}

// #2362 PR-4: 子供タブクリック時に URL を `?childId=<n>` に同期 (share link / refresh 対応)
function selectChild(childId: number) {
	childIdOverride = childId;
	if (typeof window !== 'undefined') {
		const url = new URL(window.location.href);
		url.searchParams.set('childId', String(childId));
		// import param は dialog auto-open でしか使わないので消す (戻ったとき再 open しない)
		url.searchParams.delete('import');
		window.history.replaceState({}, '', url.toString());
	}
}

// #2362 PR-4: ChildSelectionDialog 確定ハンドラ: 'all' or number[] (選択 child IDs)
//
// #2474 must-2 (Copilot must-1): SvelteKit form action を fetch で直接呼ぶ場合、
// `x-sveltekit-action: true` + `accept: application/json` header が無いと 303 redirect
// が返ってきて JSON parse 常時 fail し件数が誤表示される (件数=1 固定の旧 bug)。
// 公式 enhance と同じ header を付与 + `deserialize()` で正しい ActionResult を取得する。
async function handleChildSelectionConfirm(result: 'all' | number[]) {
	if (!pendingImportPresetId) {
		showChildSelectionDialog = false;
		return;
	}
	const childIdsValue = result === 'all' ? 'all' : result.join(',');
	const formData = new FormData();
	formData.append('presetId', pendingImportPresetId);
	formData.append('childIds', childIdsValue);

	// #2632 CX-DoR #9 NN/G #1: 取込実行中は confirm ボタンを loading 表示する。
	isImporting = true;
	// #2894 AC3: 新しい取込試行ごとに前回のアップグレード導線をクリアする。
	actionUpgradeUrl = null;

	try {
		const resp = await fetch('?/importPresetToChildren', {
			method: 'POST',
			headers: {
				accept: 'application/json',
				'x-sveltekit-action': 'true',
			},
			body: formData,
		});
		// SvelteKit returns the serialized ActionResult as text for AJAX requests
		// when x-sveltekit-action header is set. Use `deserialize()` to parse correctly.
		const actionResult = deserialize(await resp.text()) as
			| {
					type: 'success';
					data?: { imported?: number; skipped?: number; total?: number; failed?: number };
			  }
			| { type: 'failure'; data?: { error?: string } }
			| { type: 'redirect'; location: string }
			| { type: 'error'; error: unknown };

		if (actionResult.type === 'success') {
			// #2558 bug-1: デモ環境 no-op (data.demo === true) は成功偽装せず明示。
			if ((actionResult.data as Record<string, unknown> | undefined)?.demo === true) {
				actionMessage = ADMIN_REWARDS_PAGE_LABELS.importDemo;
				showToast(ADMIN_REWARDS_PAGE_LABELS.importDemo, undefined, 'info');
			} else {
				// #2955 (#2830 横展開): server 算出 `failed` > 0 のときは partial-failure を
				// 2 層 feedback (Toast + banner) で正直に出す (admin/activities と同型、共通 helper)。
				const feedback = resolveImportFeedback(
					actionResult.data as Record<string, unknown> | undefined,
					{
						success: ADMIN_REWARDS_PAGE_LABELS.importSuccess,
						allDuplicates: ADMIN_REWARDS_PAGE_LABELS.importAllDuplicates,
					},
				);
				actionMessage = feedback.message;
				showToast(actionMessage, undefined, feedback.tone);
				await invalidateAll();
			}
		} else if (actionResult.type === 'failure') {
			// #2894 AC3: PlanLimitError オブジェクトを `String()` で `[object Object]` 化していた
			// 壊れ表示を getActionErrorDisplay で根治。free tier には upgrade 導線も併記する。
			const display = getActionErrorDisplay(
				actionResult.data?.error,
				ADMIN_REWARDS_PAGE_LABELS.importFailed,
			);
			actionMessage = display.message;
			actionUpgradeUrl = display.upgradeUrl;
			showToast(actionMessage, undefined, 'error');
		} else {
			actionMessage = ADMIN_REWARDS_PAGE_LABELS.importFailed;
			actionUpgradeUrl = null;
			showToast(ADMIN_REWARDS_PAGE_LABELS.importFailed, undefined, 'error');
		}
	} catch {
		actionMessage = ADMIN_REWARDS_PAGE_LABELS.importFailed;
		actionUpgradeUrl = null;
		showToast(ADMIN_REWARDS_PAGE_LABELS.importFailed, undefined, 'error');
	} finally {
		isImporting = false;
	}
	pendingImportPresetId = null;
	showChildSelectionDialog = false;
	// URL から import param を除去 (戻り遷移時に再 open しない)
	if (typeof window !== 'undefined') {
		const url = new URL(window.location.href);
		url.searchParams.delete('import');
		window.history.replaceState({}, '', url.toString());
	}
}

function handleChildSelectionCancel() {
	pendingImportPresetId = null;
	showChildSelectionDialog = false;
	if (typeof window !== 'undefined') {
		const url = new URL(window.location.href);
		url.searchParams.delete('import');
		window.history.replaceState({}, '', url.toString());
	}
}

// #2362 PR-4: 「他の子供から copy」action
//
// #2474 must-2 (Copilot must-2): handleChildSelectionConfirm と同じ理由で
// `x-sveltekit-action: true` + `accept: application/json` header + `deserialize()`
// により copiedCount を実値で取得する (旧 bug: 件数=0 固定誤表示)。
async function handleCopyFromChild() {
	if (!copySourceChildId || !selectedChildId || copySourceChildId === selectedChildId) {
		actionMessage = ADMIN_REWARDS_PAGE_LABELS.copySameChild;
		showToast(ADMIN_REWARDS_PAGE_LABELS.copySameChild, undefined, 'info');
		return;
	}
	const formData = new FormData();
	formData.append('sourceChildId', String(copySourceChildId));
	formData.append('targetChildId', String(selectedChildId));
	// #2894 AC3: 新しい copy 試行ごとに前回のアップグレード導線をクリアする。
	actionUpgradeUrl = null;

	try {
		const resp = await fetch('?/copyFromChild', {
			method: 'POST',
			headers: {
				accept: 'application/json',
				'x-sveltekit-action': 'true',
			},
			body: formData,
		});
		const actionResult = deserialize(await resp.text()) as
			| { type: 'success'; data?: { copiedCount?: number } }
			| { type: 'failure'; data?: { error?: string } }
			| { type: 'redirect'; location: string }
			| { type: 'error'; error: unknown };

		if (actionResult.type === 'success') {
			const cnt = Number(actionResult.data?.copiedCount ?? 0);
			actionMessage = ADMIN_REWARDS_PAGE_LABELS.copySuccess(cnt);
			showToast(ADMIN_REWARDS_PAGE_LABELS.copySuccess(cnt), undefined, 'success');
			showCopyFromChildDialog = false;
			copySourceChildId = null;
			await invalidateAll();
		} else if (actionResult.type === 'failure') {
			// #2894 AC3: PlanLimitError 壊れ表示の根治 (import 経路と同型)。
			const display = getActionErrorDisplay(
				actionResult.data?.error,
				ADMIN_REWARDS_PAGE_LABELS.copyFailed,
			);
			actionMessage = display.message;
			actionUpgradeUrl = display.upgradeUrl;
			showToast(actionMessage, undefined, 'error');
		} else {
			actionMessage = ADMIN_REWARDS_PAGE_LABELS.copyFailed;
			showToast(ADMIN_REWARDS_PAGE_LABELS.copyFailed, undefined, 'error');
		}
	} catch {
		actionMessage = ADMIN_REWARDS_PAGE_LABELS.copyFailed;
		showToast(ADMIN_REWARDS_PAGE_LABELS.copyFailed, undefined, 'error');
	}
}
</script>

<svelte:head>
	<title>{PAGE_TITLES.rewards}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-4" data-tutorial="rewards-section">
	<!-- #2998 (EPIC #2897): 3 画面共通 AdminResourceHeader に統一 (title + 説明 + + 追加 dropdown + ︙)。
	     旧: inline h2 + overflow Menu。AI 提案パネルの本文直置きを撤去し、+ 追加 dropdown → Dialog 起動に
	     統一した (activities / checklists と同型、NN/G #4 consistency)。
	     申請承認の overflow menu (rewards-overflow-menu) と pending バッジは既存 testid を保つため
	     toolbarLeading / overflowSnippet / badge slot に渡す。 -->
	<AdminResourceHeader
		title={REWARDS_LABELS.sectionTitle}
		description={ADMIN_REWARDS_PAGE_LABELS.headerDescription}
		addMenuItems={addMenuItems}
		addButtonLabel={ADMIN_REWARDS_PAGE_LABELS.addMenuButton}
		addMenuAriaLabel={ADMIN_REWARDS_PAGE_LABELS.addMenuAriaLabel}
		addMenuTestid="rewards-add-menu"
		addMenuDataTutorial="rewards-add-start"
	>
		{#snippet badge()}
			{#if !data.isPremium}
				<span class="inline-block px-2 py-0.5 text-[10px] rounded-full bg-[var(--color-premium)] text-[var(--color-text-inverse)] align-middle">{REWARDS_LABELS.premiumBadge}</span>
			{/if}
		{/snippet}
		{#snippet toolbarLeading()}
			{#if data.pendingRequestsCount > 0}
				<span class="inline-flex items-center justify-center min-w-5 h-5 px-1 text-xs font-bold rounded-full bg-[var(--color-action-danger)] text-white" data-testid="pending-badge">
					{data.pendingRequestsCount}
				</span>
			{/if}
		{/snippet}
		{#snippet overflowSnippet()}
			<Menu
				items={overflowMenuItems}
				ariaLabel={REWARDS_LABELS.overflowMenuAriaLabel}
				testid="rewards-overflow-menu"
				triggerLabel="︙"
				triggerClass="admin-resource-header__overflow-btn"
			/>
		{/snippet}
	</AdminResourceHeader>

	<!-- #2998 (EPIC #2897) fix: title + 重複説明文は AdminResourceHeader が担うため撤去し、
	     ごほうび固有の有用なポインタ (応援機能との区別案内 + おうえんメッセージへのクロスリンク) のみ残す。
	     旧: pageDescTitle / pageDescText1 がヘッダー title / description と二重表示されていた。 -->
	<div class="page-description">
		<p class="page-description__text">
			{REWARDS_LABELS.pageDescText2}
		</p>
		<p class="page-description__hint">
			{REWARDS_LABELS.pageDescHintPrefix}
			<a href="/admin/messages" class="page-description__link">{REWARDS_LABELS.pageDescHintLink}</a>
			{REWARDS_LABELS.pageDescHintSuffix}
		</p>
	</div>

	<!-- #2362 PR-4: 子供タブ切替 UI (slot 2、正準スロット契約 #3097) -->
	{#if data.children.length > 0}
		<div
			class="child-tab-row"
			data-testid="admin-rewards-child-tabs"
			data-tutorial="rewards-child-tabs"
			role="tablist"
			aria-label={ADMIN_REWARDS_PAGE_LABELS.childTabsAriaLabel}
		>
			{#each data.children as child (child.id)}
				{@const count = (data.childRewardsByChild[child.id] ?? []).length}
				<Button
					variant={selectedChildId === child.id ? 'primary' : 'ghost'}
					size="sm"
					class="child-tab {selectedChildId === child.id ? '' : 'child-tab--inactive'}"
					data-testid="rewards-child-tab-{child.id}"
					role="tab"
					aria-selected={selectedChildId === child.id}
					onclick={() => selectChild(child.id)}
				>
					{child.nickname}
					<span class="child-tab__count">({count})</span>
				</Button>
			{/each}

			<!-- 兄弟共通化 actions (右寄せ) -->
			<div class="child-tab-actions">
				{#if data.children.length >= 2}
					<Button
						variant="ghost"
						size="sm"
						data-testid="rewards-copy-from-child-btn"
						disabled={!data.isPremium}
						onclick={() => { showCopyFromChildDialog = true; }}
					>
						{ADMIN_REWARDS_PAGE_LABELS.copyFromChildButton}
					</Button>
				{/if}
			</div>
		</div>

		{#if selectedChild}
			<div class="child-context-banner" data-testid="rewards-child-context-banner">
				<span class="child-context-banner__label">
					{selectedChild.nickname}{ADMIN_REWARDS_PAGE_LABELS.childContextRewardsSuffix(perChildRewards.length)}
				</span>
				<span class="child-context-banner__hint">
					{ADMIN_REWARDS_PAGE_LABELS.childContextHint}
				</span>
			</div>
		{/if}
	{/if}

	<!-- #3097 (EPIC #3096): プラン系バナー (slot 4) — 正準スロットに固定配置。
	     旧: child タブの上にあったため activities (slot 4 = limit banner) と配置がズレていた。 -->
	{#if !data.isPremium}
		<!-- #728: 無料プラン向けアップグレード誘導 -->
		<div class="bg-[var(--color-premium-bg)] rounded-xl p-4 space-y-3 border border-[var(--color-border-premium)]" data-testid="admin-rewards-plan-banner">
			<div class="flex items-start gap-3" data-testid="rewards-upgrade-banner">
				<span class="text-2xl">✨</span>
				<div class="flex-1">
					<p class="font-bold text-[var(--color-premium)]">{REWARDS_LABELS.upgradeBannerTitle}</p>
					<p class="text-xs text-[var(--color-premium-light)] mt-1">
						{REWARDS_LABELS.upgradeBannerDesc}
					</p>
				</div>
			</div>
			<a
				href="/admin/subscription"
				class="inline-block px-3 py-1.5 bg-[var(--color-premium)] text-[var(--color-text-inverse)] rounded-lg font-bold text-sm hover:opacity-90 transition-colors"
				data-testid="rewards-upgrade-cta"
			>
				{REWARDS_LABELS.upgradeButton}
			</a>
		</div>
	{/if}

	<!-- #2268: 検索 UI (slot 5、一覧の直上、正準スロット契約 #3097) -->
	<section data-testid="admin-rewards-search">
		<FormField
			label={REWARDS_LABELS.searchLabel}
			type="search"
			bind:value={searchQuery}
			placeholder={REWARDS_LABELS.searchPlaceholder}
		/>
	</section>

	<!-- アクションメッセージ (取込結果 / copy 結果 / invalid preset 警告) — slot 6 (role="status") -->
	{#if actionMessage}
		<div
			class="action-message"
			role="status"
			data-testid="rewards-action-message"
		>
			<span>{actionMessage}</span>
			<!-- #2894 AC3: PlanLimitError 受領時はアップグレード導線を併記 (NN/G #9) -->
			{#if actionUpgradeUrl}
				<a class="action-upgrade-link" href={actionUpgradeUrl} data-testid="rewards-upgrade-link">
					{PLAN_GATE_LABELS.upgradeLinkLabel}
				</a>
			{/if}
		</div>
	{/if}

	<!-- #3097 (EPIC #3096): ごほうび一覧 (slot 7、検索の直下)。
	     #2832: 選択中 child のごほうび一覧 (編集 / 削除)。削除は pending redemption ガード (AC1)、
	     編集は申請時点 snapshot note (AC2 案 b)。旧: child-context バナー直下 (slot 3) に置かれ
	     検索 (slot 5) より上だったため正準順に違反していた。 -->
	{#if selectedChild}
		<section class="reward-list" data-testid="admin-rewards-list">
			<div data-testid="rewards-per-child-list">
				{#if perChildRewards.length === 0}
					<p class="reward-list__empty" data-testid="rewards-per-child-empty">
						{ADMIN_REWARDS_PAGE_LABELS.rewardListEmpty}
					</p>
				{:else}
					{#each perChildRewards as reward (reward.id)}
						<div class="reward-item" data-testid="reward-item-{reward.id}">
							<span class="reward-item__icon">{reward.icon ?? '🎁'}</span>
							<span class="reward-item__title">{reward.title}</span>
							{#if hasPendingRedemption(reward.id)}
								<span class="reward-item__pending" data-testid="reward-pending-badge-{reward.id}">
									{ADMIN_REWARDS_PAGE_LABELS.rewardPendingBadge}
								</span>
							{/if}
							<span class="reward-item__points">{reward.points}P</span>
							<div class="reward-item__actions">
								<Button
									variant="ghost"
									size="sm"
									disabled={!data.isPremium}
									data-testid="reward-edit-btn-{reward.id}"
									onclick={() => openEditDialog(reward)}
								>
									{ADMIN_REWARDS_PAGE_LABELS.rewardEditButton}
								</Button>
								<Button
									variant="ghost"
									size="sm"
									class="reward-item__delete-btn"
									data-testid="reward-delete-btn-{reward.id}"
									onclick={() => openDeleteDialog(reward)}
								>
									{ADMIN_REWARDS_PAGE_LABELS.rewardDeleteButton}
								</Button>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</section>
	{/if}

	<!-- Error Display -->
	{#if errorMessage}
		<div class="bg-[color-mix(in_srgb,var(--color-action-danger)_10%,transparent)] rounded-xl p-3 border border-[color-mix(in_srgb,var(--color-action-danger)_30%,transparent)] text-[var(--color-action-danger)] text-sm">
			{errorMessage}
		</div>
	{/if}

	<!-- #2998 (EPIC #2897): AI 提案パネルの本文直置きを撤去。activities / checklists と同型に
	     「+ 追加」dropdown → AI ダイアログ (下部 showAddDialog + addMode='ai') で開く方式に統一。 -->

	<!-- #2268: 検索結果 0 件メッセージ。CX-DoR #9・#11 横展開 (Round 18): 独自 banner markup を
	     UnifiedEmptyState SSOT に統一 (NN/G #4 consistency)。filter 結果空のため hasFilter mode +
	     filteredText に既存文言を渡し、primary CTA / import link は出さない (検索条件下のため)。
	     testid は E2E 互換のため rewards-search-empty を維持。 -->
	{#if allEmpty}
		<UnifiedEmptyState
			testid="rewards-search-empty"
			hasFilter
			filteredText={REWARDS_LABELS.searchEmptyMessage}
			showPrimary={false}
			canImport={false}
		/>
	{/if}

	<!--
		#2558 段階2 横展開: 旧 Preset Catalog (admin 内 marketplace 風 in-page browse UI、
		二重管理) を撤去し marketplace への画面遷移に統一 (DESIGN.md §10 構造的ルール
		「marketplace 取込はマーケットプレイス画面に一本化、admin 内ブラウズ UI 二重管理禁止」)。
		取込実行は marketplace 詳細 → `?import=<presetId>` → ChildSelectionDialog auto-open
		の正規経路 (marketplace-import-flow.md §3.1) に合流させる。

		secondary link「みんなのテンプレートを見る」(empty state / 運用期到達性、
		DESIGN.md §10「bulk import bridge ルール」整合) を保持。
	-->
	<section data-testid="rewards-marketplace-browse-section">
		<a
			href="/marketplace?type=reward-set"
			class="inline-flex items-center gap-1 text-xs text-[var(--color-action-primary)] hover:underline"
			data-testid="rewards-marketplace-browse-link"
		>
			{CONCEPT_ICONS.template} {TEMPLATE_TERMS.browse}
		</a>
	</section>

	{#if grantSuccess}
		<div class="bg-[color-mix(in_srgb,var(--color-action-success)_10%,transparent)] rounded-xl p-4 border border-[color-mix(in_srgb,var(--color-action-success)_30%,transparent)] text-center">
			<p class="text-[var(--color-action-success)] font-bold">{REWARDS_LABELS.grantSuccess}</p>
		</div>
	{/if}

	<!-- #2998 (EPIC #2897): 「+ 追加」dropdown → Dialog (activities / checklists と同型)。
	     manual = 手動追加フォーム (プリセット選択 + custom フォーム)、ai = AI 提案パネル。
	     旧: ごほうび一覧 (プリセット選択 grid) + AI panel + 追加フォームを本文に常時露出していたが、
	     入口を + 追加 dropdown に統一し視覚ノイズを削減 (NN/G #4 consistency / Hick's Law)。 -->
	<Dialog
		bind:open={showAddDialog}
		title={addMode === 'ai' ? ADMIN_REWARDS_PAGE_LABELS.addDialogTitleAi : ADMIN_REWARDS_PAGE_LABELS.addDialogTitleManual}
		testid="rewards-add-dialog"
	>
		{#if addMode === 'ai'}
			<!-- AI Suggest Reward Panel (#719)。採用したら manual フォームに切替えて内容確認 → 追加。 -->
			<AiSuggestRewardPanel onaccept={acceptAiRewardThenSwitch} isFamily={data.planTier === 'family'} />
		{:else if addMode === 'manual'}
			<div class="space-y-4">
				<!-- プリセットを選択 → フォームに prefill -->
				<section>
					<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-2">{REWARDS_LABELS.selectTemplateTitle}</h3>
					<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
						{#each filteredTemplates as tmpl}
							<Button
								variant="ghost"
								size="sm"
								disabled={!data.isPremium}
								class="bg-[var(--color-surface-card)] rounded-xl p-3 shadow-sm text-center hover:shadow-md flex-col h-auto
									{selectedTemplate?.title === tmpl.title ? 'ring-2 ring-[var(--color-action-primary)]' : ''}"
								onclick={() => selectTemplate(tmpl)}
							>
								<span class="text-2xl block">{tmpl.icon ?? '🎁'}</span>
								<p class="text-xs font-bold text-[var(--color-text-muted)] mt-1">{tmpl.title}</p>
								<p class="text-xs text-[var(--color-point)] font-bold">{tmpl.points}P</p>
							</Button>
						{/each}
					</div>
				</section>

				<!-- Add Form (旧: Grant Form、#2268 リネーム) -->
				<form
					method="POST"
					action="?/add"
					use:enhance={() => {
						return async ({ result, update }) => {
							if (result.type === 'success' && result.data && 'granted' in result.data) {
								grantSuccess = true;
								closeAddDialog();
								setTimeout(() => { grantSuccess = false; }, 3000);
							}
							await update();
						};
					}}
					class="space-y-3"
				>
					<h3 class="text-sm font-bold text-[var(--color-text-muted)]">{REWARDS_LABELS.confirmGrantTitle}</h3>
					<input type="hidden" name="childId" value={selectedChildId} />

					<div class="grid grid-cols-2 gap-3">
						<FormField label={REWARDS_LABELS.titleLabel} type="text" name="title" bind:value={customTitle} disabled={!data.isPremium} required />
						<FormField label={REWARDS_LABELS.pointsLabel} type="number" name="points" bind:value={customPoints} min={1} max={10000} disabled={!data.isPremium} required />
					</div>
					<div class="grid grid-cols-2 gap-3">
						<FormField label={REWARDS_LABELS.iconLabel} type="text" name="icon" bind:value={customIcon} disabled={!data.isPremium} />
						<FormField label={REWARDS_LABELS.categoryLabel}>
							{#snippet children()}
								<NativeSelect
									name="category"
									bind:value={customCategory}
									disabled={!data.isPremium}
									options={Object.entries(categoryLabels).map(([value, label]) => ({ value, label }))}
								/>
							{/snippet}
						</FormField>
					</div>
					<!-- #3147: ショップ陳列系統 (physical/money/privilege)。未選択 ('') なら表示側 deriveShopCategory に fallback -->
					<FormField
						label={ADMIN_REWARDS_PAGE_LABELS.shopCategoryLabel}
						hint={ADMIN_REWARDS_PAGE_LABELS.shopCategoryHint}
					>
						{#snippet children()}
							<NativeSelect
								name="shopCategory"
								bind:value={customShopCategory}
								disabled={!data.isPremium}
								options={shopCategoryOptions}
							/>
						{/snippet}
					</FormField>

					<Button
						type="submit"
						variant="primary"
						size="md"
						disabled={!data.isPremium}
						class="w-full"
						data-testid="rewards-add-submit"
					>
						{REWARDS_LABELS.grantButton(customIcon, customTitle, customPoints)}
					</Button>
				</form>
			</div>
		{/if}
	</Dialog>

	<!-- #2362 PR-4: ChildSelectionDialog (`?import=<presetId>` auto-open) -->
	<ChildSelectionDialog
		bind:open={showChildSelectionDialog}
		children={childOptions}
		allowMultiple={true}
		onConfirm={handleChildSelectionConfirm}
		onCancel={handleChildSelectionCancel}
		confirmLoading={isImporting}
		closeOnConfirm={false}
		testid="reward-import-child-selection-dialog"
	/>

	<!-- #2832 AC2 (案 b): reward 編集 dialog。pending redemption がある reward は
	     「申請時点の内容で処理」note を表示する (snapshot 仕様の明示)。 -->
	<Dialog
		bind:open={showEditDialog}
		title={ADMIN_REWARDS_PAGE_LABELS.editDialogTitle}
		testid="reward-edit-dialog"
	>
		{#if editingReward && hasPendingRedemption(editingReward.id)}
			<div class="edit-pending-note" role="note" data-testid="reward-edit-pending-note">
				{ADMIN_REWARDS_PAGE_LABELS.editPendingNote}
			</div>
		{/if}
		<div class="space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<FormField label={REWARDS_LABELS.titleLabel} type="text" bind:value={editTitle} required />
				<FormField label={REWARDS_LABELS.pointsLabel} type="number" bind:value={editPoints} min={1} max={10000} required />
			</div>
			<FormField label={REWARDS_LABELS.iconLabel} type="text" bind:value={editIcon} />
			<!-- #3154: 編集時もショップ陳列系統 (physical/money/privilege) を変更可能 (06-UI §14.6 整合) -->
			<FormField
				label={ADMIN_REWARDS_PAGE_LABELS.shopCategoryLabel}
				hint={ADMIN_REWARDS_PAGE_LABELS.shopCategoryHint}
			>
				{#snippet children()}
					<NativeSelect
						name="shopCategory"
						bind:value={editShopCategory}
						options={shopCategoryOptions}
						data-testid="reward-edit-shop-category"
					/>
				{/snippet}
			</FormField>
		</div>
		<div class="copy-dialog-footer">
			<Button variant="ghost" onclick={() => { showEditDialog = false; editingReward = null; }}>
				{ADMIN_REWARDS_PAGE_LABELS.editCancelButton}
			</Button>
			<Button
				variant="primary"
				loading={isSavingEdit}
				disabled={!editTitle.trim()}
				data-testid="reward-edit-confirm"
				onclick={handleEditConfirm}
			>
				{isSavingEdit ? ADMIN_REWARDS_PAGE_LABELS.editSavingButton : ADMIN_REWARDS_PAGE_LABELS.editSaveButton}
			</Button>
		</div>
	</Dialog>

	<!-- #2832 AC1: reward 削除確認 dialog。pending redemption がある場合は server 側ガード
	     (hasPendingByReward) が 409 を返し、Toast + banner の 2 層 feedback で拒否理由を表示する。 -->
	<Dialog
		bind:open={showDeleteDialog}
		title={ADMIN_REWARDS_PAGE_LABELS.deleteDialogTitle}
		testid="reward-delete-dialog"
	>
		{#if deletingReward}
			<p class="delete-dialog-message">
				{ADMIN_REWARDS_PAGE_LABELS.deleteConfirmMessage(deletingReward.title)}
			</p>
			<p class="delete-dialog-irreversible">
				{ADMIN_REWARDS_PAGE_LABELS.deleteIrreversibleNote}
			</p>
			{#if hasPendingRedemption(deletingReward.id)}
				<div class="edit-pending-note" role="note" data-testid="reward-delete-pending-warning">
					{ADMIN_REWARDS_PAGE_LABELS.deletePendingBlocked}
				</div>
			{/if}
		{/if}
		<div class="copy-dialog-footer">
			<Button variant="ghost" onclick={() => { showDeleteDialog = false; deletingReward = null; }}>
				{ADMIN_REWARDS_PAGE_LABELS.deleteCancelButton}
			</Button>
			<Button
				variant="danger"
				loading={isDeleting}
				data-testid="reward-delete-confirm"
				onclick={handleDeleteConfirm}
			>
				{isDeleting ? ADMIN_REWARDS_PAGE_LABELS.deleteDeletingButton : ADMIN_REWARDS_PAGE_LABELS.deleteConfirmButton}
			</Button>
		</div>
	</Dialog>

	<!-- #2362 PR-4: 「他の子供から copy」 dialog -->
	<Dialog
		bind:open={showCopyFromChildDialog}
		title={ADMIN_REWARDS_PAGE_LABELS.copyDialogTitle}
		testid="rewards-copy-from-child-dialog"
	>
		<p class="copy-dialog-desc">
			{ADMIN_REWARDS_PAGE_LABELS.copyDialogDescPrefix}{CHILD_HONORIFIC_LABEL}{ADMIN_REWARDS_PAGE_LABELS.copyDialogDescSuffix}<strong>{selectedChild?.nickname ?? ADMIN_REWARDS_PAGE_LABELS.copyDialogSelectedPlaceholder}</strong>{ADMIN_REWARDS_PAGE_LABELS.copyDialogDescCloseParen}
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
						data-testid="rewards-copy-source-{child.id}"
					/>
					<span class="copy-source-option__label">
						{child.nickname}
						<span class="copy-source-option__age">({child.age} {ADMIN_REWARDS_PAGE_LABELS.copyDialogAgeSuffix})</span>
						<span class="copy-source-option__count">
							{(data.childRewardsByChild[child.id] ?? []).length} {ADMIN_REWARDS_PAGE_LABELS.copyDialogCountSuffix}
						</span>
					</span>
				</label>
			{:else}
				<p class="copy-source-empty">{ADMIN_REWARDS_PAGE_LABELS.copyDialogEmpty}</p>
			{/each}
		</div>
		<div class="copy-dialog-footer">
			<Button variant="ghost" onclick={() => { showCopyFromChildDialog = false; copySourceChildId = null; }}>
				{ADMIN_REWARDS_PAGE_LABELS.copyDialogCancel}
			</Button>
			<Button
				variant="primary"
				disabled={!copySourceChildId}
				data-testid="rewards-copy-from-child-confirm"
				onclick={handleCopyFromChild}
			>
				{ADMIN_REWARDS_PAGE_LABELS.copyDialogConfirm}
			</Button>
		</div>
	</Dialog>

	<!-- #3079: バックアップから復元 dialog (preview → 実行の 2 段)。
	     ファイル選択 → 内容を確認 (件数/重複 preview) → 復元する の 2 step。
	     マーケットプレイス取込とは別概念 (JSON v2 envelope を読み込んで復元)。 -->
	<Dialog
		bind:open={showRestoreDialog}
		title={BACKUP_RESTORE_LABELS.restoreDialogTitle}
		closable={true}
		testid="restore-rewards-dialog"
	>
		<p class="restore-dialog-desc">{BACKUP_RESTORE_LABELS.restoreDialogDesc(REWARD_TERMS.canonical)}</p>
		{#if restorePreview === null}
			<input
				type="file"
				accept="application/json,.json"
				class="restore-file-input"
				disabled={restoreLoading}
				onchange={onRestoreFileChange}
				data-testid="restore-rewards-file-input"
			/>
			<div class="restore-footer">
				<Button variant="ghost" onclick={() => { showRestoreDialog = false; }}>
					{BACKUP_RESTORE_LABELS.cancelButton}
				</Button>
				<Button
					variant="primary"
					loading={restoreLoading}
					disabled={!restoreFile}
					data-testid="restore-rewards-check"
					onclick={handleRestorePreview}
				>
					{restoreLoading ? BACKUP_RESTORE_LABELS.checking : BACKUP_RESTORE_LABELS.checkButton}
				</Button>
			</div>
		{:else}
			<div class="restore-preview" data-testid="restore-rewards-preview">
				<p class="restore-preview__heading">{BACKUP_RESTORE_LABELS.previewHeading}</p>
				{#if restorePreview.newItems === 0 && restorePreview.duplicates > 0}
					<p class="restore-preview__all-dup">{BACKUP_RESTORE_LABELS.previewAllDuplicates(REWARD_TERMS.canonical)}</p>
				{:else}
					<p class="restore-preview__summary">
						{BACKUP_RESTORE_LABELS.previewSummary(restorePreview.total, restorePreview.newItems, restorePreview.duplicates)}
					</p>
				{/if}
			</div>
			<div class="restore-footer">
				<Button variant="ghost" disabled={restoreLoading} onclick={() => { restorePreview = null; }}>
					{BACKUP_RESTORE_LABELS.backButton}
				</Button>
				<Button
					variant="primary"
					loading={restoreLoading}
					disabled={restorePreview.newItems === 0}
					data-testid="restore-rewards-confirm"
					onclick={handleRestoreConfirm}
				>
					{restoreLoading ? BACKUP_RESTORE_LABELS.restoreProcessing : BACKUP_RESTORE_LABELS.restoreSubmitBtn}
				</Button>
			</div>
		{/if}
	</Dialog>
</div>

<style>
	.page-description {
		background: var(--color-surface-card);
		border-radius: 0.75rem;
		padding: 1rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
	}
	.page-description__text {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		line-height: 1.5;
	}
	.page-description__hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border, rgba(0, 0, 0, 0.06));
	}
	.page-description__link {
		color: var(--color-action-primary);
		font-weight: 600;
		text-decoration: none;
	}
	.page-description__link:hover {
		text-decoration: underline;
	}

	/* #3097 (EPIC #3096): child-tab-row / child-context-banner styles moved to
	   app.css "Admin resource layout" shared classes (DRY across 3 admin pages).
	   CSS comments use ASCII to satisfy local/no-hardcoded-jp-text in style blocks. */

	.action-message {
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-md);
		background: var(--color-feedback-info-bg);
		border: 1px solid var(--color-feedback-info-border);
		color: var(--color-feedback-info-text);
		font-size: 0.85rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.action-upgrade-link {
		font-weight: 600;
		color: var(--color-text-link);
		text-decoration: underline;
	}

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

	/* #3079: restore-from-backup dialog (comments use ASCII for local/no-hardcoded-jp-text in style) */
	.restore-dialog-desc {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		margin-bottom: 1rem;
		line-height: 1.6;
	}
	.restore-file-input {
		display: block;
		width: 100%;
		margin-bottom: 1rem;
	}
	.restore-preview {
		background: var(--color-surface-muted);
		border-radius: 0.5rem;
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
	}
	.restore-preview__heading {
		font-weight: 600;
		margin-bottom: 0.25rem;
	}
	.restore-preview__summary {
		color: var(--color-text);
	}
	.restore-preview__all-dup {
		color: var(--color-text-muted);
	}
	.restore-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border-light);
	}

	/* #2832: per-child reward list + edit / delete */
	.reward-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.reward-list__empty {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		padding: 0.75rem;
		text-align: center;
	}
	.reward-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-surface-card);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-md);
	}
	.reward-item__icon {
		font-size: 1.25rem;
	}
	.reward-item__title {
		flex: 1;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-text-primary);
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.reward-item__pending {
		font-size: 0.7rem;
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		background: var(--color-feedback-warning-bg);
		border: 1px solid var(--color-feedback-warning-border);
		color: var(--color-feedback-warning-text);
		white-space: nowrap;
	}
	.reward-item__points {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--color-point, var(--color-text-secondary));
		white-space: nowrap;
	}
	.reward-item__actions {
		display: flex;
		gap: 0.25rem;
	}
	:global(.reward-item__delete-btn) {
		color: var(--color-action-danger) !important;
	}
	.edit-pending-note {
		font-size: 0.8rem;
		padding: 0.5rem 0.75rem;
		margin-bottom: 0.75rem;
		border-radius: var(--radius-sm);
		background: var(--color-feedback-info-bg);
		border: 1px solid var(--color-feedback-info-border);
		color: var(--color-feedback-info-text);
	}
	.delete-dialog-message {
		font-size: 0.9rem;
		color: var(--color-text-primary);
		margin-bottom: 0.5rem;
	}
	.delete-dialog-irreversible {
		font-size: 0.8rem;
		color: var(--color-action-danger);
		margin-bottom: 0.75rem;
	}
</style>
