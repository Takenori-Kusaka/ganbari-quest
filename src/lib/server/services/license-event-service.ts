// src/lib/server/services/license-event-service.ts
// #804: ライセンスキー監査ログサービス
//
// license-key-service の各ライフサイクル操作から呼ばれる。記録失敗は呼び出し元の
// ビジネスロジックを阻害してはならない（監査ログが落ちても本処理は完走させる）。
// ops 側の一覧 / キー別履歴 / IP 別失敗集計 もここから提供する。

import { getRepos } from '$lib/server/db/factory';
import type {
	LicenseEventRow,
	LicenseEventType,
} from '$lib/server/db/interfaces/license-event-repo.interface';
import { logger } from '$lib/server/logger';

/**
 * ライセンスキーの先頭プレフィックスのみ取り出す。
 * validation_failed で未知キーが入力された場合に、
 * DB 膨張と偽造試行値の漏洩を抑えるために使う。
 */
export function licenseKeyPrefix(key: string, len = 7): string {
	const normalized = (key ?? '').toString().toUpperCase().trim();
	if (normalized.length <= len) return normalized;
	return `${normalized.slice(0, len)}...`;
}

export interface LicenseEventContext {
	/** 'stripe:<session>' / 'ops:<uid>' / 'tenant:<id>' / 'system' / null */
	actorId?: string | null;
	tenantId?: string | null;
	ip?: string | null;
	ua?: string | null;
}

export interface RecordLicenseEventInput extends LicenseEventContext {
	eventType: LicenseEventType;
	licenseKey: string;
	metadata?: Record<string, unknown> | null;
}

export async function recordLicenseEvent(input: RecordLicenseEventInput): Promise<void> {
	try {
		await getRepos().licenseEvent.insert({
			eventType: input.eventType,
			licenseKey: input.licenseKey,
			tenantId: input.tenantId ?? null,
			actorId: input.actorId ?? null,
			ip: input.ip ?? null,
			ua: input.ua ?? null,
			metadata: input.metadata ?? null,
		});
	} catch (e) {
		logger.error('[LICENSE_EVENT] Failed to record event', {
			context: {
				eventType: input.eventType,
				keyPrefix: licenseKeyPrefix(input.licenseKey),
				error: e instanceof Error ? e.message : String(e),
			},
		});
	}
}

export interface LicenseEventEntry {
	id: number;
	eventType: LicenseEventType;
	licenseKey: string;
	tenantId: string | null;
	actorId: string | null;
	ip: string | null;
	ua: string | null;
	metadata: Record<string, unknown> | null;
	createdAt: string;
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === 'object' && parsed !== null
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function toEntry(row: LicenseEventRow): LicenseEventEntry {
	return {
		id: row.id,
		eventType: row.eventType,
		licenseKey: row.licenseKey,
		tenantId: row.tenantId,
		actorId: row.actorId,
		ip: row.ip,
		ua: row.ua,
		metadata: parseMetadata(row.metadata),
		createdAt: row.createdAt,
	};
}

export async function listEventsByLicenseKey(
	licenseKey: string,
	limit = 100,
): Promise<LicenseEventEntry[]> {
	const normalized = licenseKey.toUpperCase().trim();
	const rows = await getRepos().licenseEvent.findByLicenseKey(normalized, limit);
	return rows.map(toEntry);
}

export async function listRecentEvents(limit = 100): Promise<LicenseEventEntry[]> {
	const rows = await getRepos().licenseEvent.findRecent(limit);
	return rows.map(toEntry);
}

export async function countRecentFailuresByIp(
	windowMinutes = 10,
	limit = 20,
): Promise<Array<{ ip: string; count: number }>> {
	return getRepos().licenseEvent.countRecentFailuresByIp(windowMinutes, limit);
}
