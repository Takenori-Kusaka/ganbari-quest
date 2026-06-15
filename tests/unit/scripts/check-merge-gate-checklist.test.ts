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

const LIGHT_MISSING_SECTION = `
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
	it('PASS: 2 section 全消化', () => {
		const r = checkMergeGateChecklist({ body: LIGHT_ALL_CHECKED, labels: [], lane: 'feature' });
		expect(r.ok).toBe(true);
		expect(r.targetSections).toEqual(LIGHT_LANE_SECTIONS);
	});

	it('FAIL: 未チェックが残る', () => {
		const r = checkMergeGateChecklist({ body: LIGHT_HAS_UNCHECKED, labels: [], lane: 'feature' });
		expect(r.ok).toBe(false);
		expect(r.error).toContain('未チェック項目');
	});

	it('section 不在は warning だが fail はしない (現行挙動維持、AC4)', () => {
		const r = checkMergeGateChecklist({ body: LIGHT_MISSING_SECTION, labels: [], lane: 'feature' });
		expect(r.ok).toBe(true);
		expect((r.warnings || []).length).toBeGreaterThan(0);
	});

	it('hotfix lane も 2 section を対象 (PASS)', () => {
		const r = checkMergeGateChecklist({ body: LIGHT_ALL_CHECKED, labels: [], lane: 'hotfix' });
		expect(r.ok).toBe(true);
		expect(r.targetSections).toEqual(LIGHT_LANE_SECTIONS);
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
