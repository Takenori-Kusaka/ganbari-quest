import { error } from '@sveltejs/kit';
import { getMarketplaceItem } from '$lib/data/marketplace';
import type { MarketplaceItemType } from '$lib/domain/marketplace-item';
// #2775 (Issue #2774 Phase 2): rule-preset exchange を `<a href>` 統一形式に移行した結果、
// `marketplaceRegistry` / `rulePresetStrategy` / `RulePresetPayload` / `fail` / `redirect` は
// 本 file で未使用となったため import 撤去。5 type 全て admin 側 `?import=` 経路に集約。
// (#2366 / #2367 / #2368 / #2369 / ADR-0052 の Strategy / dispatcher は admin/rewards 等の
//  受領先 page で参照される。本 marketplace 詳細 page では type 判別と load のみ。)
import { requireTenantId } from '$lib/server/auth/factory';
import { findActivities } from '$lib/server/db/activity-repo';
import { getAllChildren } from '$lib/server/services/child-service';
import type { Actions, PageServerLoad } from './$types';

const VALID_TYPES: MarketplaceItemType[] = [
	'activity-pack',
	'reward-set',
	'checklist',
	'rule-preset',
	// #2297 (EPIC #2294 ③): challenge-set 詳細ページ対応
	'challenge-set',
];

export const load: PageServerLoad = async ({ params, locals }) => {
	const { type, itemId } = params;

	if (!VALID_TYPES.includes(type as MarketplaceItemType)) {
		error(404, 'コンテンツタイプが不正です');
	}

	const item = getMarketplaceItem(type as MarketplaceItemType, itemId);
	if (!item) {
		error(404, 'コンテンツが見つかりません');
	}

	// #2136 MP-1 / #2137 MP-2: 認証済みなら一括追加 CTA を出すための情報をロード。
	// マーケットプレイスは公開ルートなので、未認証 (locals.context が無い場合) は
	// children を空配列にしてサインアップ誘導 CTA を出す。
	// reward-set / checklist 両方の CTA で children を共通利用するため、
	// type 区別せず一括ロード（無駄に大きい呼び出しではないため pre-PMF で問題なし）。
	const isAuthenticated = !!locals.context;
	let children: { id: number; nickname: string }[] = [];
	// Round 18 Cluster H (#13/#16/#20/#25/#28): activity-pack subset 選択用に、
	// 既存活動の name を集めて preschool 親が「[既存]」ラベルで重複を一目で見分けられるようにする。
	// per-child / family master 並存期 (ADR-0055) のため tenant aggregate (`findActivities`) で
	// 全 child の既存活動 name を集約。重複判定は name match のみ (icon は SSOT が活動 master のため
	// 比較に含めない)。空配列で初期化、未認証時はそのまま空配列のまま返る。
	let existingActivityNames: string[] = [];
	if (isAuthenticated) {
		try {
			const tenantId = requireTenantId(locals);
			const allChildren = await getAllChildren(tenantId);
			children = allChildren.map((c) => ({ id: c.id, nickname: c.nickname }));

			if (type === 'activity-pack') {
				const existing = await findActivities(tenantId);
				existingActivityNames = Array.from(new Set(existing.map((a) => a.name)));
			}
		} catch {
			// 認証コンテキストはあるがテナント解決失敗 — 未認証扱いにフォールバック
			children = [];
			existingActivityNames = [];
		}
	}

	return {
		item,
		isAuthenticated,
		// #2137: MP-2 側 svelte が `data.isLoggedIn` を参照するためのエイリアス
		isLoggedIn: isAuthenticated,
		children,
		// Round 18 Cluster H: activity-pack 詳細で「[既存]」ラベル表示用 (未認証時 / 他 type 時は空配列)
		existingActivityNames,
	};
};

export const actions: Actions = {
	// #2774 / #2775 (Issue #2774 Phase 2): 5 type 取込 CTA 統一を完遂。
	// reward-set / checklist / challenge-set / rule-preset (exchange + bonus) の全 server action を撤去し、
	// marketplace 詳細 svelte 側 `<a href="/admin/<page>?import=<itemId>">` 直接遷移に統一。
	// CWE-598 整合: childId は URL/form body どちらにも露出せず、admin 側 ChildSelectionDialog で
	// per-child fan-out を決定する SSOT に集約 (docs/design/marketplace-import-flow.md §3.1-3.5)。
	// 旧 `importRewardSet` / `importChecklist` / `importChallengeSet` / `importRulePreset` は撤去済。
};
