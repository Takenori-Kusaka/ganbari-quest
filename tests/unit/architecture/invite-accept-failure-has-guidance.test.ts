// tests/unit/architecture/invite-accept-failure-has-guidance.test.ts (#4704 / ADR-0061)
//
// **招待の受諾に失敗した理由は、必ず顧客向けの案内を持つ。**
//
// # なぜ必要か
//
// 受諾に失敗すると、その後 fallback の**新規テナント自動作成**が走る。理由を伝えないと
// 顧客は「なぜか知らない空の家族グループの owner になっている」dead-end に着地する
// (#3555 ① が email 束縛の 2 件に対して案内バナーを入れた経緯)。
//
// ところが案内を出す判定が **理由コードの手書き allowlist** だったため、#4704 で
// `MEMBER_LIMIT_REACHED` を足したときに素通りした — 上限で参加できなかった人が、
// 何の説明もないまま別の空グループに着地する経路が生まれていた
// (PR #4792 の adversarial review で検出)。
//
// 個別修正では 3 件目が出るので、**理由と案内の対応を型と実行時の両方で全域にする**。
//
// # 何を fail させるか
//
// - 受諾 txn の失敗理由 (`AcceptInviteFailure`) のどれかが、wire の理由コードに写像されない
// - 理由コードのどれかに案内文が無い
// - 案内を出す判定が理由コードの SSOT (`isInviteAcceptErrorCode`) を経由しない形に戻る

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUTH_INVITE_LABELS } from '$lib/domain/labels';
import { INVITE_ACCEPT_ERROR_CODES, isInviteAcceptErrorCode } from '$lib/domain/validation/auth';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const readSrc = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf-8');

/** 受諾 txn の失敗理由 → wire の理由コードの写像 (invite-service の SSOT)。 */
function acceptInviteFailureErrorMap(): Record<string, string> {
	const src = readSrc('src/lib/server/services/invite-service.ts');
	const block = src.match(
		/const ACCEPT_INVITE_FAILURE_ERRORS: Record<AcceptInviteFailure, string> = \{([\s\S]*?)\n\};/,
	);
	const body = block?.[1];
	if (!body) throw new Error('ACCEPT_INVITE_FAILURE_ERRORS を読めませんでした');
	const entries = [...body.matchAll(/^\t([A-Z_]+):\s*'([A-Z_]+)',/gm)].map(
		(m) => [m[1] as string, m[2] as string] as const,
	);
	if (entries.length === 0) throw new Error('写像を 1 件も抽出できませんでした');
	return Object.fromEntries(entries);
}

/** 受諾 txn が返しうる失敗理由 (repo 契約の union)。 */
function acceptInviteFailureReasons(): string[] {
	const src = readSrc('src/lib/server/db/interfaces/auth-repo.interface.ts');
	const block = src.match(/export type AcceptInviteFailure =([\s\S]*?);/);
	const body = block?.[1];
	if (!body) throw new Error('AcceptInviteFailure を読めませんでした');
	const reasons = [...body.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] as string);
	if (reasons.length === 0) throw new Error('失敗理由を 1 件も抽出できませんでした');
	return reasons;
}

describe('#4704 招待受諾の失敗理由は必ず顧客向け案内を持つ', () => {
	it('この test 自体が空振りしない (理由と写像を実ファイルから読めている)', () => {
		expect(acceptInviteFailureReasons().length).toBeGreaterThanOrEqual(4);
		expect(Object.keys(acceptInviteFailureErrorMap()).length).toBeGreaterThanOrEqual(4);
		expect(INVITE_ACCEPT_ERROR_CODES.length).toBeGreaterThanOrEqual(4);
	});

	it('受諾 txn の全失敗理由が wire の理由コードに写像される', () => {
		const map = acceptInviteFailureErrorMap();
		for (const reason of acceptInviteFailureReasons()) {
			expect(map[reason], `AcceptInviteFailure.${reason} の写像がありません`).toBeTruthy();
		}
	});

	it('写像先の理由コードが全て SSOT の union に含まれる', () => {
		for (const code of Object.values(acceptInviteFailureErrorMap())) {
			expect(
				isInviteAcceptErrorCode(code),
				`理由コード ${code} が INVITE_ACCEPT_ERROR_CODES にありません (案内が出ず、` +
					`受諾失敗 → 新規家族グループ自動作成で無説明の dead-end になります)`,
			).toBe(true);
		}
	});

	it('全ての理由コードに「なぜ」と「次に何を」を含む案内文がある', () => {
		for (const code of INVITE_ACCEPT_ERROR_CODES) {
			const banner = AUTH_INVITE_LABELS.acceptErrorBanners[code];
			expect(banner, `${code} の案内文がありません`).toBeTruthy();
			// 受諾できなかった事実 + 新グループが作られた事実 + 次アクションを必ず含める
			expect(banner, `${code} の案内が新規グループ作成に触れていません`).toContain(
				'新しい家族グループが作成されました',
			);
			expect(banner.length, `${code} の案内が短すぎます`).toBeGreaterThan(40);
		}
	});

	it('案内を出す判定が理由コードの SSOT を経由している (手書き allowlist に戻っていない)', () => {
		const provider = readSrc('src/lib/server/auth/providers/cognito.ts');
		expect(provider).toContain('isInviteAcceptErrorCode(result.error)');
		// 個別コードの比較で分岐する形に戻ったら落とす (#4704 の再発形)
		expect(
			/result\.error === '[A-Z_]+'/.test(provider),
			'受諾失敗の案内判定が理由コードの直接比較に戻っています (理由を足したとき素通りします)',
		).toBe(false);

		const layout = readSrc('src/routes/(parent)/admin/+layout.server.ts');
		expect(layout).toContain('isInviteAcceptErrorCode(rawInviteAcceptError)');
	});
});
