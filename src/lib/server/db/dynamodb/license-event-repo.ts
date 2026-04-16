// src/lib/server/db/dynamodb/license-event-repo.ts
// DynamoDB stub for ILicenseEventRepo (#804)
// 実装は DynamoDB テーブル追加 PR で差し替える。
// 現時点では no-op でインタフェース契約のみ満たす。
//
// 予定スキーマ:
//   PK = `LICENSE_EVENT#${licenseKey}` / SK = `EVENT#${createdAt}#${id}`
//   GSI1 (直近イベント一覧)    : PK = 'LICENSE_EVENT_ALL' / SK = createdAt
//   GSI2 (IP 別 fail 集計用)   : PK = `LICENSE_FAIL_IP#${ip}` / SK = createdAt

import type {
	InsertLicenseEventInput,
	LicenseEventRow,
} from '../interfaces/license-event-repo.interface';

export async function insert(_input: InsertLicenseEventInput): Promise<void> {
	// TODO(#804 follow-up): DynamoDB 実装。
}

export async function findByLicenseKey(
	_licenseKey: string,
	_limit: number,
): Promise<LicenseEventRow[]> {
	return [];
}

export async function findRecent(_limit: number): Promise<LicenseEventRow[]> {
	return [];
}

export async function countRecentFailuresByIp(
	_windowMinutes: number,
	_limit: number,
): Promise<Array<{ ip: string; count: number }>> {
	return [];
}
