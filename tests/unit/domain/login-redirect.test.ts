// tests/unit/domain/login-redirect.test.ts
// #4701: ログイン後の戻り先 (`?next=`) の open redirect 防止と、ログイン画面の状態 query → 文言 mapping。
import { describe, expect, it } from 'vitest';
import { LOGIN_LABELS } from '../../../src/lib/domain/labels';
import {
	buildLoginHrefWithNext,
	encodeNextParam,
	LOGIN_ERROR_CODES,
	LOGIN_REASON_CODES,
	resolveLoginNotice,
	resolveSafeNextPath,
} from '../../../src/lib/domain/validation/login-redirect';

describe('resolveSafeNextPath (#4701 open redirect 防止)', () => {
	it.each([
		'/marketplace/checklist/x',
		'/admin/activities?import=kinder-starter',
		'/switch',
		'/',
		'/a/b/c?x=1&y=2#frag',
	])('同一オリジンの相対パス %s は通す', (p) => {
		expect(resolveSafeNextPath(p)).toBe(p);
	});

	it.each([
		['//evil.com', 'protocol-relative'],
		['/\\evil.com', 'backslash (ブラウザが / に正規化)'],
		['https://evil.com/x', '絶対 URL'],
		['http://localhost:5173/admin', '絶対 URL (同一 host でも)'],
		['javascript:alert(1)', 'scheme'],
		['evil.com', '先頭 / 無し'],
		['', '空'],
		['/admin\r\nSet-Cookie: x=y', 'CRLF injection'],
		[`/${'a'.repeat(2100)}`, '長すぎる'],
	])('%s (%s) は null (無視)', (p) => {
		expect(resolveSafeNextPath(p)).toBeNull();
	});

	it('null / undefined は null', () => {
		expect(resolveSafeNextPath(null)).toBeNull();
		expect(resolveSafeNextPath(undefined)).toBeNull();
	});
});

describe('encodeNextParam / buildLoginHrefWithNext', () => {
	it('パス区切りは残し、入れ子 query の ? = & は encode する', () => {
		expect(encodeNextParam('/admin/activities?import=a&b=c')).toBe(
			'/admin/activities%3Fimport%3Da%26b%3Dc',
		);
		expect(buildLoginHrefWithNext('/marketplace/checklist/x')).toBe(
			'/auth/login?next=/marketplace/checklist/x',
		);
	});

	it('encode → URLSearchParams で復元 → resolveSafeNextPath を往復しても同値', () => {
		const original = '/admin/activities?import=kinder-starter';
		const href = buildLoginHrefWithNext(original);
		const url = new URL(href, 'http://localhost');
		expect(resolveSafeNextPath(url.searchParams.get('next'))).toBe(original);
	});
});

describe('resolveLoginNotice (送り側 query → 顧客向け文言)', () => {
	const q = (s: string) => new URLSearchParams(s);

	it.each([
		['registered=true', 'status', LOGIN_LABELS.noticeRegistered],
		['confirmed=true', 'status', LOGIN_LABELS.noticeConfirmed],
		['passwordReset=true', 'status', LOGIN_LABELS.passwordResetSuccess],
		[`reason=${LOGIN_REASON_CODES.deleted}`, 'alert', LOGIN_LABELS.noticeAccountDeleted],
		[`error=${LOGIN_ERROR_CODES.oauthFailed}`, 'alert', LOGIN_LABELS.noticeOauthFailed],
		[`error=${LOGIN_ERROR_CODES.missingParams}`, 'alert', LOGIN_LABELS.noticeOauthStateLost],
		[`error=${LOGIN_ERROR_CODES.invalidState}`, 'alert', LOGIN_LABELS.noticeOauthStateLost],
		[
			`error=${LOGIN_ERROR_CODES.tokenExchangeFailed}`,
			'alert',
			LOGIN_LABELS.noticeOauthTokenExchangeFailed,
		],
	])('?%s → %s', (query, kind, message) => {
		const n = resolveLoginNotice(q(query));
		expect(n).not.toBeNull();
		expect(n?.kind).toBe(kind);
		expect(n?.message).toBe(message);
		expect(n?.message.length).toBeGreaterThan(10);
	});

	it('未知の error / reason 値でも黙らず汎用文言を出す', () => {
		expect(resolveLoginNotice(q('error=something_new'))?.message).toBe(
			LOGIN_LABELS.noticeLoginFailedGeneric,
		);
		expect(resolveLoginNotice(q('reason=unknown'))?.message).toBe(
			LOGIN_LABELS.noticeLoginFailedGeneric,
		);
	});

	it('error は成功系より優先され、query 無しは null', () => {
		expect(resolveLoginNotice(q('registered=true&error=oauth_failed'))?.kind).toBe('alert');
		expect(resolveLoginNotice(q(''))).toBeNull();
		expect(resolveLoginNotice(q('next=/admin'))).toBeNull();
	});
});
