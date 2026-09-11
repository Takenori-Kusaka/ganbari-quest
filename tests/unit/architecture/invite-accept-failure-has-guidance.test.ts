// tests/unit/architecture/invite-accept-failure-has-guidance.test.ts (#4704 / ADR-0061)
//
// **招待の受諾に失敗した理由は、必ず顧客向けの案内を持つ。**
//
// # なぜ必要か
//
// 受諾に失敗した人は `/auth/join` に留まる (#4636)。理由を伝えないと「なぜ参加できないのか
// 分からないまま行き止まる」ので、理由ごとに「なぜ + 次アクション」を出す
// (#3555 ① が email 束縛の 2 件に対して案内を入れた経緯)。
//
// ところが案内を出す判定が **理由コードの手書き allowlist** だったため、#4704 で
// `MEMBER_LIMIT_REACHED` を足したときに素通りした — 上限で参加できなかった人が、
// 何の説明もないまま行き止まる経路が生まれていた (PR #4792 の adversarial review で検出)。
//
// 個別修正では 3 件目が出るので、**理由と案内の対応を型と実行時の両方で全域にする**。
//
// # 何を fail させるか
//
// - 受諾 txn の失敗理由 (`AcceptInviteFailure`) のどれかが、wire の理由コードに写像されない
// - 理由コードのどれかに案内文が無い
// - 案内を出す判定が理由コードの手書き allowlist に戻る (理由を足すと素通りする形)

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INVITE_JOIN_BLOCKED_MESSAGES } from '$lib/domain/labels';
import {
	INVITE_ACCEPT_ERROR_REASONS,
	isInviteAcceptErrorReason,
} from '$lib/domain/validation/auth';

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
		expect(INVITE_ACCEPT_ERROR_REASONS.length).toBeGreaterThanOrEqual(4);
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
				isInviteAcceptErrorReason(code),
				`理由コード ${code} が INVITE_ACCEPT_ERROR_REASONS にありません ` +
					`(案内が出ず、/auth/join で無説明の行き止まりになります)`,
			).toBe(true);
		}
	});

	it('全ての理由コードに「なぜ」と「次に何を」を含む案内文がある', () => {
		for (const code of INVITE_ACCEPT_ERROR_REASONS) {
			// 汎用 fallback (getInviteJoinBlockedMessage) ではなく対応表を直接引く。
			// fallback 経由だと「案内が無い理由」が汎用文言で埋まって検出できない。
			const message: string = INVITE_JOIN_BLOCKED_MESSAGES[code];
			expect(message, `${code} の案内文がありません`).toBeTruthy();
			expect(message.length, `${code} の案内が短すぎます`).toBeGreaterThan(30);
		}
	});

	it('案内を出す判定が理由を選ばない (手書き allowlist に戻っていない)', () => {
		// `/auth/join` は理由を絞らずに受け取り、未知の理由は汎用文言に落ちる (#4636)。
		const joinServer = readSrc('src/routes/auth/join/+page.server.ts');
		expect(joinServer).toContain('getInviteJoinBlockedMessage(reason)');
		// 個別コードの比較で分岐する形に戻ったら落とす (#4704 の再発形)
		expect(
			/reason === '[A-Z_]+'/.test(joinServer),
			'受諾失敗の案内判定が理由コードの直接比較に戻っています (理由を足したとき素通りします)',
		).toBe(false);
	});
});
