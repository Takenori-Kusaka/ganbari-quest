// tests/unit/domain/settings-backup-classification.test.ts
// #3382: settings backup allowlist の機械強制強化。
// (1) get/setSetting で実在する全設定キーが exportable / secret / non-exportable のいずれかに分類済 (silent-gap ガード)
// (2) 秘匿キーが EXPORTABLE_SETTING_KEYS に混入していない (CWE-522/916)
// (3) 全 exportable キーに値バリデータが存在し、範囲外・型不正・未知 enum・制御文字を弾く

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// #4085: repo 走査 test (実行時間が入力サイズに比例する)。既定 5s のままだと unit lane の
// 並列実行の負荷で落ち、「本物の回帰か負荷か」の切り分けが毎回発生するため file 単位で明示する。
// 区分は scripts/lib/ci/repo-scan-test-registry.mjs が SSOT (未宣言 / timeout 欠落は CI が fail)。
vi.setConfig({ testTimeout: 60_000 });

import {
	EXPORTABLE_SETTING_KEYS,
	isValidSettingValue,
	NON_EXPORTABLE_SETTING_KEYS,
	SECRET_SETTING_KEYS,
	SETTING_VALUE_VALIDATORS,
} from '../../../src/lib/domain/export-format';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const srcRoot = join(REPO_ROOT, 'src');

/** src 配下を再帰走査して .ts / .svelte のパス一覧を返す。 */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		const st = statSync(full);
		if (st.isDirectory()) {
			collectSourceFiles(full, acc);
		} else if (full.endsWith('.ts') || full.endsWith('.svelte')) {
			acc.push(full);
		}
	}
	return acc;
}

/**
 * src 全体から getSetting / setSetting / getSettings の文字列リテラルキーを抽出する。
 * これが「実在する設定キー」の SSOT。新キーが分類漏れのまま追加されたら本テストが fail する。
 */
function collectUsedSettingKeys(): Set<string> {
	const keys = new Set<string>();
	// getSetting('x' / setSetting('x'
	const singleRe = /(?:getSetting|setSetting)\(\s*'([a-z_][a-z0-9_]*)'/g;
	// getSettings(['x', 'y', ...]) の配列内リテラル
	const multiRe = /getSettings\(\s*\[([^\]]*)\]/g;
	const literalInArray = /'([a-z_][a-z0-9_]*)'/g;
	for (const file of collectSourceFiles(srcRoot)) {
		// テスト用モック等が混ざる server/db/*-repo の getSetting 定義自体は key リテラルを持たないため対象外。
		const text = readFileSync(file, 'utf8');
		for (const match of text.matchAll(singleRe)) {
			if (match[1]) keys.add(match[1]);
		}
		for (const match of text.matchAll(multiRe)) {
			const inner = match[1] ?? '';
			for (const lit of inner.matchAll(literalInArray)) {
				if (lit[1]) keys.add(lit[1]);
			}
		}
	}
	return keys;
}

describe('#3382 settings backup key 分類 SSOT (silent-gap ガード)', () => {
	const classified = new Set<string>([
		...EXPORTABLE_SETTING_KEYS,
		...SECRET_SETTING_KEYS,
		...NON_EXPORTABLE_SETTING_KEYS,
	]);

	it('get/setSetting で実在する全キーが exportable / secret / non-exportable に分類済 (未分類 = fail)', () => {
		const used = collectUsedSettingKeys();
		// sanity: 走査が機能していること (代表キーが拾えている)
		expect(used.has('decay_intensity')).toBe(true);
		expect(used.has('pin_hash')).toBe(true);

		const unclassified = [...used].filter((k) => !classified.has(k)).sort();
		expect(
			unclassified,
			`未分類の設定キーがあります。export-format.ts の EXPORTABLE_SETTING_KEYS / SECRET_SETTING_KEYS / NON_EXPORTABLE_SETTING_KEYS のいずれかに追加してください: ${unclassified.join(', ')}`,
		).toEqual([]);
	});

	it('秘匿キーは 1 件も EXPORTABLE_SETTING_KEYS に含まれない (CWE-522/916)', () => {
		const leaked = SECRET_SETTING_KEYS.filter((k) =>
			(EXPORTABLE_SETTING_KEYS as readonly string[]).includes(k),
		);
		expect(leaked, `秘匿キーが backup allowlist に混入しています: ${leaked.join(', ')}`).toEqual(
			[],
		);
	});

	it('non-exportable キーも EXPORTABLE_SETTING_KEYS に含まれない (排他分類)', () => {
		const overlap = NON_EXPORTABLE_SETTING_KEYS.filter((k) =>
			(EXPORTABLE_SETTING_KEYS as readonly string[]).includes(k),
		);
		expect(overlap).toEqual([]);
	});

	it('exportable / secret / non-exportable は相互に重複しない', () => {
		const total =
			EXPORTABLE_SETTING_KEYS.length +
			SECRET_SETTING_KEYS.length +
			NON_EXPORTABLE_SETTING_KEYS.length;
		expect(classified.size).toBe(total);
	});
});

describe('#3382 設定値バリデータ (import 時の fail-closed)', () => {
	it('全 exportable キーに値バリデータが定義されている (網羅)', () => {
		const missing = (EXPORTABLE_SETTING_KEYS as readonly string[]).filter(
			(k) => typeof SETTING_VALUE_VALIDATORS[k] !== 'function',
		);
		expect(missing, `validator 未定義の exportable キー: ${missing.join(', ')}`).toEqual([]);
	});

	it('正常値は受理する', () => {
		expect(isValidSettingValue('decay_intensity', 'normal')).toBe(true);
		expect(isValidSettingValue('point_rate', '1')).toBe(true);
		expect(isValidSettingValue('point_rate', '0.5')).toBe(true);
		expect(isValidSettingValue('point_unit_mode', 'currency')).toBe(true);
		expect(isValidSettingValue('point_currency', 'JPY')).toBe(true);
		expect(isValidSettingValue('notification_quiet_start', '21:00')).toBe(true);
		expect(isValidSettingValue('weekly_report_day', 'monday')).toBe(true);
		expect(isValidSettingValue('weekly_report_enabled', '1')).toBe(true);
		expect(isValidSettingValue('reward_auto_approve', 'true')).toBe(true);
		expect(isValidSettingValue('tutorial_started_at', '2026-03-15T08:30:00.000Z')).toBe(true);
		expect(isValidSettingValue('questionnaire_activity_level', 'few')).toBe(true);
	});

	it('範囲外 / 型不正 / 未知 enum は拒否する', () => {
		expect(isValidSettingValue('decay_intensity', 'extreme')).toBe(false); // 未知 enum
		expect(isValidSettingValue('point_rate', 'abc')).toBe(false); // 非数値
		expect(isValidSettingValue('point_rate', '-1')).toBe(false); // 範囲外 (負)
		expect(isValidSettingValue('point_rate', '0')).toBe(false); // 範囲外 (0)
		expect(isValidSettingValue('point_unit_mode', 'bitcoin')).toBe(false); // 未知 enum
		expect(isValidSettingValue('point_currency', 'XYZ')).toBe(false); // 未知通貨
		expect(isValidSettingValue('notification_quiet_start', '25:99')).toBe(false); // 不正時刻
		expect(isValidSettingValue('weekly_report_day', 'someday')).toBe(false); // 未知曜日
		expect(isValidSettingValue('reward_auto_approve', 'maybe')).toBe(false); // 非 bool
		expect(isValidSettingValue('tutorial_started_at', 'not-a-date')).toBe(false); // 不正日時
	});

	it('制御文字 (NUL 含む) を含む値は拒否する (poison-null-byte)', () => {
		const NUL = String.fromCharCode(0);
		expect(isValidSettingValue('point_currency', `JPY${NUL}`)).toBe(false);
		const BEL = String.fromCharCode(7);
		expect(isValidSettingValue('questionnaire_challenges', `a${BEL}b`)).toBe(false);
	});

	it('allowlist 外キーは常に false (validator 未定義)', () => {
		expect(isValidSettingValue('pin_hash', 'whatever')).toBe(false);
		expect(isValidSettingValue('session_token', 'x')).toBe(false);
	});
});
