// src/lib/features/parent-gate/pin-verify-error.ts
// `POST /api/v1/parent-gate/verify` の失敗 body → 顧客向け文言 の対応表 (SSOT)。
//
// なぜ独立した file にするか (#4866 系 / PO 決裁 2026-09-10 決定 4):
// PIN を入力する面が `/switch` の modal だけでなく、admin の再入力ダイアログにも増えた。
// 対応表を 2 箇所に写すと、`LOCKED_OUT` の解除時刻の出し方のような**顧客が次に何をすれば
// いいか**を決める文言が面ごとにずれる。ここを唯一の SSOT にする
// (docs/DESIGN.md §6 / ADR-0045 の「同じ概念を複数箇所に書かない」と同じ話)。

import { OYAKAGI_LABELS } from '$lib/domain/labels';

/** verify API が失敗時に返す body の読み取る部分。 */
export interface PinVerifyErrorBody {
	error?: string;
	lockedUntil?: string;
}

export interface PinVerifyErrorDisplay {
	/** 画面に出す文言 */
	message: string;
	/** lockout 解除時刻 (unix ms)。lockout でない / parse 不能なら null */
	lockedUntilMs: number | null;
}

/**
 * 失敗 body を「出す文言」と「lockout 解除時刻」に解決する。
 *
 * `LOCKED_OUT` で解除の**絶対時刻**を出すのは #2991 の判断:「いつ再試行できるか」を
 * 示さないと、保護者は無反応と区別できず何度も叩く。時刻が parse 不能なときだけ
 * 時刻なしの文言に落とす。
 */
export function resolvePinVerifyError(body: PinVerifyErrorBody): PinVerifyErrorDisplay {
	if (body.error === 'LOCKED_OUT' && body.lockedUntil) {
		const unlockTime = new Date(body.lockedUntil);
		if (Number.isNaN(unlockTime.getTime())) {
			return { message: OYAKAGI_LABELS.lockedError, lockedUntilMs: null };
		}
		return {
			message: OYAKAGI_LABELS.gateLockedUntilNotice(
				unlockTime.toLocaleTimeString('ja-JP', {
					timeZone: 'Asia/Tokyo',
					hour: '2-digit',
					minute: '2-digit',
				}),
			),
			lockedUntilMs: unlockTime.getTime(),
		};
	}
	if (body.error === 'PIN_FORMAT') {
		return { message: OYAKAGI_LABELS.gateFormatNotice, lockedUntilMs: null };
	}
	if (body.error === 'INVALID_PIN' || body.error === 'PIN_NOT_SET') {
		return { message: OYAKAGI_LABELS.invalidError, lockedUntilMs: null };
	}
	return { message: OYAKAGI_LABELS.gateGenericError, lockedUntilMs: null };
}
