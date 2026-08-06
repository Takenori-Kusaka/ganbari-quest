// tests/unit/services/deletion-warning-email.test.ts
// #2399: 削除予告メールの本文が「行動できる情報」を持つことを固定する。
//
// 守る不変条件:
//   [M1] 復元導線 (URL) と物理削除予定日が本文に含まれる (「あと N 日」だけでは行動できない)
//   [M2] 子供の名前・活動内容を差し込む口を持たない (runbook §2 中立トーン / ADR-0012)
//   [M3] List-Unsubscribe を付けない = SendRawEmailCommand ではなく SendEmailCommand で送る
//        (購読解除しても本通知は止まらない、を送信経路のレベルで固定する)
//   [M4] 煽り表現を含めない (Anti-engagement)

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn().mockResolvedValue({});
const sendRawCalls: unknown[] = [];
const sendEmailCalls: Array<Record<string, unknown>> = [];

vi.mock('@aws-sdk/client-ses', () => ({
	SESClient: class {
		send = mockSend;
	},
	SendEmailCommand: class {
		constructor(params: Record<string, unknown>) {
			sendEmailCalls.push(params);
		}
	},
	SendRawEmailCommand: class {
		constructor(params: unknown) {
			sendRawCalls.push(params);
		}
	},
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		SES_SENDER_EMAIL: 'noreply@ganbari-quest.com',
		SES_CONFIG_SET_NAME: 'ganbari-quest-config',
		APP_BASE_URL: 'https://ganbari-quest.com',
	},
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { DELETION_WARNING_EMAIL_LABELS } from '$lib/domain/labels';
import { sendDeletionWarningEmail } from '$lib/server/services/email-service';

function lastSentBodies(): { html: string; text: string; subject: string } {
	const params = sendEmailCalls[sendEmailCalls.length - 1] as {
		Message: {
			Subject: { Data: string };
			Body: { Html: { Data: string }; Text?: { Data: string } };
		};
	};
	return {
		subject: params.Message.Subject.Data,
		html: params.Message.Body.Html.Data,
		text: params.Message.Body.Text?.Data ?? '',
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	sendEmailCalls.length = 0;
	sendRawCalls.length = 0;
	mockSend.mockResolvedValue({});
	process.env.AUTH_MODE = 'cognito';
});

describe('#2399 [M1] 本文に復元導線と削除予定日がある', () => {
	it('HTML / text の両方に復元先 URL と削除予定日と残日数が入る', async () => {
		const ok = await sendDeletionWarningEmail({
			email: 'owner@example.com',
			ownerName: '保護者',
			deletionDate: '2026年4月15日',
			daysRemaining: 14,
		});

		expect(ok).toBe(true);
		const { html, text, subject } = lastSentBodies();

		for (const body of [html, text]) {
			// 復元導線 — 「消える」だけ伝えて取り消し方法が無い状態を作らない
			expect(body).toContain('https://ganbari-quest.com/admin/settings/account');
			// 物理削除予定日 + 残日数
			expect(body).toContain('2026年4月15日');
			expect(body).toContain('14');
			// 期限を過ぎると戻せないこと
			expect(body).toContain(DELETION_WARNING_EMAIL_LABELS.irreversibleNote);
		}
		expect(subject).toContain('14');
	});

	it('文言は labels SSOT 経由 (件名 / 見出しがハードコードでない)', async () => {
		await sendDeletionWarningEmail({
			email: 'owner@example.com',
			ownerName: '保護者',
			deletionDate: '2026年4月15日',
			daysRemaining: 14,
		});
		const { html, subject } = lastSentBodies();
		expect(subject).toContain(DELETION_WARNING_EMAIL_LABELS.subject(14));
		expect(html).toContain(DELETION_WARNING_EMAIL_LABELS.heading);
	});
});

describe('#2399 [M2] 子供の情報を載せない', () => {
	it('送信 params は子供名 / 活動を受け取る口を持たない (宛名と日付だけ)', async () => {
		await sendDeletionWarningEmail({
			email: 'owner@example.com',
			ownerName: '保護者',
			deletionDate: '2026年4月15日',
			daysRemaining: 14,
		});
		const { html, text } = lastSentBodies();
		// 子供 / 活動を指す語が本文に出てこない (引き止め目的の情報利用を構造的に排除)
		for (const body of [html, text]) {
			expect(body).not.toContain('お子さま');
			expect(body).not.toContain('活動');
			expect(body).not.toContain('ポイント');
		}
	});
});

describe('#2399 [M3] 購読解除で止まらない経路で送る', () => {
	it('List-Unsubscribe を付けない (SendRawEmailCommand を使わない)', async () => {
		await sendDeletionWarningEmail({
			email: 'owner@example.com',
			ownerName: '保護者',
			deletionDate: '2026年4月15日',
			daysRemaining: 1,
		});

		expect(sendEmailCalls).toHaveLength(1);
		expect(sendRawCalls).toHaveLength(0);
		const { html, text } = lastSentBodies();
		for (const body of [html, text]) {
			expect(body).not.toContain('/unsubscribe/');
		}
	});

	it('配信設定にかかわらず届く旨を本文で伝える', async () => {
		await sendDeletionWarningEmail({
			email: 'owner@example.com',
			ownerName: '保護者',
			deletionDate: '2026年4月15日',
			daysRemaining: 1,
		});
		const { text } = lastSentBodies();
		expect(text).toContain(DELETION_WARNING_EMAIL_LABELS.transactionalNote);
	});
});

describe('#2399 [M4] Anti-engagement — 煽らない', () => {
	it('「今すぐ」等の急かす表現を含めない', async () => {
		await sendDeletionWarningEmail({
			email: 'owner@example.com',
			ownerName: '保護者',
			deletionDate: '2026年4月15日',
			daysRemaining: 14,
		});
		const { html, text, subject } = lastSentBodies();
		for (const body of [subject, html, text]) {
			for (const phrase of ['今すぐ', 'お得', '急いで', '！']) {
				expect(body).not.toContain(phrase);
			}
		}
	});
});
