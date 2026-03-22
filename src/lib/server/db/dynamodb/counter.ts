// src/lib/server/db/dynamodb/counter.ts
// Atomic counter for numeric ID generation using DynamoDB UpdateExpression ADD

import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE_NAME, getDocClient } from './client';
import type { EntityName } from './keys';
import { counterKey } from './keys';

/**
 * Atomically increment a counter for the given entity and return the new value.
 *
 * Uses DynamoDB `ADD counter :val` which is atomic even under concurrent access.
 * The counter item is stored as: PK=COUNTER, SK=<entity>, counter=<number>
 *
 * @param entity - Entity name (e.g., 'child', 'activityLog')
 * @param increment - Amount to increment (default: 1)
 * @returns The new counter value after increment
 */
export async function nextId(entity: EntityName, increment = 1): Promise<number> {
	const key = counterKey(entity);
	const docClient = getDocClient();

	const result = await docClient.send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: key,
			UpdateExpression: 'ADD #counter :val',
			ExpressionAttributeNames: {
				'#counter': 'counter',
			},
			ExpressionAttributeValues: {
				':val': increment,
			},
			ReturnValues: 'UPDATED_NEW',
		}),
	);

	const newValue = result.Attributes?.counter;
	if (typeof newValue !== 'number') {
		throw new Error(`Counter increment failed for entity "${entity}": unexpected return value`);
	}

	return newValue;
}

/**
 * Get the current counter value without incrementing.
 * Returns 0 if the counter does not exist yet.
 *
 * @param entity - Entity name (e.g., 'child', 'activityLog')
 * @returns The current counter value
 */
export async function currentId(entity: EntityName): Promise<number> {
	const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
	const key = counterKey(entity);
	const docClient = getDocClient();

	const result = await docClient.send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: key,
			ProjectionExpression: '#counter',
			ExpressionAttributeNames: {
				'#counter': 'counter',
			},
		}),
	);

	const value = result.Item?.counter;
	return typeof value === 'number' ? value : 0;
}

/**
 * Set the counter to a specific value.
 * Useful for data migration (seeding counters to match existing SQLite auto-increment values).
 *
 * WARNING: This is NOT atomic with respect to concurrent nextId() calls.
 * Only use during migration or initialization when no concurrent writes are expected.
 *
 * @param entity - Entity name (e.g., 'child', 'activityLog')
 * @param value - The value to set the counter to
 */
export async function seedCounter(entity: EntityName, value: number): Promise<void> {
	const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
	const key = counterKey(entity);
	const docClient = getDocClient();

	await docClient.send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...key,
				counter: value,
			},
		}),
	);
}

/**
 * Generate multiple sequential IDs in a single atomic operation.
 * Returns the starting ID (inclusive) and ending ID (inclusive).
 *
 * Example: batchNextIds('activityLog', 5) might return { start: 101, end: 105 }
 *
 * @param entity - Entity name
 * @param count - Number of IDs to reserve
 * @returns Object with start and end IDs (both inclusive)
 */
export async function batchNextIds(
	entity: EntityName,
	count: number,
): Promise<{ start: number; end: number }> {
	if (count < 1) {
		throw new Error(`batchNextIds: count must be >= 1, got ${count}`);
	}

	const end = await nextId(entity, count);
	const start = end - count + 1;

	return { start, end };
}
