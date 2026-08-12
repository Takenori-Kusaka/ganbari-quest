// tests/unit/services/email-content-snapshot.test.ts
// #4507 (GAMMA 監査 R2): 顧客に届くメール全種の件名・本文を snapshot で固定する。
//
// なぜ snapshot なのか:
//   #4507 で確定した 6 件のうち 4 件 (虚偽約束 / 二重サフィックス / 呼称割れ / 内部コード露出) は
//   **文言そのものの不良**であり、型でも既存の assertion でも検出できなかった。1 通ずつ
//   「この語が含まれる」を書く方式は書いた語しか守らない (現に「スタンダードプランプラン」は
//   誰も assert していなかったので 6 箇所で生き延びた)。snapshot は本文全体を差分に出すので、
//   **意図しない文言変更は必ずレビューに現れる**。
//
//   意図した変更のときは `npx vitest run -u` で更新する。更新差分そのものが
//   「顧客に届く文面がどう変わるか」のレビュー材料になる (これが本 test の主目的であり、
//   assertion の弱体化ではない — ADR-0006)。
//
//   snapshot は「変わったこと」しか言わない (変更が正しいかは言わない) ので、
//   SSOT 違反を機械的に落とす不変条件を別に併置する (§不変条件)。
//
// 送信区分 (marketing / transactional) の配線検証は lifecycle-email / deletion 系の
// service test の責務。本 test は「何が書かれているか」を見る。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const sesCommands: Array<{ type: 'simple' | 'raw'; params: Record<string, unknown> }> = [];

vi.mock('@aws-sdk/client-ses', () => ({
	SESClient: class {
		send = vi.fn().mockResolvedValue({});
	},
	SendEmailCommand: class {
		constructor(params: Record<string, unknown>) {
			sesCommands.push({ type: 'simple', params });
		}
	},
	SendRawEmailCommand: class {
		constructor(params: Record<string, unknown>) {
			sesCommands.push({ type: 'raw', params });
		}
	},
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		SES_SENDER_EMAIL: 'noreply@ganbari-quest.com',
		APP_BASE_URL: 'https://ganbari-quest.com',
	},
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// 配信停止トークンは HMAC。鍵を固定すれば URL も決定的になり snapshot が安定する。
vi.mock('$lib/runtime/env', () => ({
	getEnv: () => ({ OPS_SECRET_KEY: 'test-fixed-secret-for-snapshot', AUTH_MODE: 'cognito' }),
	env: { OPS_SECRET_KEY: 'test-fixed-secret-for-snapshot', AUTH_MODE: 'cognito' },
}));

import { PLAN_FULL_TERMS, PLAN_RETENTION_TERMS } from '$lib/domain/terms';
import * as emailService from '$lib/server/services/email-service';
import * as trialNotificationService from '$lib/server/services/trial-notification-service';
import {
	sendTrialEndedTodayEmail,
	sendTrialEnding1DayEmail,
	sendTrialEnding3DaysEmail,
} from '$lib/server/services/trial-notification-service';

// ============================================================
// 送信内容の取り出し
// ============================================================

/** RFC 2047 (=?UTF-8?B?...?=) の件名をデコードする。 */
function decodeSubject(raw: string): string {
	return raw.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_m, b64: string) =>
		Buffer.from(b64, 'base64').toString('utf-8'),
	);
}

/** raw MIME (List-Unsubscribe 付き) から text/plain パートを取り出す。 */
function extractRawTextPart(message: string): string {
	const marker = 'Content-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64';
	const start = message.indexOf(marker);
	if (start === -1) return '';
	const bodyStart = message.indexOf('\r\n\r\n', start) + 4;
	const bodyEnd = message.indexOf('\r\n--', bodyStart);
	return Buffer.from(message.slice(bodyStart, bodyEnd), 'base64').toString('utf-8');
}

interface CapturedEmail {
	subject: string;
	text: string;
	/** marketing 便にのみ付く List-Unsubscribe ヘッダの有無 */
	hasListUnsubscribe: boolean;
}

/** 直前に送られた 1 通を取り出す。 */
function takeSentEmail(): CapturedEmail {
	expect(sesCommands).toHaveLength(1);
	const sent = sesCommands[0];
	if (!sent) throw new Error('メールが 1 通も送られていません');
	if (sent.type === 'simple') {
		const message = sent.params.Message as {
			Subject: { Data: string };
			Body: { Text?: { Data: string } };
		};
		return {
			subject: message.Subject.Data,
			text: message.Body.Text?.Data ?? '',
			hasListUnsubscribe: false,
		};
	}
	const rawMessage = (sent.params.RawMessage as { Data: Uint8Array }).Data;
	const message = Buffer.from(rawMessage).toString('utf-8');
	const subjectLine = /^Subject: (.+)$/m.exec(message)?.[1] ?? '';
	return {
		subject: decodeSubject(subjectLine),
		text: extractRawTextPart(message),
		hasListUnsubscribe: message.includes('List-Unsubscribe:'),
	};
}

// ============================================================
// 全メールの固定入力
// ============================================================

const TO = 'parent@example.com';
const TENANT = 'tenant-0001';

/**
 * 顧客に届くメール全種。**メールを増やしたら必ずここへ足す** —
 * 足し忘れは §網羅性 の test が落として気づかせる。
 */
const EMAILS: Array<{ name: string; send: () => Promise<boolean> }> = [
	{ name: 'welcome', send: () => emailService.sendWelcomeEmail(TO, 'やまだ家') },
	{
		name: 'inquiry-confirmation',
		send: () => emailService.sendInquiryConfirmationEmail(TO, 'INQ-0001'),
	},
	{ name: 'cancellation', send: () => emailService.sendCancellationEmail(TO, '2026年9月30日') },
	{
		name: 'deletion-warning',
		send: () =>
			emailService.sendDeletionWarningEmail({
				email: TO,
				ownerName: 'やまだ',
				deletionDate: '2026年9月30日',
				daysRemaining: 14,
			}),
	},
	{
		name: 'deletion-reserved',
		send: () =>
			emailService.sendDeletionReservedEmail({
				email: TO,
				ownerName: 'やまだ',
				deletionDate: '2026年9月30日',
				graceDays: 7,
			}),
	},
	{ name: 'deletion-complete', send: () => emailService.sendDeletionCompleteEmail(TO) },
	{ name: 'member-removed', send: () => emailService.sendMemberRemovedEmail(TO, 'やまだ家') },
	{ name: 'member-joined', send: () => emailService.sendMemberJoinedEmail(TO, 'はなこ', '保護者') },
	{
		name: 'ownership-transferred',
		send: () => emailService.sendOwnershipTransferredEmail(TO, 'はなこ', 'オーナー'),
	},
	{ name: 'pin-reset-code', send: () => emailService.sendPinResetCodeEmail(TO, '123456') },
	{
		name: 'weekly-report',
		send: () =>
			emailService.sendWeeklyReportEmail(TO, {
				childName: 'たろう',
				dateRange: '2026年9月1日〜9月7日',
				categories: [{ name: 'おてつだい', count: 5, diff: 2 }],
				streak: 3,
				pointsEarned: 120,
				totalPoints: 980,
				newAchievements: ['はじめての1週間'],
			}),
	},
	{
		name: 'license-renewal-reminder',
		send: () =>
			emailService.sendLicenseRenewalReminderEmail({
				email: TO,
				tenantId: TENANT,
				ownerName: 'やまだ',
				planLabel: 'スタンダード月額',
				expiresAt: '2026年9月30日',
				daysRemaining: 7,
			}),
	},
	{
		name: 'dormant-reactivation',
		send: () =>
			emailService.sendDormantReactivationEmail({
				email: TO,
				tenantId: TENANT,
				ownerName: 'やまだ',
				daysSinceLastActive: 120,
			}),
	},
	{
		name: 'payment-failed-notice',
		send: () =>
			emailService.sendPaymentFailedNoticeEmail({
				email: TO,
				ownerName: 'やまだ',
				planLabel: 'スタンダード月額',
				graceDeadline: '2026年9月30日',
				daysRemaining: 7,
			}),
	},
	{
		name: 'pmf-survey',
		send: () =>
			emailService.sendPmfSurveyEmail({
				email: TO,
				tenantId: TENANT,
				ownerName: 'やまだ',
				round: 'R1',
				surveyUrl: 'https://example.com/survey',
			}),
	},
	{
		name: 'trial-ending-3days',
		send: () => sendTrialEnding3DaysEmail(TO, '2026年9月30日', 'standard'),
	},
	{
		name: 'trial-ending-1day',
		send: () => sendTrialEnding1DayEmail(TO, '2026年9月30日', 'standard'),
	},
	{ name: 'trial-ended-today', send: () => sendTrialEndedTodayEmail(TO, 'standard') },
];

// ============================================================
// snapshot
// ============================================================

describe('顧客向けメールの件名・本文 snapshot (#4507)', () => {
	beforeEach(() => {
		sesCommands.length = 0;
		process.env.AUTH_MODE = 'cognito';
	});

	for (const { name, send } of EMAILS) {
		it(`${name} の件名・本文が変わっていない`, async () => {
			await send();
			expect(takeSentEmail()).toMatchSnapshot();
		});
	}
});

// ============================================================
// 網羅性 — メールを足したら snapshot も増える
// ============================================================

describe('メール網羅性 (#4507)', () => {
	/** `send*Email` export を反射で数える。個別メール名のハードコード列挙は追加漏れを検出できない。 */
	function sendEmailExportNames(mod: Record<string, unknown>): string[] {
		return (
			Object.keys(mod)
				.filter((key) => /^send[A-Z].*Email$/.test(key))
				// sendEmail 相当の低レベル API は個別メールではないため対象外
				.filter((key) => key !== 'sendEmail')
		);
	}

	it('email-service + trial-notification-service の send*Email export が全て snapshot 対象になっている', () => {
		// email-service 側だけを数えると trial-notification-service 側の 3 通が分母から漏れ、
		// そちらに新規メールを足しても検出されずに素通りしていた (#4507 監査後の残懸念)。
		// 2 module を反射で数えて合算することで、どちらに足しても検出できるようにする。
		const exported = [
			...sendEmailExportNames(emailService as unknown as Record<string, unknown>),
			...sendEmailExportNames(trialNotificationService as unknown as Record<string, unknown>),
		];

		// snapshot 側の網羅数と export 数が一致していれば、新規メールの追加漏れは無い。
		// (手動アンカー `toHaveLength(18)` には依存しない — それ自体が「足し忘れても気づけない」
		// 固定値だったため、比較先を反射由来の exported.length に置き換える)
		expect(exported).toHaveLength(EMAILS.length);
	});
});

// ============================================================
// 不変条件 — snapshot 更新で SSOT 違反を通してしまわないための assert
// ============================================================

describe('メール文言の不変条件 (#4507)', () => {
	beforeEach(() => {
		sesCommands.length = 0;
		process.env.AUTH_MODE = 'cognito';
	});

	/** 全メールの件名 + 本文を 1 本の文字列として集める。 */
	async function collectAllText(): Promise<string> {
		const chunks: string[] = [];
		for (const { send } of EMAILS) {
			sesCommands.length = 0;
			await send();
			const sent = takeSentEmail();
			chunks.push(sent.subject, sent.text);
		}
		return chunks.join('\n');
	}

	it('プラン名に「プラン」を二重に付けたものが 1 件も無い (#4507 監査 #4)', async () => {
		const all = await collectAllText();
		for (const planLabel of Object.values(PLAN_FULL_TERMS)) {
			expect(all).not.toContain(`${planLabel}プラン`);
		}
	});

	it('無料プランを「フリープラン」と呼んでいるメールが無い (#4507 監査 #5)', async () => {
		const all = await collectAllText();
		expect(all).not.toContain('フリープラン');
		// SSOT 側の呼称が使われていること (「呼んでいない」だけでは呼称が消えても通るため)
		expect(all).toContain(PLAN_FULL_TERMS.free);
	});

	it('内部 role コードを本文に露出しているメールが無い (#4507 監査 #6)', async () => {
		const all = await collectAllText();
		for (const roleCode of ['owner', 'parent', 'child']) {
			expect(all).not.toContain(`「${roleCode}」`);
		}
	});

	it('トライアル終了系メールが「データは削除されません」と無条件に約束していない (#4507 監査 #1)', async () => {
		const trialEmails = EMAILS.filter((e) => e.name.startsWith('trial-'));
		expect(trialEmails).toHaveLength(3);

		for (const { name, send } of trialEmails) {
			sesCommands.length = 0;
			await send();
			const { text } = takeSentEmail();

			// 虚偽約束そのもの
			expect(text, name).not.toContain('データは削除されません');
			expect(text, name).not.toContain('いつでも復元できます');

			// 保持期間切れの物理削除は 3 通とも述べる (3 通の中で食い違わせない)。
			// 「復元できません」まで述べ切る — 実装は物理削除なので「閲覧不可」等に弱めない。
			expect(text, name).toContain(PLAN_RETENTION_TERMS.free);
			expect(text, name).toContain('復元できません');
			expect(text, name).toContain('再契約でも戻りません');
		}
	});

	it('支払い失敗の通知が件名で支払い失敗の事実を述べている (#4507 監査 #2)', async () => {
		await emailService.sendPaymentFailedNoticeEmail({
			email: TO,
			ownerName: 'やまだ',
			planLabel: 'スタンダード月額',
			graceDeadline: '2026年9月30日',
			daysRemaining: 7,
		});
		const { subject, hasListUnsubscribe } = takeSentEmail();

		expect(subject).toContain('お支払いを確認できませんでした');
		expect(subject).not.toContain('次回更新予定日');
		// トランザクション便: 配信停止で止められない
		expect(hasListUnsubscribe).toBe(false);
	});

	it('退会の予約・完了通知がトランザクション便で送られる (#4507 監査 #3)', async () => {
		await emailService.sendDeletionReservedEmail({
			email: TO,
			ownerName: 'やまだ',
			deletionDate: '2026年9月30日',
			graceDays: 7,
		});
		expect(takeSentEmail().hasListUnsubscribe).toBe(false);

		sesCommands.length = 0;
		await emailService.sendDeletionCompleteEmail(TO);
		expect(takeSentEmail().hasListUnsubscribe).toBe(false);
	});
});
