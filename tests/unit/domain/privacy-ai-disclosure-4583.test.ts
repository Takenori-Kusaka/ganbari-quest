// tests/unit/domain/privacy-ai-disclosure-4583.test.ts (#4583)
//
// プライバシーポリシーの生成 AI に関する記述が **実装の事実と一致している**ことを固定する。
//
// # 何が壊れていたか
//
// 第9条④:「外部第三者（生成 AI 等を含む）への送信は行いません」
// 第10条 :「運営者の環境の外にある生成 AI サービスには送信しません（**送信する機能自体が
//           ありません**）」
//
// どちらも**絶対形の否定**だが、実装は生成 AI に送っている:
//
//   | 経路 | 送信内容 | 実体 |
//   |---|---|---|
//   | 活動 / チェックリスト / ごほうび提案 | 保護者が入力した文章 | *-suggest-service.ts |
//   | 領収書 OCR | 領収書画像 (base64) | receipt-ocr-service.ts |
//
// 送信先は `AI_PROVIDER` で切り替わり、既定は Bedrock (AWS 環境内)、セルフホストでは
// Gemini (Google = 運営者の環境外) になりうる。
//
// # なぜ test にするか
//
// LP の未実装訴求 (#4510 / ADR-0013) と同じ構造で、**向きが逆**（やらないと言って、やっている）。
// 法務文書でこれが起きると、条文が守れない約束になる。文言を直しても、後で AI 送信経路が
// 増えたときに条文だけ取り残されるため、「否定形が復活したら落ちる」形で pin する。

import { describe, expect, it } from 'vitest';
import { LP_LEGAL_PRIVACY_LABELS } from '../../../src/lib/domain/labels';
import { CURRENT_PRIVACY_VERSION } from '../../../src/lib/server/services/consent-service';

const section9 = LP_LEGAL_PRIVACY_LABELS.section9;
const section10 = LP_LEGAL_PRIVACY_LABELS.section10;
// `as const` で値型が literal union になるため、素朴な filter 述語は型が合わない。
// unknown[] に落としてから文字列だけを集める。
const allSections = (Object.values(LP_LEGAL_PRIVACY_LABELS) as unknown[])
	.filter((v): v is string => typeof v === 'string')
	.join('\n');

describe('#4583 プライバシーポリシーの生成 AI 記述が実装と一致する', () => {
	describe('絶対形の否定が復活しない', () => {
		it('第9条④ が「生成 AI へ送信しない」と言い切らない', () => {
			expect(
				section9,
				'実装は AI 提案 3 種と領収書 OCR で実際に送信している (守れない約束になる)',
			).not.toContain('外部第三者（生成 AI 等を含む）への送信は行いません');
		});

		it('第10条 が「送信する機能自体がありません」と言い切らない', () => {
			// 「機能が無い」は最も強い否定で、AI 提案の入力欄という機能が現に存在する以上成立しない
			expect(section10).not.toContain('送信する機能自体がありません');
		});

		it('ポリシー全体で「生成 AI に送信しません」型の言い切りが残っていない', () => {
			expect(allSections).not.toMatch(/生成\s*AI[^。]{0,40}送信は行いません/);
		});
	});

	describe('実際に送るものを述べている', () => {
		it('第9条④ が AI 提案の入力と領収書画像を挙げている', () => {
			expect(section9).toContain('AI 提案');
			expect(section9).toContain('領収書');
		});

		it('第9条④ が送信先の 2 系統 (Bedrock / Gemini) を区別している', () => {
			// 「運営者が管理する AWS 環境内でのみ処理」はセルフホスト (Gemini) では成立しない
			expect(section9).toContain('Bedrock');
			expect(section9).toContain('Gemini');
		});

		it('第9条④ が「入力した内容は送られる」ことを読み手に警告している', () => {
			// 保護者が子供の名前を書けばそのまま送信される。ここを黙ると #4583 の実害が残る
			expect(section9).toMatch(/お名前|特定につながる/);
		});

		it('DB のデータを一括送信しないことは引き続き述べている (過剰否定にしない)', () => {
			// 実装上、活動記録・プロフィールを AI に流す経路は無い。事実なので消さない
			expect(section9).toMatch(/活動記録・プロフィール/);
			expect(section10).toMatch(/データベースから取り出して/);
		});
	});

	it('条文改訂に伴い privacy version が bump されている (再同意が発火する)', () => {
		// 旧版のまま条文だけ変えると、同意済みの顧客は改訂を知らないまま使い続ける
		expect(CURRENT_PRIVACY_VERSION).not.toBe('2026-04-28');
	});
});
