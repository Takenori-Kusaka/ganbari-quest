// src/lib/server/services/license-key-service.ts
// ライセンスキー生成・検証・消費サービス (#0247)

import { randomBytes } from 'node:crypto';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';

// ============================================================
// キー生成
// ============================================================

const KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0/O/1/I を除外

/** GQ-XXXX-XXXX-XXXX 形式のライセンスキーを生成 */
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
	return `GQ-${segments.join('-')}`;
}

// ============================================================
// DynamoDB 操作
// ============================================================

export interface LicenseRecord {
	licenseKey: string;
	tenantId: string;
	plan: 'monthly' | 'yearly' | 'lifetime';
	stripeSessionId?: string;
	status: 'active' | 'consumed' | 'revoked';
	consumedBy?: string;
	consumedAt?: string;
	createdAt: string;
}

/** ライセンスキーを発行して DynamoDB に保存 */
export async function issueLicenseKey(params: {
	tenantId: string;
	plan: 'monthly' | 'yearly' | 'lifetime';
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

/** ライセンスキーを検証 (存在チェック + active 状態チェック) */
export async function validateLicenseKey(
	key: string,
): Promise<{ valid: true; record: LicenseRecord } | { valid: false; reason: string }> {
	const normalized = key.toUpperCase().trim();

	if (!/^GQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized)) {
		return { valid: false, reason: 'ライセンスキーの形式が不正です' };
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
		`[LICENSE] Key consumed: ${normalized} by tenant=${consumedByTenantId} (issued for=${record.tenantId})`,
	);
	return true;
}
