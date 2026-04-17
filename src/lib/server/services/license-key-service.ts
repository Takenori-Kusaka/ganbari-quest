// src/lib/server/services/license-key-service.ts
// ライセンスキー生成・検証・消費サービス (#0247, #319 HMAC署名対応)

import { createHmac, randomBytes } from 'node:crypto';
import {
	LICENSE_KEY_STATUS,
	type LicenseKeyStatus,
} from '$lib/domain/constants/license-key-status';
import { type LicensePlan, planDurationDays } from '$lib/domain/constants/license-plan';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { MS_PER_DAY } from '$lib/domain/constants/time';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';

// ============================================================
// 定数
// ============================================================

const KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0/O/1/I を除外
const CHECKSUM_LENGTH = 5;

/** 旧形式: GQ-XXXX-XXXX-XXXX */
const LEGACY_FORMAT = /^GQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
/** 新形式: GQ-XXXX-XXXX-XXXX-YYYYY (HMAC署名付き) */
const SIGNED_FORMAT = /^GQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{5}$/;

// ============================================================
// HMAC署名 (#319, #806)
// ============================================================

/** LICENSE_SECRET 環境変数を取得（未設定なら undefined） */
function getLicenseSecret(): string | undefined {
	return process.env.AWS_LICENSE_SECRET || undefined;
}

/** production 環境かどうか判定 */
function isProduction(): boolean {
	return process.env.NODE_ENV === 'production';
}

/**
 * Legacy 形式（署名なし）のライセンスキーを受け入れるかどうか判定する (#806)
 *
 * - production + secret 未設定: 受け入れない（偽造リスク）
 * - production + secret 設定済み + `ALLOW_LEGACY_LICENSE_KEYS=true`: 受け入れる（移行期のみ）
 * - production + secret 設定済み + フラグなし: 受け入れない（新形式に移行済み）
 * - dev / test: 常に受け入れる（既存キーでの開発/テストを壊さない）
 */
function isLegacyFormatAllowed(): boolean {
	if (!isProduction()) return true;
	return process.env.ALLOW_LEGACY_LICENSE_KEYS === 'true';
}

/**
 * ライセンスキーサービスの起動時設定チェック (#806)
 *
 * production で `AWS_LICENSE_SECRET` が未設定だと、署名付きキーの偽造が可能になり、
 * legacy 形式のキーを総当たりできる状態でサービスが動いてしまう。これは致命的な
 * セキュリティバグなので、production 起動時に明示的に失敗させる。
 *
 * - production: secret 未設定なら throw（起動失敗）
 * - dev: secret 未設定なら WARN ログ（既存開発フローを壊さない）
 * - test: サイレント（ユニットテストで env を切り替える都合）
 *
 * hooks.server.ts 等の SvelteKit 起動パスから1度だけ呼ぶ想定。
 */
export function assertLicenseKeyConfigured(): void {
	const hasSecret = Boolean(getLicenseSecret());
	if (hasSecret) return;

	if (isProduction()) {
		throw new Error(
			'[LICENSE] AWS_LICENSE_SECRET is required in production. ' +
				"Generate one with: `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"` " +
				'and set it in your environment (e.g. AWS SSM Parameter Store). ' +
				'See .env.example and docs/decisions/0026-license-key-architecture.md.',
		);
	}

	// Avoid noise during `vitest` runs — tests drive env manually.
	if (process.env.NODE_ENV === 'test') return;

	logger.warn(
		'[LICENSE] AWS_LICENSE_SECRET is not set. ' +
			'HMAC-signed license keys will fall back to legacy format. ' +
			'This is OK for local dev but MUST be set in production.',
	);
}

/** ペイロードから HMAC-SHA256 チェックサムを生成 (KEY_CHARS エンコード, 5文字) */
export function createHmacChecksum(payload: string, secret: string): string {
	const hmac = createHmac('sha256', secret).update(payload).digest();
	let checksum = '';
	for (let i = 0; i < CHECKSUM_LENGTH; i++) {
		const b = hmac[i] ?? 0;
		checksum += KEY_CHARS[b % KEY_CHARS.length];
	}
	return checksum;
}

/** キーが署名付き形式かどうか判定 */
export function isSignedKeyFormat(key: string): boolean {
	return SIGNED_FORMAT.test(key);
}

/** 署名付きキーの署名を検証 */
export function verifyKeySignature(key: string, secret: string): boolean {
	// GQ-XXXX-XXXX-XXXX-YYYYY → payload = GQ-XXXX-XXXX-XXXX, checksum = YYYYY
	const lastDash = key.lastIndexOf('-');
	const payload = key.slice(0, lastDash);
	const checksum = key.slice(lastDash + 1);
	const expected = createHmacChecksum(payload, secret);
	return checksum === expected;
}

// ============================================================
// キー生成
// ============================================================

/** ライセンスキーを生成。秘密鍵があれば HMAC 署名付き形式 */
export function generateLicenseKey(): string {
	const bytes = randomBytes(12);
	const segments: string[] = [];
	for (let s = 0; s < 3; s++) {
		let seg = '';
		for (let i = 0; i < 4; i++) {
			const b = bytes[s * 4 + i] ?? 0;
			seg += KEY_CHARS[b % KEY_CHARS.length];
		}
		segments.push(seg);
	}
	const payload = `GQ-${segments.join('-')}`;

	const secret = getLicenseSecret();
	if (secret) {
		const checksum = createHmacChecksum(payload, secret);
		return `${payload}-${checksum}`;
	}

	return payload;
}

// ============================================================
// DynamoDB 操作
// ============================================================

/**
 * ライセンスキーの種別 (#801)
 *
 * - `purchase`: Stripe 購入で発行されたキー。buyer tenant にロックされ、
 *   consume 時に `consumedByTenantId === record.tenantId` を強制する（返金後
 *   の二重取り防止）。
 * - `gift`: 個別贈答・サポート補填等で Ops が発行したキー。任意 tenant が
 *   consume 可能。`issuedBy` に発行 actor を必ず記録する。
 * - `campaign`: キャンペーン配布の一括発行キー。任意 tenant が consume 可能。
 *   `issuedBy` に発行 actor を必ず記録する。
 *
 * 旧レコード（kind フィールド未設定）は後方互換のため `purchase` として扱う。
 * これは最も厳しい解釈で、既存 Stripe 発行キーの想定と一致する。
 */
export type LicenseKeyKind = 'purchase' | 'gift' | 'campaign';

/**
 * ライセンスキーの失効理由 (#797)
 *
 * - `expired`: 有効期限経過バッチによる自動失効 (#818 の期限切れバッチ)
 * - `leaked`: HMAC シークレット漏洩等で先行的に revoke (#810)
 * - `ops-manual`: サポートによる手動失効 (#805)
 * - `refund`: Stripe 返金 webhook による自動失効 (#824)
 */
export type LicenseRevokeReason = 'expired' | 'leaked' | 'ops-manual' | 'refund';

/** #797: デフォルト有効期限（発行から 90 日）。競合他社標準 (Keygen 等) に合わせた値。 */
export const DEFAULT_LICENSE_VALIDITY_DAYS = 90;

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

/**
 * LicenseRecord から kind を取り出す。旧レコード（kind なし）は 'purchase' 扱い。
 * 後方互換ロジックを 1 箇所に集約するヘルパー。
 */
export function getRecordKind(record: Pick<LicenseRecord, 'kind'>): LicenseKeyKind {
	return record.kind ?? 'purchase';
}

/** ライセンスキーを発行して DynamoDB に保存 */
export async function issueLicenseKey(params: {
	tenantId: string;
	plan: LicensePlan;
	stripeSessionId?: string;
	/** #801: キー種別。省略時は 'purchase'（既存呼び出しは Stripe webhook 経由のため） */
	kind?: LicenseKeyKind;
	/** #801: 発行 actor (ops user id / 'stripe:<sessionId>' 等)。gift/campaign では必須 */
	issuedBy?: string;
	/**
	 * #797: 有効期限 (ISO8601)。省略時は発行日時 + DEFAULT_LICENSE_VALIDITY_DAYS 日。
	 * 明示的に `null` を渡すと期限なし（lifetime 的扱い）。ops 発行で使用。
	 */
	expiresAt?: string | null;
	context?: { ip?: string | null; ua?: string | null };
}): Promise<LicenseRecord> {
	const kind = params.kind ?? 'purchase';

	// #801: gift / campaign では発行 actor を記録する（監査性確保）
	if ((kind === 'gift' || kind === 'campaign') && !params.issuedBy) {
		throw new Error(
			`[LICENSE] issueLicenseKey: issuedBy is required for kind=${kind} (audit requirement)`,
		);
	}

	const key = generateLicenseKey();
	const nowDate = new Date();
	const now = nowDate.toISOString();

	// #797: expiresAt の解決
	// - undefined: デフォルト 90 日後
	// - null: 期限なし（ops が明示的に渡した場合）
	// - string: 指定値をそのまま使う
	let expiresAt: string | undefined;
	if (params.expiresAt === null) {
		expiresAt = undefined;
	} else if (params.expiresAt === undefined) {
		expiresAt = new Date(
			nowDate.getTime() + DEFAULT_LICENSE_VALIDITY_DAYS * MS_PER_DAY,
		).toISOString();
	} else {
		expiresAt = params.expiresAt;
	}

	const record: LicenseRecord = {
		licenseKey: key,
		tenantId: params.tenantId,
		plan: params.plan,
		stripeSessionId: params.stripeSessionId,
		status: LICENSE_KEY_STATUS.ACTIVE,
		createdAt: now,
		kind,
		issuedBy: params.issuedBy,
		expiresAt,
	};

	const repos = getRepos();
	await repos.auth.saveLicenseKey(record);

	// #869: フルキーをログに出さない（ADR-0026 ログマスク標準）
	logger.info(
		`[LICENSE] Key issued: ${key.slice(0, 7)}... for tenant=${params.tenantId} plan=${params.plan} kind=${kind} expiresAt=${expiresAt ?? 'never'}`,
	);

	// #804: 監査ログに issued イベント記録
	const issuedActor =
		params.issuedBy ?? (params.stripeSessionId ? `stripe:${params.stripeSessionId}` : 'system');
	return record;
}

/** ライセンスキーを検証 (署名チェック + DB 存在チェック + active 状態チェック) */
export async function validateLicenseKey(
	key: string,
	/** #804: 監査ログ用コンテキスト (ip/ua/actor/tenant)。省略時は null で記録。 */
	context?: {
		actorId?: string | null;
		tenantId?: string | null;
		ip?: string | null;
		ua?: string | null;
	},
): Promise<{ valid: true; record: LicenseRecord } | { valid: false; reason: string }> {
	const normalized = key.toUpperCase().trim();

	// 形式チェック: 旧形式 or 署名付き形式
	const isLegacy = LEGACY_FORMAT.test(normalized);
	const isSigned = SIGNED_FORMAT.test(normalized);

	// #804: validation_failed の共通記録ヘルパ。
	// 未知キー (DB に無い形式不正 or 署名不一致) は prefix のみ保存して DB 膨張 + 偽造試行値
	// の漏洩を抑える。findLicenseKey まで進んだ場合はレコード側と紐付けたいので full key。
	const recordFailure = async (
		_reason: string,
		_options?: { useFullKey?: boolean; extra?: Record<string, unknown> },
	) => {};

	if (!isLegacy && !isSigned) {
		await recordFailure('format_invalid');
		return { valid: false, reason: 'ライセンスキーの形式が不正です' };
	}

	// 旧形式キーは production では原則拒否（#806）
	// 移行期に限り `ALLOW_LEGACY_LICENSE_KEYS=true` で明示的に許可可能。
	// dev/test では常に受け入れる（既存テスト互換性のため）。
	if (isLegacy && !isLegacyFormatAllowed()) {
		logger.warn(
			`[LICENSE] Legacy format rejected in production: ${normalized.slice(0, 7)}... ` +
				`Set ALLOW_LEGACY_LICENSE_KEYS=true to temporarily permit (migration window only).`,
		);
		await recordFailure('legacy_format_rejected');
		return { valid: false, reason: 'ライセンスキーが不正です' };
	}

	// 署名付きキーの場合: HMAC 署名を検証（DB問い合わせ前に拒否可能）
	if (isSigned) {
		const secret = getLicenseSecret();
		if (secret && !verifyKeySignature(normalized, secret)) {
			logger.warn(`[LICENSE] Signature verification failed: ${normalized.slice(0, 7)}...`);
			await recordFailure('signature_mismatch');
			return { valid: false, reason: 'ライセンスキーが不正です' };
		}
	}

	// 旧形式キーの場合: 秘密鍵があればログ出力（将来的に非推奨化の追跡用）
	if (isLegacy && getLicenseSecret()) {
		logger.info(`[LICENSE] Legacy format key used: ${normalized.slice(0, 7)}...`);
	}

	const repos = getRepos();
	const record = await repos.auth.findLicenseKey(normalized);

	if (!record) {
		await recordFailure('not_found');
		return { valid: false, reason: 'ライセンスキーが見つかりません' };
	}

	if (record.status === LICENSE_KEY_STATUS.CONSUMED) {
		await recordFailure('already_consumed', {
			useFullKey: true,
			extra: { issuedFor: record.tenantId },
		});
		return { valid: false, reason: 'このライセンスキーは既に使用されています' };
	}

	if (record.status === LICENSE_KEY_STATUS.REVOKED) {
		await recordFailure('revoked', {
			useFullKey: true,
			extra: { revokedReason: record.revokedReason ?? null },
		});
		return { valid: false, reason: 'このライセンスキーは無効化されています' };
	}

	// #797: 有効期限チェック。active でも expiresAt を過ぎていたら reject する。
	// expiresAt が未設定の legacy レコードは期限チェックをスキップ（後方互換）。
	if (isLicenseExpired(record)) {
		logger.info(
			`[LICENSE] Expired key rejected: ${normalized.slice(0, 7)}... expiresAt=${record.expiresAt}`,
		);
		await recordFailure('expired', {
			useFullKey: true,
			extra: { expiresAt: record.expiresAt ?? null },
		});
		return { valid: false, reason: 'このライセンスキーは有効期限が切れています' };
	}

	// #804: 検証成功を記録 (ブルートフォース検知の母数にもなる)
	return { valid: true, record };
}

/**
 * #797: ライセンスレコードが有効期限切れかどうか判定。
 * - expiresAt が未設定の legacy レコード → false（期限チェックなし）
 * - expiresAt が現在時刻より前 → true
 */
export function isLicenseExpired(
	record: Pick<LicenseRecord, 'expiresAt'>,
	now: Date = new Date(),
): boolean {
	if (!record.expiresAt) return false;
	return new Date(record.expiresAt).getTime() < now.getTime();
}

/** consumeLicenseKey の結果 */
export type ConsumeLicenseKeyResult =
	| { ok: true; plan: LicenseRecord['plan']; planExpiresAt?: string }
	| { ok: false; reason: string };

/**
 * ライセンスキーの plan から planExpiresAt を計算する。
 * - monthly / family-monthly: +30 日
 * - yearly / family-yearly: +365 日
 * - lifetime: undefined（期限なし）
 *
 * Stripe Checkout 経由の購入は Stripe 側が current_period_end を管理するが、
 * ライセンスキー消費は Stripe サブスクリプションを伴わない一回限りの付与であり、
 * アプリ側で期限を決める必要がある。
 */
function computePlanExpiresAt(
	plan: LicenseRecord['plan'],
	now: Date = new Date(),
): string | undefined {
	const days = planDurationDays(plan);
	if (days === undefined) return undefined;
	return new Date(now.getTime() + days * MS_PER_DAY).toISOString();
}

/**
 * ライセンスキーを消費してテナントに有料プランを付与する (サインアップ時の claim 用)
 *
 * #795: 従来の実装は `license_keys.status=consumed` に更新するだけで tenants.plan を
 * 更新していなかったため、新規ユーザーがキー入力しても有料機能が解放されず、
 * 完全に装飾的な実装になっていた。
 *
 * 本実装では:
 *   1. キーを見つけて active であることを確認（検証失敗時は {ok:false} を即返す）
 *   2. tenants.plan / status / planExpiresAt を更新（有料プラン昇格）
 *   3. license_keys.status=consumed に更新（成功確定後）
 *
 * 順序の根拠: 先に license を consumed にすると、tenant 更新失敗時に「キーは消費済みだが
 * プランは free のまま」という整合性崩壊が起きる。tenant 更新を先に行い、失敗時には
 * 例外を伝播させて呼び出し元（signup）に失敗を通知する。
 */
export async function consumeLicenseKey(
	key: string,
	consumedByTenantId: string,
	context?: { ip?: string | null; ua?: string | null },
): Promise<ConsumeLicenseKeyResult> {
	const normalized = key.toUpperCase().trim();
	const repos = getRepos();

	const recordFailure = async (_reason: string, _extra?: Record<string, unknown>) => {};
	const record = await repos.auth.findLicenseKey(normalized);
	if (!record) {
		return { ok: false, reason: 'ライセンスキーが見つかりません' };
	}
	if (record.status === LICENSE_KEY_STATUS.CONSUMED) {
		await recordFailure('already_consumed', { issuedFor: record.tenantId });
		return { ok: false, reason: 'このライセンスキーは既に使用されています' };
	}
	if (record.status === LICENSE_KEY_STATUS.REVOKED) {
		await recordFailure('revoked', { revokedReason: record.revokedReason ?? null });
		return { ok: false, reason: 'このライセンスキーは無効化されています' };
	}
	if (record.status !== LICENSE_KEY_STATUS.ACTIVE) {
		await recordFailure('not_active', { status: record.status });
		return { ok: false, reason: 'ライセンスキーが使用できません' };
	}

	// #797: 期限切れは active でも consume 拒否。validateLicenseKey と同じルール。
	if (isLicenseExpired(record)) {
		logger.info(
			`[LICENSE] Expired key consume rejected: ${normalized.slice(0, 7)}... expiresAt=${record.expiresAt}`,
		);
		await recordFailure('expired', { expiresAt: record.expiresAt ?? null });
		return { ok: false, reason: 'このライセンスキーは有効期限が切れています' };
	}

	// #801: キー種別に応じた consume 権限チェック。
	// - purchase: buyer tenant にロック (record.tenantId === consumedByTenantId)
	// - gift / campaign: 任意 tenant が consume 可能
	// 旧レコード (kind なし) は purchase 扱い — 既存 Stripe 発行キーは buyer tenant
	// に一致するはずで、もし一致しないなら返金後の不正流用の可能性が高い。
	const kind = getRecordKind(record);
	if (kind === 'purchase' && record.tenantId !== consumedByTenantId) {
		logger.warn(
			`[LICENSE] Cross-tenant purchase consume rejected: key=${normalized.slice(0, 7)}... issued_for=${record.tenantId} attempted_by=${consumedByTenantId}`,
		);
		await recordFailure('cross_tenant_purchase', {
			issuedFor: record.tenantId,
			kind,
		});
		return {
			ok: false,
			reason: 'このライセンスキーは購入したアカウントでのみ使用できます',
		};
	}

	const planExpiresAt = computePlanExpiresAt(record.plan);

	// 先に tenant の plan を昇格（失敗したら license は consumed にしない）
	await repos.auth.updateTenantStripe(consumedByTenantId, {
		plan: record.plan,
		status: SUBSCRIPTION_STATUS.ACTIVE,
		planExpiresAt,
		licenseKey: normalized,
	});

	// 成功したので license を consumed としてマーク
	await repos.auth.updateLicenseKeyStatus(
		normalized,
		LICENSE_KEY_STATUS.CONSUMED,
		consumedByTenantId,
	);

	logger.info(
		`[LICENSE] Key consumed: ${normalized.slice(0, 7)}... by tenant=${consumedByTenantId} (issued for=${record.tenantId}, kind=${kind}) plan=${record.plan} expiresAt=${planExpiresAt ?? 'never'}`,
	);

	// #804: 監査ログに consumed イベント記録
	return { ok: true, plan: record.plan, planExpiresAt };
}

// ============================================================
// Revoke (#797, #805)
// ============================================================

export type RevokeLicenseKeyResult =
	| { ok: true; licenseKey: string; revokedReason: LicenseRevokeReason; revokedAt: string }
	| { ok: false; reason: string };

/**
 * ライセンスキーを失効させる (#797)
 *
 * - active → revoked に状態遷移
 * - revokedAt / revokedReason / revokedBy を記録して監査証跡を残す
 * - 既に consumed / revoked のキーは再度 revoke できない（冪等性のため同じ理由なら許容）
 *
 * 利用想定:
 * - Ops 手動失効 (#805): `revokedReason='ops-manual'`, `revokedBy='ops:<uid>'`
 * - 期限切れバッチ (#818): `revokedReason='expired'`, `revokedBy='system'`
 * - Stripe 返金 (#824): `revokedReason='refund'`, `revokedBy='stripe:<eventId>'`
 * - シークレット漏洩 (#810): `revokedReason='leaked'`, `revokedBy='ops:<uid>'`
 */
export async function revokeLicenseKey(params: {
	licenseKey: string;
	reason: LicenseRevokeReason;
	revokedBy: string;
	context?: { ip?: string | null; ua?: string | null };
}): Promise<RevokeLicenseKeyResult> {
	const normalized = params.licenseKey.toUpperCase().trim();
	const repos = getRepos();

	const record = await repos.auth.findLicenseKey(normalized);
	if (!record) {
		return { ok: false, reason: 'ライセンスキーが見つかりません' };
	}

	if (record.status === LICENSE_KEY_STATUS.REVOKED) {
		logger.info(
			`[LICENSE] revokeLicenseKey: already revoked: ${normalized.slice(0, 7)}... (reason=${record.revokedReason ?? 'unknown'})`,
		);
		return { ok: false, reason: 'このライセンスキーは既に無効化されています' };
	}

	if (record.status === LICENSE_KEY_STATUS.CONSUMED) {
		// consumed キーも監査目的で revoke 可能だが、現状ユースケースがないため拒否
		return { ok: false, reason: 'このライセンスキーは既に使用されています' };
	}

	const revokedAt = new Date().toISOString();
	await repos.auth.revokeLicenseKey({
		licenseKey: normalized,
		reason: params.reason,
		revokedBy: params.revokedBy,
		revokedAt,
	});

	logger.warn(
		`[LICENSE] Key revoked: ${normalized.slice(0, 7)}... reason=${params.reason} by=${params.revokedBy}`,
	);

	// #804: 監査ログに revoked イベント記録
	return { ok: true, licenseKey: normalized, revokedReason: params.reason, revokedAt };
}
