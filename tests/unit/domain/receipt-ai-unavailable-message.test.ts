// tests/unit/domain/receipt-ai-unavailable-message.test.ts
// 領収書 AI 読み取りが使えないときの顧客向け文言と、運営への通知方針の整合 (オーナー決裁 2026-08-07)。
//
// この文言は「顧客が何をすればよいか」だけでなく「**運営に何が起きているか**」も語る。
// 後者は実装の事実を超えて書くと顧客に嘘をつくことになるため、文言と通知方針を 1 本の
// test で縛る (ADR-0013 の「実装していないことを実装しているように書かない」を
// 顧客向けエラー文言にも適用する)。
//
// オーナー決裁 2026-08-07: アラートは Discord の障害通知へ webhook で飛ばす (`notify: true`)。
// したがって「運営が検知済み」は事実として書ける。整合は片側ではなく **両方向** で縛る
// (届くのに黙る / 届かないのに約束する のどちらも fail させる)。
//
// ただしその裏付け (alarm) は AWS の `OpsStack` にしか無い。自宅 NUC のセルフホスト家庭には
// 「運営」が居ないため、同じ文言を出すと嘘になるうえ、本当に直せる親自身から設定を直す動機を
// 奪う。文言は配備で 2 本に分け、選択 (`resolveAiUnavailableMessage`) も本 test で固定する。

import { describe, expect, it } from 'vitest';
import { ALARM_NOTIFY_POLICY } from '../../../infra/lib/ops-alert-policy';
import { POINTS_LABELS } from '../../../src/lib/domain/labels';
import type { TypedEnv } from '../../../src/lib/runtime/env';
import {
	isVendorOperatedDeployment,
	resolveAiUnavailableMessage,
} from '../../../src/lib/server/ai/unavailable-message';

/** AI 不達を運営に届ける alarm。文言が「検知済み」と言えるかはこの alarm の通知方針で決まる。 */
const AI_ALARM_NAME = 'ganbari-quest-ai-provider-unavailable';

/** 通知方針を引く。表から消えていたら (= 判断の根拠自体が消えたら) その場で落とす。 */
function aiAlarmPolicy() {
	const policy = ALARM_NOTIFY_POLICY[AI_ALARM_NAME];
	if (!policy) throw new Error(`${AI_ALARM_NAME} が ALARM_NOTIFY_POLICY から消えています`);
	return policy;
}

/** 「運営が知っている」と顧客に読ませる語。文言と通知方針の整合判定に使う。 */
const AWARENESS_WORDS = ['検知', '通知', '連絡', '把握'];

const MANAGED_MESSAGE =
	'写真ではなくシステム側の不具合で、運営が検知済みです。金額を手入力してください。';
const SELF_HOSTED_MESSAGE =
	'写真ではなくサーバーのAI設定が原因です。設定を直すか金額を手入力してください。';

/** 実行モードだけを差し替えた env。resolveRuntimeMode は APP_MODE を無条件に優先する。 */
function envForMode(mode: TypedEnv['APP_MODE']): TypedEnv {
	return { APP_MODE: mode, NODE_ENV: 'test' } as TypedEnv;
}

describe('[1] 顧客向け文言 (クラウド配備 = 運営が運用している)', () => {
	it('[1-1] オーナー決裁 2026-08-07 で採用された文言と完全一致する', () => {
		expect(POINTS_LABELS.receiptAiUnavailableManaged).toBe(MANAGED_MESSAGE);
	});

	// #4366 の実害は「自分の写真が悪い」と誤解して撮り直すことだった。原因が顧客側に無いことを
	// 先に言い、そのうえで今できること (手入力) を示す。
	it('[1-2] 顧客のせいではないこと / いま何ができるかを両方伝える', () => {
		expect(POINTS_LABELS.receiptAiUnavailableManaged).toContain('写真ではなく');
		expect(POINTS_LABELS.receiptAiUnavailableManaged).toContain('システム側');
		expect(POINTS_LABELS.receiptAiUnavailableManaged).toContain('手入力');
	});
});

describe('[2] 顧客向け文言 (セルフホスト配備 = 運営が居ない)', () => {
	it('[2-1] 採用された文言と完全一致する', () => {
		expect(POINTS_LABELS.receiptAiUnavailableSelfHosted).toBe(SELF_HOSTED_MESSAGE);
	});

	it('[2-2] 顧客のせいではないこと / いま何ができるかを両方伝える', () => {
		expect(POINTS_LABELS.receiptAiUnavailableSelfHosted).toContain('写真ではなく');
		expect(POINTS_LABELS.receiptAiUnavailableSelfHosted).toContain('手入力');
	});

	// 自宅 NUC には「運営」が居ない。検知を約束すると嘘になるうえ、本当に直せる親自身から
	// 設定を直す動機を奪う。
	it('[2-3] 運営が対応中だと読める語を含まない', () => {
		for (const word of [...AWARENESS_WORDS, '運営']) {
			expect(POINTS_LABELS.receiptAiUnavailableSelfHosted).not.toContain(word);
		}
	});

	// 実体は設定・資格情報の欠落。「システム障害」と読ませると親の不安と問い合わせを不必要に
	// 増やす。直せる場所を示すのが正しい (過剰な障害宣言をしない)。
	it('[2-4] 過剰な障害宣言をせず、直せる場所を指す', () => {
		for (const word of ['障害', '不具合']) {
			expect(POINTS_LABELS.receiptAiUnavailableSelfHosted).not.toContain(word);
		}
		expect(POINTS_LABELS.receiptAiUnavailableSelfHosted).toContain('設定');
	});
});

describe('[3] 両配備に共通して守る性質', () => {
	const both = [
		['managed', POINTS_LABELS.receiptAiUnavailableManaged],
		['self-hosted', POINTS_LABELS.receiptAiUnavailableSelfHosted],
	] as const;

	// O2 (長すぎて読み飛ばされる) の再燃を防ぐため、実測長を上限として固定する。
	// 実測はいずれも 40 字。PO 例示の写しは 42 字だった。
	it.each(both)('[3-1] %s は 40 字以内に収まる', (_name, message) => {
		expect([...message].length).toBeLessThanOrEqual(40);
	});

	// 画像が読めなかったとき (`receiptOcrFailed` = 撮り直しを促す) と混ぜると、顧客は
	// 自分の写真が悪いと誤解して撮り直しを繰り返す (#4366 害 b)。
	it.each(both)('[3-2] %s は撮り直しを促さない (画像起因の失敗と言い分ける)', (_name, message) => {
		expect(message).not.toContain('撮り直');
	});

	it('[3-3] 画像起因の失敗 (receiptOcrFailed) は従来どおり撮り直しを促す', () => {
		expect(POINTS_LABELS.receiptOcrFailed).toContain('撮り直');
	});

	// 手入力で今すぐ進めるのだから、待たせる理由がない (オーナー決裁 2026-08-07)。
	it.each(both)('[3-4] %s は復旧を待つよう要求しない', (_name, message) => {
		for (const wait of ['お待ち', '復旧まで', 'しばらく']) {
			expect(message).not.toContain(wait);
		}
	});

	it('[3-5] 2 本は別の文言である (取り違えの検出)', () => {
		expect(POINTS_LABELS.receiptAiUnavailableManaged).not.toBe(
			POINTS_LABELS.receiptAiUnavailableSelfHosted,
		);
	});
});

describe('[4] 配備による文言の選択 (resolveAiUnavailableMessage)', () => {
	// alarm は AWS の OpsStack にしか無い。「運営が検知済み」と言えるのはここだけ。
	it.each([['aws-prod'], ['demo']] as const)('[4-1] %s はクラウド版の文言を返す', (mode) => {
		const env = envForMode(mode);
		expect(isVendorOperatedDeployment(env)).toBe(true);
		expect(resolveAiUnavailableMessage(env)).toBe(MANAGED_MESSAGE);
	});

	it.each([
		['nuc-prod'],
		['local-debug'],
		['build'],
	] as const)('[4-2] %s はセルフホスト版の文言を返す', (mode) => {
		const env = envForMode(mode);
		expect(isVendorOperatedDeployment(env)).toBe(false);
		expect(resolveAiUnavailableMessage(env)).toBe(SELF_HOSTED_MESSAGE);
	});

	// 既定は「運営は居ない」側。未知のモードが増えたときに、偽の約束をする方向へ倒れない。
	it('[4-3] 判定できない env は嘘をつかない側 (セルフホスト版) に倒れる', () => {
		const env = {} as TypedEnv;
		expect(isVendorOperatedDeployment(env)).toBe(false);
		expect(resolveAiUnavailableMessage(env)).toBe(SELF_HOSTED_MESSAGE);
	});
});

describe('[5] クラウド版の文言と通知方針の整合 (両方向)', () => {
	it('[5-1] AI 不達 alarm が通知方針表に宣言されている', () => {
		expect(ALARM_NOTIFY_POLICY[AI_ALARM_NAME]).toBeDefined();
	});

	// オーナー決裁 2026-08-07:「アラートは Discord の障害通知へ webhook で飛ばすべき」。
	// 降格するなら文言側の「検知済み」も同時に落とす必要があり、[5-3] がそれを強制する。
	it('[5-2] Discord へ通知する (notify: true)', () => {
		expect(aiAlarmPolicy().notify).toBe(true);
	});

	// 両方向で縛る:
	//   notify: true  なのに文言が黙っている → 顧客は「放置されている」と誤解する
	//   notify: false なのに文言が約束する   → 実装の事実 (記録は残るが人には届かない) とズレる
	it('[5-3] 通知方針と「運営が知っている」の言明が一致する', () => {
		const message = POINTS_LABELS.receiptAiUnavailableManaged;
		const claimsAwareness = AWARENESS_WORDS.some((w) => message.includes(w));

		if (aiAlarmPolicy().notify) {
			expect(
				claimsAwareness,
				`notify: true (Discord に届く) なら、顧客にも運営が知っていることを伝える。${AWARENESS_WORDS.join(' / ')} のいずれかを含めてください`,
			).toBe(true);
		} else {
			expect(
				claimsAwareness,
				`notify: false のあいだ「${AWARENESS_WORDS.join(' / ')}」を顧客に約束すると、実装の事実 (CloudWatch に記録が残るだけで人には届かない) とズレます`,
			).toBe(false);
		}
	});

	// 降格したときに「顧客にはそう表示しているから console で足りる」という循環根拠が
	// 復活しないよう、notify: false の側でだけ縛りを残す。
	it('[5-4] 鳴らさないときの理由が「顧客にそう表示しているから」を根拠にしない', () => {
		if (aiAlarmPolicy().notify) return; // 昇格中は該当する失敗モードが存在しない

		for (const circular of ['通知済み', '検知済み']) {
			expect(aiAlarmPolicy().reason).not.toContain(circular);
		}
	});
});
