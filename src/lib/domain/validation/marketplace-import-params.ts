// src/lib/domain/validation/marketplace-import-params.ts
// Round 18 Cluster H (#2767 Fix Round 1 B3): marketplace activity-pack subset 取込の
// URL query (`?indexes=<csv>`) を Zod で input validation する。
//
// 設計背景:
// - `/admin/activities?import=<itemId>&indexes=0,2,5,...` の indexes は公開 marketplace SSOT の
//   activity index (payload.activities[i] の i)。CWE-598 整合で childId は乗らないが、
//   負数 / NaN / 非整数 / 重複 / 空文字 などの edge case を「黙って全件 fallback」に流すと
//   攻撃面ではなく UX 面で「ユーザ指定と異なる subset が取込まれる」事故になる。
// - 元実装は Number/filter/Set で部分的に防御していたが、Zod ベースで input contract を
//   明示化し、unit test で 4 edge case (NaN / 負数 / 空文字 / 重複) を回帰固定する。
//
// 設計原則:
// - **null = 全件取込 (後方互換)** を維持。indexes 省略時は全件 (importPackToChildren で
//   selectedIndexes=null パスを走らせる)。
// - **空配列 = 全件 fallback**。「不正値だけのカンマ列 (例: `?indexes=abc,,xyz`)」は安全側に
//   倒して全件取込 fallback。空 indexes での 0 件取込にはしない (admin 側の dispatchImport が
//   空 payload で 400 を返すのは別 layer の責務)。
// - **upper bound は呼び出し側で適用**。本 helper は payload.activities.length を知らないため
//   負/非整数のみ落とし、上限チェックは admin 側で `.filter((i) => i < length)` を継続。
//
// 関連: Issue #2767 / ADR-0055 (per-child + family master データモデル原則)。

import { z } from 'zod';

/**
 * 単一 index value 用 schema。
 *
 * 受理: 非負整数 (0, 1, 2, ..., MAX_SAFE_INTEGER)
 * 拒否: NaN / Infinity / 負数 / 小数 / 文字列 (Number(s) で NaN 化する全ケース)
 */
const indexSchema = z
	.number()
	.int({ message: 'index must be integer' })
	.nonnegative({ message: 'index must be >= 0' })
	.finite({ message: 'index must be finite' });

/**
 * `?indexes=<csv>` query 文字列をパースして、重複除去済の非負整数配列を返す。
 *
 * @param raw URL searchParams で取得した raw 文字列 (trim 済推奨)。`null` / `undefined` / 空文字
 *   は「indexes 省略」扱いで `null` を返す (= admin 側で全件取込 fallback)。
 * @returns 重複除去済 + 並び順保持の非負整数配列。**全要素が不正値 (例: 'abc,xyz') の場合も
 *   null を返して全件 fallback に倒す** (UX 安全側)。
 */
export function parseImportIndexes(raw: string | null | undefined): number[] | null {
	if (raw === null || raw === undefined) return null;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return null;

	const tokens = trimmed.split(',').map((s) => s.trim());
	const parsedNumbers: number[] = [];
	for (const token of tokens) {
		if (token.length === 0) continue;
		const n = Number(token);
		const result = indexSchema.safeParse(n);
		if (result.success) {
			parsedNumbers.push(result.data);
		}
		// invalid token (NaN / 負数 / 小数等) は silent drop — 全要素 drop で空配列 → null へ
	}

	if (parsedNumbers.length === 0) return null;

	// 重複除去 + 並び順保持
	return Array.from(new Set(parsedNumbers));
}
