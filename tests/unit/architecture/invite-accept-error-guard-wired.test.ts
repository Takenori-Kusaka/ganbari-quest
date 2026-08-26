// tests/unit/architecture/invite-accept-error-guard-wired.test.ts
//
// #4638 (fitness function): 招待受諾拒否の通知 cookie を読む唯一の消費地点が、
// SSOT の型ガード `isInviteAcceptErrorReason` を **実際に通している**ことを固定する。
//
// #4633 で SSOT (INVITE_ACCEPT_ERROR_REASONS) と型ガードを新設したが、消費側
// (`admin/+layout.server.ts`) は生の cookie 文字列をそのまま client へ渡しており、
// ガードは export されているだけで src からの参照が 0 件だった (= 到達不能な判定関数)。
// これはリポジトリが #4623 / #4624 で削除中の class と同型であり、
// 「SSOT を作ったのに配線しない」を機械検出する。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	INVITE_ACCEPT_ERROR_REASONS,
	isInviteAcceptErrorReason,
} from '../../../src/lib/domain/validation/auth';

const REPO_ROOT = join(__dirname, '../../..');
const LAYOUT_SERVER = join(REPO_ROOT, 'src/routes/(parent)/admin/+layout.server.ts');

describe('#4638 招待受諾拒否 cookie の型ガード配線', () => {
	it('admin +layout.server.ts が isInviteAcceptErrorReason を通している (到達不能な判定関数を作らない)', () => {
		const source = readFileSync(LAYOUT_SERVER, 'utf8');

		// import されている
		expect(
			source.includes('isInviteAcceptErrorReason'),
			'admin/+layout.server.ts が isInviteAcceptErrorReason を参照していない。' +
				'SSOT の型ガードを新設したまま消費側で配線しないと、未検証の cookie 値が SSR ペイロードに素通しになる (#4638)',
		).toBe(true);

		// cookie を読んだ結果をガードに通している (読むだけで捨てていない)
		expect(
			/isInviteAcceptErrorReason\(\s*rawInviteAcceptError\s*\)/.test(source),
			'cookie 値 (rawInviteAcceptError) が isInviteAcceptErrorReason に渡されていない',
		).toBe(true);
	});

	it('型ガードが SSOT の全理由を受理し、未知の値を拒否する', () => {
		for (const reason of INVITE_ACCEPT_ERROR_REASONS) {
			expect(isInviteAcceptErrorReason(reason), `${reason} が拒否された`).toBe(true);
		}
		expect(isInviteAcceptErrorReason('UNKNOWN')).toBe(false);
		expect(isInviteAcceptErrorReason('')).toBe(false);
		expect(isInviteAcceptErrorReason(undefined)).toBe(false);
	});
});
