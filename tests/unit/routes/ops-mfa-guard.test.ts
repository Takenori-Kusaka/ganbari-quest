// tests/unit/routes/ops-mfa-guard.test.ts
// #4266 → #4363: /ops の **MFA 判定機構** の回帰テスト。
//
// 位置づけ (2026-08-06 オーナー決裁後):
//   #4266 は CloudFront の admin IP allowlist 廃止の代替として /ops に MFA を要求した。
//   #4363 (オーナー決裁) でその**要求**を撤去し、現在の /ops は ops group 所属のみで通る。
//   ただし**判定機構は残してある** (`OPS_MFA_REQUIRED` を true に戻せば復帰する)。
//
//   - 現行挙動 (要求 off) の網羅   → tests/unit/routes/ops-mfa-not-required.test.ts
//   - policy 層との一致 / SSOT     → tests/unit/policy/ops-mfa-flag-consistency.test.ts
//   - **本 file** = 機構そのもの (requireMfa=true を明示した場合の真理値表 + context token)
//
// 本 file を消してはいけない: 機構が腐ると「フラグを戻せば復帰する」という #4363 の前提
// (= 弱くした防御をいつでも戻せる) が静かに壊れる。
//
// 不変条件 (フラグを true に戻したときの fail-closed / ADR-0024「設定が無ければ止める」):
//   - ops group 所属でも、MFA を経ていない identity は入れない
//   - MFA 情報が取れない (claim 欠落 = undefined) 場合も入れない (不明は拒否)

import { describe, expect, it } from 'vitest';
import {
	hasMfaAuthenticatedSession,
	hasOpsAccess,
	isOpsMember,
} from '../../../src/lib/server/auth/ops-authz';
import type { Identity } from '../../../src/lib/server/auth/types';

/** MFA を要求する設定に戻した場合を明示する (production の既定は false)。 */
const REQUIRE_MFA = true;

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

describe('#4266 hasOpsAccess — MFA を要求する設定 (requireMfa=true) の真理値表', () => {
	it('ops group かつ MFA 済は許可', () => {
		expect(hasOpsAccess(opsWithMfa, undefined, REQUIRE_MFA)).toBe(true);
	});

	it('ops group でも MFA 未経由は拒否', () => {
		expect(hasOpsAccess(opsWithoutMfa, undefined, REQUIRE_MFA)).toBe(false);
	});

	it('ops group でも MFA 情報不明 (claim 欠落) は拒否 (fail-closed)', () => {
		expect(hasOpsAccess(opsMfaUnknown, undefined, REQUIRE_MFA)).toBe(false);
	});

	it('非 ops group は MFA 済でも拒否', () => {
		expect(
			hasOpsAccess(
				{
					type: 'cognito',
					userId: 'u-parent',
					email: 'parent@example.com',
					groups: [],
					mfaAuthenticated: true,
				},
				undefined,
				REQUIRE_MFA,
			),
		).toBe(false);
	});

	it('local identity は拒否 (/ops は Cognito 配信のみ)', () => {
		expect(hasOpsAccess({ type: 'local' }, undefined, REQUIRE_MFA)).toBe(false);
	});

	it('identity=null は拒否', () => {
		expect(hasOpsAccess(null, undefined, REQUIRE_MFA)).toBe(false);
	});

	it('isOpsMember は group 所属のみを判定する (MFA 条件は hasOpsAccess の責務)', () => {
		// group 判定と MFA 判定を混ぜないことで、「なぜ弾かれたか」がログ / テストで分離できる
		expect(isOpsMember(opsWithoutMfa)).toBe(true);
		expect(hasOpsAccess(opsWithoutMfa, undefined, REQUIRE_MFA)).toBe(false);
	});
});

// ---------- #4266 セッション単位判定 (silent refresh 対策) ----------
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
		expect(hasOpsAccess(opsAfterRefresh, { mfaAuthenticated: true }, REQUIRE_MFA)).toBe(true);
	});

	it('identity も context も MFA を示さなければ拒否 (fail-closed)', () => {
		expect(hasOpsAccess(opsAfterRefresh, { mfaAuthenticated: false }, REQUIRE_MFA)).toBe(false);
		expect(hasOpsAccess(opsAfterRefresh, undefined, REQUIRE_MFA)).toBe(false);
		expect(hasOpsAccess(opsAfterRefresh, {}, REQUIRE_MFA)).toBe(false);
	});

	it('context が MFA 済でも ops group でなければ拒否', () => {
		expect(
			hasOpsAccess(
				{ type: 'cognito', userId: 'u-p', email: 'p@example.com', groups: [] },
				{ mfaAuthenticated: true },
				REQUIRE_MFA,
			),
		).toBe(false);
	});

	it('hasMfaAuthenticatedSession は identity / context の OR を取る (group 条件を含まない)', () => {
		// 機構を単体で保持する述語。group 判定と混ざっていないことをここで固定する。
		expect(hasMfaAuthenticatedSession(opsWithMfa)).toBe(true);
		expect(hasMfaAuthenticatedSession(opsAfterRefresh, { mfaAuthenticated: true })).toBe(true);
		expect(hasMfaAuthenticatedSession(opsAfterRefresh)).toBe(false);
		expect(hasMfaAuthenticatedSession(opsWithoutMfa)).toBe(false);
		expect(hasMfaAuthenticatedSession(null)).toBe(false);
		expect(hasMfaAuthenticatedSession({ type: 'local' }, { mfaAuthenticated: true })).toBe(true);
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

// ---------- #4282 復旧導線の分岐キー (MFA を要求する設定に戻したときに効く) ----------
// #4266 で MFA 必須化した際、拒否された運営者が見るのは共通の 403 画面だけで、画面からは
// 復旧手段が分からなかった (= 締め出して復旧できない状態)。そこで 403 (データを一切
// load しない fail-closed) は維持したまま、**MFA が理由の 403 のときだけ** 復旧導線を
// 描けるよう、エラー本文に機械可読な reason を載せる設計を入れた。
//
// #4363 で MFA 要求が off になったため `requireOpsAccess` はこの reason を出さない
// (= 導線は表示されない)。**語彙と描画側は残す**: フラグを戻した瞬間に拒否理由と導線が
// 同時に復活する必要があるため。描画側の回帰は
// tests/unit/routes/error-page-ops-mfa.test.ts / tests/unit/components/ops-mfa-setup-notice.test.ts。
describe('#4282 MFA 拒否理由の語彙 (policy 層と 1 語彙)', () => {
	it('OPS_MFA_REQUIRED_REASON は policy 層の DenyReason と同一値', async () => {
		const { OPS_MFA_REQUIRED_REASON } = await import('$lib/policy/capabilities');
		expect(OPS_MFA_REQUIRED_REASON).toBe('ops-mfa-required');
	});
});
