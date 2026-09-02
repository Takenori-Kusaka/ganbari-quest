// cspell:ignore Fimport
// ↑ percent-encode 済み URL (`%3Fimport%3D…`) の断片。`?` `=` を encode した形がそのまま
//   期待値なので、綴りを直すと encodeNextParam の検証が成立しない (#4701)。
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

// 先頭 2 文字だけを見る `^\/(?![/\\])` は、間に 1 文字挟むだけですり抜ける。
// Location ヘッダやブラウザの正規化でその 1 文字が除去されると `//evil.com` に縮退し、
// 外部サイトへ飛ばされる (QM review fix、PR #4743)。
// 制御文字は code point から組み立てる (リテラルで置くと editor / lint / diff で黙って消えるため)。
describe('resolveSafeNextPath — 文字を挟んで検査をすり抜ける open redirect', () => {
	const ch = (code: number) => String.fromCharCode(code);

	it.each([
		[0x09, 'TAB'],
		[0x0b, '垂直タブ'],
		[0x0c, '改ページ'],
		[0x85, 'NEL (C1 制御文字)'],
		[0x2028, 'LINE SEPARATOR'],
		[0x2029, 'PARAGRAPH SEPARATOR'],
		[0x01, 'SOH (C0 制御文字)'],
		[0x7f, 'DEL'],
		[0x00, 'NUL'],
		[0xa0, 'NBSP'],
		[0xfeff, 'BOM'],
		[0x20, '半角スペース'],
	])('U+%s (%s) を挟んだ protocol-relative / backslash は null', (code, _label) => {
		expect(resolveSafeNextPath(`/${ch(code)}//evil.com`)).toBeNull();
		expect(resolveSafeNextPath(`/${ch(code)}/\\evil.com`)).toBeNull();
	});

	it.each([
		['/%09//evil.com', 'TAB を percent-encode'],
		['/%20//evil.com', '半角スペースを percent-encode'],
		['/%00//evil.com', 'NUL を percent-encode'],
		['/%0d%0a//evil.com', 'CRLF を percent-encode'],
		['/%a0//evil.com', 'NBSP を percent-encode'],
	])('%s (%s) は正規化後に //evil.com へ縮退するため null', (p) => {
		expect(resolveSafeNextPath(p)).toBeNull();
	});

	it('末尾 LF は $ が最終改行の手前にもマッチするため deny list をすり抜ける', () => {
		expect(resolveSafeNextPath('/admin\n')).toBeNull();
	});

	it('行区切り / 複数制御文字を挟んだ形も null', () => {
		expect(resolveSafeNextPath(`/admin${ch(0x2028)}Set-Cookie: x=y`)).toBeNull();
		expect(resolveSafeNextPath(`/admin/${ch(0x09)}${ch(0x09)}//evil.com`)).toBeNull();
	});

	it('非 ASCII は Location ヘッダに載らないため拒否する (送り側で percent-encode する)', () => {
		expect(resolveSafeNextPath('/admin/かつどう')).toBeNull();
		expect(resolveSafeNextPath('/admin/%E3%81%8B')).toBe('/admin/%E3%81%8B');
	});

	it('正常な相対パスは allowlist 追加後も通り続ける', () => {
		for (const p of [
			'/',
			'/switch',
			'/marketplace/checklist/x',
			'/admin/activities?import=kinder-starter',
			'/a/b/c?x=1&y=2#frag',
			"/admin/stats?rate=50%&q=a'b(c)",
			'/admin/foo;v=1,2/bar:baz@qux',
			'/admin/~user/_file.name-1',
			'/admin/a!$*+=',
		]) {
			expect(resolveSafeNextPath(p)).toBe(p);
		}
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
