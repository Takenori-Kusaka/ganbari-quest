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
	shouldNotifyOffsite,
} from '$lib/domain/backup-offsite';

const probe = (over: Partial<OffsiteProbe> = {}): OffsiteProbe => ({
	expected: true,
	marker: 'NAS 1F 書斎',
	...over,
});

describe('#3970 judgeOffsiteReplication', () => {
	it('[OS1] off-site を期待していない家庭は判定対象外 — 警告しない', () => {
		// ローカル 1 箇所を受容する選択 (#3970「受容する場合」) まで警告すると、
		// 警告が常態化して読まれなくなる。
		expect(judgeOffsiteReplication(probe({ expected: false }))).toEqual({ level: 'not-expected' });
	});

	it('[OS2] 目印が読めれば ok', () => {
		expect(judgeOffsiteReplication(probe())).toEqual({ level: 'ok' });
	});

	it('[OS3] 目印が無ければ critical — マウント fallback の無音失敗', () => {
		// NAS が落ちている状態で compose を上げると Docker がローカルに空ディレクトリを作り、
		// 書き込みが成功してしまう。空ディレクトリには目印が無いので検出できる。
		expect(judgeOffsiteReplication(probe({ marker: null }))).toEqual({
			level: 'critical',
			reason: 'marker-missing',
		});
	});

	it('[OS4] 目印を読めないときは ok にせず unknown を返す', () => {
		// 判定不能を「問題なし」に丸めない。丸めると #3950 と同じ「無音で無保護」に戻る。
		expect(judgeOffsiteReplication(probe({ marker: 'unreadable' }))).toEqual({
			level: 'unknown',
			reason: 'marker-unreadable',
		});
	});

	it('[OS5] 目印が空ファイルでも ok — 中身ではなく「見えているか」を見ている', () => {
		// 中身に意味を持たせると、運用者が何を書くべきか迷う。存在自体が信号。
		expect(judgeOffsiteReplication(probe({ marker: '' }))).toEqual({ level: 'ok' });
	});
});

describe('#3970 describeOffsiteVerdict — 受け手は非エンジニアの家族', () => {
	it('[OS6] 対象外 / 期待どおりのときは伝える文言が無い', () => {
		expect(describeOffsiteVerdict({ level: 'not-expected' })).toBeNull();
		expect(describeOffsiteVerdict({ level: 'ok' })).toBeNull();
	});

	it('[OS7] critical / unknown は「バックアップ自体は取れている」ことを明示する', () => {
		// これを書かないと運用者が「バックアップが失敗した」と誤読し、取れている控えを
		// 無いものとして扱ってしまう。伝えるべきは「取れたが置き場に届いていない」。
		for (const v of [
			{ level: 'critical', reason: 'marker-missing' },
			{ level: 'unknown', reason: 'marker-unreadable' },
		] as const) {
			expect(describeOffsiteVerdict(v)).toContain('取れて');
		}
	});

	it('[OS8] 文面に開発者語彙 (env 名 / パス / 内部用語) を出さない', () => {
		// 受け手は非エンジニアの親。変数名やファイルパスを見せても取れる行動が無い。
		const forbidden = [
			'HOST_BACKUP_DIR',
			'BACKUP_DIR',
			'docs/',
			'.md',
			'ファイルシステム',
			'デバイス',
			'マウント',
		];
		for (const v of [
			{ level: 'critical', reason: 'marker-missing' },
			{ level: 'unknown', reason: 'marker-unreadable' },
		] as const) {
			const text = describeOffsiteVerdict(v) ?? '';
			for (const word of forbidden) {
				expect(text).not.toContain(word);
			}
		}
	});

	it('[OS9] critical では取るべき行動が書かれている', () => {
		const text = describeOffsiteVerdict({ level: 'critical', reason: 'marker-missing' }) ?? '';
		expect(text).toContain('確認');
		expect(text).toContain('再起動');
	});
});

describe('#3970 shouldNotifyOffsite — 毎晩同じ警告を投げない', () => {
	it('[OS10] 状態が変わったときだけ通知する', () => {
		// 同じ警告が毎晩届くと数日で無視され、同じ通知先を共有している本物の失敗 alert
		// (#4129 / #4087) まで一緒に見られなくなる。
		const critical = { level: 'critical', reason: 'marker-missing' } as const;
		expect(shouldNotifyOffsite(critical, null)).toBe(true);
		expect(shouldNotifyOffsite(critical, 'ok')).toBe(true);
		expect(shouldNotifyOffsite(critical, 'critical')).toBe(false);
	});

	it('[OS11] 正常 / 対象外では通知しない', () => {
		expect(shouldNotifyOffsite({ level: 'ok' }, 'critical')).toBe(false);
		expect(shouldNotifyOffsite({ level: 'not-expected' }, 'critical')).toBe(false);
	});

	it('[OS12] critical → unknown のように別の異常へ変わったら通知する', () => {
		// 「異常なのは同じだから黙る」にすると、原因が変わったことを見逃す。
		expect(shouldNotifyOffsite({ level: 'unknown', reason: 'marker-unreadable' }, 'critical')).toBe(
			true,
		);
	});
});
