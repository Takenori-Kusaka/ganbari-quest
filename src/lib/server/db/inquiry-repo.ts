// src/lib/server/db/inquiry-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InquiryRecord } from './interfaces/inquiry-repo.interface';

export type { InquiryRecord } from './interfaces/inquiry-repo.interface';

export async function generateInquiryId(): Promise<string> {
	return getRepos().inquiry.generateInquiryId();
}

export async function saveInquiry(record: InquiryRecord): Promise<void> {
	return getRepos().inquiry.saveInquiry(record);
}
