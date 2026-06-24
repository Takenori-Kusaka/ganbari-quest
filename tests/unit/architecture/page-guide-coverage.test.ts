// tests/unit/architecture/page-guide-coverage.test.ts
// #3262 (EPIC #3260 F1): ページガイドの (1) 親パス フォールバック + (2) 顧客接点ルートの
// 登録漏れ網羅 gate。
//
// (1) getPageGuide の親パスフォールバック (guideCandidatePaths) を unit 検証。
// (2) 顧客接点ルート (admin + marketplace、ops/child は対象外) を列挙し、各ルートが
//     REGISTERED (dedicated guide 登録済) / PENDING (C1〜C7 で付与予定の backlog) /
//     EXEMPT (dedicated guide 不要、fallback で十分) のいずれかに必ず属すことを assert する。
//     どれにも属さない新規ルート = 登録漏れ → hard-fail (registration leak 検出)。
//     C2〜C7 が dedicated guide を付与したら、その route を PENDING から外す (REGISTERED へ移行)。

import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	guideCandidatePaths,
	REGISTERED_GUIDE_PATHS,
} from '../../../src/lib/ui/tutorial/page-guide-registry';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// C1〜C7 で dedicated guide を付与予定の顧客接点ルート (未登録 backlog)。
// dedicated guide を実装したら該当 route を本 PENDING から削除する (REGISTERED へ移行)。
const PENDING_GUIDE_PATHS = [
	// C2: settings サブ 6
	'/admin/settings/account',
	'/admin/settings/activities',
	'/admin/settings/data',
	'/admin/settings/notifications',
	'/admin/settings/rules',
	'/admin/settings/support',
	// C3: プラン・課金 + billing → #3267 で REGISTERED へ移行済
	// C4: members + packs
	'/admin/members',
	'/admin/packs',
	// C5: marketplace
	'/marketplace',
	'/marketplace/[type]/[itemId]',
	// C7: 低頻度顧客接点
	'/admin/certificates',
	'/admin/growth-book',
	'/admin/rewards/requests',
];

// dedicated guide 不要 (親フォールバックで十分) なルート。各々理由を明記。
const EXEMPT_GUIDE_PATHS: Record<string, string> = {
	'/admin/activities/[id]/edit':
		'活動編集フォーム (transient)。親 /admin/activities にフォールバック',
	'/admin/certificates/[id]': '証明書詳細 (transient)。親 /admin/certificates にフォールバック',
	'/admin/billing/cancel': '解約フロー途中 (transient)。/admin/billing にフォールバック',
	'/admin/billing/cancel/graduation': '卒業フロー (transient)。/admin/billing にフォールバック',
	'/admin/billing/cancel/thanks': '解約完了 (transient)。/admin/billing にフォールバック',
};

function listRoutePaths(): string[] {
	const out: string[] = [];
	const walk = (dir: string, routePrefix: string) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (e.isDirectory()) {
				// (parent) 等の group ルートは URL に出ないので prefix に足さない
				const seg = e.name.startsWith('(') && e.name.endsWith(')') ? '' : `/${e.name}`;
				walk(resolve(dir, e.name), routePrefix + seg);
			} else if (e.name === '+page.svelte') {
				out.push(routePrefix || '/');
			}
		}
	};
	walk(resolve(REPO_ROOT, 'src/routes/(parent)/admin'), '/admin');
	walk(resolve(REPO_ROOT, 'src/routes/marketplace'), '/marketplace');
	return out;
}

describe('#3262 F1: getPageGuide 親パス フォールバック', () => {
	it('guideCandidatePaths は自身→親→祖先を最も具体的な順で返す', () => {
		expect(guideCandidatePaths('/admin/settings/account')).toEqual([
			'/admin/settings/account',
			'/admin/settings',
			'/admin',
		]);
		expect(guideCandidatePaths('/admin')).toEqual(['/admin']);
	});

	it('未登録サブパスは登録済の親候補に到達する (= ? が空にならない)', () => {
		// /admin/settings/account は未登録だが、候補に登録済の /admin/settings を含む
		const candidates = guideCandidatePaths('/admin/settings/account');
		expect(candidates.some((c) => REGISTERED_GUIDE_PATHS.includes(c))).toBe(true);
		// /admin 配下は最終的に必ず /admin (登録済) にフォールバックできる
		expect(guideCandidatePaths('/admin/members').includes('/admin')).toBe(true);
	});
});

describe('#3262 F1: 顧客接点ルートの登録漏れ網羅 gate', () => {
	it('全顧客接点ルートが REGISTERED / PENDING / EXEMPT のいずれかに属す (新規登録漏れ 0)', () => {
		const routes = listRoutePaths();
		const accounted = new Set([
			...REGISTERED_GUIDE_PATHS,
			...PENDING_GUIDE_PATHS,
			...Object.keys(EXEMPT_GUIDE_PATHS),
		]);
		const unaccounted = routes.filter((r) => !accounted.has(r));
		expect(
			unaccounted,
			`ガイド未対応の顧客接点ルートが追加された (REGISTERED/PENDING/EXEMPT いずれにも不在)。\n` +
				`dedicated guide を付与し registry 登録するか、PENDING / EXEMPT に分類すること:\n` +
				`${unaccounted.map((r) => `  ${r}`).join('\n')}`,
		).toEqual([]);
	});

	it('PENDING の route はまだ REGISTERED になっていない (dedicated guide 実装後は PENDING から外す)', () => {
		const stale = PENDING_GUIDE_PATHS.filter((p) => REGISTERED_GUIDE_PATHS.includes(p));
		expect(
			stale,
			`PENDING に挙げた route が registry 登録済 (dedicated guide 完成)。本 PENDING リストから削除して ratchet を締める:\n${stale.map((r) => `  ${r}`).join('\n')}`,
		).toEqual([]);
	});
});
