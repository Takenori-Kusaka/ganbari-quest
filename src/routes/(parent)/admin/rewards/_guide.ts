import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #2927 (EPIC #2925 Sub-2): narrative を「①ページ概要 → ②画面の見方 → ③最頻操作」に統一。
// step 1 は selector 省略で画面中央 modal 表示。step 2 はお子さまタブ (小要素) を target にする
// (旧 step 1 の rewards-section は巨大要素のため target にしない)。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
const L = PAGE_GUIDE_LABELS.adminRewards;

export const REWARDS_GUIDE: PageGuide = {
	pageId: 'admin-rewards',
	title: L.title,
	icon: '🎁',
	steps: [
		// ① ページ概要
		{
			id: 'rewards-intro',
			...L.steps['rewards-intro'],
		},
		// ② 画面の見方
		{
			id: 'rewards-child-tabs',
			selector: '[data-tutorial="rewards-child-tabs"]',
			...L.steps['rewards-child-tabs'],
			position: 'bottom',
		},
		// ③ 最頻操作（ごほうび追加の起点 = 追加ボタンを target にする）
		{
			id: 'rewards-add',
			// 追加フォームの「追加する」ボタン (Card 末尾の主 CTA) を highlight する。
			// position hint は撤去して driver.js collision-aware auto 配置に委譲する (#2968 round2)。
			// per-step 手書き hint は driver.js auto と競合して一方の viewport で overflow を引き起こす
			// (mobile を直して desktop を壊す whack-a-mole)。auto 配置が bottom → top flip を viewport
			// 状況に応じて選択することで全 viewport PASS が保証される。
			selector: '[data-tutorial="rewards-add-start"]',
			...L.steps['rewards-add'],
		},
	],
};
