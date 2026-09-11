// tests/unit/routes/ocr-receipt-tenant-quota.test.ts
//
// **領収書の読み取りに 1 世帯あたりの回数上限が効いていること** (PO 決裁 2026-09-10 決定 5)。
//
// ## なぜ要るか
//
// `POST /api/v1/points/ocr-receipt` は 1 回叩くたびに OCR ベンダーを呼ぶ = **顧客の金が動く**。
// 上限が無い状態では、連打 / 誤操作 / スクリプトで 1 世帯からコストが青天井に伸びる。
//
// ## 固定する不変条件
//
//   [Q1] 上限までは通る / 上限を超えたら **ベンダーを呼ばない**
//   [Q2] 上限は **世帯ごと**に独立 (別の家庭の利用で自分が止まらない)
//   [Q3] 超過の応答は **アップグレード導線を出さない** (PO 決定 5: plan gate は掛けない)
//   [Q4] **検証で弾かれた要求は枠を消費しない** (コストが発生していないのに枠を失わない)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockOcrReceipt = vi.fn();
vi.mock('$lib/server/services/receipt-ocr-service', () => ({
	ocrReceipt: (...args: unknown[]) => mockOcrReceipt(...args),
	RECEIPT_MAX_IMAGE_BYTES: 5 * 1024 * 1024,
}));
vi.mock('$lib/server/security/magic-bytes', () => ({
	validateBase64ImageMagicBytes: () => ({ valid: true }),
}));

import { RECEIPT_OCR_QUOTA_PER_TENANT } from '../../../src/lib/domain/constants/receipt-ocr-quota';
import { POINTS_LABELS } from '../../../src/lib/domain/labels';
import { POST } from '../../../src/routes/api/v1/points/ocr-receipt/+server';

function makeEvent(tenantId: string, opts: { mimeType?: string } = {}) {
	return {
		request: new Request('https://x/api/v1/points/ocr-receipt', {
			method: 'POST',
			body: JSON.stringify({ image: 'AAAA', mimeType: opts.mimeType ?? 'image/png' }),
		}),
		// 領収書 OCR は #4875 で親限定になっている。本 test が測るのは**回数上限**なので
		// 呼び手は保護者で固定する (role の方は api-parent-only-role-guard.test.ts が測る)。
		locals: { context: { tenantId, role: 'owner' } },
		// biome-ignore lint/suspicious/noExplicitAny: minimal RequestEvent stub for handler unit test
	} as any;
}

beforeEach(() => {
	mockOcrReceipt.mockResolvedValue({ amount: 100 });
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('[Q1] 上限までは通り、超えたらベンダーを呼ばない', () => {
	it(`${RECEIPT_OCR_QUOTA_PER_TENANT} 回目までは 200`, async () => {
		// rate-limiter の store は module スコープなので、test ごとに別 tenant を使って独立させる
		const tenantId = 't-quota-boundary';
		for (let i = 0; i < RECEIPT_OCR_QUOTA_PER_TENANT; i++) {
			const res = await POST(makeEvent(tenantId));
			expect(res.status, `${i + 1} 回目`).toBe(200);
		}
		expect(mockOcrReceipt).toHaveBeenCalledTimes(RECEIPT_OCR_QUOTA_PER_TENANT);
	});

	it(`${RECEIPT_OCR_QUOTA_PER_TENANT + 1} 回目は止まり、OCR を呼ばない`, async () => {
		const tenantId = 't-quota-over';
		for (let i = 0; i < RECEIPT_OCR_QUOTA_PER_TENANT; i++) {
			await POST(makeEvent(tenantId));
		}
		mockOcrReceipt.mockClear();

		const res = await POST(makeEvent(tenantId));
		expect(res.status).not.toBe(200);
		expect(
			mockOcrReceipt,
			'上限を超えてもベンダーを呼んでいたら、上限がコストを止めていない',
		).not.toHaveBeenCalled();
	});
});

describe('[Q2] 上限は世帯ごとに独立', () => {
	it('別の世帯が使い切っても自分は通る', async () => {
		const otherTenant = 't-quota-other';
		for (let i = 0; i < RECEIPT_OCR_QUOTA_PER_TENANT + 1; i++) {
			await POST(makeEvent(otherTenant));
		}
		const res = await POST(makeEvent('t-quota-me'));
		expect(res.status).toBe(200);
	});
});

describe('[Q3] 超過の応答にアップグレード導線を出さない', () => {
	it('文言は SSOT の 1 本で、上位プランへの誘導を含まない', async () => {
		const tenantId = 't-quota-message';
		for (let i = 0; i < RECEIPT_OCR_QUOTA_PER_TENANT; i++) {
			await POST(makeEvent(tenantId));
		}
		const res = await POST(makeEvent(tenantId));
		const body = (await res.json()) as {
			error?: { message?: string; action?: string; severity?: string };
		};

		expect(body.error?.message).toBe(POINTS_LABELS.receiptQuotaExceeded);
		// PO 決定 5: plan gate を掛けないので、上限は上位プランでも外れない。
		// 外れないものへ誘導するのは、顧客に効かない支出を勧めることになる。
		for (const word of ['プラン', 'アップグレード', '有料', '/admin/subscription']) {
			expect(body.error?.message ?? '', `「${word}」が混ざっている`).not.toContain(word);
		}
		// 顧客が今できることは無い = 再試行ボタンも出さない (ADR-0062)
		expect(body.error?.action).toBe('none');
		expect(body.error?.severity).toBe('info');
	});
});

describe('[Q4] 検証で弾かれた要求は枠を消費しない', () => {
	it('形式違いを上限回数ぶん叩いても、そのあと正規の要求が通る', async () => {
		const tenantId = 't-quota-invalid-first';
		for (let i = 0; i < RECEIPT_OCR_QUOTA_PER_TENANT; i++) {
			const res = await POST(makeEvent(tenantId, { mimeType: 'image/gif' }));
			expect(res.status).toBe(400);
		}
		expect(mockOcrReceipt).not.toHaveBeenCalled();

		const res = await POST(makeEvent(tenantId));
		expect(
			res.status,
			'弾かれた要求で枠が減っていると、顧客はコストを発生させていないのに使えなくなる',
		).toBe(200);
	});
});
