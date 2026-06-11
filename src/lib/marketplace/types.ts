/**
 * Marketplace import/export Strategy 型定義 — ADR-0052 (Issue #2363)
 *
 * 5 種類の MarketplaceItemType (activity-pack / reward-set / checklist /
 * rule-preset / challenge-set) を統一抽象化する Strategy interface 群。
 *
 * 設計原則 (ADR-0052):
 *   - 1 type = 1 Strategy 実装 + 1 Descriptor 登録 (#2365-2369 で具体実装)
 *   - tenant isolation 強制: `ImportContext.tenantId` は全 Strategy で必須引数
 *   - dry-run preview と apply の二段階分離 (UI 側で取込件数を事前提示できる)
 *   - 戻り値は discriminated union 風の `imported / skipped / errors` 構造で
 *     5 type 横断で UI が一貫したフィードバックを出せる
 *
 * 関連:
 *   - ADR-0046 (Service Interface + Context DI)
 *   - ADR-0023 archive (tenant isolation 強制)
 *   - ADR-0010 (Pre-PMF Bucket A: 浪費防止)
 *   - ADR-0014 / #1350 (OSS 先調査)
 */

import type { MarketplaceItemType } from '$lib/domain/marketplace-item';

// ── 5 type 拡張: challenge-set を含む ────────────────────────────
// domain/marketplace-item.ts の `MarketplaceItemType` は 4 値だが、
// Registry は将来 challenge-set 実装 (#2369) を見据え 5 値を扱う。
// 現在の `MarketplaceItemType` と challenge-set 拡張のあいだを橋渡しする。

export type MarketplaceTypeCode = MarketplaceItemType | 'challenge-set';

export const MARKETPLACE_TYPE_CODES = [
	'activity-pack',
	'reward-set',
	'checklist',
	'rule-preset',
	'challenge-set',
] as const satisfies readonly MarketplaceTypeCode[];

/**
 * marketplace の「ブラウズ / 陳列 surface」に出す type の SSOT (Issue #2896)。
 *
 * 2026-06-11 PO 判断: marketplace は活動 / ごほうび / チェックリストの 3 type に絞る。
 * `rule-preset` (とくべつルール) と `challenge-set` (チャレンジ集) は陳列対象から外し、
 * 機能本体は各 admin 画面 (`/admin/settings/rules` / `/admin/challenges`) に保持する。
 *
 * 重要 (互換維持):
 *   - `MARKETPLACE_TYPE_CODES` (全 5 type) は Registry 登録 / schema / round-trip / 直リンク
 *     (`/marketplace/<type>/<itemId>`) / admin の `?import=` 受領経路の互換のため不変。
 *   - 本定数は **一覧 loader / 一覧 UI の陳列・type filter・件数集計**でのみ使う filter SSOT。
 *     これにより「型は残すが陳列だけ絞る」をハードコード散在なしで実現する。
 */
export const MARKETPLACE_BROWSE_TYPE_CODES = [
	'activity-pack',
	'reward-set',
	'checklist',
] as const satisfies readonly MarketplaceTypeCode[];

export type MarketplaceBrowseTypeCode = (typeof MARKETPLACE_BROWSE_TYPE_CODES)[number];

/** 指定 type が marketplace の陳列対象かどうかを判定する (filter SSOT)。 */
export function isBrowseableMarketplaceType(typeCode: string): boolean {
	return (MARKETPLACE_BROWSE_TYPE_CODES as readonly string[]).includes(typeCode);
}

// ── 共通 Context ──────────────────────────────────────────────────

/**
 * import 操作の共通入力。tenant isolation を型レベルで強制する。
 *
 * @property tenantId        取込先テナント ID (必須、ADR-0023 archive 整合)
 * @property dryRun          true の場合は DB 書込を行わず preview と等価
 * @property presetId        marketplace preset 由来の場合のソース識別子
 * @property childId         reward-set 等の単一 child 紐付き type で使用 (legacy)
 * @property childIds        #2362 PR-3 (ADR-0055): per-child instance type
 *                           (activity-pack / challenge-set 等) で複数 child 配信。
 *                           `requiresChildSelection: true` の Descriptor では必須。
 * @property applyMustDefault activity-pack の must 推奨採用フラグ (#1758)
 */
export interface ImportContext {
	tenantId: string;
	dryRun?: boolean;
	presetId?: string;
	childId?: number;
	childIds?: readonly number[];
	applyMustDefault?: boolean;
}

// ── 共通 Preview / Result ────────────────────────────────────────

/**
 * dry-run preview 結果。UI で「N 件追加 / M 件重複スキップ」を提示するために使う。
 *
 * @property total           payload 内の項目総数
 * @property newItems        新規追加見込み件数
 * @property duplicates      重複スキップ見込み件数
 * @property duplicateNames  重複対象の表示名 (UI 提示用)
 * @property byCategory      type 固有の分類別件数 (任意、activity-pack のカテゴリ等)
 */
export interface ImportPreview {
	total: number;
	newItems: number;
	duplicates: number;
	duplicateNames: string[];
	byCategory?: Record<string, number>;
}

/**
 * apply 実行結果。
 *
 * @property imported 実際に persist できた item / row 数
 * @property skipped  重複等で意図的に取込まなかった item 数
 * @property errors   人間可読のエラーメッセージ列 (UI ログ / 詳細表示用)
 * @property failed   #2830: **実際に persist 失敗した item / row 数** (errors.length と分離)。
 *
 *   `errors` は per-child catch 行 / 集計行「N 件保存できませんでした」/ per-item validation
 *   error が混在しうるため、`errors.length` は「失敗した item 数」と一致しない (bulk throw
 *   1 回で 30 row 喪失でも errors.length≈2)。さらに rule-preset は warnings (already-imported
 *   等の非失敗通知) を `errors` に畳み込んで表示するため、`errors.length` を失敗数として
 *   読むと無害な warning が失敗に誤算入される。UI の partial-failure 件数表示は必ず本
 *   フィールドを使うこと (#2955 で optional fallback を撤去し required 化、5 strategy 全配線済)。
 */
export interface ImportResult {
	imported: number;
	skipped: number;
	errors: string[];
	failed: number;
}

// ── ImportStrategy interface ─────────────────────────────────────

/**
 * 1 つの MarketplaceTypeCode に対応する import/export 振る舞いの SSOT。
 *
 * @typeParam TPayload  parse 後の payload 型 (例: ActivityPackPayload)
 *
 * 実装契約:
 *   1. `parse(input)` は外部 JSON を受け取り validation 済み payload を返す
 *      (Valibot schema 連携は #2364 で導入)
 *   2. `preview(payload, ctx)` は DB write を行わず取込見込みを返す
 *   3. `apply(payload, ctx)` は実際に DB write を行い結果を返す
 *      (`ctx.dryRun === true` の場合は preview と等価動作)
 *   4. すべてのメソッドで `ctx.tenantId` を必ず使う (tenant isolation 強制)
 */
export interface ImportStrategy<TPayload> {
	/** parse + validation。失敗時は明確な error メッセージで throw */
	parse(input: unknown): TPayload;
	/** dry-run プレビュー (DB write 禁止) */
	preview(payload: TPayload, ctx: ImportContext): Promise<ImportPreview>;
	/** 実際の import 実行 */
	apply(payload: TPayload, ctx: ImportContext): Promise<ImportResult>;
}

// ── MarketplaceTypeDescriptor ────────────────────────────────────

/**
 * 1 type を Registry に登録するための記述子。
 *
 * @typeParam TCode     型コード (リテラル型で TypeScript discriminated union を実現)
 * @typeParam TPayload  payload 型
 */
export interface MarketplaceTypeDescriptor<
	TCode extends MarketplaceTypeCode = MarketplaceTypeCode,
	TPayload = unknown,
> {
	/** 型コード (Registry のキー) */
	readonly typeCode: TCode;
	/** 親管理画面で表示する短ラベル (例: "活動セット") */
	readonly displayLabel: string;
	/** ヘルプ用 1 行説明 */
	readonly description: string;
	/** import/export 振る舞い */
	readonly strategy: ImportStrategy<TPayload>;
	/**
	 * 子供紐付け必須かどうか (legacy 単一 child binding)。
	 * true の type (reward-set 等) は import 時に `ctx.childId` が必須。
	 *
	 * #2362 PR-3 以降、per-child instance type は `requiresChildSelection: true`
	 * (複数 child 選択) を優先採用する。`requiresChildId` は単一 child binding
	 * の legacy type 向けに残置。
	 */
	readonly requiresChildId: boolean;
	/**
	 * #2362 PR-3 (ADR-0055): per-child instance への配信時に
	 * ChildSelectionDialog (誰に追加 / 全員) を要求するかどうか。
	 *
	 * true の type (activity-pack / challenge-set 等) は import 時に
	 * `ctx.childIds: readonly number[]` が必須となり、配列の各 child に
	 * per-child instance を作成する。Marketplace 側に child 情報を露出させない
	 * (CWE-598 privacy 排除) ため、AdminApp 側で選択結果を `ctx` 経由で注入する。
	 *
	 * false (default) の type (rule-preset / checklist 等 family master type) は
	 * 従来通り 1 record 取込のみで完結する。
	 */
	readonly requiresChildSelection?: boolean;
	/**
	 * Valibot schema (#2364 で導入予定、現段階は型ホール `unknown`)。
	 * 当面 `parse()` 内で個別 validation するが、#2364 完了後は
	 * Registry 側で schema-driven validation に統一する。
	 */
	readonly schema?: unknown;
}

// ── 型ヘルパ (実装時の補助) ──────────────────────────────────────

/** 任意の Descriptor を扱うための union (Registry 内部用) */
export type AnyMarketplaceTypeDescriptor = MarketplaceTypeDescriptor<MarketplaceTypeCode, unknown>;
