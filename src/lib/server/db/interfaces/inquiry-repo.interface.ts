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

export interface IInquiryRepo {
	generateInquiryId(): Promise<string>;
	saveInquiry(record: InquiryRecord): Promise<void>;
}
