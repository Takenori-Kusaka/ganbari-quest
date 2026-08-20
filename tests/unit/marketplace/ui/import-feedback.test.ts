/**
 * resolveImportFeedback unit test — Issue #2955 (#2830 / #2935 follow-up)
 *
 * marketplace 取込 result の message / tone 出し分け (partial-failure 含む) の精度規約を回帰固定する。
 * 特に「failed が SSOT であり errors.length への fallback を行わない」判断 (#2955 項目 2) を
 * 仕様としてテストで明文化する。
 */

import { describe, expect, it } from 'vitest';
import { MARKETPLACE_IMPORT_FEEDBACK_LABELS } from '$lib/domain/labels';
import { resolveImportFeedback } from '$lib/marketplace/ui/import-feedback';

const labels = {
	success: (n: number) => `success:${n}`,
	allDuplicates: 'all-duplicates',
};

describe('resolveImportFeedback (#2955)', () => {
	it('failed > 0 で partial-failure (error tone) を返す — imported > 0 でも成功と偽らない (#2824)', () => {
		const fb = resolveImportFeedback({ imported: 3, failed: 2, errors: ['x'] }, labels);
		expect(fb.tone).toBe('error');
		expect(fb.message).toBe(MARKETPLACE_IMPORT_FEEDBACK_LABELS.partialFailure(3, 2));
		expect(fb.message).toContain('3 件を追加しましたが');
		expect(fb.message).toContain('2 件は保存できませんでした');
	});

	it('imported = 0 かつ failed > 0 は全件保存失敗の文言 (error tone)', () => {
		const fb = resolveImportFeedback({ imported: 0, failed: 5 }, labels);
		expect(fb.tone).toBe('error');
		expect(fb.message).toBe(MARKETPLACE_IMPORT_FEEDBACK_LABELS.partialFailure(0, 5));
	});

	it('failed = 0 かつ imported > 0 で success', () => {
		const fb = resolveImportFeedback({ imported: 4, failed: 0, errors: [] }, labels);
		expect(fb).toEqual({ message: 'success:4', tone: 'success', upgradeUrl: null });
	});

	it('failed = 0 かつ imported = 0 (純粋な全件重複) で allDuplicates (info)', () => {
		const fb = resolveImportFeedback({ imported: 0, skipped: 8, failed: 0 }, labels);
		expect(fb).toEqual({ message: 'all-duplicates', tone: 'info', upgradeUrl: null });
	});

	it('errors.length への fallback は行わない — failed 欠落時は errors があっても失敗扱いしない (#2955 項目 2 判断記録)', () => {
		// rule-preset は warnings (already-imported 等の非失敗) を errors に merge して返すため、
		// errors.length を失敗数として読むと warnings が失敗件数に誤算入される。
		// failed (required 化済) のみを SSOT とし、欠落 (契約違反の異常系) は 0 縮退とする。
		const fb = resolveImportFeedback(
			{ imported: 2, errors: ['warning: already imported'] },
			labels,
		);
		expect(fb).toEqual({ message: 'success:2', tone: 'success', upgradeUrl: null });
	});

	it('data undefined / 不正値 (負数・非数) は 0 縮退で allDuplicates に落ちる', () => {
		expect(resolveImportFeedback(undefined, labels).tone).toBe('info');
		expect(resolveImportFeedback({ imported: -1, failed: '2' }, labels).tone).toBe('info');
	});

	it('page 固有の partialFailure override が優先される', () => {
		const fb = resolveImportFeedback(
			{ imported: 1, failed: 1 },
			{ ...labels, partialFailure: (i: number, f: number) => `custom:${i}/${f}` },
		);
		expect(fb).toEqual({ message: 'custom:1/1', tone: 'error', upgradeUrl: null });
	});
});

/**
 * #4693 (adversarial D2 / D3): 「プラン上限で入れなかった」を成功トーンで消さない。
 *
 * 取込サービスは上限超過分を書き込み計画から外すが、その理由は長らく `errors` 配列
 * (= UI ログ用) にしか載っておらず、画面はそれを読んでいなかった。結果:
 *   - ファイル復元で 119 件全部が上限で弾かれても「0 件を復元しました」と成功トーン
 *     (AC1 の upsell 導線がユーザーに一度も見えない)
 *   - チェックリスト取込で上限の子を外しても、その子の名前が親の画面に出ない (AC4)
 */
const LIMIT_REASON = 'カスタム活動は最大3個まで作成できます。プランをアップグレードしてください。';

function blocked(count: number) {
	return { count, message: LIMIT_REASON, upgradeUrl: '/admin/subscription' };
}

describe('resolveImportFeedback の blocked 反映 (#4693)', () => {
	it('全件が上限で弾かれたとき「すでに追加済み」ではなく上限の理由を出す', () => {
		const fb = resolveImportFeedback(
			{ imported: 0, skipped: 0, failed: 0, blocked: blocked(119) },
			labels,
		);

		expect(fb.message).toContain(LIMIT_REASON);
		expect(fb.message).not.toContain('all-duplicates');
		expect(fb.tone).toBe('error');
	});

	it('上限が理由のときはアップグレード導線 URL を渡す (AC1 upsell)', () => {
		const fb = resolveImportFeedback({ imported: 0, failed: 0, blocked: blocked(119) }, labels);

		expect(fb.upgradeUrl).toBe('/admin/subscription');
	});

	it('一部だけ入ったときは「入った件数」と「外した理由」を両方出す', () => {
		const fb = resolveImportFeedback({ imported: 1, failed: 0, blocked: blocked(4) }, labels);

		expect(fb.message).toContain('success:1');
		expect(fb.message).toContain(LIMIT_REASON);
		expect(fb.tone).toBe('error');
	});

	it('壊れた blocked (件数 0 / message 空) は成功表示を汚さない', () => {
		const fb = resolveImportFeedback(
			{ imported: 3, failed: 0, blocked: { count: 0, message: '', upgradeUrl: null } },
			labels,
		);

		expect(fb).toEqual({ message: 'success:3', tone: 'success', upgradeUrl: null });
	});
});
