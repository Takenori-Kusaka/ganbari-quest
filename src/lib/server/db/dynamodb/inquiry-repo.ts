// src/lib/server/db/dynamodb/inquiry-repo.ts
// DynamoDB implementation for inquiry storage

import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE_NAME, getDocClient } from './client';
import { inquiryKey } from './keys';

export interface InquiryRecord {
	inquiryId: string;
	tenantId: string | null;
	email: string;
	replyEmail: string | null;
	category: string;
	body: string;
	status: 'open' | 'replied' | 'closed';
	createdAt: string;
}

/**
 * 問い合わせ受付番号を発番する（INQ-YYYYMMDD-XXXX形式）
 * グローバルカウンター: PK=INQUIRY_COUNTER, SK=<date>
 */
export async function generateInquiryId(): Promise<string> {
	const now = new Date();
	const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');

	const result = await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: { PK: 'INQUIRY_COUNTER', SK: dateStr },
			UpdateExpression: 'ADD #counter :val',
			ExpressionAttributeNames: { '#counter': 'counter' },
			ExpressionAttributeValues: { ':val': 1 },
			ReturnValues: 'UPDATED_NEW',
		}),
	);

	const seq = result.Attributes?.counter as number;
	return `INQ-${dateStr}-${String(seq).padStart(4, '0')}`;
}

/** 問い合わせを保存 */
export async function saveInquiry(record: InquiryRecord): Promise<void> {
	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...inquiryKey(record.inquiryId),
				...record,
			},
		}),
	);
}
