// Demo IInquiryRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type { InquiryRecord } from '../interfaces/inquiry-repo.interface';

export async function generateInquiryId(): Promise<string> {
	// Demo Lambda の inquiry はサポートしないが、interface 契約のため
	// deterministic な dummy ID を返す (stateless)
	return 'DEMO-INQUIRY';
}

export async function saveInquiry(_record: InquiryRecord): Promise<void> {
	// Stub: no-op
}
