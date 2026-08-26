// tests/unit/services/legal-doc-version-parity.test.ts
// #4497 (GAMMA-PRIV-01): 法的文書の「最終改定日」⇄ 同意 version 定数の突合 fitness function。
//
// なぜ機械 guard が要るか:
//   privacy.html は 2026-04-28 以降に実質的変更を 3 回 (卒業事例公開の新設 / 無料プラン削除猶予の
//   即時化 = 利用者不利変更 / CDN ログ + アクセス先 URL の収集追加) 経ているのに
//   CURRENT_PRIVACY_VERSION は '2026-04-28' のままだった。既存利用者は「同意済み」のままで、
//   新規の同意記録も旧 version で保存され続ける = 表示文書と同意証跡の恒常不一致。
//   同型の不整合は #593 で一度是正済みだが機械強制が無く再発した (same-class 2 回目) ため、
//   ADR-0061 §2 に従い guard を入れる。
//
// 検査する不変条件 (4 本):
//   A. 文書内の日付が 1 つに揃っている  — header の「最終更新日」== 末尾の「最終改定日」
//      (#4497 finding #4: 条文を足したのに header の日付だけ据え置かれる虚偽表示状態を検出する)
//   B. SSOT と配信物が一致している      — labels.ts (SSOT) の日付 == site/*.html (fallback) の日付
//   C. 文書と同意証跡が一致している      — 文書の改定日 == consent-service.ts の version 定数
//   D. 本文と改定日が結合している        — 本文 (intro / 各条) を変えたら改定日も動いている
//
// A/B/C は「日付 ⇄ 日付」「日付 ⇄ 定数」の突合しか見ていないため、**本文だけ変えて日付を
// 据え置く**形は 3 本とも素通りする。実測 (2026-08-20): PR #4778 が privacy 第3条 / 第8条 /
// 第10条を書き換えたまま articleHeader / effective / CURRENT_PRIVACY_VERSION のいずれも
// 動かしておらず、A/B/C は全て緑だった。同意証跡がどの本文への同意か特定できなくなる、という
// #4497 本体と同じ欠陥の再発であるため D を足す (PO 決裁 C、PR #4516 コメント)。
//
// D の実装形: 本文 key 群の SHA-256 を「その時点の改定日」とセットで pin する (§BODY_PINS)。
// 本文を 1 文字でも変えれば hash が変わり、pin と食い違って落ちる。落ちたときの唯一の直し方は
// 「改定日を動かす → version 定数を上げる (A/B/C が強制) → pin を新しい (改定日, hash) に置き換える」
// の 3 点セットで、本文だけ黙って差し替えることができない。
//
// 残余リスク (silent gap を隠さないため明記する): pin はリポジトリ内の値なので、改定日を
// 据え置いたまま hash だけ書き換えることは物理的には可能である。D が保証するのは
// 「本文を変えた PR は必ず改定日の判断を通る」ことであって、判断そのものの正しさではない。

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LP_LEGAL_PRIVACY_LABELS, LP_LEGAL_TERMS_LABELS } from '../../../src/lib/domain/labels';

// consent-service は import 時に db factory / logger を引くため、定数だけ読むのに必要な最小 mock。
vi.mock('$lib/server/db/factory', () => ({ getRepos: () => ({ auth: {} }) }));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const REPO_ROOT = path.resolve(__dirname, '../../..');

/** 「2026年8月7日」→「2026-08-07」。見つからなければ undefined（呼び出し側で fail させる）。 */
function toIsoDate(japaneseDate: string | undefined): string | undefined {
	if (!japaneseDate) return undefined;
	const m = japaneseDate.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
	if (!m) return undefined;
	return `${m[1]}-${m[2]?.padStart(2, '0')}-${m[3]?.padStart(2, '0')}`;
}

/** 「最終更新日: 2026年8月7日」等のラベル付き日付を ISO で取り出す。 */
function extractLabeledDate(
	source: string,
	label: '最終更新日' | '最終改定日',
): string | undefined {
	const m = source.match(new RegExp(`${label}\\s*[:：]\\s*(\\d{4}年\\d{1,2}月\\d{1,2}日)`));
	return toIsoDate(m?.[1]);
}

function readSiteFile(relative: string): string {
	return fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

// ---------------------------------------------------------------------------
// D. 本文 ⇄ 改定日の結合
// ---------------------------------------------------------------------------

/**
 * 「本文」とみなす key。intro + 各条 (section1 / section6_2 / section10 …)。
 *
 * 日付を運ぶ articleHeader / effective は本文ではない (これらを本文に含めると、日付を
 * 動かしただけで hash が変わり D が意味を失う)。Stripe Checkout の custom_text 用文言など、
 * 法的文書として配信されない key も本文ではない (§NON_BODY_KEYS)。
 */
const BODY_KEY_PATTERN = /^(intro|section\d+(_\d+)?)$/;

/** 日付を運ぶ key (A/B/C が担当する)。 */
const DATE_KEYS: readonly string[] = ['articleHeader', 'effective'];

/**
 * 本文でも日付でもない key の明示許可リスト。
 *
 * 新しい key を namespace に足したときは、ここか BODY_KEY_PATTERN のどちらかに必ず入る。
 * どちらにも入らない key があれば D-1 が落ちる (= 本文を増やしたのに hash に載らない、という
 * silent gap を作れない)。
 */
const NON_BODY_KEYS: Record<string, readonly string[]> = {
	privacy: [],
	// Stripe Checkout の custom_text 用文言。terms.html には載らず、同意対象の条文でもない。
	terms: [
		'submitMessage',
		'afterSubmitMessage',
		'submitMessageWithPlan',
		'afterSubmitMessageWithPlan',
	],
};

/** 本文 key を昇順に並べ、[key, value] の列を SHA-256 でまとめる。 */
function computeBodyHash(namespace: Record<string, unknown>): string {
	const entries = Object.keys(namespace)
		.filter((key) => BODY_KEY_PATTERN.test(key))
		.sort()
		.map((key) => [key, namespace[key]]);
	return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

interface BodyPin {
	/** この本文が確定した「最終改定日」(ISO)。labels.ts の effective と一致していること。 */
	revision: string;
	/** その改定日時点の本文 hash。 */
	sha256: string;
}

/**
 * 本文 hash の pin (改定日とセット)。
 *
 * **更新手順** (本文を変えたら 3 点セットで行う):
 *   1. labels.ts の articleHeader / effective の日付を「本文を最後に変更した日」に更新し、
 *      site/*.html の fallback と site/shared-labels.js (generate-lp-labels.mjs) も揃える
 *   2. consent-service.ts の version 定数を同じ日付へ上げる
 *   3. 下の revision / sha256 を新しい値に置き換える (sha256 は落ちたテストの出力に載る)
 *
 * 複数 PR が同一リリースで統合される場合は、**その中で本文を最後に変更した日**に全 PR を
 * 揃える (版を 1 回だけ上げ、顧客の再同意を 1 回にまとめるため)。逆に、既にその改定日で
 * 本文が本番に出たあとで本文を変えるなら、改定日を新しい日へ動かすこと (据え置くと、
 * その変更に対する再同意が発火しない)。
 */
const BODY_PINS: Record<string, BodyPin> = {
	privacy: {
		// #4598 (develop) が第9条④ / 第10条の「生成 AI へ送らない」絶対形を事実に合わせて
		// 書き直した。本 branch の §3 / §7 / §10 改定と合成した本文の hash に更新している。
		// 改定日は PO 決裁 A のとおり 3 本とも 2026-08-20 で据え置き (同一リリースで cut し、
		// 顧客の再同意は 1 回にまとめる)。
		revision: '2026-08-20',
		sha256: '23c2ae132383d74362e781d8022219f91296cc8f4da6a6c69a8837cc3b4cdfd6',
	},
	terms: {
		// #4503 (develop) が第7条・第8条ほかを改定し、改定日を 2026-08-13 へ動かした。
		// 本 branch との merge 時に上記 3 点セット (改定日 / CURRENT_TERMS_VERSION / pin) で追随している。
		revision: '2026-08-13',
		sha256: '017e04479cd3881311f543374b5876a0ed237c5a37b52de1c5172ea7c9dab4fd',
	},
};

interface LegalDoc {
	/** テスト表示名 */
	name: string;
	/** 配信される静的 HTML (data-lp-key の fallback テキストを持つ) */
	htmlPath: string;
	/** labels.ts 側の SSOT (LP へは generate-lp-labels.mjs 経由で配信される) */
	labels: { articleHeader: string; effective: string };
	/** 同 namespace 全体 (D の本文 key 走査用) */
	namespace: Record<string, unknown>;
	/** 同意記録に焼かれる version 定数名 (エラーメッセージ用) */
	versionConstName: 'CURRENT_PRIVACY_VERSION' | 'CURRENT_TERMS_VERSION';
	/** consent-service.ts の実値 */
	version: string;
}

const { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } = await import(
	'../../../src/lib/server/services/consent-service'
);

const DOCS: LegalDoc[] = [
	{
		name: 'privacy',
		htmlPath: 'site/privacy.html',
		labels: LP_LEGAL_PRIVACY_LABELS,
		namespace: LP_LEGAL_PRIVACY_LABELS,
		versionConstName: 'CURRENT_PRIVACY_VERSION',
		version: CURRENT_PRIVACY_VERSION,
	},
	{
		name: 'terms',
		htmlPath: 'site/terms.html',
		labels: LP_LEGAL_TERMS_LABELS,
		namespace: LP_LEGAL_TERMS_LABELS,
		versionConstName: 'CURRENT_TERMS_VERSION',
		version: CURRENT_TERMS_VERSION,
	},
];

describe('#4497 法的文書の改定日 ⇄ 同意 version 定数の突合 (fitness function)', () => {
	for (const doc of DOCS) {
		describe(doc.name, () => {
			const updatedInLabels = extractLabeledDate(doc.labels.articleHeader, '最終更新日');
			const revisedInLabels = extractLabeledDate(doc.labels.effective, '最終改定日');

			it('A. labels.ts SSOT 内で header「最終更新日」と末尾「最終改定日」が一致する', () => {
				expect(
					updatedInLabels,
					`${doc.name}: labels.ts の articleHeader から「最終更新日」を読み取れませんでした`,
				).toBeDefined();
				expect(
					revisedInLabels,
					`${doc.name}: labels.ts の effective から「最終改定日」を読み取れませんでした`,
				).toBeDefined();
				expect(
					updatedInLabels,
					`${doc.name}: 文書内で日付が食い違っています (header=${updatedInLabels} / 末尾=${revisedInLabels})。` +
						' 条文を変えたら両方を同じ日付に更新してください。',
				).toBe(revisedInLabels);
			});

			it('B. 配信 HTML の fallback 日付が labels.ts SSOT と一致する', () => {
				const html = readSiteFile(doc.htmlPath);
				expect(
					extractLabeledDate(html, '最終更新日'),
					`${doc.htmlPath}: header の日付が labels.ts (${updatedInLabels}) と一致しません。` +
						' labels.ts を直したあと同じ値を HTML の fallback にも反映してください。',
				).toBe(updatedInLabels);
				expect(
					extractLabeledDate(html, '最終改定日'),
					`${doc.htmlPath}: 末尾の日付が labels.ts (${revisedInLabels}) と一致しません。`,
				).toBe(revisedInLabels);
			});

			it('C. 改定日が consent-service.ts の version 定数と一致する', () => {
				expect(
					doc.version,
					`${doc.name}: 文書の最終改定日は ${revisedInLabels} ですが ${doc.versionConstName} は` +
						` '${doc.version}' です。文書を改定したら version 定数も同じ日付へ上げてください` +
						' (上げないと既存利用者に再同意が発火せず、新規の同意記録も旧 version で保存されます)。' +
						' 呼称変更等で再同意が不要と判断した場合は、改定日を動かさない運用とセットで判断してください。',
				).toBe(revisedInLabels);
			});

			it('D-1. namespace の全 key が「本文」「日付」「明示除外」のいずれかに分類されている', () => {
				const excluded = NON_BODY_KEYS[doc.name] ?? [];
				const unclassified = Object.keys(doc.namespace).filter(
					(key) =>
						!BODY_KEY_PATTERN.test(key) && !DATE_KEYS.includes(key) && !excluded.includes(key),
				);
				expect(
					unclassified,
					`${doc.name}: 分類されていない key があります: ${unclassified.join(', ')}。` +
						' 条文なら BODY_KEY_PATTERN に合う名前 (intro / sectionN) にし、' +
						' 条文でないなら NON_BODY_KEYS に理由付きで追加してください。' +
						' 放置すると本文を増やしても D-2 の hash に載らず、改定日を動かさずに条文を足せてしまいます。',
				).toEqual([]);
			});

			it('D-2. 本文を変えたら改定日も動いている (本文 hash ⇄ 改定日の pin)', () => {
				const pin = BODY_PINS[doc.name];
				expect(pin, `${doc.name}: BODY_PINS に pin がありません`).toBeDefined();
				if (!pin) return;

				const actualHash = computeBodyHash(doc.namespace);
				const fixHint =
					`\n  直し方: 1) labels.ts の articleHeader / effective を「本文を最後に変更した日」に更新` +
					` (site/${doc.name}.html の fallback と site/shared-labels.js も揃える)` +
					`\n          2) ${doc.versionConstName} を同じ日付へ上げる` +
					`\n          3) BODY_PINS.${doc.name} を { revision: '<新しい改定日>', sha256: '${actualHash}' } に置き換える`;

				expect(
					revisedInLabels,
					`${doc.name}: pin の改定日 (${pin.revision}) と labels.ts の最終改定日 (${revisedInLabels})` +
						` が食い違っています。改定日を動かしたら BODY_PINS も同時に更新してください。${fixHint}`,
				).toBe(pin.revision);

				expect(
					actualHash,
					`${doc.name}: 本文が変わっているのに最終改定日が ${pin.revision} のまま据え置かれています。` +
						' 本文と改定日が食い違うと、同意証跡がどの本文への同意なのか特定できなくなります' +
						' (#4497 の欠陥そのもの)。また改定日が動かないと既存利用者に再同意が発火しません。' +
						fixHint,
				).toBe(pin.sha256);
			});
		});
	}

	it('version 定数は YYYY-MM-DD 形式である (改定日と直接突合できる形を保つ)', () => {
		for (const doc of DOCS) {
			expect(doc.version, `${doc.versionConstName}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		}
	});
});
