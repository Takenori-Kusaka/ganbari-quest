// #4175 — 「component は直したが実画面に届いていない」を機械で閉じる。
//
// ## 実際に起きたこと
//
// #4153 で `BackupHealthCard.svelte` を切り出し、Storybook に 4 状態を置き、
// **SS を `ss-render-impossible` 宣言で省略した**。根拠は「Storybook で見た目を確認できる」だった。
//
// ところが実画面 (`admin/settings/support/+page.svelte`) は **59 行のインライン実装**のままで、
// **component を import している画面が 1 つも無かった**。つまり:
//
//   - Storybook が描いていたのは **誰も表示しない component**
//   - 「Storybook で確認できるから SS 不要」という主張が成立していなかった (証跡の真正性)
//   - #4162 で component 側に足した `backupRotationBlockedHint` が
//     **家族の見る画面に 1 箇所も無い** = 修正が届いていない
//
// テストは通り、CI は緑で、PR body には「component 化 + Storybook 4 状態」と書いてあった。
// **成果物が存在し証跡が揃っているのに顧客経路だけ空**という形で、#3950 と同型である。
//
// ## 何を固定するか
//
// 描画を 1 箇所に集約したこと。二重実装が復活すれば落ちる。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PAGE_PATH = join(
	process.cwd(),
	'src',
	'routes',
	'(parent)',
	'admin',
	'settings',
	'support',
	'+page.svelte',
);
const CARD_PATH = join(
	process.cwd(),
	'src',
	'lib',
	'features',
	'admin',
	'components',
	'BackupHealthCard.svelte',
);

const page = readFileSync(PAGE_PATH, 'utf-8');
const card = readFileSync(CARD_PATH, 'utf-8');

describe('#4175 バックアップ状態カードの配線', () => {
	it('[BW1] 実画面が BackupHealthCard を使っている', () => {
		// これが無いと、component をいくら直しても家族の画面は変わらない。
		expect(page).toContain('BackupHealthCard');
		expect(page).toMatch(/<BackupHealthCard\s/);
	});

	it('[BW2] 実画面が状態表示を再実装していない (二重実装の復活を止める)', () => {
		// level ごとの Alert 出し分けは component の責務。page 側に同じ分岐が生えたら、
		// 片方だけ直して「直したのに届かない」が再発する。
		const reimplemented = [
			'backupOkTitle',
			'backupWarnTitle',
			'backupCriticalTitle',
			'backupLastSuccessLabel',
			'backupActionHint',
			'backupRotationBlockedHint',
		].filter((label) => page.includes(label));

		expect(
			reimplemented,
			`実画面が状態表示を再実装しています: ${reimplemented.join(', ')}。` +
				'描画は BackupHealthCard に集約してください (#4175 の再発)。',
		).toEqual([]);
	});

	it('[BW3] component 側が全ての状態文言を持っている (page から移し切れている)', () => {
		// [BW2] は「page に無いこと」しか見ない。移し先に無ければ**どこにも無い**ので、
		// 消しただけで通ってしまう。移動先の存在も併せて固定する。
		for (const label of [
			'backupOkTitle',
			'backupWarnTitle',
			'backupCriticalTitle',
			'backupLastSuccessLabel',
			'backupActionHint',
		]) {
			expect(card, `${label} が BackupHealthCard にありません`).toContain(label);
		}
	});

	it('[BW4] #4162 の rotation-blocked 文言が実際に描画経路へ載っている', () => {
		// 判定 (domain) → 表示 (component) → 画面 (page) のどこか 1 つでも切れると
		// 「修正したのに家族には届かない」になる。表示層に到達していることを固定する。
		expect(card).toContain('backupRotationBlockedHint');
		expect(card).toContain('rotation-blocked');
	});
});
