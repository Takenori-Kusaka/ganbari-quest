// tests/unit/routes/settings-data-guide.test.ts
// #4665 (EPIC #4650): 設定 > データ のガイドが「取り返しのつかない操作」を説明しないまま
// ページ上部で終わっていた class を機械 gate 化する。
//
// 観測された実害:
//   - 3 step すべてが最上部の「データ管理」カード内で完結し、中段のクラウド共有と
//     末尾の Danger Zone（すべてのデータを削除）にはどの step も到達しなかった
//   - 「バックアップするボタンをタップ」が実ボタン名（バックアップデータをダウンロード）と違う
//   - **復元の既定が「置換（既存データを削除してインポート）」** で、押すと子供・活動ログ・
//     ポイントを全削除してから読み込むのに、ガイドは一言も警告していなかった
//
// 「不可逆な操作に step があるか」「その step が不可逆だと述べているか」は機械判定できる。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PAGE_GUIDE_LABELS, SETTINGS_LABELS } from '$lib/domain/labels';
import { SETTINGS_DATA_GUIDE } from '../../../src/routes/(parent)/admin/settings/data/_guide';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PAGE = path.join(REPO_ROOT, 'src/routes/(parent)/admin/settings/data/+page.svelte');

const STEPS = PAGE_GUIDE_LABELS.adminSettingsData.steps;
type GuideStepText = {
	title: string;
	what: string;
	how: string;
	goal: string;
	tips?: readonly string[];
};
const textOf = (id: keyof typeof STEPS): string => {
	const s = STEPS[id] as GuideStepText;
	return [s.title, s.what, s.how, s.goal, ...(s.tips ?? [])].join('\n');
};

describe('#4665 設定 > データ のガイドが不可逆操作を説明する', () => {
	it('[D1] ページの主要 4 セクションすべてに step がある', () => {
		for (const id of [
			'settings-data-export',
			'settings-data-import',
			'settings-data-cloud',
			'settings-data-clear',
		]) {
			expect(
				SETTINGS_DATA_GUIDE.steps.some((s) => s.id === id),
				`${id} の step が無い`,
			).toBe(true);
		}
	});

	it('[D2] バックアップ step が実ボタン名と 2 つのオプションに触れている', () => {
		const text = textOf('settings-data-export');
		expect(text, 'ボタン名が画面と違う').toContain(SETTINGS_LABELS.dataExportAction);
		expect(text, '画像・音声オプションに触れていない').toContain(
			SETTINGS_LABELS.dataExportIncludeFiles,
		);
		expect(text, '圧縮オプションに触れていない').toContain(SETTINGS_LABELS.dataExportCompact);
	});

	// 今回の中心。置換 = 全削除であることを述べない復元 step を通さない。
	it('[D3] 復元 step が「置換」の既定と不可逆性を警告している', () => {
		const text = textOf('settings-data-import');
		expect(text, '置換モード名が出てこない').toContain(SETTINGS_LABELS.dataImportModeReplace);
		expect(text, '追加モード名が出てこない').toContain(SETTINGS_LABELS.dataImportModeAdd);
		expect(text, '削除されることを述べていない').toMatch(/削除/);
		expect(text, '元に戻せないことを述べていない').toMatch(/戻せ(ない|ません)/);
	});

	it('[D4] 全削除 step が不可逆であることと事前保存を述べている', () => {
		const text = textOf('settings-data-clear');
		expect(text, '取り消せないことを述べていない').toMatch(/取り消せ(ない|ません)/);
		expect(text, '事前のダウンロードを勧めていない').toMatch(/ダウンロード/);
	});

	it('[D5] クラウド共有 step が実セクション名と PIN の受け渡しを説明している', () => {
		const text = textOf('settings-data-cloud');
		// 画面見出しは「☁️ クラウド共有」。絵文字を除いた語で照合する
		expect(text).toContain(SETTINGS_LABELS.cloudSectionTitle.replace(/^[^\p{L}]+/u, ''));
		expect(text, 'PIN の受け渡しに触れていない').toMatch(/PIN/);
	});

	// 条件付き描画の 2 軸: クラウド共有カードは authMode==='cognito' のときだけ描かれる。
	// エクスポートはプラン gate なので requiredTier で静的に絞る（optional ではない）。
	it('[D6] 条件付き step の絞り方が実装の条件と対応している', () => {
		const cloud = SETTINGS_DATA_GUIDE.steps.find((s) => s.id === 'settings-data-cloud');
		expect(cloud?.requiredRuntime).toBe('saas');
		expect(cloud?.optional).toBe(true);

		const exp = SETTINGS_DATA_GUIDE.steps.find((s) => s.id === 'settings-data-export');
		expect(exp?.requiredTier).toBe('standard');
		expect(exp?.optional ?? false, 'プラン gate に optional は使わない').toBe(false);

		// 常設セクションに optional を付けると anchor 退行を silent に隠す
		for (const id of ['settings-data-import', 'settings-data-clear']) {
			const step = SETTINGS_DATA_GUIDE.steps.find((s) => s.id === id);
			expect(step?.optional ?? false, `${id} に optional が付いている`).toBe(false);
		}
	});

	it('[D7] 概要が中段・末尾のセクションも並びに含めている', () => {
		const how = STEPS['settings-data-intro'].how;
		expect(how, 'クラウド共有が並びに無い').toMatch(/クラウド共有/);
		expect(how, '削除が並びに無い').toMatch(/削除/);
	});

	it('[D8] ガイドが指す anchor がページに実在する', () => {
		const source = fs.readFileSync(PAGE, 'utf8');
		for (const step of SETTINGS_DATA_GUIDE.steps) {
			if (!step.selector) continue;
			const anchor = step.selector.match(/data-tutorial="([a-z0-9-]+)"/)?.[1];
			expect(anchor, `${step.id} の selector が data-tutorial 形式でない`).toBeDefined();
			expect(source, `${step.id} の anchor "${anchor}" がページに無い`).toContain(
				`data-tutorial="${anchor}"`,
			);
		}
	});

	// #4665 F6: 「クラウドバックアップ」/「スタンダード以上」の別名が復活すると、
	// 同じものが画面内で 2 つの名前を持つ状態に戻る。
	it('[D9] クラウドセクションの呼称とプラン表記が 1 つに揃っている', () => {
		const labelsSource = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/domain/labels.ts'), 'utf8');
		const body = labelsSource.replace(/^\s*\/\/.*$/gm, '');
		expect(body, '「クラウドバックアップ」の別名が残っている').not.toContain(
			'クラウドバックアップ',
		);
		const pageBody = fs.readFileSync(PAGE, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
		const badgeLiterals = [...pageBody.matchAll(/<PremiumBadge[^>]*label="([^"]+)"/g)].map(
			(m) => m[1],
		);
		expect(badgeLiterals, 'PremiumBadge の label が直書きされている').toEqual([]);
	});
});
