// tests/unit/domain/legal-labels.test.ts
// #1638 #1590: 法的文書 SSOT 用 LEGAL_LABELS / SIGNUP_LABELS 拡張の存在検証
//
// scripts/check-lp-ssot.mjs で site/privacy.html / site/terms.html との
// 文言整合は CI 検証されるが、本ユニットテストでは
//   - LEGAL_LABELS の必須 key が export されていること
//   - SIGNUP_LABELS に追加した cross-border 同意関連 key が存在すること
//   - consent-service のバージョン定数が更新されていること
// を検証する。文言ドリフト検出の二重ガード。

import { describe, expect, it } from 'vitest';

import { LEGAL_LABELS, SIGNUP_LABELS } from '$lib/domain/labels';
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

	it('signup チェックボックスの域外移転同意文言が定義されている（個人開発配慮版: サービス提供のためという目的を明示）', () => {
		// 個人開発配慮版（DPIA §5）: チェックボックス文言は「サービス提供に必要な範囲」を主語とする。
		// 移転先国（米国 / AWS / バージニア北部）の情報は SIGNUP_LABELS.crossBorderNotice に移動済み。
		expect(LEGAL_LABELS.signupCrossBorderConsent).toContain('サービス提供');
		expect(LEGAL_LABELS.signupCrossBorderConsent).toContain('同意します');
	});
});

describe('#1638: SIGNUP_LABELS cross-border consent 拡張', () => {
	it('crossBorderNotice に移転先国（米国 AWS バージニア北部 / Stripe / Google）が明記されている', () => {
		// 個人開発配慮版（DPIA §5）: 移転先国は notice 段落に明示し、checkbox 文言からは外した。
		expect(SIGNUP_LABELS.crossBorderNotice).toContain('米国');
		expect(SIGNUP_LABELS.crossBorderNotice).toContain('AWS');
		expect(SIGNUP_LABELS.crossBorderNotice).toContain('バージニア北部');
		expect(SIGNUP_LABELS.crossBorderNotice).toContain('Stripe');
		expect(SIGNUP_LABELS.crossBorderNotice).toContain('Google');
		expect(SIGNUP_LABELS.crossBorderNotice).toContain('サービス提供');
	});

	it('crossBorderNoNoUse に「広告利用なし / 第三者販売なし / 機械学習流用なし」が明記されている', () => {
		// 個人開発配慮版（DPIA §5）: 安心要素を独立段落で太字強調する。
		expect(SIGNUP_LABELS.crossBorderNoNoUse).toContain('広告利用');
		expect(SIGNUP_LABELS.crossBorderNoNoUse).toContain('第三者');
		expect(SIGNUP_LABELS.crossBorderNoNoUse).toContain('機械学習');
		expect(SIGNUP_LABELS.crossBorderNoNoUse).toContain('ありません');
	});

	it('crossBorderAgreePrefix がサービス提供目的を主語とした同意文言になっている', () => {
		// 個人開発配慮版: prefix は「上記を理解し...同意します」。
		// 移転先国の固有名詞は crossBorderNotice 側に集約済み。
		expect(SIGNUP_LABELS.crossBorderAgreePrefix).toContain('サービス提供');
		expect(SIGNUP_LABELS.crossBorderAgreePrefix).toContain('同意します');
	});

	it('crossBorderAgreeLink / crossBorderAgreeSuffix が定義されている', () => {
		expect(SIGNUP_LABELS.crossBorderAgreeLink).toBe('詳細');
		expect(SIGNUP_LABELS.crossBorderAgreeSuffix).toBe('）');
	});

	it('crossBorderAgreeError が定義されている', () => {
		expect(SIGNUP_LABELS.crossBorderAgreeError).toContain('同意');
	});

	it('blockCrossBorderRequired が定義されている', () => {
		expect(SIGNUP_LABELS.blockCrossBorderRequired).toContain('同意');
	});
});

describe('#1638 #1590: consent-service バージョン定数', () => {
	it('CURRENT_TERMS_VERSION が 2026-04-28 に更新されている', () => {
		expect(CURRENT_TERMS_VERSION).toBe('2026-04-28');
	});

	it('CURRENT_PRIVACY_VERSION が 2026-04-28 に更新されている', () => {
		expect(CURRENT_PRIVACY_VERSION).toBe('2026-04-28');
	});

	it('規約バージョンが ISO-like 形式（YYYY-MM-DD）であること', () => {
		expect(CURRENT_TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(CURRENT_PRIVACY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});
