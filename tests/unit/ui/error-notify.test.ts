// tests/unit/ui/error-notify.test.ts
// #3218 (EPIC #3217): 統一エラー通知 helper の検証。
//   - resolveApiErrorMessage: status × server message → ユーザ向け文言マッピング
//   - 500 系は内部例外露出防止のため body message を使わず汎用文言にする
//   - notifyApiError / notifyActionError が error Toast を出す

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const showToastMock = vi.fn();
vi.mock('$lib/ui/primitives/Toast.svelte', () => ({
	showToast: (...args: unknown[]) => showToastMock(...args),
}));

import { ERROR_NOTIFY_LABELS } from '../../../src/lib/domain/labels';
import {
	notifyActionError,
	notifyApiError,
	notifyNetworkError,
	resolveApiErrorMessage,
} from '../../../src/lib/ui/error-notify';

beforeEach(() => showToastMock.mockClear());
afterEach(() => vi.clearAllMocks());

describe('resolveApiErrorMessage — status × server message マッピング', () => {
	it('500 系は server message を無視し汎用 server 文言 (内部例外露出防止)', () => {
		expect(resolveApiErrorMessage(500, 'DynamoDB ValidationException: ...')).toBe(
			ERROR_NOTIFY_LABELS.server,
		);
		expect(resolveApiErrorMessage(503, 'stack trace...')).toBe(ERROR_NOTIFY_LABELS.server);
	});

	it('400/403/409 は server の UI 向け文言を尊重する', () => {
		expect(resolveApiErrorMessage(400, 'プランが正しくありません')).toBe(
			'プランが正しくありません',
		);
		expect(resolveApiErrorMessage(403, '保護者のみ可能です')).toBe('保護者のみ可能です');
	});

	it('server message 無しはステータス別の汎用文言にフォールバック', () => {
		expect(resolveApiErrorMessage(403, '')).toBe(ERROR_NOTIFY_LABELS.forbidden);
		expect(resolveApiErrorMessage(409, '')).toBe(ERROR_NOTIFY_LABELS.conflict);
		expect(resolveApiErrorMessage(400, '')).toBe(ERROR_NOTIFY_LABELS.badRequest);
		expect(resolveApiErrorMessage(418, '')).toBe(ERROR_NOTIFY_LABELS.generic);
	});
});

describe('notifyApiError — fetch Response', () => {
	it('400 + {message} で error Toast にサーバー文言を出す', async () => {
		const res = new Response(JSON.stringify({ message: 'プランが正しくありません' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
		const r = await notifyApiError(res);
		expect(r.message).toBe('プランが正しくありません');
		expect(showToastMock).toHaveBeenCalledWith(
			ERROR_NOTIFY_LABELS.title,
			'プランが正しくありません',
			'error',
		);
	});

	it('500 + {error: 内部例外} でも汎用文言に置換して出す (露出防止)', async () => {
		const res = new Response(JSON.stringify({ error: 'TypeError: cannot read x of undefined' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
		const r = await notifyApiError(res);
		expect(r.message).toBe(ERROR_NOTIFY_LABELS.server);
		expect(showToastMock).toHaveBeenCalledWith(
			ERROR_NOTIFY_LABELS.title,
			ERROR_NOTIFY_LABELS.server,
			'error',
		);
	});

	it('非 JSON body でも汎用文言で error Toast を出す (silent にしない)', async () => {
		const res = new Response('<html>500</html>', { status: 502 });
		const r = await notifyApiError(res);
		expect(r.shown).toBe(true);
		expect(r.message).toBe(ERROR_NOTIFY_LABELS.server);
		expect(showToastMock).toHaveBeenCalledTimes(1);
	});
});

describe('notifyNetworkError / notifyActionError', () => {
	it('notifyNetworkError は network 文言で error Toast', () => {
		const r = notifyNetworkError();
		expect(r.message).toBe(ERROR_NOTIFY_LABELS.network);
		expect(showToastMock).toHaveBeenCalledWith(
			ERROR_NOTIFY_LABELS.title,
			ERROR_NOTIFY_LABELS.network,
			'error',
		);
	});

	it('action failure は data.error を尊重して error Toast', () => {
		const r = notifyActionError({
			type: 'failure',
			status: 400,
			data: { error: 'ポイントが不足しています' },
		});
		expect(r?.message).toBe('ポイントが不足しています');
		expect(showToastMock).toHaveBeenCalledWith(
			ERROR_NOTIFY_LABELS.title,
			'ポイントが不足しています',
			'error',
		);
	});

	it('action error (500 相当) は汎用 server 文言', () => {
		const r = notifyActionError({ type: 'error', error: new Error('boom') });
		expect(r?.message).toBe(ERROR_NOTIFY_LABELS.server);
	});

	it('action success / redirect は通知しない (null)', () => {
		expect(notifyActionError({ type: 'success', status: 200, data: {} })).toBeNull();
		expect(notifyActionError({ type: 'redirect', status: 303, location: '/x' })).toBeNull();
		expect(showToastMock).not.toHaveBeenCalled();
	});
});
