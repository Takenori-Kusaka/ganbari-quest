// Issue #2945 (Phase A/A-3、親 #2942) AC4/AC5: lane-aware merge gate checklist judge の unit test。
// feature/hotfix lane = 現行 2 section 全消化 (回帰ゼロ)、integration lane = 統合用 section (設定可能)。
import { describe, expect, it } from 'vitest';
import {
	checkMergeGateChecklist,
	DEFAULT_INTEGRATION_LANE_SECTIONS,
	LIGHT_LANE_SECTIONS,
	resolveIntegrationSections,
	shouldSkip,
} from '../../../scripts/check-merge-gate-checklist.mjs';

// --- fixtures ---

const LIGHT_ALL_CHECKED = `
## Ready for Review チェックリスト
- [x] CI 全緑
- [x] pre-ready PASS

## 完了チェックリスト
- [x] AC 全達成
- [x] 設計書同期
`;

const LIGHT_HAS_UNCHECKED = `
## Ready for Review チェックリスト
- [x] CI 全緑
- [ ] pre-ready PASS

## 完了チェックリスト
- [x] AC 全達成
`;

const _LIGHT_MISSING_SECTION = `
## 概要
チェックリスト section が無い PR
`;

const INTEGRATION_DEFAULT_CHECKED = `
## 統合 PR チェックリスト
- [x] 最重厚レーン全 job 緑
- [x] エビデンス表完備
- [x] adversarial evidence 解消
`;

const INTEGRATION_DEFAULT_UNCHECKED = `
## 統合 PR チェックリスト
- [x] 最重厚レーン全 job 緑
- [ ] エビデンス表完備
`;

const INTEGRATION_MISSING_SECTION = `
## 概要
統合 PR だが統合用チェックリスト section が無い
`;

// --- 定数 ---

describe('定数 / resolveIntegrationSections (AC5)', () => {
	it('feature lane の対象は現行 2 section', () => {
		expect(LIGHT_LANE_SECTIONS).toEqual([
			'## Ready for Review チェックリスト',
			'## 完了チェックリスト',
		]);
	});

	it('integration lane 既定は統合用 section', () => {
		expect(DEFAULT_INTEGRATION_LANE_SECTIONS).toEqual(['## 統合 PR チェックリスト']);
	});

	it('env override で section 名を差替えられる (Phase B 確定を先取りしない)', () => {
		expect(resolveIntegrationSections('## 統合チェック A,## 統合チェック B')).toEqual([
			'## 統合チェック A',
			'## 統合チェック B',
		]);
	});

	it('空 override は既定を返す', () => {
		expect(resolveIntegrationSections('')).toEqual(DEFAULT_INTEGRATION_LANE_SECTIONS);
		expect(resolveIntegrationSections(undefined)).toEqual(DEFAULT_INTEGRATION_LANE_SECTIONS);
	});
});

// --- feature / hotfix lane (AC4 回帰ゼロ) ---

describe('checkMergeGateChecklist feature/hotfix lane (AC4)', () => {
	it('always PASS, check removed', () => {
		const r = checkMergeGateChecklist({ body: LIGHT_HAS_UNCHECKED, labels: [], lane: 'feature' });
		expect(r.ok).toBe(true);
		expect(r.reason).toContain('removed');
	});

	it('hotfix lane always PASS, check removed', () => {
		const r = checkMergeGateChecklist({ body: LIGHT_HAS_UNCHECKED, labels: [], lane: 'hotfix' });
		expect(r.ok).toBe(true);
		expect(r.reason).toContain('removed');
	});
});

// --- integration lane (AC5) ---

describe('checkMergeGateChecklist integration lane (AC5)', () => {
	it('PASS: 統合用 section 全消化', () => {
		const r = checkMergeGateChecklist({
			body: INTEGRATION_DEFAULT_CHECKED,
			labels: [],
			lane: 'integration',
		});
		expect(r.ok).toBe(true);
		expect(r.targetSections).toEqual(DEFAULT_INTEGRATION_LANE_SECTIONS);
	});

	it('FAIL: 統合用 section に未チェックが残る', () => {
		const r = checkMergeGateChecklist({
			body: INTEGRATION_DEFAULT_UNCHECKED,
			labels: [],
			lane: 'integration',
		});
		expect(r.ok).toBe(false);
		expect(r.error).toContain('未チェック項目');
	});

	it('FAIL: 必須 section 不在は fail (warning で素通りさせない、#2945 no-go)', () => {
		const r = checkMergeGateChecklist({
			body: INTEGRATION_MISSING_SECTION,
			labels: [],
			lane: 'integration',
		});
		expect(r.ok).toBe(false);
		expect(r.error).toContain('必須 section');
	});

	it('integration lane は feature の 2 section をハードコード対象にしない (AC5)', () => {
		// feature 用 section だけ持つ統合 PR は、integration では統合用 section 不在で fail する
		const r = checkMergeGateChecklist({
			body: LIGHT_ALL_CHECKED,
			labels: [],
			lane: 'integration',
		});
		expect(r.ok).toBe(false);
		expect(r.targetSections).toEqual(DEFAULT_INTEGRATION_LANE_SECTIONS);
	});

	it('env override section で検証対象を差替えられる (AC5)', () => {
		const body = `
## 統合チェック X
- [x] done
`;
		const r = checkMergeGateChecklist({
			body,
			labels: [],
			lane: 'integration',
			integrationSectionsOverride: '## 統合チェック X',
		});
		expect(r.ok).toBe(true);
		expect(r.targetSections).toEqual(['## 統合チェック X']);
	});
});

// --- shouldSkip / dependabot lane (AC6) ---

describe('shouldSkip / dependabot lane (AC6)', () => {
	it('dependencies ラベルで skip', () => {
		expect(shouldSkip({ labels: ['dependencies'] }).skip).toBe(true);
	});
	it('通常 PR は skip しない', () => {
		expect(shouldSkip({ labels: ['type:infra'] }).skip).toBe(false);
	});
	it('checkMergeGateChecklist: dependencies ラベルは PASS (skip)', () => {
		const r = checkMergeGateChecklist({
			body: LIGHT_HAS_UNCHECKED,
			labels: ['dependencies'],
			lane: 'feature',
		});
		expect(r.ok).toBe(true);
		expect(r.reason).toContain('skip');
	});
});

// --- #3071: integration lane では dependencies label による skip を無効化 (空洞化防止) ---

describe('shouldSkip integration lane = skip 無効化 (#3071)', () => {
	it('integration lane では dependencies ラベルでも skip しない', () => {
		expect(shouldSkip({ labels: ['dependencies'], lane: 'integration' }).skip).toBe(false);
	});
	it('checkMergeGateChecklist: integration + dependencies label でも skip せず section 検証が走る', () => {
		// 統合 PR section 不在 → 空洞化なら skip で PASS してしまう。fix 後は必ず検証され fail する。
		const r = checkMergeGateChecklist({
			body: '## 関係ないセクション\n本文のみ',
			labels: ['dependencies'],
			lane: 'integration',
		});
		expect(r.reason ?? '').not.toContain('skip');
		expect(r.ok).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// #4348: section 探索を「本文の部分一致」から「H2 見出し行の完全一致」に是正した回帰。
//
// 旧実装は `body.indexOf(section)` で section 開始位置を決めていたため、説明文 / AC 表 /
// HTML コメントに同じ文字列があると **そこから切り出して**しまい、checkbox の集計範囲が
// 本来の section とずれた。以下 3 例はいずれも旧実装では誤判定する入力
// (mutation 実測: countUnchecked を indexOf 版に戻すと 1 例目と 3 例目が red になる)。
// ---------------------------------------------------------------------------

describe('#4348: section 探索は H2 見出し行の完全一致', () => {
	it('本文中の言及が見出しより前にあっても、集計は本物の section を数える', () => {
		// 旧実装: AC 表のセルから切り出し → 直後の `\n## ` までに `- [ ]` が無く「全消化」と誤判定。
		const body = [
			'## AC 検証マップ (ADR-0004)',
			'',
			'| AC1 | 内容 | 手段 | 下記「## Ready for Review チェックリスト」参照 |',
			'',
			'## Ready for Review チェックリスト',
			'- [x] CI 全緑',
			'- [ ] pre-ready PASS',
			'',
		].join('\n');
		const r = checkMergeGateChecklist({ body, labels: [], lane: 'feature' });
		expect(r.ok).toBe(false);
		expect(r.error ?? '').toContain('Ready for Review チェックリスト');
	});

	it('HTML コメント内の見出し文字列だけでは section が存在するとみなさない', () => {
		const body = ['## 概要', '', '<!-- ## Ready for Review チェックリスト を書く -->', ''].join(
			'\n',
		);
		const r = checkMergeGateChecklist({ body, labels: [], lane: 'feature' });
		// feature lane は section 不在を warning にする (現行仕様)。found=false が warning に出ること。
		expect((r.warnings ?? []).join('\n')).toContain('Ready for Review チェックリスト');
	});

	it('code block 内の未チェック checkbox は集計しない (template の例示で fail させない)', () => {
		const body = [
			'## Ready for Review チェックリスト',
			'- [x] CI 全緑',
			'- [x] pre-ready PASS',
			'',
			'```markdown',
			'- [ ] これは書き方の例',
			'```',
			'',
		].join('\n');
		const r = checkMergeGateChecklist({ body, labels: [], lane: 'feature' });
		expect(r.ok).toBe(true);
	});
});
