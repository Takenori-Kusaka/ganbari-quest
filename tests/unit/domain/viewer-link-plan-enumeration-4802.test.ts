// tests/unit/domain/viewer-link-plan-enumeration-4802.test.ts
//
// PO 回答 (2026-09-03、PR #4802 コメント): 閲覧リンク (viewer link) まわりのプラン列挙は
//   - プラン名は `terms.ts` / `labels.ts` 経由
//   - 未提供・未実装のプランを列挙しない (ADR-0013 — 表示は実装の事実を SSOT とする)
//
// 「提供しているプラン」の SSOT は `PlanTier` (`constants/plan-tier.ts`、機能制限を適用する段) と
// その表示名 `PLAN_LABELS` (`getPlanLabel`)。閲覧リンクは API (`/api/v1/admin/viewer-tokens`) と
// 画面 (`/admin/members`) の両方が `tier === 'family'` で gate しているので、顧客が読む文言が
// 名指しするプランはその 1 つ (= `getPlanLabel('family')`) でなければならない。
//
// これが無いと: 旧称「ファミリープラン」/ 提供していない「永久ライセンス」等が閲覧リンクの
// 説明に紛れ込んでも、値が偶然一致している間は誰も気づかない (deprecated alias 経由の直書きは
// 値が同じなので runtime では検出できず、名前が変わった瞬間に割れる)。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PlanTier } from '../../../src/lib/domain/constants/plan-tier';
import {
	getPlanLabel,
	LP_FAQ_LABELS,
	LP_FAQ_PHASEB_LABELS,
	MEMBERS_LABELS,
	PAGE_GUIDE_LABELS,
	PLAN_GATE_LABELS,
	PLAN_LABELS,
} from '../../../src/lib/domain/labels';
import { VIEWER_LINK_TERMS } from '../../../src/lib/domain/terms';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoFile = (p: string) => readFileSync(resolve(__dirname, '../../../', p), 'utf-8');

/** 提供しているプランの表示名 = PlanTier の全 key を getPlanLabel に通したもの (SSOT 由来) */
const OFFERED_PLAN_TIERS = Object.keys(PLAN_LABELS) as PlanTier[];
// PLAN_LABELS の key 集合が PlanTier と一致していないとここが型エラーになる (列挙の SSOT 同期)
const _planLabelsCoverAllTiers: Record<PlanTier, string> = PLAN_LABELS;
void _planLabelsCoverAllTiers;
const OFFERED_PLAN_NAMES = OFFERED_PLAN_TIERS.map(getPlanLabel);

/** 閲覧リンクを gate している tier (API `requireFamily` / members page `isFamily`) */
const VIEWER_LINK_TIER: PlanTier = 'family';

/** 閲覧リンクについて顧客が読む文言すべて (ここに 1 行足せば列挙の検査対象になる) */
const VIEWER_LINK_TEXTS: Array<[string, string]> = [
	...Object.entries(MEMBERS_LABELS)
		.filter(([key, value]) => key.startsWith('viewer') && typeof value === 'string')
		.map(([key, value]): [string, string] => [`MEMBERS_LABELS.${key}`, value as string]),
	['PLAN_GATE_LABELS.viewerTokenFamilyOnly', PLAN_GATE_LABELS.viewerTokenFamilyOnly],
	['ページガイド members-intro.how', PAGE_GUIDE_LABELS.adminMembers.steps['members-intro'].how],
	['ページガイド members-viewer.what', PAGE_GUIDE_LABELS.adminMembers.steps['members-viewer'].what],
	['LP FAQ text109', LP_FAQ_LABELS.text109],
	['LP FAQ (Phase B) k108', LP_FAQ_PHASEB_LABELS.k108],
];

/**
 * 文中の「プラン名」を拾う。プラン名は「カタカナ + プラン」(スタンダード / プレミアム / ファミリー) か
 * 「無料プラン」の形をとる。総称 (「プラン」「有料プラン」「ご自身の権限とプラン」) は列挙ではないので
 * 拾わない — 助詞や普通名詞まで前方一致で飲み込むと、総称の言及を偽陽性にしてしまう。
 */
function planMentions(text: string): string[] {
	return text.match(/(?:[ァ-ヶー]+|無料)プラン/g) ?? [];
}

/** 提供していない / 廃止済みのプラン呼称。列挙に紛れ込んではならない */
const UNOFFERED_PLAN_NAMES = [
	'ファミリープラン',
	'永久ライセンス',
	'ライフタイム',
	'エンタープライズ',
];

describe('#4802 閲覧リンクのプラン列挙は提供中のプランだけを SSOT 経由で名指しする', () => {
	it('検査対象の文言集合が空でない (閲覧リンクの文言が消えたら本 test の前提が崩れる)', () => {
		expect(VIEWER_LINK_TEXTS.length).toBeGreaterThan(5);
		expect(OFFERED_PLAN_NAMES).toContain(getPlanLabel(VIEWER_LINK_TIER));
	});

	it.each(VIEWER_LINK_TEXTS)('%s が名指しするプランは提供中のプランに含まれる', (_n, text) => {
		for (const mention of planMentions(text)) {
			expect(OFFERED_PLAN_NAMES, `「${mention}」は提供中のプランではない`).toContain(mention);
		}
	});

	it.each(
		VIEWER_LINK_TEXTS,
	)('%s は閲覧リンクを gate している tier 以外のプランを名指ししない', (_n, text) => {
		const gateName = getPlanLabel(VIEWER_LINK_TIER);
		for (const mention of planMentions(text)) {
			// 「無料プランでは使えない」型の対比も無し。閲覧リンクが属するプランだけを述べる
			expect(mention, `閲覧リンクの文言が ${gateName} 以外を名指ししている`).toBe(gateName);
		}
	});

	it.each(VIEWER_LINK_TEXTS)('%s に未提供 / 廃止済みのプラン呼称が無い', (_n, text) => {
		for (const stale of UNOFFERED_PLAN_NAMES) {
			expect(text).not.toContain(stale);
		}
	});

	it('閲覧リンクの機能名は VIEWER_LINK_TERMS.name と一致する (機能名も atom 経由)', () => {
		expect(MEMBERS_LABELS.viewerSectionTitle).toBe(VIEWER_LINK_TERMS.name);
		expect(PAGE_GUIDE_LABELS.adminMembers.steps['members-intro'].how).toContain(
			VIEWER_LINK_TERMS.name,
		);
	});
});

describe('#4802 閲覧リンクの文言はプラン名を deprecated alias や直書きで持たない (source)', () => {
	// `PLAN_FULL_TERMS.family` / `PLAN_TERMS.family` は `.premium` への移行用 alias (@deprecated)。
	// 値が同じなので runtime では区別できず、alias を消した瞬間に閲覧リンクの文言だけが割れる。
	it('labels.ts の閲覧リンク関連行は deprecated alias `_TERMS.family` を参照しない', () => {
		const lines = repoFile('src/lib/domain/labels.ts').split('\n');
		const viewerLines = lines.filter(
			(line) =>
				/viewer|VIEWER_LINK_TERMS|閲覧リンク/i.test(line) && !line.trimStart().startsWith('//'),
		);
		expect(viewerLines.length).toBeGreaterThan(0);
		for (const line of viewerLines) {
			expect(line, line.trim()).not.toMatch(/PLAN(_FULL)?_TERMS\.family\b/);
		}
	});

	it('閲覧リンクの API / 画面はプラン名の文字列リテラルを持たない (labels 経由のみ)', () => {
		const files = [
			'src/routes/api/v1/admin/viewer-tokens/+server.ts',
			'src/routes/(parent)/admin/members/+page.svelte',
			'src/routes/view/[token]/+page.svelte',
		];
		for (const file of files) {
			const src = repoFile(file);
			expect(src, `${file} にプラン名の直書きがある`).not.toMatch(
				/['"`][^'"`\n]*プラン[^'"`\n]*['"`]/,
			);
		}
	});
});
