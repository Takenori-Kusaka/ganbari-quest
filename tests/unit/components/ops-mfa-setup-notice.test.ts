// tests/unit/components/ops-mfa-setup-notice.test.ts
// #4282 AC5: MFA 未設定の運営者に「拒否」ではなく設定導線を出す。
//
// 背景: #4266 で /ops を「ops group + MFA 済」に絞ったが、拒否側の画面は共通 403
// (「アクセスが きょか されていません」+「ログインし直す」) のままだった。TOTP 未設定の
// 運営者が「ログインし直す」を押しても同じ 403 に戻るだけで、画面から復旧できない。
//
// 本 component は「何が足りないか」「どう設定するか」「設定後に何をするか」を 1 画面で示す。
// 検証は「見出しがある」ではなく **復旧に必要な 3 要素が揃っているか** を assert する
// (要素が 1 つでも落ちれば運営者は詰まるため、render-only にしない / tests/CLAUDE.md)。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { OPS_MFA_SETUP_LABELS } from '../../../src/lib/domain/labels';
import OpsMfaSetupNotice from '../../../src/lib/features/ops/OpsMfaSetupNotice.svelte';

describe('#4282 OpsMfaSetupNotice — 締め出しではなく復旧導線', () => {
	afterEach(() => {
		cleanup();
	});

	it('何が足りないかを名指しする (「権限がありません」で終わらせない)', () => {
		render(OpsMfaSetupNotice);
		expect(screen.getByRole('heading', { name: OPS_MFA_SETUP_LABELS.title })).toBeTruthy();
		expect(screen.getByText(OPS_MFA_SETUP_LABELS.description)).toBeTruthy();
	});

	it('設定手順を画面上に全て出す (リンク先を読まないと分からない状態にしない)', () => {
		render(OpsMfaSetupNotice);
		const steps = screen.getAllByRole('listitem').map((el) => el.textContent ?? '');
		expect(OPS_MFA_SETUP_LABELS.steps.length).toBeGreaterThanOrEqual(3);
		for (const step of OPS_MFA_SETUP_LABELS.steps) {
			expect(steps.some((t) => t.includes(step))).toBe(true);
		}
	});

	it('設定後の出口 (再ログイン) を操作できる', () => {
		render(OpsMfaSetupNotice);
		const relogin = screen.getByRole('link', { name: OPS_MFA_SETUP_LABELS.reloginLabel });
		// 再ログインは Cognito の MFA チャレンジを経て amr を載せ直すための唯一の出口。
		// ここが /ops 自身を指していると 403 ループになる。
		expect(relogin.getAttribute('href')).toBe('/auth/login');
	});

	it('自力で設定できない場合の連絡先 (runbook 参照) を示す', () => {
		render(OpsMfaSetupNotice);
		expect(screen.getByText(OPS_MFA_SETUP_LABELS.runbookHint)).toBeTruthy();
	});
});
