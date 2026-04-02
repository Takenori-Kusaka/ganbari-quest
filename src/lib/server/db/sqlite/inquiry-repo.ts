// SQLite implementation of IInquiryRepo
// settings テーブルに inquiry: プレフィックスで問い合わせを保存

import { db } from '../client';
import type { InquiryRecord } from '../interfaces/inquiry-repo.interface';
import { settings } from '../schema';

/** タイムスタンプベースのID発番（SQLiteモードではアトミックカウンタ不要） */
export async function generateInquiryId(): Promise<string> {
	const now = new Date();
	const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
	const seq = String(now.getTime() % 10000).padStart(4, '0');
	return `INQ-${dateStr}-${seq}`;
}

/** 問い合わせを settings テーブルに JSON 保存 */
export async function saveInquiry(record: InquiryRecord): Promise<void> {
	const key = `inquiry:${record.inquiryId}`;
	const now = new Date().toISOString();
	db.insert(settings)
		.values({ key, value: JSON.stringify(record), updatedAt: now })
		.onConflictDoUpdate({
			target: settings.key,
			set: { value: JSON.stringify(record), updatedAt: now },
		})
		.run();
}
