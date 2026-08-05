// #4192 (#4174 Q3 の PO 決裁) — 運用者向け通知の payload に**顧客識別子が出ない**ことを機械で固定する。
//
// Discord は運用者の機器ではなく外部 SaaS で、embed はチャットログとして永続化される。
// 通知は「起きた」を伝えるのが役割で、「誰に起きた」は認証された場所 (ログ / DB) で引く。
//
// **payload builder を直接検査する** (fetch を張らない): 送出経路が増えても、embed を作るのは
// この 2 関数なので、ここを固定すれば全経路で効く。

import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
	type AlertOptions,
	buildAlertEmbed,
	buildThrottledAlertEmbed,
	redactAlertOptions,
} from '$lib/server/discord-alert';
import { redactNotificationText, redactPathIds } from '$lib/server/notify-privacy';
import { buildIncidentEmbed, buildInquiryEmbed } from '$lib/server/services/discord-notify-service';

/** 通知に出てはいけない値 (PO 決裁 Q3 の「載せない」列)。 */
const CUSTOMER_IDENTIFIERS = {
	tenantId: '9f8b1c2d-3e4a-4b5c-8d7e-6f5a4b3c2d1e',
	childId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
	email: 'kazoku@example.com',
	legacyChildId: '903',
};

function serialize(payload: unknown): string {
	return JSON.stringify(payload);
}

describe('#4192 通知 payload に顧客識別子が出ない', () => {
	it('incident embed: error message / path に混ざった顧客識別子が出力に現れない', () => {
		const embed = buildIncidentEmbed(
			`Failed to load child ${CUSTOMER_IDENTIFIERS.childId} for ${CUSTOMER_IDENTIFIERS.email} (tenant=${CUSTOMER_IDENTIFIERS.tenantId})`,
			{
				method: 'GET',
				path: `/api/v1/admin/children/${CUSTOMER_IDENTIFIERS.legacyChildId}?tenantId=${CUSTOMER_IDENTIFIERS.tenantId}`,
				status: 500,
			},
		);
		const out = serialize(embed);

		expect(out).not.toContain(CUSTOMER_IDENTIFIERS.childId);
		expect(out).not.toContain(CUSTOMER_IDENTIFIERS.tenantId);
		expect(out).not.toContain(CUSTOMER_IDENTIFIERS.email);
		// query string ごと落とす (`?tenantId=` のような値の載せ方を潰す)
		expect(out).not.toContain('?tenantId=');
		// 「どの画面で落ちたか」は残る (顧客識別子ではなく triage に要る)
		expect(out).toContain('/api/v1/admin/children');
		expect(out).toContain('システムエラー');
	});

	it('alert embed: TenantId field を持たない / 自由記述の識別子も落ちる', () => {
		const embed = buildAlertEmbed(
			redactAlertOptions({
				level: 'error',
				message: `Internal Server Error for ${CUSTOMER_IDENTIFIERS.email}`,
				method: 'POST',
				path: `/api/v1/children/${CUSTOMER_IDENTIFIERS.childId}/activities`,
				status: 500,
				requestId: 'req-abc-123',
				errorSummary: `tenant ${CUSTOMER_IDENTIFIERS.tenantId} write failed`,
				stackSummary: `at handler (/api/v1/children/${CUSTOMER_IDENTIFIERS.childId})`,
				details: `email=${CUSTOMER_IDENTIFIERS.email}`,
			}),
		);
		const out = serialize(embed);

		for (const value of Object.values(CUSTOMER_IDENTIFIERS)) {
			if (value === CUSTOMER_IDENTIFIERS.legacyChildId) continue; // 上の incident ケースで検証
			expect(out, `顧客識別子 ${value} が payload に残っています`).not.toContain(value);
		}
		// requestId は残す — これが無いと「誰に起きたか」をログから引く導線まで消える
		expect(out).toContain('req-abc-123');
		const fieldNames = (embed.fields as Array<{ name: string }>).map((f) => f.name);
		expect(fieldNames).not.toContain('TenantId');
	});

	it('過去互換で tenantId を混ぜても embed には出ない (型 gate の実行時裏打ち)', () => {
		// 型レベルの gate は svelte-check / tsc が担う (AlertOptions に tenantId が無い)。
		// ここでは「型を迂回して渡されても embed には出ない」= 二重防御を固定する。
		const legacyCallsite = {
			level: 'error',
			message: 'boom',
			tenantId: CUSTOMER_IDENTIFIERS.tenantId,
		} as unknown as AlertOptions;
		expect(serialize(buildAlertEmbed(redactAlertOptions(legacyCallsite)))).not.toContain(
			CUSTOMER_IDENTIFIERS.tenantId,
		);
	});

	it('まとめ通知 (throttled) の description にも識別子が出ない', () => {
		// throttle key は redact 済 options から作られる = key 経由の再露出が無い
		const redacted = redactAlertOptions({
			level: 'error',
			message: 'boom',
			path: `/api/v1/children/${CUSTOMER_IDENTIFIERS.childId}`,
			errorSummary: `tenant ${CUSTOMER_IDENTIFIERS.tenantId}`,
		});
		const key = `${redacted.path ?? ''}:${redacted.errorSummary ?? redacted.message}`;
		const out = serialize(buildThrottledAlertEmbed(key, { count: 3, requestIds: ['req-1'] }));

		expect(out).not.toContain(CUSTOMER_IDENTIFIERS.childId);
		expect(out).not.toContain(CUSTOMER_IDENTIFIERS.tenantId);
		expect(out).toContain('req-1');
	});
});

describe('#4197 inquiry 通知 payload に顧客識別子が出ない', () => {
	// #4197 AC1/AC2: tenantId / 送信者 / 返信先 は field ごと撤去し、受付番号 + カテゴリ +
	// 「認証された画面で読む」導線だけを載せる。本文は残す (AC3、下の it で根拠を書く)。
	it('受付番号とカテゴリは載り、tenantId / メールアドレスの field は無い', () => {
		const embed = buildInquiryEmbed('bug', 'ログインできません', 'INQ-20260805-001');
		const fieldNames = (embed.fields as Array<{ name: string }>).map((f) => f.name);

		expect(embed.title).toContain('INQ-20260805-001');
		expect(fieldNames).toContain('受付番号');
		expect(fieldNames).toContain('カテゴリ');
		// 旧 payload の 3 field は復活させない
		expect(fieldNames).not.toContain('テナント');
		expect(fieldNames).not.toContain('送信者');
		expect(fieldNames).not.toContain('返信先');
		// 受付番号を鍵に認証された場所へ誘導する (読めないまま絞らない)
		expect(serialize(embed)).toContain('inquiries');
	});

	// AC3: 本文は載せる (運用者が本文を読める認証済画面が現状存在しないため)。
	// ただし本文に混ざる顧客識別子は redaction を通す。
	it('本文は残るが、本文に混ざった email / tenantId は出力に現れない', () => {
		const embed = buildInquiryEmbed(
			'consult',
			`朝の準備が進みません。返信は ${CUSTOMER_IDENTIFIERS.email} まで (tenant=${CUSTOMER_IDENTIFIERS.tenantId})`,
			'INQ-20260805-002',
		);
		const out = serialize(embed);

		expect(out).not.toContain(CUSTOMER_IDENTIFIERS.email);
		expect(out).not.toContain(CUSTOMER_IDENTIFIERS.tenantId);
		// 用件そのものは読める (絞りすぎて問い合わせ対応が止まらない)
		expect(out).toContain('朝の準備が進みません');
	});

	// #3211 / #3388 回帰: sanitize が先に走ると `foo@here.com` の `@here` に zero-width space が
	// 入り email の形が壊れて redaction をすり抜ける。順序は redact → sanitize で固定する。
	it('mention 語を含むメールアドレス (foo@here.com) も落ちる (redact → sanitize 順の固定)', () => {
		const out = serialize(buildInquiryEmbed('other', '返信先は parent@here.com です', 'INQ-1'));

		expect(out).not.toContain('parent@here.com');
		expect(out).not.toContain('here.com');
		// mention 中和自体は維持 (誤 ping させない)
		expect(serialize(buildInquiryEmbed('other', '@everyone 見て', 'INQ-2'))).not.toMatch(
			/@everyone/,
		);
	});

	// 受付番号の採番前に save が落ちた経路 (support page の catch) でも識別子を載せない
	it('受付番号が無い場合でも tenantId / email を載せない', () => {
		const embed = buildInquiryEmbed('feature', `連絡先 ${CUSTOMER_IDENTIFIERS.email}`);
		const out = serialize(embed);

		expect(out).not.toContain(CUSTOMER_IDENTIFIERS.email);
		expect((embed.fields as Array<{ name: string }>).map((f) => f.name)).not.toContain('受付番号');
	});
});

describe('#4192 redaction の単体挙動', () => {
	it('path の可変セグメントだけを落とし、画面名は残す', () => {
		expect(redactPathIds('/api/v1/admin/children/903')).toBe('/api/v1/admin/children/:id');
		expect(redactPathIds(`/admin/status/${CUSTOMER_IDENTIFIERS.tenantId}`)).toBe(
			'/admin/status/:id',
		);
		expect(redactPathIds('/admin/activities')).toBe('/admin/activities');
		expect(redactPathIds('/admin/activities?childId=903')).toBe('/admin/activities');
	});

	it('自由記述の email / UUID を落とす', () => {
		expect(redactNotificationText(`contact ${CUSTOMER_IDENTIFIERS.email}`)).not.toContain(
			CUSTOMER_IDENTIFIERS.email,
		);
		expect(redactNotificationText(`tenant=${CUSTOMER_IDENTIFIERS.tenantId}`)).not.toContain(
			CUSTOMER_IDENTIFIERS.tenantId,
		);
	});

	// adversarial 自己レビューで実測した過剰 redaction。`attempt 2/3` の `/3` を path とみなして
	// `2/:id` に潰していた (triage 情報の破壊)。URL path に見えるものだけを対象にする。
	it('通常文の `/` を path とみなして潰さない', () => {
		expect(redactNotificationText('DSQL timeout after 30000 ms (attempt 2/3)')).toBe(
			'DSQL timeout after 30000 ms (attempt 2/3)',
		);
		expect(redactNotificationText('rate 1/2 完了')).toBe('rate 1/2 完了');
		// URL path (階層あり) は従来どおり落とす
		expect(redactNotificationText('failed at /api/v1/admin/children/903')).toContain(
			'/api/v1/admin/children/:id',
		);
	});

	// **意図的に受容している過剰 redaction**: 7 桁以上の連続数字は既存 `redactPii` の phone pattern に
	// 当たり `<PHONE_REDACTED>` になる。本製品の運用値でその桁数が出るのは件数より識別子の可能性が高く、
	// 安全側に倒す判断 (`pii-redaction.ts` の設計原則「false negative を最大 risk」と同じ)。
	// 実運用の件数 (数件〜数万) は落ちないことを固定する。
	it('実運用レンジの件数は落ちない / 7 桁以上は安全側に潰れる (受容する挙動)', () => {
		expect(redactNotificationText('27 rows missing')).toBe('27 rows missing');
		expect(redactNotificationText('rows=12345 mismatch')).toBe('rows=12345 mismatch');
		expect(redactNotificationText('rows=1234567 mismatch')).not.toContain('1234567');
	});

	it('事象の種別・件数・環境名は落とさない (通知が意味を失わない)', () => {
		const text = redactNotificationText(
			'backup failed: 3 files missing on staging (job=backup-nuc)',
		);
		expect(text).toContain('backup failed');
		expect(text).toContain('3 files');
		expect(text).toContain('staging');
		expect(text).toContain('backup-nuc');
	});
});
