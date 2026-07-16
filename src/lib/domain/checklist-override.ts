// src/lib/domain/checklist-override.ts
//
// #3473: チェックリスト日次 override (特定日の item 追加 / スキップ) のドメイン値域 SSOT。
//
// 背景: backup restore (`importChecklistOverridesData`) は untrusted なバックアップファイル由来の
// `action` / `itemName` / `icon` を validation 無しで DB に書き戻していた (#3473 item 3)。
// `action` が enum 外 ('add' / 'remove' 以外) だと子供画面のレンダリングフィルタ
// (`overrides.filter((o) => o.action === 'remove' | 'add')`) に一切ヒットせず、
// 「DB には存在するが永遠に表示されない」silent なデータ破損を生む。
//
// ADR-0066 (export/import 値域 SSOT): wire restore とドメイン validator は同一値域定数を
// import する。本 module がその値域 SSOT (atom) を提供する。

/**
 * 日次 override の action。
 * - `add`    : その日だけ item を追加する
 * - `remove` : family template の item をその日だけスキップする
 *
 * 子供画面レンダリング (`checklist-service.ts`) が `action === 'add' | 'remove'` で分岐するため、
 * これ以外の値は表示に反映されない (= 実質破損)。restore 境界で本 enum に強制する。
 */
export const CHECKLIST_OVERRIDE_ACTIONS = ['add', 'remove'] as const;

export type ChecklistOverrideAction = (typeof CHECKLIST_OVERRIDE_ACTIONS)[number];

/** override item 名の最大文字数 (DB 肥大 / 表示崩れ防止の上限)。 */
export const CHECKLIST_OVERRIDE_ITEM_NAME_MAX = 100;

/** override icon の最大文字数 (multi-codepoint emoji を許容しつつ乱用を防ぐ緩い上限)。 */
export const CHECKLIST_OVERRIDE_ICON_MAX = 16;

/** targetDate は `YYYY-MM-DD` (JST date) 形状。restore 境界で形状を検証する。 */
export const CHECKLIST_OVERRIDE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** restore 入力 (untrusted backup 由来) の sanitize 結果。 */
export type ChecklistOverrideRestoreResult =
	| {
			ok: true;
			value: {
				targetDate: string;
				action: ChecklistOverrideAction;
				itemName: string;
				icon: string;
				createdAt: string;
			};
	  }
	| { ok: false; reason: string };

function isChecklistOverrideAction(v: unknown): v is ChecklistOverrideAction {
	return typeof v === 'string' && (CHECKLIST_OVERRIDE_ACTIONS as readonly string[]).includes(v);
}

/**
 * backup restore の override 入力を検証・sanitize する (#3473 item 3)。
 *
 * trust 境界: owner が自分の backup を復元する経路だが、ファイルは手編集 / 破損し得るため
 * untrusted として扱う。不正値は **verbatim で書き戻さず** reason 付きで拒否し、
 * import 側が skipped + errors に可視化する (silent 破損を作らない)。
 *
 * - `action`: `CHECKLIST_OVERRIDE_ACTIONS` 外は拒否 (enum 外は表示に反映されない = 破損)
 * - `itemName`: 空は拒否、`CHECKLIST_OVERRIDE_ITEM_NAME_MAX` 超は切り詰め
 * - `icon`: 空は既定 '📦'、`CHECKLIST_OVERRIDE_ICON_MAX` 超は切り詰め
 * - `targetDate`: `YYYY-MM-DD` 形状外は拒否
 * - `createdAt`: 非空文字列でなければ拒否 (round-trip 保全対象、ISO 期待だが厳密検証は過剰防御回避)
 */
export function sanitizeChecklistOverrideRestore(input: {
	targetDate: unknown;
	action: unknown;
	itemName: unknown;
	icon: unknown;
	createdAt: unknown;
}): ChecklistOverrideRestoreResult {
	if (typeof input.targetDate !== 'string' || !CHECKLIST_OVERRIDE_DATE_RE.test(input.targetDate)) {
		return { ok: false, reason: `targetDate 不正 (${String(input.targetDate)})` };
	}
	if (!isChecklistOverrideAction(input.action)) {
		return { ok: false, reason: `action 不正 (${String(input.action)})` };
	}
	if (typeof input.itemName !== 'string' || input.itemName.trim() === '') {
		return { ok: false, reason: 'itemName 空' };
	}
	if (typeof input.createdAt !== 'string' || input.createdAt.trim() === '') {
		return { ok: false, reason: 'createdAt 空' };
	}
	const itemName = input.itemName.slice(0, CHECKLIST_OVERRIDE_ITEM_NAME_MAX);
	const iconRaw = typeof input.icon === 'string' && input.icon.trim() !== '' ? input.icon : '📦';
	const icon = iconRaw.slice(0, CHECKLIST_OVERRIDE_ICON_MAX);
	return {
		ok: true,
		value: {
			targetDate: input.targetDate,
			action: input.action,
			itemName,
			icon,
			createdAt: input.createdAt,
		},
	};
}
