// tests/unit/auth/invite-token.test.ts
// #3528: invite token_hash 生成 / timing-safe 照合 util のテスト (Canon TDD、ADR-0061)
// 設計 SSOT: docs/design/dsql-data-model.md §6.6 invites 行
//   「token_hash（招待コードの timing-safe ハッシュ、raw 非保存）必須 =
//     現行 inviteCode capability 機構の写像、bare bearer 化による機密性退行を防ぐ（CWE-522）」

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashInviteCode, hashInviteSecret } from '../../../src/lib/server/auth/invite-code-hash';
import {
	generateInviteToken,
	hashInviteToken,
	verifyInviteTokenHash,
} from '../../../src/lib/server/auth/invite-token';

/** base64url 文字集合のみ許容 (padding なし、URL-safe) */
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/** sha256 hex (64 chars) */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

describe('generateInviteToken', () => {
	it('token は 32 bytes 由来の base64url 文字列 (43 chars、padding なし)', () => {
		const { token } = generateInviteToken();
		// 32 bytes → base64url は 43 文字 (ceil(32*4/3) = 43、padding 除去)
		expect(token).toHaveLength(43);
		expect(token).toMatch(BASE64URL_RE);
	});

	it('tokenHash は sha256 hex (64 chars) で token 自身と一致する', () => {
		const { token, tokenHash } = generateInviteToken();
		expect(tokenHash).toMatch(SHA256_HEX_RE);
		// 生成時 hash と照合用 hash 関数は同一写像 (DB lookup の前提)
		expect(hashInviteToken(token)).toBe(tokenHash);
		// 独立に計算した sha256(token) hex とも一致 (アルゴリズム固定の contract)
		expect(tokenHash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
	});

	it('tokenHash に raw token が含まれない (CWE-522: raw 非保存の前提)', () => {
		const { token, tokenHash } = generateInviteToken();
		expect(tokenHash).not.toContain(token);
		expect(tokenHash.toLowerCase()).not.toContain(token.toLowerCase());
	});

	it('複数回生成で token / tokenHash が衝突しない (高エントロピー)', () => {
		const tokens = new Set<string>();
		const hashes = new Set<string>();
		for (let i = 0; i < 100; i++) {
			const { token, tokenHash } = generateInviteToken();
			tokens.add(token);
			hashes.add(tokenHash);
		}
		expect(tokens.size).toBe(100);
		expect(hashes.size).toBe(100);
	});
});

describe('hashInviteToken', () => {
	it('同一 token → 同一 hash (決定的)', () => {
		expect(hashInviteToken('abc')).toBe(hashInviteToken('abc'));
	});

	it('異なる token → 異なる hash', () => {
		expect(hashInviteToken('abc')).not.toBe(hashInviteToken('abd'));
	});

	it('sha256 hex (64 chars 小文字) を返す', () => {
		expect(hashInviteToken('any-token')).toMatch(SHA256_HEX_RE);
	});
});

// #3588 ①: 招待秘密 hash の SSOT 統合。hashInviteToken / hashInviteCode は hashInviteSecret に
// 委譲し、同一写像 (sha256 hex) であることを regression guard する。将来アルゴリズムを変えても
// 片側更新漏れ (invite lookup 不整合) を構造的に起こさない。
describe('hash SSOT 統合 (#3588 ①)', () => {
	it('hashInviteToken / hashInviteCode / hashInviteSecret は同一写像', () => {
		for (const input of ['', 'inv-abc', 'a'.repeat(43), '日本語コード', 'inv-0123-XYZ_-~']) {
			const secret = hashInviteSecret(input);
			expect(hashInviteToken(input)).toBe(secret);
			expect(hashInviteCode(input)).toBe(secret);
			// 独立に計算した sha256(input) hex とも一致 (アルゴリズム固定の contract)
			expect(secret).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
		}
	});
});

describe('verifyInviteTokenHash', () => {
	it('正しい token と stored hash の組で true', () => {
		const { token, tokenHash } = generateInviteToken();
		expect(verifyInviteTokenHash(token, tokenHash)).toBe(true);
	});

	it('異なる token では false', () => {
		const { tokenHash } = generateInviteToken();
		const { token: otherToken } = generateInviteToken();
		expect(verifyInviteTokenHash(otherToken, tokenHash)).toBe(false);
	});

	it('長さ不一致の stored hash でも throw せず false (timingSafeEqual の長さ例外を漏らさない)', () => {
		const { token } = generateInviteToken();
		expect(() => verifyInviteTokenHash(token, 'deadbeef')).not.toThrow();
		expect(verifyInviteTokenHash(token, 'deadbeef')).toBe(false);
		expect(verifyInviteTokenHash(token, '')).toBe(false);
	});

	it('1 文字違いの hash で false (同一長の負ケース)', () => {
		const { token, tokenHash } = generateInviteToken();
		const lastChar = tokenHash.at(-1) === '0' ? '1' : '0';
		const tampered = tokenHash.slice(0, -1) + lastChar;
		expect(tampered).toHaveLength(tokenHash.length);
		expect(verifyInviteTokenHash(token, tampered)).toBe(false);
	});

	it('空 token でも throw せず false', () => {
		const { tokenHash } = generateInviteToken();
		expect(verifyInviteTokenHash('', tokenHash)).toBe(false);
	});
});
