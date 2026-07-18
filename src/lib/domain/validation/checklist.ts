import * as v from 'valibot';
// #3151 slice3 (ADR-0066): icon の値域は「grapheme 数」で判定する。grapheme 計数は activity /
// reward と同一実装 (countIconGraphemes) を共有し、値でなく述語を SSOT 化する (ADR-0066 原則 2)。
import { countIconGraphemes } from './activity';

// ============================================================
// チェックリスト item 値域 SSOT (#3151 slice3 / ADR-0066)
// ============================================================
// domain Valibot schema (本ファイル checklistItemSchema) と wire Valibot schema
// (src/lib/marketplace/schemas/checklist-schema.ts の ChecklistItemSchema) の両方が本定数を参照する。
// 値域 literal の二重定義は #3132 class (値域ドリフト blocker) の root class のため禁止。
// domain⊆wire 包含は tests/unit/architecture/schema-range-ssot.test.ts が boundary probe で機械表明する。
//
// slice1/2 (activity / reward) と異なり checklist は SSOT 化前に domain 側の値域 validator が
// 存在せず、admin 認可経路 (`addTemplateItem` action) は label 長 / icon 長を無制限に受理していた。
// 一方 wire は label maxLength(100) / icon maxLength(20) / order minValue(0) を課しており、
// export は buildExportEnvelopeV2 内で wire schema を再検証するため、admin で 100 文字超の item を
// 作成すると export が throw する = domain⊄wire の非対称 (往復不能データを authoring できてしまう)。
// 本 slice で domain validator (checklistItemSchema) を新設し、admin authoring 経路と wire schema の
// 両方を本定数へ揃えることで、authoring 可能な値域 ⊆ export/import 往復可能な値域 を成立させる。

export const CHECKLIST_LABEL_MIN = 1;
export const CHECKLIST_LABEL_MAX = 100;
export const CHECKLIST_ORDER_MIN = 0;
export const CHECKLIST_ICON_MIN_GRAPHEMES = 1;
export const CHECKLIST_ICON_MAX_GRAPHEMES = 2;

/**
 * チェックリスト item icon 値域 (1〜2 grapheme) 判定。domain / wire 両 Valibot check の
 * 共有 oracle (#3151 slice3)。旧 wire 側 `maxLength(20)` (UTF-16 units 基準) は ZWJ 連結絵文字
 * 2 個 (👨‍👩‍👧‍👦👨‍👩‍👧‍👦 = 22 units) を弾き (往復不能)、逆に絵文字 3 個以上 (🎁🎈🎀 = 6 units) を
 * 受理していた (単一〜少数の絵文字という意図に反する)。grapheme 判定への統一で「1〜2 個の絵文字」
 * という意図を表現方式ごと SSOT 化し、domain / wire を同一境界に揃える (activity / reward と同型)。
 */
export function isValidChecklistIcon(val: string): boolean {
	const count = countIconGraphemes(val);
	return count >= CHECKLIST_ICON_MIN_GRAPHEMES && count <= CHECKLIST_ICON_MAX_GRAPHEMES;
}

// ============================================================
// field 単位の Valibot schema (domain / wire 共有 SSOT、#3852 Phase B-2 / EPIC #3151 選択肢 B)
// ============================================================
// 旧: 同じ label/icon/order の shape を domain Zod と wire Valibot (checklist-schema.ts) で 2 回宣言
// (slice3 では値域「定数」だけを共有し、field「schema 構造」は依然 2 重定義だった)。新: field pipe を
// 本節に 1 回だけ定義し、domain object (下記 checklistItemSchema) と wire object の双方が import して
// 組み立てる。構造の二重定義を排し、境界値の再ドリフト (#3132 class) を構造的に不可能にする。
// activity (Phase B-1 / #3860) / reward (Phase B-0 / #3853) と同型。

/** チェックリスト項目名 (1〜100 文字) */
export const checklistLabelSchema = v.pipe(
	v.string('label は文字列で指定してください'),
	v.minLength(CHECKLIST_LABEL_MIN, 'label は必須です'),
	v.maxLength(CHECKLIST_LABEL_MAX, `label は ${CHECKLIST_LABEL_MAX} 文字以内で指定してください`),
);

/** チェックリスト項目 icon (1〜2 grapheme の絵文字)。isValidChecklistIcon を共有 oracle に判定 (#3151) */
export const checklistIconSchema = v.pipe(
	v.string(),
	v.minLength(1, 'icon は必須です'),
	v.check(isValidChecklistIcon, 'icon は 1〜2 個の絵文字で指定してください'),
);

/** チェックリスト項目の並び順 (0 以上の整数)。追加時に自動採番される */
export const checklistOrderSchema = v.pipe(
	v.number('order は数値で指定してください'),
	v.integer('order は整数で指定してください'),
	v.minValue(CHECKLIST_ORDER_MIN, `order は ${CHECKLIST_ORDER_MIN} 以上で指定してください`),
);

/**
 * チェックリスト item の domain validator (SSOT)。
 *
 * wire round-trip の 1 item (`{ label, icon, order }`) と同一 shape。値域定数 / icon 述語は
 * 上記 SSOT を参照し、wire schema (ChecklistItemSchema) と同一境界で受理/拒否する。
 *
 * 実利用箇所 (dead code ではない):
 *   - admin authoring 経路: `/admin/checklists` の addItem action が
 *     `v.pick(checklistItemSchema, ['label', 'icon'])` で label / icon を検証する
 *     (order は追加時に自動採番されるため authoring 対象外)。
 *   - fitness probe: tests/unit/architecture/schema-range-ssot.test.ts が本 schema を
 *     domain oracle として wire schema と cross-assert する。
 */
export const checklistItemSchema = v.object({
	label: checklistLabelSchema,
	icon: checklistIconSchema,
	order: checklistOrderSchema,
});
