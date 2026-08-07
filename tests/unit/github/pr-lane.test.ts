// Issue #2943 (Phase A/A-1) AC2: PR lane 判定 SSOT (scripts/pr-lane.mjs) の
// 決定的 4 lane 分類 (feature / integration / hotfix / dependabot) の境界を網羅する unit test。
// develop 二層ブランチ戦略 (docs/sessions/branch-strategy.md §3〜§5) の CI gate 側 SSOT。
import { describe, expect, it } from 'vitest';
import { BOT_ACTORS, classifyLane, parseArgs } from '../../../scripts/pr-lane.mjs';

describe('classifyLane (#2943 AC1/AC2)', () => {
	// --- AC2 で明示された 6 境界条件 ---
	it('feature: base develop / head feat/* / 通常 actor', () => {
		expect(classifyLane({ baseRef: 'develop', headRef: 'feat/x', actor: 'Takenori-Kusaka' })).toBe(
			'feature',
		);
	});

	it('integration: head develop & base main', () => {
		expect(classifyLane({ baseRef: 'main', headRef: 'develop', actor: 'Takenori-Kusaka' })).toBe(
			'integration',
		);
	});

	it('hotfix: head fix/* & base main', () => {
		expect(classifyLane({ baseRef: 'main', headRef: 'fix/urgent', actor: 'Takenori-Kusaka' })).toBe(
			'hotfix',
		);
	});

	// --- release ブランチ方式 (branch-strategy.md §3、動く標的問題の構造的解消) ---
	it('integration: release/* → main も統合 PR (重量レーン) に帰属', () => {
		expect(
			classifyLane({ baseRef: 'main', headRef: 'release/2026-06-16', actor: 'Takenori-Kusaka' }),
		).toBe('integration');
	});

	it('integration: release/ 接頭辞の各種命名 (日付 / 連番) も integration', () => {
		for (const head of ['release/2026-06-16', 'release/v1.2.3', 'release/3021']) {
			expect(classifyLane({ baseRef: 'main', headRef: head, actor: 'u' })).toBe('integration');
		}
	});

	it('release/* → develop (base develop) は integration ではなく feature 軽量レーン', () => {
		// base が develop のときは release 接頭辞でも feature (back-merge / 誤 base 防御)
		expect(classifyLane({ baseRef: 'develop', headRef: 'release/2026-06-16', actor: 'u' })).toBe(
			'feature',
		);
	});

	it('優先順位: bot は release/* → main でも dependabot が勝つ', () => {
		expect(
			classifyLane({ baseRef: 'main', headRef: 'release/2026-06-16', actor: 'dependabot[bot]' }),
		).toBe('dependabot');
	});

	it('dependabot: actor が base/head より優先 (develop→main でも bot なら dependabot)', () => {
		expect(classifyLane({ baseRef: 'main', headRef: 'develop', actor: 'dependabot[bot]' })).toBe(
			'dependabot',
		);
	});

	it('feature 既定: base main / head feat/* (cutover 前 main 向け通常 PR = 軽量観点)', () => {
		expect(classifyLane({ baseRef: 'main', headRef: 'feat/x', actor: 'Takenori-Kusaka' })).toBe(
			'feature',
		);
	});

	it('dependabot: renovate[bot] も bot 扱い (base develop / head fix/*)', () => {
		expect(classifyLane({ baseRef: 'develop', headRef: 'fix/x', actor: 'renovate[bot]' })).toBe(
			'dependabot',
		);
	});

	// --- 優先順位 (最初にマッチした lane を返す) の追加境界 ---
	it('優先順位: bot は hotfix 形 (fix/* → main) でも dependabot が勝つ', () => {
		expect(
			classifyLane({ baseRef: 'main', headRef: 'fix/dep-bump', actor: 'dependabot[bot]' }),
		).toBe('dependabot');
	});

	it('優先順位: integration は hotfix より先に判定 (head develop & base main)', () => {
		// develop は fix/ で始まらないので hotfix にはならないが、判定順序の固定を明示
		expect(classifyLane({ baseRef: 'main', headRef: 'develop', actor: 'someone' })).toBe(
			'integration',
		);
	});

	// --- back-merge PR の帰属 (#2960 / #2967 実地観測) ---
	it('back-merge: main → develop (head main / base develop) は feature 軽量レーンに帰属', () => {
		expect(classifyLane({ baseRef: 'develop', headRef: 'main', actor: 'Takenori-Kusaka' })).toBe(
			'feature',
		);
	});

	it('back-merge 派生: hotfix-backport branch → develop も feature に帰属', () => {
		expect(
			classifyLane({ baseRef: 'develop', headRef: 'fix/999-backport', actor: 'Takenori-Kusaka' }),
		).toBe('feature');
	});

	// --- hotfix は base が main のときのみ。develop 向けは feature ---
	it('fix/* → develop は hotfix ではなく feature (base develop が優先)', () => {
		expect(classifyLane({ baseRef: 'develop', headRef: 'fix/123', actor: 'Takenori-Kusaka' })).toBe(
			'feature',
		);
	});

	// --- 各種ブランチ接頭辞 → develop はすべて feature ---
	it('refactor/* / docs/* / infra/* → develop はすべて feature', () => {
		for (const head of ['refactor/x', 'docs/x', 'infra/x', 'chore/x']) {
			expect(classifyLane({ baseRef: 'develop', headRef: head, actor: 'Takenori-Kusaka' })).toBe(
				'feature',
			);
		}
	});

	// --- 空・null 入力の堅牢性 (副作用なし・throw しない) ---
	it('空文字 / null 入力でも throw せず feature 既定を返す', () => {
		expect(classifyLane({ baseRef: '', headRef: '', actor: '' })).toBe('feature');
		// @ts-expect-error 意図的な null 入力で堅牢性を検証
		expect(classifyLane({ baseRef: null, headRef: null, actor: null })).toBe('feature');
	});

	it('前後空白は trim される (CI env var 由来の改行/空白対策)', () => {
		expect(
			classifyLane({ baseRef: ' main ', headRef: ' develop ', actor: ' Takenori-Kusaka ' }),
		).toBe('integration');
		expect(classifyLane({ baseRef: 'main', headRef: 'develop', actor: ' dependabot[bot] ' })).toBe(
			'dependabot',
		);
	});

	// --- 4 lane のいずれかを必ず返す (網羅性 invariant、AC1) ---
	it('AC1: 出力は常に 4 lane のいずれか', () => {
		const lanes = new Set(['feature', 'integration', 'hotfix', 'dependabot']);
		const cases = [
			{ baseRef: 'develop', headRef: 'feat/x', actor: 'u' },
			{ baseRef: 'main', headRef: 'develop', actor: 'u' },
			{ baseRef: 'main', headRef: 'fix/x', actor: 'u' },
			{ baseRef: 'main', headRef: 'feat/x', actor: 'u' },
			{ baseRef: 'main', headRef: 'develop', actor: 'dependabot[bot]' },
		];
		for (const c of cases) {
			expect(lanes.has(classifyLane(c))).toBe(true);
		}
	});
});

describe('commitAuthors — 全 commit が bot かどうかで dependabot exempt を判定 (#4445)', () => {
	it('actor が bot で commitAuthors 未指定 (旧呼び出し) は従来どおり dependabot (後方互換)', () => {
		expect(classifyLane({ baseRef: 'develop', headRef: 'fix/x', actor: 'dependabot[bot]' })).toBe(
			'dependabot',
		);
	});

	it('actor が bot で commitAuthors が全て bot なら dependabot lane を維持する (bot のみ PR の緩和は不変)', () => {
		expect(
			classifyLane({
				baseRef: 'develop',
				headRef: 'dependabot/npm_and_yarn/x',
				actor: 'dependabot[bot]',
				commitAuthors: ['dependabot[bot]'],
			}),
		).toBe('dependabot');
	});

	it('actor が bot でも commitAuthors に人間が 1 件でも混ざれば dependabot lane から外れる (#4445 実測 PR #4422 相当)', () => {
		expect(
			classifyLane({
				baseRef: 'develop',
				headRef: 'dependabot/npm_and_yarn/infra/x',
				actor: 'dependabot[bot]',
				commitAuthors: ['dependabot[bot]', 'Takenori-Kusaka', 'ganbariquestsupport-lab'],
			}),
		).not.toBe('dependabot');
	});

	it('人間混入時は通常の base/head 判定にフォールスルーする (base develop → feature)', () => {
		expect(
			classifyLane({
				baseRef: 'develop',
				headRef: 'dependabot/npm_and_yarn/infra/x',
				actor: 'dependabot[bot]',
				commitAuthors: ['dependabot[bot]', 'Takenori-Kusaka'],
			}),
		).toBe('feature');
	});

	it('人間混入時は base main / head fix/* なら hotfix にフォールスルーする', () => {
		expect(
			classifyLane({
				baseRef: 'main',
				headRef: 'fix/dependabot-manual-follow-up',
				actor: 'dependabot[bot]',
				commitAuthors: ['dependabot[bot]', 'Takenori-Kusaka'],
			}),
		).toBe('hotfix');
	});

	it('commitAuthors が空配列 (fetch 失敗等で不明) の場合は fail-open で従来どおり dependabot を維持する', () => {
		expect(
			classifyLane({
				baseRef: 'develop',
				headRef: 'fix/x',
				actor: 'dependabot[bot]',
				commitAuthors: [],
			}),
		).toBe('dependabot');
	});

	it('renovate[bot] actor でも同様に commitAuthors 混入で dependabot lane から外れる', () => {
		expect(
			classifyLane({
				baseRef: 'develop',
				headRef: 'renovate/x',
				actor: 'renovate[bot]',
				commitAuthors: ['renovate[bot]', 'someone'],
			}),
		).not.toBe('dependabot');
	});

	it('login 未解決 (null → 空文字) の commit author は人間扱いとして扱う (fail-closed、bot 誤認防止)', () => {
		expect(
			classifyLane({
				baseRef: 'develop',
				headRef: 'dependabot/npm_and_yarn/x',
				actor: 'dependabot[bot]',
				commitAuthors: ['dependabot[bot]', ''],
			}),
		).not.toBe('dependabot');
	});

	it('actor が human の PR は commitAuthors の影響を受けない (bot 判定の対象外)', () => {
		expect(
			classifyLane({
				baseRef: 'develop',
				headRef: 'feat/x',
				actor: 'Takenori-Kusaka',
				commitAuthors: ['dependabot[bot]'],
			}),
		).toBe('feature');
	});
});

describe('BOT_ACTORS SSOT (#2947 AC1)', () => {
	it('bot lane の actor 集合を named export する (dependabot[bot] / renovate[bot])', () => {
		expect(BOT_ACTORS).toEqual(['dependabot[bot]', 'renovate[bot]']);
	});

	it('BOT_ACTORS の各 actor は classifyLane で dependabot lane に分類される (SSOT 整合)', () => {
		for (const actor of BOT_ACTORS) {
			expect(classifyLane({ baseRef: 'develop', headRef: 'feat/x', actor })).toBe('dependabot');
		}
	});

	it('BOT_ACTORS は freeze されており実行時改変できない (SSOT 不変条件)', () => {
		expect(Object.isFrozen(BOT_ACTORS)).toBe(true);
	});
});

describe('parseArgs (#2943 AC5 CLI)', () => {
	it('--base main --head develop --actor x をパースする (空白区切り)', () => {
		expect(parseArgs(['--base', 'main', '--head', 'develop', '--actor', 'x'])).toEqual({
			baseRef: 'main',
			headRef: 'develop',
			actor: 'x',
		});
	});

	it('--base=main 形式 (= 区切り) もパースする', () => {
		expect(parseArgs(['--base=main', '--head=develop', '--actor=x'])).toEqual({
			baseRef: 'main',
			headRef: 'develop',
			actor: 'x',
		});
	});

	it('未指定 flag は空文字 (CLI 呼び出し側で classifyLane が feature 既定)', () => {
		expect(parseArgs([])).toEqual({ baseRef: '', headRef: '', actor: '' });
	});

	it('parseArgs + classifyLane の結合で integration を得る (AC5 経路)', () => {
		const { baseRef, headRef, actor } = parseArgs([
			'--base',
			'main',
			'--head',
			'develop',
			'--actor',
			'x',
		]);
		expect(classifyLane({ baseRef, headRef, actor })).toBe('integration');
	});

	it('--commit-authors はカンマ区切りで配列にパースされる (#4445)', () => {
		expect(
			parseArgs([
				'--base',
				'develop',
				'--head',
				'x',
				'--actor',
				'dependabot[bot]',
				'--commit-authors',
				'dependabot[bot],Takenori-Kusaka',
			]),
		).toEqual({
			baseRef: 'develop',
			headRef: 'x',
			actor: 'dependabot[bot]',
			commitAuthors: ['dependabot[bot]', 'Takenori-Kusaka'],
		});
	});

	it('--commit-authors 未指定時は commitAuthors が undefined のまま (後方互換)', () => {
		expect(
			parseArgs(['--base', 'develop', '--head', 'x', '--actor', 'y']).commitAuthors,
		).toBeUndefined();
	});

	it('--commit-authors="" (空文字) は commitAuthors が undefined 扱い (fetch 失敗等の fail-open 経路)', () => {
		expect(
			parseArgs(['--base', 'develop', '--head', 'x', '--actor', 'y', '--commit-authors', ''])
				.commitAuthors,
		).toBeUndefined();
	});

	it('parseArgs + classifyLane の結合: commit-authors 混入で dependabot lane から外れる (AC5 経路 #4445)', () => {
		const { baseRef, headRef, actor, commitAuthors } = parseArgs([
			'--base',
			'develop',
			'--head',
			'dependabot/x',
			'--actor',
			'dependabot[bot]',
			'--commit-authors',
			'dependabot[bot],Takenori-Kusaka',
		]);
		expect(classifyLane({ baseRef, headRef, actor, commitAuthors })).toBe('feature');
	});
});
