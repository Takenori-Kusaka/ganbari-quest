// tests/unit/routes/settings-data-error-alert-props-4752.test.ts
//
// #4752: server は ADR-0062 の種別マッピングで「どれくらい重大か (severity)」「顧客が次に何を
// すべきか (action)」を決めているのに、`/admin/settings/data` の画面はその 2 つを **props に
// 直書き** していた。実測すると、置換復元の自動復旧が半端に終わった 409
// (`severity: error` / `action: contact_admin` = 運営に連絡) が、画面では
// 「入力内容をご確認ください」(fix_input) と案内されていた — 半端な状態の顧客に、
// 直しようのない入力を直せと言う誤った次の行動。
//
// 本 test は「server の error body から解決した値を渡している」ことを描画元 (page) の側で固定する。
// [C5] (tests/integration/db/restore-compensation-failure-4752.test.ts) が「渡された値が画面に
// どう出るか」を DOM で見るのに対し、こちらは「画面が値を渡し続けるか」を見る (再固定の防止)。
//
// 走査対象は settings/data の 1 file のみ (repo 走査ではない)。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PAGE_PATH = resolve(process.cwd(), 'src/routes/(parent)/admin/settings/data/+page.svelte');
const source = readFileSync(PAGE_PATH, 'utf-8');

/** `<ErrorAlert ... />` タグを属性文字列ごと取り出す。 */
function errorAlertTags(): string[] {
	return [...source.matchAll(/<ErrorAlert\b[\s\S]*?\/>/g)].map((m) => m[0]);
}

/** そのタグが表示する message 変数名 (`message={foo}` の foo)。 */
function messageBinding(tag: string): string {
	return /message=\{([^}]+)\}/.exec(tag)?.[1]?.trim() ?? '';
}

// server の API error body (severity / action を持つ) 由来の表示。ここは server 指定を反映する。
const SERVER_DERIVED_MESSAGES = ['importError', 'exportError', 'cloudError', 'cloudImportError'];

describe('#4752 settings/data の ErrorAlert が server の severity / action を反映する', () => {
	it('server 由来の 4 経路すべてで severity / action を式で渡している (直書きしていない)', () => {
		const tags = errorAlertTags();
		expect(tags.length).toBeGreaterThanOrEqual(SERVER_DERIVED_MESSAGES.length);

		for (const name of SERVER_DERIVED_MESSAGES) {
			const tag = tags.find((t) => messageBinding(t) === name);
			expect(tag, `${name} を表示する ErrorAlert が見つからない`).toBeDefined();
			if (!tag) continue;
			expect(tag, `${name}: severity を直書きしている (server 指定が画面に届かない)`).not.toMatch(
				/severity="/,
			);
			expect(tag, `${name}: action を直書きしている (誤った次の行動を案内しうる)`).not.toMatch(
				/action="/,
			);
			expect(tag, `${name}: severity を式で渡していない`).toMatch(/severity=\{/);
			expect(tag, `${name}: action を式で渡していない`).toMatch(/action=\{/);
		}
	});

	it('解決は error-notify SSOT (resolveApiErrorDisplay) 経由で行う (page 内での独自判定を作らない)', () => {
		expect(source).toContain('resolveApiErrorDisplay');
		// 旧: page ローカルの独自 kind 解決関数。SSOT へ移したので復活させない。
		expect(source).not.toContain('resolveCloudImportErrorKind');
	});
});
