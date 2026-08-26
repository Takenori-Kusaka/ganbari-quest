// tests/unit/architecture/invite-accept-error-guard-wired.test.ts
//
// #4638 / #4636 (fitness function): 招待受諾拒否の理由を扱う唯一の消費地点が、SSOT の理由一覧を
// **実際に通している**ことを固定する (SSOT を作ったのに配線しない = 到達不能な判定関数を作らない、
// #4623 / #4624 で削除中の class と同型)。
//
// #4636 で理由の伝達手段が 1 回限りの通知 cookie (admin +layout.server.ts で読取) から
// `/auth/join` 画面へ移った (cookie は TTL 切れで理由が永久に失われ、one-shot なのでリロードで
// 二度と出ない、という構造を廃止した)。したがって本 guard の対象も join 画面に移る。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	getInviteJoinBlockedMessage,
	INVITE_JOIN_BLOCKED_MESSAGES,
} from '../../../src/lib/domain/labels';
import {
	INVITE_ACCEPT_ERROR_REASONS,
	isInviteAcceptErrorReason,
} from '../../../src/lib/domain/validation/auth';

const REPO_ROOT = join(__dirname, '../../..');
const JOIN_PAGE_SERVER = join(REPO_ROOT, 'src/routes/auth/join/+page.server.ts');
const ADMIN_LAYOUT_SERVER = join(REPO_ROOT, 'src/routes/(parent)/admin/+layout.server.ts');

describe('#4636 招待受諾拒否理由の配線', () => {
	it('/auth/join が理由 → 文言の SSOT (getInviteJoinBlockedMessage) を通している', () => {
		const source = readFileSync(JOIN_PAGE_SERVER, 'utf8');

		expect(
			source.includes('getInviteJoinBlockedMessage'),
			'/auth/join が getInviteJoinBlockedMessage を参照していない。理由 → 文言の SSOT を' +
				'経由しないと、画面ごとに文言が分岐して未知の理由が無説明になる (#4636)',
		).toBe(true);

		// 理由は招待 cookie から **その都度再導出** する (1 回限りの通知 cookie に戻さない)
		expect(
			source.includes('previewInviteAcceptance'),
			'/auth/join が previewInviteAcceptance で理由を再導出していない。' +
				'理由が cookie の寿命に依存する構造に戻ると、リロード / 再訪で理由が消える (#4636)',
		).toBe(true);
	});

	it('admin layout に受諾拒否の通知 cookie 経路が残っていない (理由の SSOT を 2 つにしない)', () => {
		const source = readFileSync(ADMIN_LAYOUT_SERVER, 'utf8');

		expect(
			source.includes('INVITE_ACCEPT_ERROR_COOKIE_NAME'),
			'admin +layout.server.ts に旧通知 cookie の読取が残っている。' +
				'/auth/join と併存すると理由の SSOT が 2 つになる (#4636 AC8)',
		).toBe(false);
	});

	it('理由 SSOT の全値に文言があり、未知の値は汎用文言に落ちる', () => {
		for (const reason of INVITE_ACCEPT_ERROR_REASONS) {
			expect(isInviteAcceptErrorReason(reason)).toBe(true);
			expect(INVITE_JOIN_BLOCKED_MESSAGES[reason]).toBeTruthy();
			expect(getInviteJoinBlockedMessage(reason)).toBe(INVITE_JOIN_BLOCKED_MESSAGES[reason]);
		}
		expect(isInviteAcceptErrorReason('SOMETHING_NEW')).toBe(false);
		expect(isInviteAcceptErrorReason(undefined)).toBe(false);
		expect(getInviteJoinBlockedMessage('SOMETHING_NEW')).toBeTruthy();
	});
});
