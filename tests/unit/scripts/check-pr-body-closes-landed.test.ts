/**
 * tests/unit/scripts/check-pr-body-closes-landed.test.ts (#4170 AC2)
 *
 * 「下書きの `Closes #N` が GitHub 上の実 PR body に着地しているか」を検査する gate の unit test。
 *
 * 検査対象の defect は第19回統合監査 (#4152) の実測: 監査 run が `Closes #4129` を「追加した」と
 * 報告したが、ローカル下書きだけ編集しており実 PR body には存在しなかった。`Closes` 行は
 * auto-close の実処理に直結し merge されると main 上の恒久記録になるため、記述が古いだけの
 * 他 3 件とは副作用の有無が違う (監査チーム回答、2026-08-01)。
 *
 * 併せて **grep では代替できない**ことを固定する。`grep -c "Closes #4129"` は撤回経緯の言及にも
 * ヒットし、PR #4152 の実 body では 4 件返すが実際の close 宣言は 0 件だった。判定は行頭一致 SSOT
 * (`integration-pr-body.mjs` の `extractClosedIssues`) に委譲されている必要がある。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
	checkClosesLanded,
	extractClosingKeywordMentions,
	extractLandedClosingIssues,
	runClosesLandedMode,
} from '../../../scripts/check-pr-body.mjs';

/** 実 PR #4152 の構造を最小再現した body (行頭 close 宣言 3 件 + 撤回経緯の言及)。 */
const LIVE_BODY_4152 = [
	'## 関連 Issue',
	'',
	'**自動クローズ対象 issue:**',
	'Closes #4130',
	'Closes #4139',
	'Closes #4150',
	'',
	'### Closes 集約の検証結果',
	'',
	'- **#4129 の追加を撤回した理由**: 監査は当初 `Closes #4129` を追加すると判断したが、',
	'  adversarial reviewer の反証が正しい。open 継続が正しいため撤回した。',
	'',
	'| # | 観点 | 結果 |',
	'|---|---|---|',
	'| 4 | Closes 集約 | 当初 `Closes #4129` の追加を予告したが撤回 |',
	'',
	'| OBJ-1 | 「`Closes #4129` を追加した」と称しているが PR body の実物には存在しない |',
].join('\n');

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'closes-landed-'));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe('#4170 AC2 — close 宣言の抽出は行頭一致 SSOT に委譲される', () => {
	it('行頭の close 宣言だけを auto-close 対象として拾う', () => {
		expect(extractLandedClosingIssues(LIVE_BODY_4152)).toEqual([4130, 4139, 4150]);
	});

	it('grep 相当 (位置を問わない keyword 一致) は撤回済みの #4129 を誤って拾う', () => {
		// この差こそが本 gate を grep で代替できない理由。両者が一致してしまったら
		// 実装が行頭一致でなくなった (= 撤回経緯を close 宣言と誤認する) ことを意味する。
		expect(extractClosingKeywordMentions(LIVE_BODY_4152)).toContain(4129);
		expect(extractLandedClosingIssues(LIVE_BODY_4152)).not.toContain(4129);
	});

	it('code fence 内の Closes は auto-close されないので拾わない', () => {
		const body = ['## 関連 Issue', '', '```', 'Closes #999', '```', ''].join('\n');
		expect(extractLandedClosingIssues(body)).toEqual([]);
	});
});

describe('#4170 AC2 — 下書きと実 body の照合', () => {
	it('一致していれば違反なし', () => {
		expect(checkClosesLanded(LIVE_BODY_4152, LIVE_BODY_4152)).toBeNull();
	});

	it('下書きにあり実 body に無い close 宣言を落とす (#4152 の事故形そのもの)', () => {
		const draft = LIVE_BODY_4152.replace('Closes #4130', 'Closes #4129\nCloses #4130');
		const violation = checkClosesLanded(draft, LIVE_BODY_4152);
		expect(violation).not.toBeNull();
		expect(violation?.id).toBe('closes-not-landed');
		expect(violation?.message).toContain('下書きにあるが実 body に無い: Closes #4129');
	});

	it('実 body にあり下書きに無い close 宣言も落とす (撤回したつもりの over-close)', () => {
		const draft = LIVE_BODY_4152.replace('Closes #4150\n', '');
		const violation = checkClosesLanded(draft, LIVE_BODY_4152);
		expect(violation).not.toBeNull();
		expect(violation?.message).toContain('実 body にあるが下書きに無い: Closes #4150');
	});

	it('撤回経緯の言及を下書き側に増やしても違反にならない (grep 由来の偽陽性を作らない)', () => {
		const draft = `${LIVE_BODY_4152}\n\n再掲: 当初 \`Closes #4129\` を足す予定だったが撤回した。`;
		expect(checkClosesLanded(draft, LIVE_BODY_4152)).toBeNull();
	});
});

describe('#4170 AC2 — CLI 専用モード (runClosesLandedMode)', () => {
	it('一致していれば exit 0', () => {
		const dir = makeTempDir();
		const draftPath = join(dir, 'draft.md');
		writeFileSync(draftPath, LIVE_BODY_4152, 'utf8');
		const code = runClosesLandedMode(
			{ pr: '4152', verifyClosesLanded: draftPath },
			() => LIVE_BODY_4152,
		);
		expect(code).toBe(0);
	});

	it('着地していない close 宣言があれば exit 1', () => {
		const dir = makeTempDir();
		const draftPath = join(dir, 'draft.md');
		writeFileSync(
			draftPath,
			LIVE_BODY_4152.replace('Closes #4130', 'Closes #4129\nCloses #4130'),
			'utf8',
		);
		const code = runClosesLandedMode(
			{ pr: '4152', verifyClosesLanded: draftPath },
			() => LIVE_BODY_4152,
		);
		expect(code).toBe(1);
	});

	it('--pr が無ければ exit 2 (実 body と比較できないので pass 側に倒さない)', () => {
		const dir = makeTempDir();
		const draftPath = join(dir, 'draft.md');
		writeFileSync(draftPath, LIVE_BODY_4152, 'utf8');
		expect(runClosesLandedMode({ pr: null, verifyClosesLanded: draftPath }, () => '')).toBe(2);
	});

	it('下書きファイルが無ければ exit 2', () => {
		const dir = makeTempDir();
		expect(
			runClosesLandedMode({ pr: '4152', verifyClosesLanded: join(dir, 'absent.md') }, () => ''),
		).toBe(2);
	});

	it('実 body を取得できなければ exit 2 (取得失敗を「違反なし」にしない)', () => {
		const dir = makeTempDir();
		const draftPath = join(dir, 'draft.md');
		writeFileSync(draftPath, LIVE_BODY_4152, 'utf8');
		const code = runClosesLandedMode({ pr: '4152', verifyClosesLanded: draftPath }, () => {
			throw new Error('gh auth failed');
		});
		expect(code).toBe(2);
	});
});
