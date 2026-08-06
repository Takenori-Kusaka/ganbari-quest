// tests/unit/routes/ops-mfa-not-required.test.ts
// #4363 (オーナー決裁 2026-08-06): /ops の MFA 要求を外し、ops group 所属のみで判定する。
//
// 決裁の内容: 選択肢 A (TOTP を登録する) / B (MFA 要求を外す) / C (/ops を使わない) を提示し、
// オーナーが B を選択した (「TOTP の対応は不要とします」)。ops group メンバーが 0 人で
// /ops に誰も入れず、TOTP 有効化も 4 手順を要する (コンソール操作は InvalidParameterException
// で失敗) ため、その手間を掛けない判断がなされた。
//
// **弱くなる点を隠さない**: #4266 が CloudFront の IP allowlist を廃止した代替が MFA だった。
// これを外すと /ops (売上・コホート・コスト・PL) の防御は「Cognito 認証 + ops group 所属」
// だけになり、多層防御が 1 層減る (ops のパスワード 1 つが漏れた時点で入られる)。
// したがって本 test は次の 2 つを**同時に**固定する:
//   (1) 現在の判定 = group のみ (決裁の実装)
//   (2) MFA 判定の機構は生きており、フラグ 1 つで元に戻せる (再評価トリガー T1-T4 で戻す)
//
// fail-closed の性質は維持する: group が確認できなければ拒否 (ここまでは緩めない)。
//
// failing-test-first (ADR-0061): 実装前は `OPS_MFA_REQUIRED` が存在せず import が解決できない
// / `hasOpsAccess(opsWithoutMfa)` が false を返すため red。

import { describe, expect, it } from 'vitest';
import { OPS_MFA_REQUIRED } from '../../../src/lib/policy/capabilities';
import { hasOpsAccess, isOpsMember } from '../../../src/lib/server/auth/ops-authz';
import type { Identity } from '../../../src/lib/server/auth/types';

const opsWithMfa: Identity = {
	type: 'cognito',
	userId: 'u-ops-1',
	email: 'ops@example.com',
	groups: ['ops'],
	mfaAuthenticated: true,
};

/** TOTP 未設定の運営者 (= 決裁後の実在アカウント kokorokagami+gqops の状態)。 */
const opsWithoutMfa: Identity = {
	type: 'cognito',
	userId: 'u-ops-2',
	email: 'ops2@example.com',
	groups: ['ops'],
	mfaAuthenticated: false,
};

/** MFA 情報が取れない (旧トークン / amr claim 欠落)。 */
const opsMfaUnknown: Identity = {
	type: 'cognito',
	userId: 'u-ops-3',
	email: 'ops3@example.com',
	groups: ['ops'],
};

const parentWithMfa: Identity = {
	type: 'cognito',
	userId: 'u-parent',
	email: 'parent@example.com',
	groups: [],
	mfaAuthenticated: true,
};

describe('#4363 /ops は ops group 所属のみで判定する (オーナー決裁で MFA 要求を撤去)', () => {
	it('MFA 未設定の ops は /ops に入れる (決裁の本体)', () => {
		expect(hasOpsAccess(opsWithoutMfa)).toBe(true);
	});

	it('MFA 情報不明 (amr claim 欠落) の ops も入れる — 旧トークンで締め出さない', () => {
		expect(hasOpsAccess(opsMfaUnknown)).toBe(true);
		expect(hasOpsAccess(opsMfaUnknown, undefined)).toBe(true);
		expect(hasOpsAccess(opsMfaUnknown, {})).toBe(true);
	});

	it('MFA 済 ops は当然入れる (回帰)', () => {
		expect(hasOpsAccess(opsWithMfa)).toBe(true);
	});

	// ---- ここから下は「緩めない」側の固定。決裁は MFA だけを外すものであり、
	//      group 判定まで緩めることは含まない。
	it('ops group 非所属は MFA 済でも拒否 (回帰、ここまで緩めない)', () => {
		expect(hasOpsAccess(parentWithMfa)).toBe(false);
	});

	it('groups が空 / 未提供の cognito identity は拒否 (fail-closed)', () => {
		expect(hasOpsAccess({ type: 'cognito', userId: 'u', email: 'u@e.com', groups: [] })).toBe(
			false,
		);
		expect(hasOpsAccess({ type: 'cognito', userId: 'u', email: 'u@e.com' })).toBe(false);
	});

	it('local identity は拒否 (/ops は Cognito 配信のみ)', () => {
		expect(hasOpsAccess({ type: 'local' })).toBe(false);
	});

	it('identity=null は拒否', () => {
		expect(hasOpsAccess(null)).toBe(false);
	});

	it('判定は isOpsMember と一致する (group 以外の条件を足していない)', () => {
		for (const id of [opsWithMfa, opsWithoutMfa, opsMfaUnknown, parentWithMfa, null]) {
			expect(hasOpsAccess(id)).toBe(isOpsMember(id));
		}
	});
});

describe('#4363 MFA 判定の機構は残っており、フラグ 1 つで復帰できる', () => {
	it('OPS_MFA_REQUIRED は現在 false (決裁の状態)', () => {
		expect(OPS_MFA_REQUIRED).toBe(false);
	});

	it('requireMfa=true を渡すと #4266 当時の判定がそのまま復活する', () => {
		// 再評価トリガー (T1: 有料 10 世帯超 / T2: ops 2 人目 / T3: /ops に書込・個票
		// / T4: 不審ログイン観測) を満たしたら OPS_MFA_REQUIRED を true にするだけでよい、
		// ことをここで機械的に保証する。実装を書き直す必要が無い = 機構を消していない。
		expect(hasOpsAccess(opsWithMfa, undefined, true)).toBe(true);
		expect(hasOpsAccess(opsWithoutMfa, undefined, true)).toBe(false);
		expect(hasOpsAccess(opsMfaUnknown, undefined, true)).toBe(false); // fail-closed
		expect(hasOpsAccess(parentWithMfa, undefined, true)).toBe(false);
	});

	it('requireMfa=true では context 側のセッション MFA も従来どおり見る (silent refresh 対策)', () => {
		expect(hasOpsAccess(opsMfaUnknown, { mfaAuthenticated: true }, true)).toBe(true);
		expect(hasOpsAccess(opsMfaUnknown, { mfaAuthenticated: false }, true)).toBe(false);
	});

	it('既定引数は OPS_MFA_REQUIRED である (別の真偽値を二重に持たない)', () => {
		for (const id of [opsWithMfa, opsWithoutMfa, opsMfaUnknown, parentWithMfa]) {
			expect(hasOpsAccess(id)).toBe(hasOpsAccess(id, undefined, OPS_MFA_REQUIRED));
		}
	});
});

describe('#4363 /ops layout guard も group のみで通す', () => {
	async function loadOps(identity: Identity | null) {
		const mod = await import('../../../src/routes/ops/+layout.server');
		// biome-ignore lint/suspicious/noExplicitAny: SvelteKit の LayoutServerLoad 引数を最小 stub で渡す
		return (mod.load as any)({ locals: { identity } });
	}

	it('MFA 未設定の ops が /ops を開ける (決裁の実効確認)', async () => {
		await expect(loadOps(opsWithoutMfa)).resolves.toEqual({});
	});

	it('amr claim の無い ops も開ける', async () => {
		await expect(loadOps(opsMfaUnknown)).resolves.toEqual({});
	});

	it('非 ops は 403 のまま (reason は載せない = ops group の存在を示唆しない)', async () => {
		await expect(loadOps(parentWithMfa)).rejects.toMatchObject({
			status: 403,
			body: { message: 'Forbidden' },
		});
	});

	it('未認証は 403 のまま', async () => {
		await expect(loadOps(null)).rejects.toMatchObject({ status: 403 });
	});
});
