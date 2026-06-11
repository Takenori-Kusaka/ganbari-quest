// src/lib/server/services/pin-operator-reset.ts — #2994 (EPIC #2990)
//
// operator-level PIN reset: self-host (docker-compose / PaaS / NUC) の運用者が、
// メールに依存せず env 1 つで PIN を既定状態 (未設定) に戻す。次回 /switch アクセスで
// 初回作成フロー (#2992) に誘導されるため、env に平文 PIN を置かない (Vaultwarden 整合)。
//
// 設計 (Issue #2994 / deep research a934ba):
//   - env `PARENT_PIN_RESET=<token>` が無い通常運用は完全 no-op (攻撃面を増やさない)
//   - 同 token は二度と適用しない (settings `pin_reset_applied` フラグ照合、冪等。
//     Django changepassword の非冪等が反面教師: env を残したまま再起動しても再 reset されない)
//   - 「制御面アクセス (サーバ/デプロイ環境の env を書ける) = owner」という実認証に寄生する。
//     PIN は実認証でなく speed bump のため、リカバリーコード / magic link は不採用 (PO 確定)
//   - cognito SaaS はマルチテナントで env から対象 tenant を特定できないため対象外
//     (運用者フォールバックは docs/runbooks/operator-pin-reset.md の DynamoDB 手順)
//   - settings repo (SQLite/DynamoDB/demo 抽象) 経由のため 3 形態同一コード

import { getAuthMode } from '$lib/server/auth/factory';
import { getSetting, setSetting } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';
import { env } from '$lib/runtime/env';

/** AUTH_MODE=local は単一 tenant ('local' 固定、local.ts provider と同値) */
const LOCAL_TENANT_ID = 'local';

/** プロセスごとに 1 回だけ評価する (2 回目以降は同期 return で zero cost) */
let evaluatedThisProcess = false;

/** unit test 用: プロセス内評価フラグをリセットする */
export function resetOperatorPinResetForTesting(): void {
	evaluatedThisProcess = false;
}

/**
 * 起動後の最初のリクエストで 1 回評価し、`PARENT_PIN_RESET` が未適用 token なら
 * PIN を既定状態 (未設定 = 初回作成フロー誘導) に初期化する。
 *
 * 呼び出し: hooks.server.ts handle 先頭 (getOrInitDb 直後)。DB 接続確立後である必要がある。
 */
export async function applyOperatorPinResetIfRequested(): Promise<void> {
	if (evaluatedThisProcess) return;
	evaluatedThisProcess = true;

	const token = env.PARENT_PIN_RESET;
	if (!token) return; // env 無し = 完全 no-op

	if (getAuthMode() !== 'local') {
		// cognito / anonymous はマルチテナント or demo のため env reset 対象外。
		// 設定ミスを運用者が気づけるよう警告だけ残す (reset は行わない)。
		logger.warn(
			'[PIN_RESET] PARENT_PIN_RESET は AUTH_MODE=local でのみ有効です (runbook の形態別手順を参照)',
			{ context: { authMode: getAuthMode() } },
		);
		return;
	}

	const applied = await getSetting('pin_reset_applied', LOCAL_TENANT_ID);
	if (applied === token) {
		// 適用済 token: 冪等 no-op。env の unset 忘れ (Metabase 反面教師) でも再 reset しない
		logger.info('[PIN_RESET] PARENT_PIN_RESET は適用済みです (env の削除を推奨)', {
			context: { tokenPrefix: token.slice(0, 8) },
		});
		return;
	}

	// 既定状態に初期化: pin_hash 空 (= isPinConfigured false → #2992 初回作成フロー) +
	// 失敗カウンタ / ロックアウトも解除 (ロック中に忘れたケースの救済)
	await setSetting('pin_hash', '', LOCAL_TENANT_ID);
	await setSetting('pin_failed_attempts', '0', LOCAL_TENANT_ID);
	await setSetting('pin_locked_until', '', LOCAL_TENANT_ID);
	await setSetting('pin_reset_applied', token, LOCAL_TENANT_ID);

	// audit log (適用事実の記録、AC6)
	logger.warn(
		'[AUDIT] [PIN_RESET] operator PIN reset を適用しました — PIN は未設定状態に戻り、次回アクセスで新規作成フローになります。適用後は PARENT_PIN_RESET env を削除してください',
		{ context: { tokenPrefix: token.slice(0, 8), tenantId: LOCAL_TENANT_ID } },
	);
}
