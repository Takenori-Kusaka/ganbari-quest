// tests/e2e/cloud-share-pending-pin-4717.spec.ts
//
// #4717: クラウド共有の PIN を発行した直後（まだ生成待ち）に受け取り側が取り込むと
// 500「システムに問題が発生しました」になり、受け取った側が障害と誤認していた。
// AWS の build cron は 5 分毎なので、発行〜5 分の窓では必ずこの状態に当たる。
//
// 本 spec は「発行 → 即取込」を実サーバで通し、案内メッセージ (409) が返ることを固定する。
// 生成完了後に同 PIN で取り込めること (AC2) は cron を跨ぐため staging 手順で担保する
// (PR body / docs/runbooks 参照)。

import { expect, test } from './fixtures';

test.describe('#4717 発行直後（生成待ち）の PIN で取り込む', () => {
	test('500 ではなく 409 + 「準備中」案内が返る', async ({ request }) => {
		// 1) クラウド共有を発行する (非同期 build のため status=pending で起票される、#3504)
		const created = await request.post('/api/v1/export/cloud', {
			data: { exportType: 'template', label: 'e2e-4717' },
		});
		if (created.status() === 403 || created.status() === 401) {
			// プラン gate / 認証で発行できない環境ではこの回帰は再現しない (unit で担保)
			test.skip(true, 'クラウド共有を発行できない環境 (プラン / 認証 gate)');
			return;
		}
		expect(created.status(), 'クラウド共有の発行').toBe(201);
		const createdBody = (await created.json()) as { pinCode?: string; status?: string };
		const pinCode = createdBody.pinCode ?? '';
		expect(pinCode.length, '発行された PIN').toBeGreaterThan(3);
		expect(createdBody.status, '起票直後は生成待ち').toBe('pending');

		// 2) 生成完了を待たずに取り込む = 顧客が実際に踏む窓
		const res = await request.post('/api/v1/import/cloud?mode=preview', {
			data: { pinCode },
		});

		expect(res.status(), '生成待ちを 500 にしない (受け取る側が障害と誤認する)').toBe(409);
		const body = (await res.json()) as {
			error?: { code?: string; message?: string; userMessage?: string; action?: string };
		};
		expect(body.error?.code).toBe('EXPORT_NOT_READY');
		// 「待てば解決する」ことが顧客に伝わる文言であること
		expect(body.error?.userMessage ?? '').toContain('準備中');
		expect(body.error?.userMessage ?? '').not.toContain('システムに問題');
		expect(body.error?.action).toBe('retry');
	});
});
