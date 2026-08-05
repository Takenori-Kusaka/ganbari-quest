// tests/unit/scripts/check-pr-body-reality-drift.test.ts
// #4170 AC1 / AC3 / AC5 — 統合 PR 本文と GitHub 実態の乖離を機械照合する。
//
// ## 実害（第19回統合監査 #4152、merge 直前に 4 回）
//
// | # | ずれた内容 | 本 test の対応 |
// |---|---|---|
// | 1 | `Closes #4129` を「追加した」が実 PR body に無かった | **AC2 で実装済**（`checkClosesLanded`） |
// | 2 | 「#4129 は open 継続が正しい」→ 実測 **CLOSED** | **AC1**: `checkStateClaims` |
// | 3 | accepted-residual の受容理由が実測と不一致（世代数 1 件 → 実測 3 件） | **AC3**: `checkClaimedCounts`（件数の形のみ） |
// | 4 | 「起票した Issue（3 件）」→ 実際 **4 件**。label も本文 `state:needs-po` / 実測 `state:needs-dev` + `status:on-hold` | **AC3**（件数）+ **AC1**（label） |
//
// 4 件とも adversarial reviewer が見つけており、audit-manager の目視では追いつかなかった。
// **執筆と merge の間に間隔がある限り構造的に再発する**（Issue 根本原因）。
//
// ## 設計上の制約（あえて narrow にしている）
//
// 本文は自然文なので、「本文が何を主張しているか」を完全に読み取ることはできない。
// **誤検出する gate は無視されるようになり、gate として死ぬ**ので、**確信が持てる形だけを拾う**:
//
// - state 主張: **同一行**に `#N` と状態語（`open` / `CLOSED` 等）が両方あるときだけ
// - label 主張: **同一行**に `#N` と `` `state:*` `` / `` `status:*` `` が両方あるときだけ
// - 件数主張: `(N 件)` 等が**行末寄り**にあり、**直後に markdown 表が始まる**ときだけ
//
// **拾えないもの**は PR 本文に明記する（gate の射程を誤解させない）。

import { describe, expect, it } from 'vitest';
import {
	BLOCKING_VIOLATION_IDS,
	checkClaimedCounts,
	checkStateClaims,
	extractCountClaims,
	extractStateClaims,
	partitionBySeverity,
} from '../../../scripts/check-pr-body.mjs';

describe('#4170 AC1 — 本文の state / label 主張を実測と突合', () => {
	describe('抽出（extractStateClaims）', () => {
		it('同一行に #N と状態語があるときだけ拾う', () => {
			const body = [
				'- #4129 は AC 5 件すべて `[ ]` / open 継続が正しい',
				// 状態語を含まない行は拾わない
				'- #4130 の対応方針を記載する',
				// #N を含まない行は拾わない
				'open',
			].join('\n');
			const claims = extractStateClaims(body);
			expect(claims.map((c) => c.number)).toEqual([4129]);
			expect(claims[0]?.claimedState).toBe('OPEN');
		});

		it('同一行に #N と state: / status: label があるとき拾う', () => {
			const body = '| #4131 | 起票済 | `state:needs-po` |';
			const claims = extractStateClaims(body);
			expect(claims[0]?.number).toBe(4131);
			expect(claims[0]?.claimedLabels).toEqual(['state:needs-po']);
		});

		it('code fence 内は拾わない（例示を主張と読み違えない）', () => {
			const body = ['```', '#4129 は open', '```'].join('\n');
			expect(extractStateClaims(body)).toEqual([]);
		});
	});

	describe('突合（checkStateClaims）', () => {
		const live = new Map([
			[4129, { state: 'CLOSED', labels: ['state:needs-dev', 'status:on-hold'] }],
			[4131, { state: 'OPEN', labels: ['state:needs-dev', 'status:on-hold'] }],
		]);

		// 実害 #2 の再現
		it('open と書いたが実測 CLOSED なら violation', () => {
			const v = checkStateClaims('- #4129 は open 継続が正しい', live);
			expect(v).not.toBeNull();
			expect(v?.message).toContain('#4129');
			expect(v?.message).toContain('CLOSED');
		});

		// 実害 #4 の再現
		it('本文 state:needs-po / 実測 state:needs-dev + status:on-hold なら violation', () => {
			const v = checkStateClaims('| #4131 | 起票済 | `state:needs-po` |', live);
			expect(v).not.toBeNull();
			expect(v?.message).toContain('state:needs-po');
			expect(v?.message).toContain('state:needs-dev');
		});

		it('一致していれば null', () => {
			const v = checkStateClaims('| #4131 | `state:needs-dev` | open |', live);
			expect(v).toBeNull();
		});

		// 実測できなかったものを「一致」と扱わない（fail-closed、ADR-0006）
		it('実測が取れていない番号は violation にする（黙って通さない）', () => {
			const v = checkStateClaims('- #9999 は open', new Map());
			expect(v, '実測不能を silent pass にすると gate が空洞化する').not.toBeNull();
			expect(v?.message).toContain('#9999');
		});
	});
});

describe('#4170 AC3 — 本文が主張する件数と表の行数の一致', () => {
	describe('抽出（extractCountClaims）', () => {
		it('件数主張の直後に表があるときだけ拾う', () => {
			const body = [
				'### 起票した Issue (3 件)',
				'',
				'| Issue | 内容 |',
				'|---|---|',
				'| #1 | a |',
				'| #2 | b |',
			].join('\n');
			const claims = extractCountClaims(body);
			expect(claims).toHaveLength(1);
			expect(claims[0]?.claimed).toBe(3);
			expect(claims[0]?.actualRows).toBe(2);
		});

		it('表が続かない件数記述は拾わない（本文中の「3 件」等）', () => {
			const body = '今回は 3 件の指摘があった。詳細は後述する。\n\n本文が続く。';
			expect(extractCountClaims(body)).toEqual([]);
		});

		it('template のプレースホルダ行は数えない', () => {
			const body = [
				'### 含有 PR 一覧 (0 件)',
				'',
				'| PR | title |',
				'|---|---|',
				'| #NNNN | `<title>` |',
			].join('\n');
			const claims = extractCountClaims(body);
			expect(claims[0]?.actualRows, 'プレースホルダは実データではない').toBe(0);
		});
	});

	// 実害 #4 の再現
	it('「3 件」と書いて表が 4 行なら violation', () => {
		const body = [
			'### 起票した Issue (3 件)',
			'',
			'| Issue | 内容 |',
			'|---|---|',
			'| #1 | a |',
			'| #2 | b |',
			'| #3 | c |',
			'| #4 | d |',
		].join('\n');
		const v = checkClaimedCounts(body);
		expect(v).not.toBeNull();
		expect(v?.message).toContain('3');
		expect(v?.message).toContain('4');
	});

	it('一致していれば null', () => {
		const body = ['### 起票 (2 件)', '', '| a | b |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |'].join(
			'\n',
		);
		expect(checkClaimedCounts(body)).toBeNull();
	});
});

describe('#4170 AC4 — integration lane でのみ hard-fail する', () => {
	// 「feature lane の挙動は変えない」が AC4 の明示要求。
	// 検査を lane 非依存に置くと、feature PR の本文に書いた `#N は open` まで拾って
	// 実測を引きに行き、**関係ない PR を落とす**。
	it('検査は isIntegration ブロック内にだけ配線されている', async () => {
		const { readFileSync } = await import('node:fs');
		const src = readFileSync('scripts/check-pr-body.mjs', 'utf8');

		// 関数定義そのもの (`export function checkClaimedCounts(body) {`) や helper 内の
		// 内部呼び出しも同じ文字列を含むため、**判定は collectViolations の中だけに絞る**。
		// 絞らないと「定義が存在する」だけで fail し、guard が意味を失う。
		const fnStart = src.indexOf('function collectViolations(');
		expect(fnStart, 'collectViolations が見つかりません').toBeGreaterThan(-1);
		const fn = src.slice(fnStart);

		const start = fn.indexOf('if (isIntegration) {');
		expect(start, 'isIntegration ブロックが見つかりません').toBeGreaterThan(-1);
		const end = fn.indexOf('\n\t} else {', start);
		expect(end, 'isIntegration の else が見つかりません').toBeGreaterThan(start);
		const integrationBlock = fn.slice(start, end);
		const outside = fn.slice(0, start) + fn.slice(end);

		for (const call of ['checkClaimedCounts(body)', 'extractStateClaims(body)']) {
			expect(integrationBlock, `${call} が integration ブロックにありません`).toContain(call);
			expect(
				outside,
				`${call} が integration ブロック外から呼ばれています (feature lane に波及する)`,
			).not.toContain(call);
		}
	});

	// 配線 (どこから呼ぶか) が正しくても、**severity 分類が advisory のままなら CI は exit 0 で通る**。
	// 構造的配置の assert だけでは本欠陥を検出できないことが QM レビュー (#4231) で実証された。
	// → 「blocking に入ること」そのものを assert する。
	it('body-state-drift / body-count-drift は blocking (hard-fail) に分類される', () => {
		for (const id of ['body-state-drift', 'body-count-drift']) {
			expect(
				BLOCKING_VIOLATION_IDS.has(id),
				`${id} が BLOCKING_GATES に無い = advisory 扱いになり、乖離しても CI が緑で通る`,
			).toBe(true);
		}
	});

	it('partitionBySeverity が 2 件を blocking 側に入れる (exit 1 になる)', () => {
		const violations = [
			{ id: 'body-state-drift', message: 'x' },
			{ id: 'body-count-drift', message: 'y' },
		];
		const { blocking, advisory } = partitionBySeverity(violations);
		expect(blocking.map((v) => v.id)).toEqual(['body-state-drift', 'body-count-drift']);
		expect(advisory, 'advisory に落ちると blocking.length === 0 で exit 0 になる').toEqual([]);
	});

	// 実際に検査が返す violation object をそのまま流し、id の綴りずれで分類が外れないことまで見る。
	it('checkStateClaims / checkClaimedCounts が返した violation は blocking になる', () => {
		const stateV = checkStateClaims('- #9999 は open', new Map());
		const countV = checkClaimedCounts(
			['### 起票 (3 件)', '', '| a | b |', '|---|---|', '| 1 | 2 |'].join('\n'),
		);
		expect(stateV).not.toBeNull();
		expect(countV).not.toBeNull();
		const { blocking } = partitionBySeverity([stateV, countV].filter((v) => v !== null));
		expect(blocking).toHaveLength(2);
	});

	// 実測を引かない経路で「違反なし」を出すと、gate が走ったのか走っていないのか区別できない。
	// #3962 で同じ形 (Windows で jq が落ち catch で握り潰し、検査が一度も走らず OK が出ていた) を踏んでいる。
	it('--no-labels / --labels のときは skip したことを出力する', async () => {
		const { readFileSync } = await import('node:fs');
		const src = readFileSync('scripts/check-pr-body.mjs', 'utf8');
		expect(src).toContain('SKIP: #4170 AC1');
	});
});
