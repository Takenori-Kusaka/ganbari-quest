// tests/unit/domain/oyakagi-lockout-labels.test.ts
// #2991: おやカギコード ロック時に解除予定時刻を明示する文言の SSOT 検証。
//
// 背景: 旧 lockedError は「しばらく待ってから」で解除時刻が無く、ユーザは「いつ再試行できるか」
// 分からず不安 → サポート連絡を強いられていた (NN/g heuristic #1 violation)。
// #2991 で gateLockedUntilNotice(timeStr) を導入し、解除予定の絶対時刻を提示する
// (NIST SP 800-63B / iOS Security Lockout は残り時間明示、秒カウントダウンは temporal vigilance で
//  不安増大のため絶対時刻型を採用 — tmp/research/pin-gate-ux-ideal-state.md Q2)。

import { describe, expect, it } from 'vitest';
import { OYAKAGI_LABELS } from '$lib/domain/labels';
import { OYAKAGI_TERMS } from '$lib/domain/terms';

describe('#2991 OYAKAGI_LABELS.gateLockedUntilNotice (ロック解除時刻の明示)', () => {
	it('解除予定の時刻文字列を文言に埋め込む', () => {
		const msg = OYAKAGI_LABELS.gateLockedUntilNotice('20:45');
		expect(msg).toContain('20:45');
	});

	it('「いつ再試行できるか」を示す (時刻 + 待機を促す表現を含む)', () => {
		const msg = OYAKAGI_LABELS.gateLockedUntilNotice('07:03');
		// 解除時刻 + 「まで」+ 「待って」で「その時刻まで待てば再試行できる」ことを伝える
		expect(msg).toContain('07:03');
		expect(msg).toContain('まで');
		expect(msg).toContain('待って');
	});

	it('おやカギコード用語を atom (OYAKAGI_TERMS.name) 経由で参照している (ADR-0045 SSOT)', () => {
		const msg = OYAKAGI_LABELS.gateLockedUntilNotice('00:00');
		expect(msg).toContain(OYAKAGI_TERMS.name);
	});

	it('時刻なしの旧 lockedError から脱却している (gateLockedUntilNotice は「しばらく」を含まない)', () => {
		const msg = OYAKAGI_LABELS.gateLockedUntilNotice('23:59');
		// 旧文言の曖昧表現「しばらく」を含まないこと (時刻提示への置換を保証)
		expect(msg).not.toContain('しばらく');
	});

	it('任意の HH:MM をそのまま埋め込む (整形は呼び出し側責務、文言側は時刻を改変しない)', () => {
		for (const t of ['00:00', '09:05', '13:30', '23:59']) {
			expect(OYAKAGI_LABELS.gateLockedUntilNotice(t)).toContain(t);
		}
	});
});
