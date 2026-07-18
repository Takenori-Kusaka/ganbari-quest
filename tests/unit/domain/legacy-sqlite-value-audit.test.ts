// tests/unit/domain/legacy-sqlite-value-audit.test.ts
// #3859 — export/import round-trip validator の legacy SQLite 値表現 受理可否の実測監査。
//
// root class (#3851 / PR #3856): 「wire validator が legacy SQLite の実データ表現を想定しきれず
// 正当な行を silent drop する」。#3851 は import-service の timestamp validator が SQLite
// `CURRENT_TIMESTAMP` 既定値 (スペース区切り日時) を誤 reject して cutover を abort させた実害。
// 本テストは同 class の横展開監査として、round-trip 経路の全 field-format validator に対し
// legacy SQLite が実際に書く値表現 (下記 5 分類) の受理可否を **実 validator を呼んで実測** し、
// 回帰として固定する (推測表ではなく物理実行が SSOT、ADR-0061 failing-test-first)。
//
// legacy 実表現の分類 (Issue #3859):
//   DT-SP    : 'YYYY-MM-DD HH:MM:SS' — SQLite CURRENT_TIMESTAMP 既定値 (スペース区切り)
//   DT-ISO   : 'YYYY-MM-DDTHH:MM:SS.sssZ' — JS new Date().toISOString()
//   BOOL-INT / BOOL-WORD : '0'|'1' / 'true'|'false' — settings KVS の 2 系統 boolean 文字列
//   NUM-STR  : '42' — 数値の文字列化 (settings value / dailyLimit 等)
//   NULLISH  : null / '' — 未設定系
//   BROKEN   : 'not-a-date' 等 — 真に不正な値 (negative、受理してはならない)
//
// 不変条件: legacy 実データ ⊆ validator 受理 (positive) / 真破損は依然 reject (negative)。
// 日時形式の SSOT は $lib/domain/validation/datetime (ADR-0066 と同型の domain 層集約) で、
// import-service (parentMessage / siblingCheer sentAt/shownAt) と export-format
// (settings tutorial_*_at) の両 validator が同一述語を import することを本テストが表明する。

import { describe, expect, it } from 'vitest';
import { sanitizeChecklistOverrideRestore } from '$lib/domain/checklist-override';
import { isValidSettingValue } from '$lib/domain/export-format';
import { sanitizeActivityNameField, sanitizeDailyLimit } from '$lib/domain/validation/activity';

/** SQLite CURRENT_TIMESTAMP 既定値そのものの形 (#3851 の実害表現)。 */
const DT_SPACE = '2026-01-02 03:04:05';
/** JS new Date().toISOString() の形。 */
const DT_ISO = '2026-01-02T03:04:05.000Z';
/** 秒なし ISO (isValidIsoDateTime の下限形。HH:MM まで)。 */
const DT_ISO_MINUTE = '2026-01-02T03:04';
/** 真に破損した日時 (negative)。 */
const DT_BROKEN = 'not-a-valid-date';
/** 形は合うが Date.parse 不能 (negative、Date.parse gate の実効性)。 */
const DT_UNPARSEABLE = '2026-13-99 99:99:99';

describe('legacy SQLite 値表現 監査 (#3859) — settings validator (export-format)', () => {
	// #3851 同 class の是正対象: tutorial_*_at の datetime validator。
	// legacy 書込経路は new Date().toISOString() (T 区切り) のみだが、round-trip の日時受理
	// ポリシーは「T / スペースの両区切り + Date.parse 可」で全 validator 統一する
	// (PR #3856 で import-service 側は統一済。片側だけ T 必須が残ると同 class ドリフトが再発する)。
	it('tutorial_started_at / tutorial_completed_at: DT-ISO と DT-SP の両方を受理する (positive)', () => {
		for (const key of ['tutorial_started_at', 'tutorial_completed_at']) {
			expect(isValidSettingValue(key, DT_ISO), `${key} × DT-ISO`).toBe(true);
			expect(isValidSettingValue(key, DT_ISO_MINUTE), `${key} × DT-ISO-minute`).toBe(true);
			// #3859: スペース区切り (SQLite CURRENT_TIMESTAMP 表現) — 是正前は T 必須 regex で reject
			expect(isValidSettingValue(key, DT_SPACE), `${key} × DT-SP`).toBe(true);
		}
	});

	it('tutorial_*_at: 真破損の日時は依然 reject する (negative、握り潰し過剰でない)', () => {
		for (const key of ['tutorial_started_at', 'tutorial_completed_at']) {
			expect(isValidSettingValue(key, DT_BROKEN), `${key} × BROKEN`).toBe(false);
			expect(isValidSettingValue(key, DT_UNPARSEABLE), `${key} × UNPARSEABLE`).toBe(false);
			expect(isValidSettingValue(key, ''), `${key} × 空文字`).toBe(false);
			// 40 char 超の bound は維持 (DoS 的長大値の排除)
			expect(isValidSettingValue(key, `${DT_ISO}${'0'.repeat(40)}`), `${key} × 長大`).toBe(false);
		}
	});

	it('boolean settings: BOOL-WORD と BOOL-INT の両表現を受理する (positive)', () => {
		// legacy setSetting は 'true'/'false' を書くが、BOOL_SETTING_VALUES は '0'/'1' も許容
		for (const v of ['true', 'false', '0', '1']) {
			expect(isValidSettingValue('notification_reminders_enabled', v), `bool × ${v}`).toBe(true);
			expect(isValidSettingValue('tutorial_banner_dismissed', v), `bool × ${v}`).toBe(true);
		}
	});

	it('boolean settings: 大文字 / 数値以外の変形は reject する (negative)', () => {
		for (const v of ['TRUE', 'yes', '2', '']) {
			expect(isValidSettingValue('notification_reminders_enabled', v), `bool × ${v}`).toBe(false);
		}
	});

	it('point_rate: NUM-STR (数値の文字列化) を受理し、非数値 / 範囲外は reject する', () => {
		expect(isValidSettingValue('point_rate', '42')).toBe(true);
		expect(isValidSettingValue('point_rate', '2.5')).toBe(true);
		expect(isValidSettingValue('point_rate', 'not-a-number')).toBe(false);
		expect(isValidSettingValue('point_rate', '')).toBe(false);
		expect(isValidSettingValue('point_rate', '0')).toBe(false); // 下限外 (> 0)
	});

	it('HH:MM settings: time input 生成形式のみ受理する (legacy 書込と一致)', () => {
		expect(isValidSettingValue('notification_quiet_start', '07:30')).toBe(true);
		expect(isValidSettingValue('notification_quiet_start', '23:59')).toBe(true);
		// legacy time input は zero-pad 必須のため '7:30' は書かれない (= reject は誤 drop でない)
		expect(isValidSettingValue('notification_quiet_start', '7:30')).toBe(false);
	});
});

describe('legacy SQLite 値表現 監査 (#3859) — checklist override validator (domain)', () => {
	const base = {
		targetDate: '2026-01-02',
		action: 'add',
		itemName: 'たいそうふく',
		icon: '👕',
		createdAt: DT_ISO,
	};

	it('createdAt: DT-SP (CURRENT_TIMESTAMP 表現) / DT-ISO の両方を受理する (positive)', () => {
		// legacy checklist_overrides.created_at は TEXT DEFAULT CURRENT_TIMESTAMP (スペース区切り)
		for (const createdAt of [DT_SPACE, DT_ISO]) {
			const r = sanitizeChecklistOverrideRestore({ ...base, createdAt });
			expect(r.ok, `createdAt=${createdAt}`).toBe(true);
		}
	});

	it('targetDate: legacy 実表現 (YYYY-MM-DD date-only) を受理し、datetime 混入は reject する', () => {
		expect(sanitizeChecklistOverrideRestore(base).ok).toBe(true);
		// targetDate に datetime が来ることは legacy 書込に存在しない (= reject は誤 drop でない)
		expect(sanitizeChecklistOverrideRestore({ ...base, targetDate: DT_SPACE }).ok).toBe(false);
		expect(sanitizeChecklistOverrideRestore({ ...base, targetDate: 'not-a-date' }).ok).toBe(false);
	});

	it('action: enum 外は reject する (negative、表示に反映されない破損の遮断)', () => {
		expect(sanitizeChecklistOverrideRestore({ ...base, action: 'toggle' }).ok).toBe(false);
	});
});

describe('legacy SQLite 値表現 監査 (#3859) — activity sanitize (domain、drop しない正規化)', () => {
	it('dailyLimit: number / NUM-STR / NULLISH をすべて受理・正規化する (drop なし)', () => {
		expect(sanitizeDailyLimit(5)).toBe(5);
		expect(sanitizeDailyLimit(0)).toBe(0); // 0 = 無制限を null に落とさない (#3422)
		expect(sanitizeDailyLimit('42')).toBe(42); // NUM-STR も受理
		expect(sanitizeDailyLimit(null)).toBe(null);
		expect(sanitizeDailyLimit('')).toBe(null);
		// 破損は安全既定 null へ正規化 (行ごと drop しない)
		expect(sanitizeDailyLimit('abc')).toBe(null);
		expect(sanitizeDailyLimit(-1)).toBe(null);
	});

	it('nameKana / nameKanji: 長大値も切詰め正規化で受理する (drop なし)', () => {
		expect(sanitizeActivityNameField('よみがな')).toBe('よみがな');
		expect(sanitizeActivityNameField(null)).toBe(null);
		expect(sanitizeActivityNameField('あ'.repeat(100))).toHaveLength(50);
	});
});
