// src/lib/domain/constants/inquiry.ts
// 問い合わせ status の SSOT (#3612)。DSQL schema の CHECK 制約 (enumCheck) と
// IInquiryRepo の型が本定数から派生する (手書き二重化禁止、dsql-data-model.md §1.0-6)。

export const INQUIRY_STATUSES = ['open', 'replied', 'closed'] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];
