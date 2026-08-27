// tests/unit/routes/settings-activities-guide.test.ts
// #4663 (EPIC #4650): 設定 > 活動・ポイント のガイドが「保存しなくても反映される」と
// 誤案内していた class を機械 gate 化する。
//
// 観測された実害:
//   - ステータス減少 step の how が「段階を選ぶ → すぐに反映されます」。実装は
//     「設定を保存」を押して PUT /api/v1/settings/decay して初めて保存される
//   - ポイント表示 step の how が「単位を選ぶ → 子供の画面に反映されます」。実装は
//     form submit（「ポイント設定を保存」）が必要で、通貨モードではレート入力も必須
//   → ガイドどおりに操作した保護者は、設定が変わらないまま画面を離れる
//   - ページ後半（既定の子供 / きょうだいチャレンジ設定）に step が無く、説明が届かない
//
// 「保存ボタンを押す手順が書いてあるか」「ボタン名・選択肢名が画面と同じか」は機械判定できる。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PAGE_GUIDE_LABELS, SETTINGS_LABELS } from '$lib/domain/labels';
import { PLAN_FULL_TERMS } from '$lib/domain/terms';
import { SETTINGS_ACTIVITIES_GUIDE } from '../../../src/routes/(parent)/admin/settings/activities/_guide';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PAGE = path.join(REPO_ROOT, 'src/routes/(parent)/admin/settings/activities/+page.svelte');

const STEPS = PAGE_GUIDE_LABELS.adminSettingsActivities.steps;

/** 「保存」を伴うカードの step id → 画面上の保存ボタン名。 */
const SAVE_BUTTONS: [keyof typeof STEPS, string][] = [
	['settings-activities-decay', SETTINGS_LABELS.decaySaveAction],
	['settings-activities-point', SETTINGS_LABELS.pointSaveAction],
	['settings-activities-default-child', SETTINGS_LABELS.defaultChildSaveAction],
	['settings-activities-sibling', SETTINGS_LABELS.siblingSaveAction],
];

describe('#4663 設定 > 活動・ポイント のガイドが保存操作を落とさない', () => {
	it('[V1] 保存が要る全カードの step が、画面の保存ボタン名を手順に含む', () => {
		for (const [id, button] of SAVE_BUTTONS) {
			expect(STEPS[id].how, `${id} の手順に保存ボタン「${button}」が出てこない`).toContain(button);
		}
	});

	// 「すぐに反映されます」型の断定は、保存ボタンの存在と正面から矛盾する。
	it('[V2] 「すぐに反映」型の誤案内が残っていない', () => {
		const texts = Object.values(STEPS).flatMap((s) => [s.what, s.how, s.goal, ...(s.tips ?? [])]);
		for (const text of texts) {
			expect(text, `保存不要と読める文言が残っている:\n  ${text}`).not.toMatch(/すぐに反映/);
		}
	});

	it('[V3] ステータス減少 step が 4 段階の選択肢名を画面と同じ語で挙げている', () => {
		const how = STEPS['settings-activities-decay'].how;
		for (const label of [
			SETTINGS_LABELS.decayOptionNone,
			SETTINGS_LABELS.decayOptionGentle,
			SETTINGS_LABELS.decayOptionNormal,
			SETTINGS_LABELS.decayOptionStrict,
		]) {
			expect(how, `選択肢「${label}」がガイドに出てこない`).toContain(label);
		}
	});

	it('[V4] ポイント表示 step が 2 つの表示モード名と通貨レート入力に触れている', () => {
		const how = STEPS['settings-activities-point'].how;
		expect(how).toContain(SETTINGS_LABELS.pointModePoint);
		expect(how).toContain(SETTINGS_LABELS.pointModeCurrency);
		// レート欄はガイドが触れないと、通貨モードを選んだ保護者が必須入力に気づかない
		expect(how, 'レート入力に触れていない').toMatch(/レート/);
	});

	it('[V5] ページの 4 カードすべてに step がある', () => {
		for (const id of [
			'settings-activities-decay',
			'settings-activities-point',
			'settings-activities-default-child',
			'settings-activities-sibling',
		]) {
			expect(
				SETTINGS_ACTIVITIES_GUIDE.steps.some((s) => s.id === id),
				`${id} の step が無い`,
			).toBe(true);
		}
	});

	// 「既定の子供」はお子さま 2 人以上のときだけ描画される = optional が要る。
	// 逆に常設カードに optional を付けると anchor 退行を silent に隠す。
	it('[V6] 条件付きカードだけが optional', () => {
		const optionalIds = SETTINGS_ACTIVITIES_GUIDE.steps
			.filter((s) => s.optional)
			.map((s) => s.id)
			.sort();
		expect(optionalIds).toEqual(['settings-activities-default-child']);
	});

	it('[V7] きょうだいランキング step がプラン制限を説明している', () => {
		const step = STEPS['settings-activities-sibling'];
		const text = [step.what, ...(step.tips ?? [])].join('\n');
		expect(text, 'プラン限定であることに触れていない').toContain(PLAN_FULL_TERMS.premium);
	});

	it('[V8] ガイドが指す anchor がページに実在する', () => {
		const source = fs.readFileSync(PAGE, 'utf8');
		for (const step of SETTINGS_ACTIVITIES_GUIDE.steps) {
			if (!step.selector) continue;
			const anchor = step.selector.match(/data-tutorial="([a-z0-9-]+)"/)?.[1];
			expect(anchor, `${step.id} の selector が data-tutorial 形式でない`).toBeDefined();
			expect(source, `${step.id} の anchor "${anchor}" がページに無い`).toContain(
				`data-tutorial="${anchor}"`,
			);
		}
	});

	// #4663 F7: 選択肢名 / 通貨欄のラベルが svelte 直書きに戻ると、ガイドと画面が別の語を
	// 名乗り出す（[V3] は labels 側だけを見るので、page 側の退行はここで止める）。
	it('[V9] ページが選択肢名・通貨欄ラベルを labels 経由で描いている', () => {
		const source = fs.readFileSync(PAGE, 'utf8');
		for (const key of [
			'decayOptionNone',
			'decayOptionGentle',
			'decayOptionNormal',
			'decayOptionStrict',
			'pointCurrencyLabel',
			'pointRateLabel',
			'pointRateHint',
		]) {
			expect(source, `SETTINGS_LABELS.${key} を参照していない`).toContain(`SETTINGS_LABELS.${key}`);
		}
	});
});
