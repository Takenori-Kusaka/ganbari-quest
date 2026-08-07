// tests/unit/domain/receipt-ai-unavailable-message.test.ts
// 領収書 AI 読み取りが使えないときの顧客向け文言と、運営への通知方針の整合 (PO 決裁 2026-08-07)。
//
// この文言は「顧客が何をすればよいか」だけでなく「**運営に何が起きているか**」も語る。
// 後者は実装の事実を超えて書くと顧客に嘘をつくことになるため、文言と通知方針を 1 本の
// test で縛る (ADR-0013 の「実装していないことを実装しているように書かない」を
// 顧客向けエラー文言にも適用する、PO 決裁 Q1)。

import { describe, expect, it } from 'vitest';
import { ALARM_NOTIFY_POLICY } from '../../../infra/lib/ops-alert-policy';
import { POINTS_LABELS } from '../../../src/lib/domain/labels';

/** AI 不達を運営に届ける alarm。文言が「通知済み」と言えるかはこの alarm の通知方針で決まる。 */
const AI_ALARM_NAME = 'ganbari-quest-ai-provider-unavailable';

/** 通知方針を引く。表から消えていたら (= 判断の根拠自体が消えたら) その場で落とす。 */
function aiAlarmPolicy() {
	const policy = ALARM_NOTIFY_POLICY[AI_ALARM_NAME];
	if (!policy) throw new Error(`${AI_ALARM_NAME} が ALARM_NOTIFY_POLICY から消えています`);
	return policy;
}

const MESSAGE =
	'システム側の問題でAI読み取りを利用できません。復旧までは金額を手入力してください。';

describe('[1] 顧客向け文言 (POINTS_LABELS.receiptAiUnavailable)', () => {
	it('[1-1] PO 決裁 2026-08-07 で採用された文言と完全一致する', () => {
		expect(POINTS_LABELS.receiptAiUnavailable).toBe(MESSAGE);
	});

	// PO 決裁の主眼は長さではなく「検証できない 1 点を落とす」こと。ただし O2 (長すぎて
	// 読み飛ばされる) の再燃を防ぐため、実測長を上限として固定する。
	// 実測 42 字 (`[...MESSAGE].length`)。PR 本文 / PO コメントの「44 字 → 38 字」は
	// 変更前 54 字を 44 字と数え違えたところから派生した概算値で、実測とは一致しない。
	it('[1-2] 42 字以内に収まる (変更前の 54 字から短縮されている)', () => {
		expect([...POINTS_LABELS.receiptAiUnavailable].length).toBeLessThanOrEqual(42);
	});

	// 落としてよいのは「検証できない 1 点」だけ。顧客の行動に効く 2 点は残す。
	it('[1-3] 顧客のせいではないこと / いま何ができるかを両方伝える', () => {
		expect(POINTS_LABELS.receiptAiUnavailable).toContain('システム側の問題');
		expect(POINTS_LABELS.receiptAiUnavailable).toContain('手入力');
	});

	// 画像が読めなかったとき (`receiptOcrFailed` = 撮り直しを促す) と混ぜると、顧客は
	// 自分の写真が悪いと誤解して撮り直しを繰り返す (#4366)。
	it('[1-4] 撮り直しを促さない (画像起因の失敗と言い分ける)', () => {
		expect(POINTS_LABELS.receiptAiUnavailable).not.toContain('撮り直');
		expect(POINTS_LABELS.receiptOcrFailed).toContain('撮り直');
	});
});

describe('[2] 文言と通知方針の整合 (PO 決裁 Q1 = No / Q2 = Yes)', () => {
	it('[2-1] AI 不達 alarm が通知方針表に宣言されている', () => {
		expect(ALARM_NOTIFY_POLICY[AI_ALARM_NAME]).toBeDefined();
	});

	// Q2 = Yes: #4189 の既定 (実発火を 1 サイクル観測してから昇格) をこの 1 件のために曲げない。
	it('[2-2] 現時点では Discord へ通知しない (notify: false)', () => {
		expect(aiAlarmPolicy().notify).toBe(false);
	});

	// Q1 = No の本体。notify: false = 人には届かないので、顧客に「通知済み」と読める約束を
	// してはならない。昇格 (notify: true) したときに初めてこの一文を戻す判断ができる。
	it('[2-3] 人に届かない間は「運営に通知した」と読める約束をしない', () => {
		if (aiAlarmPolicy().notify) return; // 昇格後は文言を戻してよい

		for (const promise of ['通知', '連絡', '把握']) {
			expect(
				POINTS_LABELS.receiptAiUnavailable,
				`notify: false のあいだ「${promise}」を顧客に約束すると、実装の事実 (CloudWatch に記録が残るだけで人には届かない) とズレます`,
			).not.toContain(promise);
		}
	});

	// 通知方針の reason 自体も顧客文言を根拠にしてはならない (Q1 で外した以上、循環した嘘になる)。
	it('[2-4] 通知方針の理由が「顧客に通知済みと表示している」を根拠にしていない', () => {
		expect(aiAlarmPolicy().reason).not.toContain('通知済み');
	});
});
