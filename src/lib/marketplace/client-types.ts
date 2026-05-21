/**
 * Browser-safe marketplace type metadata — Issue #2370 / EPIC #2362 P4
 *
 * `$lib/marketplace` (registry + strategies + services) は server コード
 * (`$lib/server/services/*`) を transitively 取り込むため、Svelte component から
 * 直接 import すると `vite-plugin-sveltekit-guard` がブラウザに server コード
 * リークを検出して build を fail させる。
 *
 * 本 module は **strategy / service / Valibot schema を一切 import せず**、
 * Registry の概念的なメタデータ (typeCode / displayLabel / description /
 * requiresChildId) のみを browser-safe な定数として SSOT 配布する。
 *
 * Server 側 (`$lib/marketplace/types/*.ts`) と本 module の整合性は unit test
 * (`tests/unit/marketplace/ui/UnifiedImportHub.test.ts` の Registry 整合確認)
 * で検証する。
 *
 * 関連:
 *   - ADR-0052 (MarketplaceTypeRegistry)
 *   - ADR-0046 (Service Interface + Context DI)
 */

export const MARKETPLACE_TYPE_CODES_CLIENT = [
	'activity-pack',
	'reward-set',
	'checklist',
	'rule-preset',
	'challenge-set',
] as const;

export type MarketplaceTypeCodeClient = (typeof MARKETPLACE_TYPE_CODES_CLIENT)[number];

export interface MarketplaceTypeMeta {
	readonly typeCode: MarketplaceTypeCodeClient;
	readonly displayLabel: string;
	readonly description: string;
	readonly requiresChildId: boolean;
}

/**
 * 5 type 全件のメタデータ SSOT (browser-safe)。
 *
 * 値は `src/lib/marketplace/types/<type>.ts` の Descriptor から手動で複製した
 * mirror。unit test で Registry の値と一致することを assert している
 * (将来的に server-only marker を使った自動 generation も検討可能)。
 */
export const MARKETPLACE_TYPE_METAS_CLIENT: readonly MarketplaceTypeMeta[] = [
	{
		typeCode: 'activity-pack',
		displayLabel: '活動セット',
		description: 'マーケットプレイス公式の活動セット (例: 入園 1 週間スターター)',
		requiresChildId: false,
	},
	{
		typeCode: 'reward-set',
		displayLabel: 'ごほうびセット',
		description: 'マーケットプレイス公式のごほうびセット (例: ようじごほうび)',
		requiresChildId: true,
	},
	{
		typeCode: 'checklist',
		displayLabel: 'チェックリスト',
		description: 'マーケットプレイス公式の持ち物チェックリスト (例: プールの もちもの)',
		requiresChildId: true,
	},
	{
		typeCode: 'rule-preset',
		displayLabel: 'ルールセット',
		description:
			'マーケットプレイス公式のルールセット (例: ポイント交換 / 連続ボーナス、4 ruleType 対応)',
		requiresChildId: false,
	},
	{
		typeCode: 'challenge-set',
		displayLabel: 'チャレンジ集',
		description:
			'マーケットプレイス公式のチャレンジ集 (例: 日本年間行事パック)。家族で取り組む協力チャレンジを一括追加します。',
		requiresChildId: false,
	},
] as const;

/** typeCode → MarketplaceTypeMeta の lookup */
export function getMarketplaceTypeMetaClient(
	typeCode: MarketplaceTypeCodeClient,
): MarketplaceTypeMeta {
	const meta = MARKETPLACE_TYPE_METAS_CLIENT.find((m) => m.typeCode === typeCode);
	if (!meta) {
		throw new Error(
			`[client-types] Unknown marketplace typeCode: "${typeCode}". Available: ${MARKETPLACE_TYPE_CODES_CLIENT.join(', ')}`,
		);
	}
	return meta;
}
