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
import { LP_LEGAL_PRIVACY_LABELS, LP_SELFHOST_LABELS } from '../../../src/lib/domain/labels';
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

		it('第9条④ が送信先の 2 系統 (運営者の環境内 / 環境外) を区別している', () => {
			// 「運営者が管理する AWS 環境内でのみ処理」はセルフホスト (外部事業者) では成立しない。
			//
			// **個別サービス名 (Bedrock / Gemini) は書かない** — 法務文書 / LP には事業者名と
			// 「運営者の環境内か外部か」を書く規約 (#4370、measure-lp-dimensions.mjs が hard-fail)。
			expect(section9).toContain('運営者が管理する AWS 環境内の生成 AI');
			expect(section9).toContain('運営者の環境外の生成 AI');
			expect(section9).toContain('Google LLC');
			expect(section9, '#4370: 法務文書に個別サービス名を書かない').not.toMatch(/Bedrock|Gemini/);
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

	describe('selfhost ページも同じ事実に揃える (#4583 追補 2)', () => {
		// privacy 第9条④ だけ直すと、selfhost の「外部サーバーにデータを送信しません」と
		// **改訂後の privacy が正面から食い違う**。片方だけ直すと不整合が
		// 「未修正」から「自ら作った矛盾」に変わる (PO 決裁)。
		it('絶対形の「外部サーバーにデータを送信しません」が残っていない', () => {
			const selfhost = JSON.stringify(LP_SELFHOST_LABELS);
			expect(selfhost).not.toContain('外部サーバーにデータを送信しません');
		});

		it('AI を使わない限り送信されない、という条件付きで述べている', () => {
			const selfhost = JSON.stringify(LP_SELFHOST_LABELS);
			expect(selfhost).toMatch(/AI 機能を使わない限り/);
		});

		it('AI 比較表が「設定すると外部へ送信される」帰結まで述べている', () => {
			// 「API キーの自前設定が必要」だけでは、購入判断に必要な帰結が伝わらない
			const selfhost = JSON.stringify(LP_SELFHOST_LABELS);
			expect(selfhost).toContain('外部の生成 AI へ送信されます');
		});
	});

	describe('第10条の法定開示が本文と食い違わない (PO 指摘 2 / 3)', () => {
		it('第三者リストの Google の用途に生成 AI が載っている', () => {
			// 第9条④で「セルフホストでは Google の生成 AI が使われる場合がある」と書いた以上、
			// §28 の情報提供リストに OAuth しか載っていないのは同一条文内の食い違い
			expect(section10).toContain('Google LLC');
			expect(section10).toMatch(/生成 AI/);
			expect(section10, 'Google の用途が OAuth のみに戻っている').not.toMatch(
				/Google LLC<\/strong>（米国） — OAuth 認証。<\/li>/,
			);
		});

		it('学習データ流用の否定が「運営者は」に限定されている', () => {
			// 絶対形だと、セルフホストで顧客自身が設定した外部事業者の扱いまで保証することになる。
			// 保証できないものを保証しない (#4583 の再生産を防ぐ)
			expect(section10).toContain('運営者は、お預かりしたデータを機械学習');
			expect(section10, '主語なしの絶対形が復活している').not.toContain(
				'<strong>機械学習・AI モデルの学習データへの流用はありません</strong>',
			);
		});
	});

	it('条文改訂に伴い privacy version が bump されている (再同意が発火する)', () => {
		// 旧版のまま条文だけ変えると、同意済みの顧客は改訂を知らないまま使い続ける
		expect(CURRENT_PRIVACY_VERSION).not.toBe('2026-04-28');
	});
});
