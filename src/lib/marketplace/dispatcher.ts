/**
 * Marketplace import dispatcher — ADR-0052 (Issue #2365)
 *
 * `+page.server.ts` から呼ぶ統一 import entry point。
 * typeCode + raw payload + context を受け取り、Registry → Strategy 経由で
 * preview / apply を一括実行する。
 *
 * 設計原則 (ADR-0052 §3.3):
 *   - UI / actions は Strategy / Registry を直接参照せず本 dispatcher 経由で呼ぶ
 *   - 戻り値の shape は旧 service 経由 + 旧 actions が返してきた形に互換
 *     (`importResult: true / packName / imported / skipped / total / errors`)
 *   - 互換 shape を本ファイルで一元管理することで、UI 側 ( `UnifiedImportHub.svelte`、
 *     旧 `ActivityImportPanel.svelte` は #2391 で物理削除済) の挙動を不変に保つ
 *
 * 関連:
 *   - ADR-0052
 *   - src/lib/marketplace/registry (Registry SSOT)
 */

import { marketplaceRegistry } from './registry.js';
import type { ImportContext, MarketplaceTypeCode } from './types.js';

/**
 * dispatchImport の戻り値 (旧 actions が返していた shape と互換)
 *
 * UI 側はこの shape をそのまま返却する想定。新 field 追加は許容するが、
 * 既存 field の rename / type 変更は UI break を起こすため禁止 (Strangler Fig 期間中)。
 */
export interface DispatchImportResult {
	importResult: true;
	packName: string;
	imported: number;
	skipped: number;
	total: number;
	errors: string[];
}

/**
 * dispatcher 入力。`typeCode` で Strategy を解決し `rawPayload` を渡す。
 *
 * @property typeCode      対象 MarketplaceTypeCode (e.g. 'activity-pack')
 * @property rawPayload    Source adapter が返した unknown payload
 * @property displayName   結果メッセージで使う表示名 (pack name / file name)
 * @property ctx           ImportContext (tenantId 必須)
 */
export interface DispatchImportInput {
	typeCode: MarketplaceTypeCode;
	rawPayload: unknown;
	displayName: string;
	ctx: ImportContext;
}

/**
 * Registry 経由で type を解決し、parse → preview → apply を一気通貫実行する。
 *
 * @throws Error parse / preview / apply のいずれかで失敗した場合
 */
export async function dispatchImport(input: DispatchImportInput): Promise<DispatchImportResult> {
	const { typeCode, rawPayload, displayName, ctx } = input;
	const descriptor = marketplaceRegistry.get(typeCode);
	const strategy = descriptor.strategy;

	// parse: Valibot schema 経由で raw payload を validation
	// biome-ignore lint/suspicious/noExplicitAny: Registry 経由の Strategy は parametric type を持つため any 経由で呼ぶ
	const payload = (strategy as any).parse(rawPayload);

	// preview: DB write 無し、件数集計のみ
	// biome-ignore lint/suspicious/noExplicitAny: 同上
	const preview = await (strategy as any).preview(payload, ctx);

	// apply: 実 DB write
	// biome-ignore lint/suspicious/noExplicitAny: 同上
	const result = await (strategy as any).apply(payload, ctx);

	return {
		importResult: true,
		packName: displayName,
		imported: result.imported,
		skipped: result.skipped,
		total: preview.total,
		errors: result.errors,
	};
}
