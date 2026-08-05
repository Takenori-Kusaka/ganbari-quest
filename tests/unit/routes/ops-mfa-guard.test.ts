// tests/unit/routes/ops-mfa-guard.test.ts
// #4266 (PO 決裁 2026-08-05): /ops の主防御を「Cognito ops group + MFA 必須」にする回帰テスト。
//
// 背景: CloudFront 層の admin IP allowlist を廃止した (顧客画面 /admin まで 403 にする設計誤り +
// 運営者のグローバル IP が固定でない / プロキシ経由で event.viewer.ip が回線 IP と一致しない)。
// IP 層 (2 枚目) を成立させられない以上、主防御であるアプリ層 (ops group) の強度を上げる。
//
// 不変条件 (fail-closed / ADR-0024 「設定が無ければ止める」):
//   - ops group 所属でも、MFA を経ていない identity は /ops に入れない
//   - MFA 情報が取れない (claim 欠落 = undefined) 場合も入れない (不明は拒否)
//
// failing-test-first (ADR-0061): 実装前は `hasOpsAccess` が存在せず import が解決できない (red)。

import { describe, expect, it } from 'vitest';
import { hasOpsAccess, isOpsMember } from '../../../src/lib/server/auth/ops-authz';
import type { Identity } from '../../../src/lib/server/auth/types';

const opsWithMfa: Identity = {
	type: 'cognito',
	userId: 'u-ops-1',
	email: 'ops@example.com',
	groups: ['ops'],
	mfaAuthenticated: true,
};

const opsWithoutMfa: Identity = {
	type: 'cognito',
	userId: 'u-ops-2',
	email: 'ops2@example.com',
	groups: ['ops'],
	mfaAuthenticated: false,
};

/** MFA 情報が取れない (旧トークン / claim 欠落)。fail-closed で拒否する。 */
const opsMfaUnknown: Identity = {
	type: 'cognito',
	userId: 'u-ops-3',
	email: 'ops3@example.com',
	groups: ['ops'],
};

describe('#4266 hasOpsAccess — ops group + MFA', () => {
	it('ops group かつ MFA 済は許可', () => {
		expect(hasOpsAccess(opsWithMfa)).toBe(true);
	});

	it('ops group でも MFA 未経由は拒否 (IP 層廃止に伴う主防御の強化)', () => {
		expect(hasOpsAccess(opsWithoutMfa)).toBe(false);
	});

	it('ops group でも MFA 情報不明 (claim 欠落) は拒否 (fail-closed)', () => {
		expect(hasOpsAccess(opsMfaUnknown)).toBe(false);
	});

	it('非 ops group は MFA 済でも拒否', () => {
		expect(
			hasOpsAccess({
				type: 'cognito',
				userId: 'u-parent',
				email: 'parent@example.com',
				groups: [],
				mfaAuthenticated: true,
			}),
		).toBe(false);
	});

	it('local identity は拒否 (/ops は Cognito 配信のみ)', () => {
		expect(hasOpsAccess({ type: 'local' })).toBe(false);
	});

	it('identity=null は拒否', () => {
		expect(hasOpsAccess(null)).toBe(false);
	});

	it('isOpsMember は group 所属のみを判定する (MFA 条件は hasOpsAccess の責務)', () => {
		// group 判定と MFA 判定を混ぜないことで、「なぜ弾かれたか」がログ / テストで分離できる
		expect(isOpsMember(opsWithoutMfa)).toBe(true);
		expect(hasOpsAccess(opsWithoutMfa)).toBe(false);
	});
});

describe('#4266 /ops layout guard', () => {
	async function loadOps(identity: Identity | null) {
		const mod = await import('../../../src/routes/ops/+layout.server');
		// biome-ignore lint/suspicious/noExplicitAny: SvelteKit の LayoutServerLoad 引数を最小 stub で渡す
		return (mod.load as any)({ locals: { identity } });
	}

	it('MFA 済 ops は通過する', async () => {
		await expect(loadOps(opsWithMfa)).resolves.toEqual({});
	});

	it('MFA 未経由の ops は 403 で、理由が MFA だと分かる', async () => {
		// 真っ白な Forbidden だと「TOTP 未設定」か「group 外」かを運営者が切り分けられない
		await expect(loadOps(opsWithoutMfa)).rejects.toMatchObject({
			status: 403,
			body: { message: 'Forbidden: ops access requires MFA' },
		});
	});

	it('MFA 情報不明の ops は 403 (fail-closed)', async () => {
		await expect(loadOps(opsMfaUnknown)).rejects.toMatchObject({ status: 403 });
	});

	it('未認証は 403 で、MFA 理由を出さない (ops group の存在を示唆しない)', async () => {
		await expect(loadOps(null)).rejects.toMatchObject({
			status: 403,
			body: { message: 'Forbidden' },
		});
	});
});

// ---------- #4266 追補: silent refresh で amr が落ちても締め出さない ----------
// Cognito の REFRESH_TOKEN_AUTH で再発行される ID token が MFA チャレンジ情報 (`amr`) を
// 保持するかは AWS 公式ドキュメントで確定できなかった (2026-08-05 調査)。保持しない場合、
// 運営者が何もしていないのに突然 /ops から締め出され、再ログインまで戻れない。
//
// したがって MFA は「今この token が MFA を経ているか」ではなく
// **「このセッションが MFA を経て開始されたか」** で判定する。ログイン時に確定した値を
// 署名付き context token (既存機構) に載せ、refresh では引き継ぐ。
describe('#4266 セッション単位の MFA 判定 (silent refresh 対策)', () => {
	/** refresh 後の identity: amr が落ちて mfaAuthenticated が undefined になった状態 */
	const opsAfterRefresh: Identity = {
		type: 'cognito',
		userId: 'u-ops-1',
		email: 'ops@example.com',
		groups: ['ops'],
	};

	it('identity の MFA が不明でも、context が MFA 済セッションなら許可', () => {
		expect(hasOpsAccess(opsAfterRefresh, { mfaAuthenticated: true })).toBe(true);
	});

	it('identity も context も MFA を示さなければ拒否 (fail-closed)', () => {
		expect(hasOpsAccess(opsAfterRefresh, { mfaAuthenticated: false })).toBe(false);
		expect(hasOpsAccess(opsAfterRefresh, undefined)).toBe(false);
		expect(hasOpsAccess(opsAfterRefresh, {})).toBe(false);
	});

	it('context が MFA 済でも ops group でなければ拒否', () => {
		expect(
			hasOpsAccess(
				{ type: 'cognito', userId: 'u-p', email: 'p@example.com', groups: [] },
				{ mfaAuthenticated: true },
			),
		).toBe(false);
	});

	it('/ops layout は locals.context の MFA も見る (refresh 直後も通過する)', async () => {
		const mod = await import('../../../src/routes/ops/+layout.server');
		// biome-ignore lint/suspicious/noExplicitAny: SvelteKit の LayoutServerLoad 引数を最小 stub で渡す
		const load = mod.load as any;
		await expect(
			load({ locals: { identity: opsAfterRefresh, context: { mfaAuthenticated: true } } }),
		).resolves.toEqual({});
		await expect(
			load({ locals: { identity: opsAfterRefresh, context: { mfaAuthenticated: false } } }),
		).rejects.toMatchObject({ status: 403 });
	});
});

describe('#4266 context token が MFA 済セッションを保持する', () => {
	it('signContext → verifyContext で mfaAuthenticated が往復する', async () => {
		const { signContext, verifyContext } = await import('$lib/server/auth/context-token');
		const token = signContext({ tenantId: 't-1', role: 'owner', mfaAuthenticated: true });
		expect(verifyContext(token)?.mfaAuthenticated).toBe(true);
	});

	it('mfaAuthenticated を載せない旧トークンは undefined (= 拒否側)', async () => {
		const { signContext, verifyContext } = await import('$lib/server/auth/context-token');
		const token = signContext({ tenantId: 't-1', role: 'owner' });
		expect(verifyContext(token)?.mfaAuthenticated).toBeUndefined();
	});
});
