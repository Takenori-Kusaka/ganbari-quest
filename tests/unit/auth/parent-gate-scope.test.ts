// tests/unit/auth/parent-gate-scope.test.ts
//
// **親 PIN gate が「どこに掛かって、どこに掛からないか」を固定する**
// (#4866 系 QM 監査 / PO 決裁 2026-09-10 決定 4)。
//
// ## なぜ要るか
//
// PIN gate の判定は `(parent)/admin/+layout.server.ts` の**インライン 1 箇所**にしか無く、
// page の `load` しか通らなかった。設計書 `14-セキュリティ設計書.md` は
// 「アプリ層（**全経路**）」と書いており、**実装より広く書いてあった** —
// PO 差し戻しの言葉では「守っているつもり」。素通りしていたのは:
//
//   - `/api/v1/admin/**` の 25 本
//   - form action (`?/action` POST) の 22 file
//
// ## 固定する不変条件 (PO 決定 4(b) がそのまま invariant)
//
//   [G1] `/api/v1/admin/**` の**書き込み**は gate 対象
//   [G2] 描画のための**読み取り**は gate 対象外 (403 にすると admin 画面が描けない)
//   [G3] **一括 PII を返す読み取り**は例外として gate 対象
//   [G4] cookie を発行する経路自身には掛からない (鍵を開ける鍵が要る状態を作らない)
//   [G5] gate が無効な環境 (demo / local / cognito-dev) では何も止めない
//   [G6] 不成立時の API 応答は **403 + `PARENT_GATE_REQUIRED`** (ADR-0062 shape)
//   [G7] **form action は hooks で倒さない** — 303 にすると保護者の入力が黙って捨てられる
//        (PO 決定 4(a))。action 側が `parentGateBlocked()` を見て `fail()` を返す

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
	authMode: 'cognito' as string,
	cognitoDev: false,
	forceActive: false as boolean | undefined,
	sessionValid: false,
};

vi.mock('$lib/server/auth/auth-mode', () => ({
	getAuthMode: () => state.authMode,
	isCognitoDevMode: () => state.cognitoDev,
}));
vi.mock('$lib/runtime/env', () => ({
	getEnv: () => ({ PARENT_GATE_FORCE_ACTIVE: state.forceActive }),
}));
vi.mock('$lib/server/services/parent-gate-session', () => ({
	verifyParentSession: () => state.sessionValid,
	PARENT_SESSION_COOKIE_NAME: 'gq_parent_session',
}));
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { enforceParentGate, isParentGateActive, parentGateBlocked, requiresParentGate } =
	await import('../../../src/lib/server/auth/parent-gate');

beforeEach(() => {
	state.authMode = 'cognito';
	state.cognitoDev = false;
	state.forceActive = undefined;
	state.sessionValid = false;
});

describe('[G1] /api/v1/admin/** の書き込みは gate 対象', () => {
	const WRITES = [
		['POST', '/api/v1/admin/invites'],
		['DELETE', '/api/v1/admin/members/u-1'],
		['POST', '/api/v1/admin/tenant/cancel'],
		['POST', '/api/v1/admin/account/delete'],
		['PATCH', '/api/v1/admin/migration'],
		['PUT', '/api/v1/admin/viewer-tokens'],
		// PO 決定 4(b)「書き込み全部」— 一括の持ち出し / 取込 / 全消去は `/api/v1/admin` の外。
		// とくに create は 201 応答に `pinCode` を載せるので、読み取りだけ塞ぐと迂回される。
		['POST', '/api/v1/export/cloud'],
		['DELETE', '/api/v1/export/cloud/ce-1'],
		['POST', '/api/v1/import/cloud'],
		['POST', '/api/v1/data/clear'],
	] as const;

	for (const [method, path] of WRITES) {
		it(`${method} ${path}`, () => {
			expect(requiresParentGate(path, method)).toBe(true);
		});
	}
});

describe('[G2] 描画のための読み取りは gate 対象外', () => {
	// ここを 403 にすると admin 画面そのものが描けなくなる (PO / QM が同じ理由を挙げている)
	const READS = [
		'/api/v1/admin/tenant/status',
		'/api/v1/admin/downgrade-preview',
		'/api/v1/admin/grace-status',
		'/api/v1/admin/invites',
		// prefix (`/api/v1/data`) は**書き込みだけ**に効く。描画のための GET は通る。
		'/api/v1/data/summary',
	];

	for (const path of READS) {
		it(`GET ${path} は通す`, () => {
			expect(requiresParentGate(path, 'GET')).toBe(false);
		});
	}
});

describe('[G3] 一括 PII を返す読み取りは例外として gate 対象', () => {
	// QM 監査が名指しした実害:「アドレスバーに URL を打つだけで家族全員分の
	// バックアップが落ちる」。脅威モデルで効くのは書き換えと**持ち出し**。
	it('GET /api/v1/admin/account/export (削除前エクスポート JSON)', () => {
		expect(requiresParentGate('/api/v1/admin/account/export', 'GET')).toBe(true);
	});

	it('GET /api/v1/export (家族データ JSON / ZIP)', () => {
		expect(requiresParentGate('/api/v1/export', 'GET')).toBe(true);
	});

	// 一覧の応答は id ではなく record 全体 (`CloudExportListItem extends CloudExportRecord`)。
	// `pinCode` と `s3Key` が平文で載り、PIN は tenant にも plan にも縛られない bearer なので、
	// DL だけ塞いでも一覧から読めば別端末で取り出せる。
	it('GET /api/v1/export/cloud (共有 PIN が載る一覧)', () => {
		expect(requiresParentGate('/api/v1/export/cloud', 'GET')).toBe(true);
	});

	it('GET /api/v1/export/cloud/<id>/download (実ファイル DL)', () => {
		expect(requiresParentGate('/api/v1/export/cloud/ce-1/download', 'GET')).toBe(true);
	});
});

describe('[G4] cookie を発行する経路自身には掛からない', () => {
	// ここに掛けると「鍵を開けるための鍵が要る」状態になり、PIN を入力する手段が消える
	for (const path of [
		'/api/v1/parent-gate/verify',
		'/api/v1/parent-gate/setup',
		'/api/v1/parent-gate/logout',
	]) {
		it(`POST ${path} は通す`, () => {
			expect(requiresParentGate(path, 'POST')).toBe(false);
		});
	}
});

describe('[G5] gate が無効な環境では何も止めない', () => {
	it('local (dev / NUC) では inactive', () => {
		state.authMode = 'local';
		expect(isParentGateActive()).toBe(false);
		expect(enforceParentGate('/api/v1/admin/invites', 'POST', undefined, 't-1')).toBeNull();
	});

	it('anonymous (demo Lambda) では inactive', () => {
		state.authMode = 'anonymous';
		expect(isParentGateActive()).toBe(false);
	});

	it('cognito-dev では inactive (既存 E2E の認証フローを壊さない)', () => {
		state.cognitoDev = true;
		expect(isParentGateActive()).toBe(false);
	});

	it('PARENT_GATE_FORCE_ACTIVE=true は local でも有効にする (手動確認 / SS 撮影用)', () => {
		state.authMode = 'local';
		state.forceActive = true;
		expect(isParentGateActive()).toBe(true);
	});
});

describe('[G6] 不成立時の API 応答は 403 + PARENT_GATE_REQUIRED', () => {
	it('session 無効なら 403 を返す', async () => {
		const res = enforceParentGate('/api/v1/admin/invites', 'POST', undefined, 't-1');
		expect(res).not.toBeNull();
		expect(res?.status).toBe(403);
		const body = (await (res as Response).json()) as { error?: { code?: string } };
		expect(
			body.error?.code,
			'FORBIDDEN と別 code にするのは、顧客の次の一手が違うから ' +
				'(FORBIDDEN = 別の人に交代 / PARENT_GATE_REQUIRED = 自分でおやカギを入れれば進める)',
		).toBe('PARENT_GATE_REQUIRED');
	});

	it('session 有効なら通す', () => {
		state.sessionValid = true;
		expect(enforceParentGate('/api/v1/admin/invites', 'POST', 'cookie', 't-1')).toBeNull();
	});
});

describe('[G7] form action は hooks で倒さない (入力を捨てない)', () => {
	// PO 決定 4(a):「保護者が書いた内容を黙って捨てるのは、gate が守るものより大きい損害」
	it('/admin/** への POST (form action) は hooks では null を返す', () => {
		expect(
			enforceParentGate('/admin/children', 'POST', undefined, 't-1'),
			'hooks で 303 / 403 に倒すと、保護者が入力した内容がそのまま消える',
		).toBeNull();
	});

	it('ただし requiresParentGate は true — action 側が fail() で止める責任を持つ', () => {
		expect(requiresParentGate('/admin/children', 'POST')).toBe(true);
	});

	it('parentGateBlocked が action 側の判定になる', () => {
		expect(parentGateBlocked(undefined, 't-1')).toBe(true);
		state.sessionValid = true;
		expect(parentGateBlocked('cookie', 't-1')).toBe(false);
	});
});

describe('gate 対象外の path には掛からない', () => {
	for (const path of ['/api/v1/activities', '/api/health', '/switch', '/ops/analytics']) {
		it(`${path} は対象外`, () => {
			expect(requiresParentGate(path, 'POST')).toBe(false);
		});
	}
});
