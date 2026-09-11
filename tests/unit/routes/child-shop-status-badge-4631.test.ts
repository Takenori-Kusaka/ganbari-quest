// tests/unit/routes/child-shop-status-badge-4631.test.ts
// #4631: ショップ陳列棚のバッジは「承認待ち」だけにする。
//
// 顧客に見えていた壊れ方:
//   - 親が承認したあと、カードに「こうかん済み」が**永久に**残り、同じカードに有効な
//     「こうかんする」ボタンが同居していた。複数回交換できるごほうびなのに
//     「もう交換できない」と子供に誤解させる (実機で再現、#4680 監査)
//   - 却下後も「まってね」が残り続け、しかも親が書いた却下理由はショップからは読めなかった
//     (記録 > 交換 まで辿らないと分からず、ショップから履歴への導線も無かった)
//
// 判定は `shopStatusBadge()` (domain SSOT) に閉じ、page はそれを描画するだけにする。

import { describe, expect, it } from 'vitest';
import { canExchangeReward, shopStatusBadge } from '../../../src/lib/domain/shop-availability';

describe('#4631 AC1 陳列棚のバッジは承認待ちのときだけ出す', () => {
	it('承認待ちはバッジを出す (親の返事を待っている = 押せない理由の説明)', () => {
		expect(shopStatusBadge('pending_parent_approval')).toBe('pending');
	});

	it.each([
		['approved'],
		['rejected'],
		['expired'],
		[null],
	])('%s はバッジを出さない (完了した状態は陳列棚に残さない)', (status) => {
		expect(shopStatusBadge(status)).toBeNull();
	});
});

describe('#4631 AC2 完了した状態でも交換ボタンは活性のまま', () => {
	it.each([
		['approved'],
		['rejected'],
		['expired'],
	])('%s は残高が足りていれば再度交換できる', (status) => {
		expect(canExchangeReward({ points: 50, latestRequestStatus: status }, 100)).toBe(true);
	});

	it('承認待ちだけは押せない (repo の dedup 契約で実際に申請が通らないため)', () => {
		expect(
			canExchangeReward({ points: 50, latestRequestStatus: 'pending_parent_approval' }, 100),
		).toBe(false);
	});
});
