// tests/unit/domain/legal-labels.test.ts
// #1638 #1590: 法的文書 SSOT 用 LEGAL_LABELS / SIGNUP_LABELS 拡張の存在検証
//
// site/privacy.html / site/terms.html との文言整合を検証する CI は無い
// （専用 lint は #4322 で撤去済、機械強制は無い、#4482）。本ユニットテストでは
//   - LEGAL_LABELS の必須 key が export されていること
//   - SIGNUP_LABELS に追加した cross-border 同意関連 key が存在すること
//   - consent-service のバージョン定数が更新されていること
// を検証する。文言ドリフト検出の二重ガード。

import { describe, expect, it } from 'vitest';

import {
	LEGAL_LABELS,
	LP_LEGAL_PRIVACY_LABELS,
	LP_LEGAL_TERMS_LABELS,
	SIGNUP_LABELS,
} from '$lib/domain/labels';
import {
	CURRENT_PRIVACY_VERSION,
	CURRENT_TERMS_VERSION,
} from '$lib/server/services/consent-service';

describe('#1638 #1590: LEGAL_LABELS', () => {
	it('卒業（ポジティブな解約）に関するキー語彙が定義されている', () => {
		expect(LEGAL_LABELS.graduation).toBe('卒業');
		expect(LEGAL_LABELS.graduationDef).toBe('ポジティブな解約');
	});

	it('外部送信規律（電気通信事業法 §27の12）に関するキー語彙が定義されている', () => {
		expect(LEGAL_LABELS.externalTransmission).toBe('外部送信規律');
		expect(LEGAL_LABELS.externalTransmissionLaw).toBe('電気通信事業法第27条の12');
	});

	it('未成年者取扱いに関するキー語彙が定義されている', () => {
		expect(LEGAL_LABELS.familyUniqueId).toBe('家族内一意 ID');
		expect(LEGAL_LABELS.underAge).toBe('未成年者');
	});

	it('域外移転（個人情報保護法 §28）に関するキー語彙が定義されている', () => {
		expect(LEGAL_LABELS.crossBorderTransfer).toBe('外国にある第三者への提供');
		expect(LEGAL_LABELS.crossBorderLaw).toBe('個人情報保護法第28条');
	});

	it('SCC / DPA に関するキー語彙が定義されている', () => {
		expect(LEGAL_LABELS.scc).toContain('標準契約条項');
		expect(LEGAL_LABELS.scc).toContain('SCC');
		expect(LEGAL_LABELS.dpa).toContain('Data Processing Addendum');
		expect(LEGAL_LABELS.dpa).toContain('DPA');
	});

	it('signup チェックボックスの域外移転同意文言が定義されている（サービス提供のためという目的を明示）', () => {
		// チェックボックス文言は「サービス提供に必要な範囲」を主語とする。
		// 移転先国（米国 / AWS / バージニア北部）の情報は privacy.html 第10条（第二層）にある（#4944）。
		expect(LEGAL_LABELS.signupCrossBorderConsent).toContain('サービス提供');
		expect(LEGAL_LABELS.signupCrossBorderConsent).toContain('同意します');
	});
});

describe('#1638 #4944: cross-border 同意の 2 層構造', () => {
	// #4944: 移転先国・事業者名は「第一層 (同意画面) から第二層 (privacy.html 第10条) へ移した」
	// のであって、消したのではない。下の 2 本を対にして、片方だけが緩むのを防ぐ:
	//   (1) 第二層に法定記載が在ること        ← 情報の消失を検出
	//   (2) 第一層に固有名詞が出ていないこと  ← 層構造の逆戻りを検出
	const FIRST_LAYER = [
		SIGNUP_LABELS.crossBorderSectionTitle,
		SIGNUP_LABELS.crossBorderWhatHappens,
		SIGNUP_LABELS.crossBorderPaymentScope,
		SIGNUP_LABELS.crossBorderNoNoUse,
		SIGNUP_LABELS.crossBorderDeletion,
		SIGNUP_LABELS.crossBorderAgreeLabel,
	];

	it('(1) 第二層 = privacy.html 第10条に移転先国・事業者名・制度・措置が残っている', () => {
		const section10 = LP_LEGAL_PRIVACY_LABELS.section10;
		expect(section10).toContain('米国');
		expect(section10).toContain('AWS');
		expect(section10).toContain('バージニア北部');
		expect(section10).toContain('Stripe');
		expect(section10).toContain('Google');
		// 施行規則 17 条 2 項の 3 情報（移転先国 / 当該国の制度 / 移転先が講ずる措置）
		expect(section10).toContain('移転先国');
		expect(section10).toContain('当該国の個人情報の保護に関する制度');
		expect(section10).toContain('移転先が講ずる個人情報の保護のための措置');
	});

	it('(2) 第一層に事業者名・国名・法律の条番号が出ていない', () => {
		// 読み手はこれらを「自分に何が起きるのか」に変換できない。第二層 (detailLink 先) に置く。
		for (const text of FIRST_LAYER) {
			expect(text).not.toContain('AWS');
			expect(text).not.toContain('Stripe');
			expect(text).not.toContain('Google');
			expect(text).not.toContain('米国');
			expect(text).not.toContain('バージニア北部');
			expect(text).not.toContain('第28条');
		}
	});

	it('第一層が「何が起きる / 起きない」を具体的に述べている', () => {
		// 起きること: 暗号化 + テナント分離 (ADR-0063 / DPIA §7.1)
		expect(SIGNUP_LABELS.crossBorderWhatHappens).toContain('暗号化');
		// 決済で渡る範囲: stripe-service.ts は customer_email を設定せず metadata のみ送る
		expect(SIGNUP_LABELS.crossBorderPaymentScope).toContain('カード番号');
		expect(SIGNUP_LABELS.crossBorderPaymentScope).toContain('通りません');
		// 消せること: 退会時の物理削除 (DPIA §7.1)
		expect(SIGNUP_LABELS.crossBorderDeletion).toContain('退会');
		expect(SIGNUP_LABELS.crossBorderDeletion).toContain('削除');
	});

	it('crossBorderNoNoUse に「広告なし / 第三者販売なし / AI 学習流用なし」が明記されている', () => {
		// privacy.html 第10条が「この説明とともにチェックボックスを表示する」と書いている実体。
		// 画面から消すと第10条が事実と食い違うため、文言を変えても 3 要素は維持する。
		expect(SIGNUP_LABELS.crossBorderNoNoUse).toContain('広告');
		expect(SIGNUP_LABELS.crossBorderNoNoUse).toContain('第三者');
		expect(SIGNUP_LABELS.crossBorderNoNoUse).toContain('AI');
		expect(SIGNUP_LABELS.crossBorderNoNoUse).toContain('行いません');
	});

	it('同意チェックボックス文言が privacy.html 第10条の引用と一字一句一致している', () => {
		// 第10条は本文中にこの文字列を埋め込んでいる。ずれると「同意した内容」と
		// 「同意したと法務文書が言っている内容」が食い違う。
		expect(LP_LEGAL_PRIVACY_LABELS.section10).toContain(SIGNUP_LABELS.crossBorderAgreeLabel);
		expect(SIGNUP_LABELS.crossBorderAgreeLabel).toContain('サービス提供');
		expect(SIGNUP_LABELS.crossBorderAgreeLabel).toContain('同意します');
	});

	it('第二層への導線ラベルが「同意前の確認」を明示的に求めている', () => {
		// 施行規則 17 条 2 項の 3 情報を URL で提供する場合、PPC Q12-10 は
		// 「同意の可否の判断の前提として、本人に対して当該情報の確認を明示的に求める」ことを要求する。
		// 旧ラベル「詳細」は何が読めるかも、確認が同意の前提であることも伝えていなかった。
		expect(SIGNUP_LABELS.crossBorderDetailLink).toContain('ご同意の前に');
		expect(SIGNUP_LABELS.crossBorderDetailLink).toContain('ご確認ください');
		expect(SIGNUP_LABELS.crossBorderDetailLink).toContain('国');
	});

	it('privacy.html 第10条が「画面にこう表示する」と述べた内容が、実際の第一層に在る', () => {
		// 第10条は本文中で「広告利用・第三者への販売・機械学習への流用を行わない旨の説明とともに
		// 表示します」と自己申告している。画面側からこの説明を消すと、法務文書が事実と食い違う。
		// 文言を変えるのは可だが、3 要素が画面から欠けることは許さない。
		expect(LP_LEGAL_PRIVACY_LABELS.section10).toContain(
			'広告利用・第三者への販売・機械学習への流用',
		);
		const firstLayerNoUse = SIGNUP_LABELS.crossBorderNoNoUse;
		expect(firstLayerNoUse).toContain('広告');
		expect(firstLayerNoUse).toContain('第三者');
		expect(firstLayerNoUse).toMatch(/AI|機械学習/);
	});

	it('crossBorderAgreeError が定義されている', () => {
		expect(SIGNUP_LABELS.crossBorderAgreeError).toContain('同意');
	});

	it('blockCrossBorderRequired が定義されている', () => {
		expect(SIGNUP_LABELS.blockCrossBorderRequired).toContain('同意');
	});
});

describe('#1638 #1590: consent-service バージョン定数', () => {
	// #4497: 旧実装は日付リテラル ('2026-04-28' / #4503 で '2026-08-13') を直接 pin していた。これは
	//   (a) 文書を正当に改定するたびに、何の欠陥も示さないまま落ちる
	//   (b) 「定数が文書と一致しているか」という肝心の不変条件は何も見ていない
	// の 2 点で有害だった（実際 privacy.html が 3 回改定された間、この pin は
	// 「2026-04-28 のまま」を守り続け、ズレを検出するどころか固定してしまっていた）。
	// リテラル pin を捨てるのではなく、**文書の最終改定日との突合**という強い不変条件に
	// 置き換える。突合の SSOT は tests/unit/services/legal-doc-version-parity.test.ts。
	/** '<p>…最終改定日: 2026年8月7日</p>' → '2026-08-07' */
	function revisionDateOf(effectiveHtml: string): string {
		const m = effectiveHtml.match(/最終改定日\s*[:：]\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);
		if (!m) throw new Error(`最終改定日を読み取れません: ${effectiveHtml}`);
		return `${m[1]}-${m[2]?.padStart(2, '0')}-${m[3]?.padStart(2, '0')}`;
	}

	it('CURRENT_TERMS_VERSION が利用規約の最終改定日と一致する', () => {
		expect(CURRENT_TERMS_VERSION).toBe(revisionDateOf(LP_LEGAL_TERMS_LABELS.effective));
	});

	it('CURRENT_PRIVACY_VERSION がプライバシーポリシーの最終改定日と一致する', () => {
		expect(CURRENT_PRIVACY_VERSION).toBe(revisionDateOf(LP_LEGAL_PRIVACY_LABELS.effective));
	});

	it('規約バージョンが ISO-like 形式（YYYY-MM-DD）であること', () => {
		expect(CURRENT_TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(CURRENT_PRIVACY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});
