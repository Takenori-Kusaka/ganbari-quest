/**
 * tests/unit/hooks/gate-approve-closes-landed.test.ts (#4170 AC2)
 *
 * approve 直前に走る Closes 着地確認の wiring を固定する。
 *
 * 監査チームの要望 (2026-08-01) は「手で叩くのを忘れるリスクがあるので approve 手順
 * (`gate-approve` の隣) に組み込めれば理想」。required CI にはしない (本文修正のたびに最重厚
 * レーンを回すと #4171 の CI 待ちが悪化する) ため、忘却リスクは本 wiring だけが担う。
 * 「宣言だけの guard」にしないため、着地していない状態で **block されること**を実測で pin する。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
	draftBodyPathForPr,
	verifyClosesLandedForApprove,
} from '../../../.claude/hooks/gate-approve.mjs';

const LIVE_BODY = ['## 関連 Issue', '', 'Closes #4130', 'Closes #4139', ''].join('\n');

const tempDirs: string[] = [];

function makeTree(): string {
	const dir = mkdtempSync(join(tmpdir(), 'gate-closes-'));
	tempDirs.push(dir);
	mkdirSync(join(dir, 'tmp', 'pr-bodies'), { recursive: true });
	return dir;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe('#4170 AC2 — approve 直前の Closes 着地確認', () => {
	it('下書きが無い PR は block しないが、未実施であることを必ず note に出す', async () => {
		const cwd = makeTree();
		const result = await verifyClosesLandedForApprove([4152], {
			cwd,
			fetchLiveBody: () => LIVE_BODY,
		});
		expect(result.ok).toBe(true);
		// 無言 skip にしない (skip したことは必ず出力する、ADR-0056 と同じ扱い)
		expect(result.ok && result.notes.join('\n')).toContain('未実施');
	});

	it('下書きの close 宣言が実 body に着地していれば通す', async () => {
		const cwd = makeTree();
		writeFileSync(draftBodyPathForPr(4152, cwd), LIVE_BODY, 'utf8');
		const result = await verifyClosesLandedForApprove([4152], {
			cwd,
			fetchLiveBody: () => LIVE_BODY,
		});
		expect(result.ok).toBe(true);
		expect(result.ok && result.notes.join('\n')).toContain('PASS');
	});

	it('下書きだけ編集して push していない状態を block する (#4152 の事故形)', async () => {
		const cwd = makeTree();
		writeFileSync(
			draftBodyPathForPr(4152, cwd),
			LIVE_BODY.replace('Closes #4130', 'Closes #4129\nCloses #4130'),
			'utf8',
		);
		const result = await verifyClosesLandedForApprove([4152], {
			cwd,
			fetchLiveBody: () => LIVE_BODY,
		});
		expect(result.ok).toBe(false);
		expect(!result.ok && result.reason).toContain('Closes #4129');
	});

	it('下書きがあるのに実 body を取得できない場合は block する (検証不能を pass に倒さない)', async () => {
		const cwd = makeTree();
		writeFileSync(draftBodyPathForPr(4152, cwd), LIVE_BODY, 'utf8');
		const result = await verifyClosesLandedForApprove([4152], {
			cwd,
			fetchLiveBody: () => {
				throw new Error('gh auth failed');
			},
		});
		expect(result.ok).toBe(false);
		expect(!result.ok && result.reason).toContain('取得できず');
	});

	it('複数 PR のうち 1 件でも着地していなければ block する', async () => {
		const cwd = makeTree();
		writeFileSync(draftBodyPathForPr(4152, cwd), LIVE_BODY, 'utf8');
		writeFileSync(draftBodyPathForPr(4160, cwd), `${LIVE_BODY}\nCloses #4171\n`, 'utf8');
		const result = await verifyClosesLandedForApprove([4152, 4160], {
			cwd,
			fetchLiveBody: () => LIVE_BODY,
		});
		expect(result.ok).toBe(false);
		expect(!result.ok && result.reason).toContain('#4160');
	});
});
