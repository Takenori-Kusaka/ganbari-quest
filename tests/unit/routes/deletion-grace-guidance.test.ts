// tests/unit/routes/deletion-grace-guidance.test.ts
// #4699: 退会 (アカウント削除) 申請後の導線が途切れないことの静的 / 単体検証。
//
// 4 つの切れ目 (Issue の症状):
//   (1) 申請直後の着地 (/auth/login) に受付完了が出ない
//   (2) 猶予中の admin 全ページに「あと N 日 / 復元」が無い (設定 > アカウントの 1 画面だけ)
//   (3) 猶予中に子供を選ぶと設定トップへ無言で転送される (理由も出ない)
//   (4) 支払い失敗 (dunning) 中は退会セクションが丸ごと消える (#3993 で grace_period の意味は確定済)
//
// UI 配線は実ファイルの静的検査 + notice mapping の単体テストで固定する
// (画面全体の描画は E2E `tests/e2e/account-deletion-grace-guidance.spec.ts` が担う)。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOGIN_LABELS, SETTINGS_LABELS } from '../../../src/lib/domain/labels';
import {
	LOGIN_REASON_CODES,
	resolveLoginNotice,
} from '../../../src/lib/domain/validation/login-redirect';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf-8');

describe('#4699 (1) 申請直後の着地で受付完了が出る', () => {
	it('reason=deletion_pending は成功系 (status) の受付文言になる', () => {
		const notice = resolveLoginNotice(
			new URLSearchParams(`reason=${LOGIN_REASON_CODES.deletionPending}`),
		);
		expect(notice).not.toBeNull();
		expect(notice?.kind).toBe('status');
		expect(notice?.message).toBe(LOGIN_LABELS.noticeDeletionPending);
		// 「取り消せる」ことを必ず含む (受付だけ伝えて復元手段を伏せない)
		expect(notice?.message).toMatch(/取り消し|復元/);
	});

	it('削除済み (reason=deleted) とは別文言・別 kind (取り違えると回復可否を誤伝達する)', () => {
		const pending = resolveLoginNotice(new URLSearchParams('reason=deletion_pending'));
		const deleted = resolveLoginNotice(new URLSearchParams('reason=deleted'));
		expect(pending?.kind).toBe('status');
		expect(deleted?.kind).toBe('alert');
		expect(pending?.message).not.toBe(deleted?.message);
	});

	it('削除申請 → signout に reason を載せ、signout が login へ引き継ぐ', () => {
		const accountPage = read('src/routes/(parent)/admin/settings/account/+page.svelte');
		expect(accountPage).toMatch(
			/\/auth\/signout\?reason=\$\{LOGIN_REASON_CODES\.deletionPending\}/,
		);

		const signout = read('src/routes/auth/signout/+server.ts');
		expect(signout).toContain('LOGIN_REASON_CODES');
		// 既知コードのみ通す (任意文字列を query に載せ替えない)
		expect(signout).toMatch(/Object\.values\(LOGIN_REASON_CODES\)/);
	});
});

describe('#4699 (2) 猶予中は全 admin ページで状態と復元導線が見える', () => {
	it('admin +layout.svelte が共通バナーを描画する (設定 1 画面に閉じない)', () => {
		const layout = read('src/routes/(parent)/admin/+layout.svelte');
		expect(layout).toContain('DeletionGraceBanner');
		expect(layout).toMatch(/data\.gracePeriodStatus\?\.isSoftDeleted/);
	});

	it('設定 > アカウントも同じ component を使う (バナーの二重実装を作らない)', () => {
		const accountPage = read('src/routes/(parent)/admin/settings/account/+page.svelte');
		expect(accountPage).toContain('DeletionGraceBanner');
		// 旧 inline 実装 (独自 fetch + markup) が残っていないこと
		expect(accountPage).not.toContain('handleRestoreAccount');
	});

	it('バナーは復元 endpoint を SSOT 定数から引く', () => {
		const banner = read('src/lib/features/admin/components/DeletionGraceBanner.svelte');
		expect(banner).toContain('DELETION_GRACE_RESTORE_ENDPOINT');
		expect(banner).not.toContain("'/api/v1/admin/account/restore'");
	});
});

describe('#4699 (3) 猶予中でも子供を選べる / 転送理由が出る', () => {
	it('hooks の書き込み許可リストに /switch がある (子供選択は cookie のみで DB を書かない)', () => {
		const hooks = read('src/hooks.server.ts');
		const block = hooks.slice(
			hooks.indexOf('const isAllowedWritePath'),
			hooks.indexOf('const isAllowedWritePath') + 1200,
		);
		// 書き込みロックの例外は最小に保つ: /switch は **完全一致**で判定する。
		// startsWith だと将来 /switchboard のような別ルートを無言でロック外にしてしまう。
		expect(block).toContain("path === '/switch'");
		expect(block).not.toMatch(/'\/switch',\s*\n\s*\]\.some\(\(p\) => path\.startsWith/);
	});

	it('設定トップが reason=account_deletion_pending を説明する (無言転送にしない)', () => {
		const hub = read('src/routes/(parent)/admin/settings/+page.svelte');
		expect(hub).toContain('account_deletion_pending');
		expect(hub).toContain('SETTINGS_LABELS.deletionPendingReadOnlyNotice');
		expect(SETTINGS_LABELS.deletionPendingReadOnlyNotice).toMatch(/読み取り専用|変更は行えません/);
	});

	it('hooks の redirect 先 query と設定画面が読む query が一致する', () => {
		const hooks = read('src/hooks.server.ts');
		expect(hooks).toContain('/admin/settings?reason=account_deletion_pending');
	});
});

describe('#4699 (4) 支払い失敗 (dunning) 中でも退会セクションが出る', () => {
	it('Danger Zone の条件が tenantStatus ではなく退会申請中かどうかで決まる', () => {
		const accountPage = read('src/routes/(parent)/admin/settings/account/+page.svelte');
		const dangerZoneCondition = accountPage
			.split('\n')
			.find(
				(line) =>
					line.includes('data-testid="account-danger-zone"') === false &&
					line.includes("$page.data.authMode === 'cognito' &&"),
			);
		expect(dangerZoneCondition, 'Danger Zone の {#if} 行が見つからない').toBeDefined();
		expect(dangerZoneCondition).toContain('gracePeriodStatus?.isSoftDeleted');
		// #3993 で dunning の意味に確定した grace_period を表示条件に使わない
		expect(dangerZoneCondition).not.toContain('SUBSCRIPTION_STATUS.GRACE_PERIOD');
	});
});
