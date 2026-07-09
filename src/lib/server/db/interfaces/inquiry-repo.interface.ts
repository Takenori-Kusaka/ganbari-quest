import type { InquiryStatus } from '$lib/domain/constants/inquiry';

export interface InquiryRecord {
	inquiryId: string;
	tenantId: string | null;
	email: string;
	replyEmail: string | null;
	category: string;
	body: string;
	/** SSOT: INQUIRY_STATUSES ($lib/domain/constants/inquiry、DSQL CHECK と共有 #3612) */
	status: InquiryStatus;
	createdAt: string;
}

export interface IInquiryRepo {
	generateInquiryId(): Promise<string>;
	saveInquiry(record: InquiryRecord): Promise<void>;
}
