// DynamoDB implementation of ISeasonEventRepo
//
// #2263 hotfix: 旧バージョンの未実装エラー throw で本番 500 を引き起こしていたため、
// Pre-PMF fallback (read = 空 / write = no-op + logger.warn) に置換した。
// シーズンイベント機能は本番未活用 (#2263 root cause: 呼び出し側が SSR でこの repo を経由するが
// 機能自体は Pre-PMF で未提供)。本実装は別 Issue で対応 (ADR-0010 Pre-PMF Bucket B = まだ作らない)。
//
// CI gate `scripts/check-dynamodb-stub.mjs` は GRANDFATHERED_STUBS に登録済 (#2263)。

import { logger } from '$lib/server/logger';
import type {
	ChildEventProgress,
	InsertSeasonEventInput,
	SeasonEvent,
	UpdateSeasonEventInput,
} from '../types';

const SERVICE = 'season-event-repo.dynamodb';

function warnRead(method: string, context: Record<string, unknown>): void {
	logger.warn(`[${SERVICE}] read fallback: returning empty (Pre-PMF stub, #2263)`, {
		service: SERVICE,
		context: { method, ...context },
	});
}

function warnWrite(method: string, context: Record<string, unknown>): void {
	logger.warn(`[${SERVICE}] write fallback: no-op (Pre-PMF stub, #2263)`, {
		service: SERVICE,
		context: { method, ...context },
	});
}

export async function findAllEvents(tenantId: string): Promise<SeasonEvent[]> {
	warnRead('findAllEvents', { tenantId });
	return [];
}

export async function findActiveEvents(today: string, tenantId: string): Promise<SeasonEvent[]> {
	warnRead('findActiveEvents', { today, tenantId });
	return [];
}

export async function findEventById(
	id: number,
	tenantId: string,
): Promise<SeasonEvent | undefined> {
	warnRead('findEventById', { id, tenantId });
	return undefined;
}

export async function findEventByCode(
	code: string,
	tenantId: string,
): Promise<SeasonEvent | undefined> {
	warnRead('findEventByCode', { code, tenantId });
	return undefined;
}

export async function insertEvent(
	input: InsertSeasonEventInput,
	tenantId: string,
): Promise<SeasonEvent> {
	warnWrite('insertEvent', { code: input.code, tenantId });
	// write fallback: 呼び出し側に SeasonEvent を返さねばならないので最低限の stub を返却。
	// Pre-PMF 段階で実際にこの返却値を永続化前提で使う呼び出し経路は存在しない (#2263)。
	const now = new Date().toISOString();
	return {
		id: 0,
		code: input.code,
		name: input.name,
		description: input.description ?? null,
		eventType: input.eventType ?? 'seasonal',
		startDate: input.startDate,
		endDate: input.endDate,
		bannerIcon: input.bannerIcon ?? '🎉',
		bannerColor: input.bannerColor ?? null,
		themeConfig: input.themeConfig ?? null,
		rewardConfig: input.rewardConfig ?? null,
		missionConfig: input.missionConfig ?? null,
		isActive: 1,
		createdAt: now,
		updatedAt: now,
	} as SeasonEvent;
}

export async function updateEvent(
	id: number,
	_input: UpdateSeasonEventInput,
	tenantId: string,
): Promise<void> {
	warnWrite('updateEvent', { id, tenantId });
}

export async function deleteEvent(id: number, tenantId: string): Promise<void> {
	warnWrite('deleteEvent', { id, tenantId });
}

export async function findChildProgress(
	childId: number,
	eventId: number,
	tenantId: string,
): Promise<ChildEventProgress | undefined> {
	warnRead('findChildProgress', { childId, eventId, tenantId });
	return undefined;
}

export async function findChildActiveEvents(
	childId: number,
	today: string,
	tenantId: string,
): Promise<ChildEventProgress[]> {
	warnRead('findChildActiveEvents', { childId, today, tenantId });
	return [];
}

export async function upsertChildProgress(
	childId: number,
	eventId: number,
	status: string,
	_progressJson: string | null,
	tenantId: string,
): Promise<void> {
	warnWrite('upsertChildProgress', { childId, eventId, status, tenantId });
}

export async function claimReward(
	childId: number,
	eventId: number,
	tenantId: string,
): Promise<void> {
	warnWrite('claimReward', { childId, eventId, tenantId });
}

/** テナントの全シーズンイベントを削除（DynamoDB Pre-PMF fallback: 書き込みがないため no-op） */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	warnWrite('deleteByTenantId', { tenantId });
}
