// src/lib/server/db/interfaces/license-record.types.ts
//
// LicenseRecord 系の型定義 (旧 license-key-service.ts から移設)。
//
// Epic #2525 Phase 7 PR-L3 (#2818) で license-key-service.ts (ロジック 700 行) を物理削除した際、
// DB 層 (auth-repo interface / dynamodb / demo) が依然として `LicenseRecord` / `LicenseRevokeReason`
// / `LicenseKeyKind` 型を参照するため、型定義のみをここに退避した。
//
// expand-contract (`phase1-license-key-removal-final-requirements.md` §3.8):
//   - 本 PR-L3 (expand): service ロジックは削除し、型 + DB interface メソッドは dead 化のまま残す
//   - PR-L5 (contract): `licenseKey` 列 DROP + `LICENSE_KEY_STATUS`/`LICENSE_PLAN` enum 削除 +
//     `LicenseRecord` table DROP と同時に本ファイルも削除する (rollback 不可点)
//
// 注: ここに DB アクセス・HMAC 署名・consume/revoke 等のビジネスロジックは置かない (型のみ)。

import type { LicenseKeyStatus } from '$lib/domain/constants/license-key-status';
import type { LicensePlan } from '$lib/domain/constants/license-plan';

/**
 * ライセンスキーの種別 (#801)
 *
 * - `purchase`: Stripe 購入で発行されたキー。
 * - `gift`: 個別贈答・サポート補填等で Ops が発行したキー。
 * - `campaign`: キャンペーン配布の一括発行キー。
 *
 * 旧レコード（kind フィールド未設定）は後方互換のため `purchase` として扱う。
 */
export type LicenseKeyKind = 'purchase' | 'gift' | 'campaign';

/**
 * ライセンスキーの失効理由 (#797)
 *
 * - `expired`: 有効期限経過バッチによる自動失効
 * - `leaked`: HMAC シークレット漏洩等で先行的に revoke
 * - `ops-manual`: サポートによる手動失効
 * - `refund`: Stripe 返金 webhook による自動失効
 */
export type LicenseRevokeReason = 'expired' | 'leaked' | 'ops-manual' | 'refund';

export interface LicenseRecord {
	licenseKey: string;
	tenantId: string;
	plan: LicensePlan;
	stripeSessionId?: string;
	status: LicenseKeyStatus;
	consumedBy?: string;
	consumedAt?: string;
	createdAt: string;
	/** #801: キー種別。未設定レコードは 'purchase' として扱う（後方互換） */
	kind?: LicenseKeyKind;
	/** #801: 発行 actor。gift/campaign では必須。purchase では stripe webhook 由来 */
	issuedBy?: string;
	/** #797: キーの有効期限 (発行から N 日で失効)。未設定は「永久有効」ではなく legacy 扱い */
	expiresAt?: string;
	/** #797: revoke された日時 (status='revoked' と対になる) */
	revokedAt?: string;
	/** #797: revoke 理由。監査ログ・CS 対応のために記録 */
	revokedReason?: LicenseRevokeReason;
	/** #797: revoke を実行した actor (`ops:<uid>` / `system` / `stripe:<eventId>`) */
	revokedBy?: string;
}
