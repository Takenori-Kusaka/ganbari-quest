// tests/unit/components/trial-banner-gated-features-sync.test.ts
// #3033 — 旧 #2919「TrialBanner bannerGatedFeatures ↔ plan gate 同期」の supersede regression guard
//
// PO 指摘 (2026-06-12): 「7日間 無料で試す」not-started バナー (制限機能列挙 #2901 含む) の
// 全ページ常設は、モバイルで画面の半分を占め無料版のまま使い続けるユーザーの不利益になるため撤去。
// 「何が無料版で制限されるか」の recognition はロック機能接触時の文脈表示
// (FeatureGate / AiSuggestPanel locked badge / rewards-upgrade-banner / export-upsell) が担う。
//
// 本 test は旧同期 test の置き換えとして「常設バナー列挙機構が再導入されていないこと」を guard する
// (ADR-0006: 対象機構の撤去に伴う assertion の置き換え。skip / 弱体化ではない)。

import { describe, expect, it } from 'vitest';
import { TRIAL_LABELS } from '../../../src/lib/domain/labels';

describe('#3033 trial 常設バナー撤去の regression guard', () => {
	it('TRIAL_LABELS に not-started バナー列挙系 compound が存在しない', () => {
		const removed = [
			'bannerGatedHeading',
			'bannerGatedFeatures',
			'bannerTitleNotStarted',
			'bannerDescNotStarted',
			'bannerCtaStart',
			'bannerCtaSubmitting',
			'bannerTitleExpired',
			'bannerDescExpired',
			'bannerDescExpiredWithArchive',
			'bannerCtaExpired',
		];
		for (const key of removed) {
			expect(TRIAL_LABELS).not.toHaveProperty(key);
		}
	});

	it('urgent 専用 + header pill の compound は存在する（撤去しすぎ防止）', () => {
		expect(TRIAL_LABELS).toHaveProperty('bannerTitleUrgent');
		expect(TRIAL_LABELS).toHaveProperty('headerPillLabel');
		expect(TRIAL_LABELS.headerPillLabel(7)).toContain('7');
	});
});
