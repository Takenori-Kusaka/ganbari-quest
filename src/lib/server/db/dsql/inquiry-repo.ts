// src/lib/server/db/dsql/inquiry-repo.ts
// EPIC #3424 / #3612 / 設計 SSOT: m3-physical-model.md §1.0-6 (CHECK SSOT) / §P9
//
// IInquiryRepo (inquiries) の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8)。全操作が単文のため txn runner 不要。
//   - **専用表化 (#3612 案 A)**: sqlite の settings KVS 間借り (`inquiry:` prefix JSON) を
//     greenfield では専用表にする (account-lockout の専用表化と同 class 是正。KVS 間借りは
//     型検証なしの data-loss class)。
//   - **inquiry_id は app 側採番の text** (`INQ-YYYYMMDD-seq`、既存 interface 契約と
//     sqlite backend の生成形式を維持。uuid 化は interface 変更を伴うため cutover 非依存の
//     将来課題)。
//   - **family_id nullable**: 未ログインの founder 導線 (/inquiry/founder) からも受ける。
//     tenantId が null の INSERT も正当 (§3.4 fitness は family_id 列の存在で判定)。
//   - **保存が正、Discord は best-effort backup (#3210)**: saveInquiry の失敗は握りつぶさず
//     throw のまま呼び出し側契約 (service が fail(500) を返す)。

import { sql } from 'drizzle-orm';
import { todayDateJST } from '$lib/domain/date-utils';
import type { IInquiryRepo, InquiryRecord } from '../interfaces/inquiry-repo.interface';
import type { SqlExecutor } from './sql-executor';

/** タイムスタンプベースの ID 採番 (sqlite backend と同形式、INQ-YYYYMMDD-nnnn)。 */
async function generateInquiryId(): Promise<string> {
	const now = new Date();
	// 問い合わせ番号の日付は顧客に見えるため JST (#4127)
	const dateStr = todayDateJST().replace(/-/g, '');
	const seq = String(now.getTime() % 10000).padStart(4, '0');
	return `INQ-${dateStr}-${seq}`;
}

/** DSQL 用 IInquiryRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlInquiryRepo(db: SqlExecutor): IInquiryRepo {
	return {
		generateInquiryId,

		async saveInquiry(record: InquiryRecord) {
			await db.execute(sql`
				INSERT INTO inquiries
					(inquiry_id, family_id, email, reply_email, category, body, status, created_at)
				VALUES (${record.inquiryId}, ${record.tenantId}, ${record.email},
					${record.replyEmail}, ${record.category}, ${record.body}, ${record.status},
					${record.createdAt})
			`);
		},
	};
}
