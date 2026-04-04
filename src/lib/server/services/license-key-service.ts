// src/lib/server/services/license-key-service.ts
// ライセンスキー生成・検証・消費サービス (#0247, #319 HMAC署名対応)

import { createHmac, randomBytes } from 'node:crypto';
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
// HMAC署名 (#319)
// ============================================================

/** LICENSE_SECRET 環境変数を取得（未設定なら undefined） */
function getLicenseSecret(): string | undefined {
	return process.env.AWS_LICENSE_SECRET || undefined;
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

export interface LicenseRecord {
	licenseKey: string;
	tenantId: string;
	plan: 'monthly' | 'yearly' | 'family-monthly' | 'family-yearly' | 'lifetime';
	stripeSessionId?: string;
	status: 'active' | 'consumed' | 'revoked';
	consumedBy?: string;
	consumedAt?: string;
	createdAt: string;
}

/** ライセンスキーを発行して DynamoDB に保存 */
export async function issueLicenseKey(params: {
	tenantId: string;
	plan: 'monthly' | 'yearly' | 'family-monthly' | 'family-yearly' | 'lifetime';
	stripeSessionId?: string;
}): Promise<LicenseRecord> {
	const key = generateLicenseKey();
	const now = new Date().toISOString();

	const record: LicenseRecord = {
		licenseKey: key,
		tenantId: params.tenantId,
		plan: params.plan,
		stripeSessionId: params.stripeSessionId,
		status: 'active',
		createdAt: now,
	};

	const repos = getRepos();
	await repos.auth.saveLicenseKey(record);

	logger.info(`[LICENSE] Key issued: ${key} for tenant=${params.tenantId} plan=${params.plan}`);
	return record;
}

/** ライセンスキーを検証 (署名チェック + DB 存在チェック + active 状態チェック) */
export async function validateLicenseKey(
	key: string,
): Promise<{ valid: true; record: LicenseRecord } | { valid: false; reason: string }> {
	const normalized = key.toUpperCase().trim();

	// 形式チェック: 旧形式 or 署名付き形式
	const isLegacy = LEGACY_FORMAT.test(normalized);
	const isSigned = SIGNED_FORMAT.test(normalized);

	if (!isLegacy && !isSigned) {
		return { valid: false, reason: 'ライセンスキーの形式が不正です' };
	}

	// 署名付きキーの場合: HMAC 署名を検証（DB問い合わせ前に拒否可能）
	if (isSigned) {
		const secret = getLicenseSecret();
		if (secret && !verifyKeySignature(normalized, secret)) {
			logger.warn(`[LICENSE] Signature verification failed: ${normalized.slice(0, 7)}...`);
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
		return { valid: false, reason: 'ライセンスキーが見つかりません' };
	}

	if (record.status === 'consumed') {
		return { valid: false, reason: 'このライセンスキーは既に使用されています' };
	}

	if (record.status === 'revoked') {
		return { valid: false, reason: 'このライセンスキーは無効化されています' };
	}

	return { valid: true, record };
}

/** ライセンスキーを消費 (サインアップ時にテナントに紐付け) */
export async function consumeLicenseKey(key: string, consumedByTenantId: string): Promise<boolean> {
	const normalized = key.toUpperCase().trim();
	const repos = getRepos();

	const record = await repos.auth.findLicenseKey(normalized);
	if (!record || record.status !== 'active') return false;

	await repos.auth.updateLicenseKeyStatus(normalized, 'consumed', consumedByTenantId);

	logger.info(
		`[LICENSE] Key consumed: ${normalized.slice(0, 7)}... by tenant=${consumedByTenantId} (issued for=${record.tenantId})`,
	);
	return true;
}
