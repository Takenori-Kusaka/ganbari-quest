// #3970 AC2 — 「off-site に置いたつもりが NUC 内だった」の検出。
//
// 本 test が守る不変条件は「**取得の成否と off-site の成否を混同しない**」こと。
// #3950 の事故は「成功と記録されているのに中身が実データでない」だった。同型が一段上で
// 起きるのが「取得は成功しているのに控えが NUC 内にしか無い」であり、両者を分けて
// 判定できることを固定する。

import { describe, expect, it } from 'vitest';
import {
	describeOffsiteVerdict,
	judgeOffsiteReplication,
	type OffsiteProbe,
} from '$lib/domain/backup-offsite';

const probe = (over: Partial<OffsiteProbe> = {}): OffsiteProbe => ({
	expected: true,
	backupDeviceId: 2049,
	liveDataDeviceId: 2049,
	...over,
});

describe('#3970 judgeOffsiteReplication', () => {
	it('[OS1] off-site を期待していない家庭は判定対象外 — 警告しない', () => {
		// ローカル 1 箇所を受容する選択 (#3970「受容する場合」) まで警告すると、
		// 警告が常態化して読まれなくなる。
		expect(judgeOffsiteReplication(probe({ expected: false }))).toEqual({
			level: 'not-expected',
		});
	});

	it('[OS2] 保存先が稼働中 DB と別デバイスなら ok', () => {
		expect(judgeOffsiteReplication(probe({ backupDeviceId: 64_768 }))).toEqual({ level: 'ok' });
	});

	it('[OS3] off-site のはずが同一デバイス上なら critical — マウント fallback の無音失敗', () => {
		// NAS が落ちている状態で compose を上げると Docker がローカルに空ディレクトリを作り、
		// 書き込みが成功してしまう。path 文字列は NAS のままなので見た目では気づけない。
		expect(
			judgeOffsiteReplication(probe({ backupDeviceId: 2049, liveDataDeviceId: 2049 })),
		).toEqual({ level: 'critical', reason: 'same-filesystem-as-live-data' });
	});

	it('[OS4] device を読めないときは ok にせず unknown を返す', () => {
		// 判定不能を「問題なし」に丸めない。丸めると #3950 と同じ「無音で無保護」に戻る。
		expect(judgeOffsiteReplication(probe({ backupDeviceId: null }))).toEqual({
			level: 'unknown',
			reason: 'device-unreadable',
		});
		expect(judgeOffsiteReplication(probe({ liveDataDeviceId: null }))).toEqual({
			level: 'unknown',
			reason: 'device-unreadable',
		});
	});

	it('[OS5] 対象外 / 期待どおりのときだけ伝える文言が無い', () => {
		expect(describeOffsiteVerdict({ level: 'not-expected' })).toBeNull();
		expect(describeOffsiteVerdict({ level: 'ok' })).toBeNull();
	});

	it('[OS6] critical / unknown の文言は「取得自体は成功している」ことを明示する', () => {
		// これを書かないと運用者が「バックアップが失敗した」と誤読し、取れている控えを
		// 無いものとして扱ってしまう。伝えるべきは「取れたが置き場が想定と違う」。
		const critical = describeOffsiteVerdict({
			level: 'critical',
			reason: 'same-filesystem-as-live-data',
		});
		expect(critical).toContain('取得自体は成功');
		expect(critical).toContain('HOST_BACKUP_DIR');

		const unknown = describeOffsiteVerdict({ level: 'unknown', reason: 'device-unreadable' });
		expect(unknown).toContain('取得自体は成功');
	});
});
