import {
	BatchWriteCommand,
	DeleteCommand,
	PutCommand,
	QueryCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ChildCustomVoice } from '../types';
import { TABLE_NAME, getDocClient } from './client';
import { nextId } from './counter';
import type { DynamoKey } from './keys';
import { padId, tenantPK } from './keys';

function voicePK(childId: number, tenantId: string): string {
	return tenantPK(`VOICE#${padId(childId)}`, tenantId);
}

function voiceKey(childId: number, voiceId: number, tenantId: string): DynamoKey {
	return {
		PK: voicePK(childId, tenantId),
		SK: `V#${padId(voiceId)}`,
	};
}

function toEntity(item: Record<string, unknown>, tenantId: string): ChildCustomVoice {
	return {
		id: item.voiceId as number,
		childId: item.childId as number,
		scene: (item.scene as string) ?? 'complete',
		label: item.label as string,
		filePath: item.filePath as string,
		publicUrl: item.publicUrl as string,
		durationMs: (item.durationMs as number) ?? null,
		isActive: (item.isActive as number) ?? 0,
		tenantId,
		createdAt: item.createdAt as string,
	};
}

export async function findByChild(
	childId: number,
	scene: string,
	tenantId: string,
): Promise<ChildCustomVoice[]> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk',
			FilterExpression: 'scene = :scene',
			ExpressionAttributeValues: {
				':pk': voicePK(childId, tenantId),
				':scene': scene,
			},
		}),
	);
	return (result.Items ?? []).map((item) => toEntity(item, tenantId));
}

export async function findById(id: number, tenantId: string): Promise<ChildCustomVoice | null> {
	// Need to scan under the voice prefix — voiceId is in the SK
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			IndexName: 'GSI1',
			KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
			ExpressionAttributeValues: {
				':pk': `VOICEID#${padId(id)}`,
				':sk': 'DETAIL',
			},
		}),
	);
	const item = result.Items?.[0];
	if (!item) return null;
	return toEntity(item, tenantId);
}

export async function findActiveVoice(
	childId: number,
	scene: string,
	tenantId: string,
): Promise<ChildCustomVoice | null> {
	const voices = await findByChild(childId, scene, tenantId);
	return voices.find((v) => v.isActive === 1) ?? null;
}

export async function insert(
	voice: Omit<ChildCustomVoice, 'id' | 'createdAt'>,
): Promise<{ id: number }> {
	const id = await nextId('voice', voice.tenantId);
	const now = new Date().toISOString();
	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...voiceKey(voice.childId, id, voice.tenantId),
				GSI1PK: `VOICEID#${padId(id)}`,
				GSI1SK: 'DETAIL',
				voiceId: id,
				childId: voice.childId,
				scene: voice.scene,
				label: voice.label,
				filePath: voice.filePath,
				publicUrl: voice.publicUrl,
				durationMs: voice.durationMs,
				isActive: voice.isActive,
				tenantId: voice.tenantId,
				createdAt: now,
			},
		}),
	);
	return { id };
}

export async function setActive(
	id: number,
	childId: number,
	scene: string,
	tenantId: string,
): Promise<void> {
	// Deactivate all voices for this child+scene
	const voices = await findByChild(childId, scene, tenantId);
	for (const v of voices) {
		if (v.isActive === 1) {
			await getDocClient().send(
				new UpdateCommand({
					TableName: TABLE_NAME,
					Key: voiceKey(childId, v.id, tenantId),
					UpdateExpression: 'SET isActive = :zero',
					ExpressionAttributeValues: { ':zero': 0 },
				}),
			);
		}
	}
	// Activate the target
	await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: voiceKey(childId, id, tenantId),
			UpdateExpression: 'SET isActive = :one',
			ExpressionAttributeValues: { ':one': 1 },
		}),
	);
}

export async function deleteById(id: number, tenantId: string): Promise<void> {
	const voice = await findById(id, tenantId);
	if (!voice) return;
	await getDocClient().send(
		new DeleteCommand({
			TableName: TABLE_NAME,
			Key: voiceKey(voice.childId, id, tenantId),
		}),
	);
}

export async function deleteByChild(childId: number, tenantId: string): Promise<void> {
	const pk = voicePK(childId, tenantId);
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk',
			ProjectionExpression: 'PK, SK',
			ExpressionAttributeValues: { ':pk': pk },
		}),
	);
	const items = result.Items ?? [];
	const BATCH = 25;
	for (let i = 0; i < items.length; i += BATCH) {
		const batch = items.slice(i, i + BATCH);
		await getDocClient().send(
			new BatchWriteCommand({
				RequestItems: {
					[TABLE_NAME]: batch.map((item) => ({
						DeleteRequest: { Key: { PK: item.PK as string, SK: item.SK as string } },
					})),
				},
			}),
		);
	}
}
