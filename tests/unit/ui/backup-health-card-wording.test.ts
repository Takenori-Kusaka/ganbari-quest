// #4162 — 「取れているのに『取れていません』と出る」を機械で閉じる。
//
// ## 同 class の 3 回
//
// | 回 | どこで | 形 |
// |---|---|---|
// | 1 | #4144 × #4148 の合成 | guard 発火中に health が `stale-critical` (=「job が動いていない」) と診断 |
// | 2 | #4153 の断定形文言 | guard trip 時に「バックアップが取れていません」が嘘になる (QM 申し送り) |
// | 3 | #4173 (本 PR) | 判定に `rotation-blocked-critical` を足したが**表示側を触らず**、7 日目に
// |   |   | 見出し「バックアップが取れていません」+ 本文「相談してください」に落ちた |
//
// 3 回とも **判定は正しく、表示だけが実態と食い違う**。判定側の test はすべて通るので、
// 判定を直すたびに表示が置き去りになる。**表示を判定 reason に紐づけて固定する**しかない。
//
// ## 何を固定するか
//
// 「取れている」状態で断定形の否定文言を出さないこと。reason が増えたときに
// 「どの見出しを出すか」を決め忘れたら落ちる。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BackupHealthReason } from '$lib/domain/backup-health';
import { SETTINGS_LABELS } from '$lib/domain/labels';

const CARD = readFileSync(
	join(process.cwd(), 'src', 'lib', 'features', 'admin', 'components', 'BackupHealthCard.svelte'),
	'utf-8',
);

/**
 * **取得が成功している** reason。ここに該当する状態で「取れていません」と出してはいけない。
 *
 * 新しい reason を足したときにこの表を更新し忘れると [BC3] が落ちる。
 */
const ACQUISITION_SUCCEEDED: BackupHealthReason[] = [
	'rotation-blocked',
	'rotation-blocked-critical',
];

describe('#4162 バックアップ状態カードの文言が実態と食い違わない', () => {
	it('[BC1] 取得が成功している状態には専用の見出し / 本文がある', () => {
		// level だけで見出しを決めると critical = 「取れていません」に落ちる。
		// reason を見て分岐していることを固定する。
		for (const reason of ACQUISITION_SUCCEEDED) {
			expect(CARD, `reason='${reason}' の分岐がカードにありません`).toContain(reason);
		}
	});

	it('[BC2] 昇格後も「相談してください」に落ちない (完全一致の取りこぼし)', () => {
		// #4173 の実際の欠陥。'rotation-blocked' の完全一致だけだと
		// 'rotation-blocked-critical' が汎用 hint に落ちる。
		expect(CARD).toContain('backupRotationBlockedCriticalHint');
		expect(CARD).toContain('backupRotationBlockedCriticalTitle');
	});

	it('[BC3] 取得が成功している状態の文言が「取れていません」と断定しない', () => {
		// 文言そのものを検査する。ここが本 class の核心 —
		// 実態 (毎晩取れており世代は増えている) と画面が逆になることを禁じる。
		const forbidden = SETTINGS_LABELS.backupCriticalTitle; // 'バックアップが取れていません'
		for (const label of [
			SETTINGS_LABELS.backupRotationBlockedCriticalTitle,
			SETTINGS_LABELS.backupRotationBlockedHint,
			SETTINGS_LABELS.backupRotationBlockedCriticalHint,
		]) {
			expect(label, `"${label}" が断定形の否定文言と一致しています`).not.toBe(forbidden);
			expect(label, `"${label}" に「取れていません」が含まれています`).not.toContain(
				'取れていません',
			);
		}
	});

	it('[BC4] 取得が成功している状態の文言が「取れている」ことを明示する', () => {
		// 否定形を避けるだけだと、無言で曖昧になる。**取れている事実**を伝えることまで固定する。
		for (const label of [
			SETTINGS_LABELS.backupRotationBlockedHint,
			SETTINGS_LABELS.backupRotationBlockedCriticalHint,
		]) {
			expect(label).toContain('取れています');
		}
	});

	it('[BC5] 昇格後の文言は放置の危険を伝える (warn と同文にしない)', () => {
		// 昇格の意味は「同じ状態が続いている」ではなく「**このままだと本当に失敗する**」。
		// warn と同文なら昇格が表示上は無意味になる。
		expect(SETTINGS_LABELS.backupRotationBlockedCriticalHint).not.toBe(
			SETTINGS_LABELS.backupRotationBlockedHint,
		);
		expect(SETTINGS_LABELS.backupRotationBlockedCriticalHint).toContain('取れなくなります');
	});
});
