// tests/unit/scripts/build-release-notes.test.ts
// #4883: リリース通知 (Discord 📢 アップデート情報) の本文生成の回帰ガード。
//
// 旧実装 (deploy.yml の bash) は「開発者がコミット件名に書いた文」を顧客向け本文に流用し、
// AI 側が「顧客に伝えることは無い (SKIP)」と判断してもそれを生テキストで上書きしていた
// (fail-open)。結果、開発者語彙がそのまま配信された。
//
// 本テストは以下を機械検証する:
//   1. コミット件名は顧客向けテキストとして一切使われない (fail-closed)
//   2. 出典は merge 済み PR の `## 顧客価値・目的` 第 1 文、または明示宣言のみ
//   3. 顧客向けと確定できない項目は落とす (英字語 / コード片 / 開発者宛の記述)
//   4. 項目 0 件なら投稿しない (SKIP) — 生テキストへ degrade しない
//   5. scope 付き Conventional Commits を型として正しく解釈する
//   6. チケット参照除去が空カッコを残さない

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	buildReleaseNotes,
	classifyCommitType,
	extractCustomerValueSentence,
	formatJstDate,
	loadLabels,
	parseCommitSubject,
	resolveReleaseNote,
	sanitizeNoteText,
} from '../../../scripts/build-release-notes.mjs';

/** 実際に顧客へ配信されてしまった語 (Issue #4883 の現象表)。1 語たりとも再配信させない。 */
const LEAKED_PHRASES = [
	'approve gate',
	'fail-closed',
	'表層依存',
	'認可述語',
	'childId',
	'ポイント単位連結',
];

const customerValueBody = (firstSentence: string, rest = '') =>
	`## 顧客価値・目的\n\n${firstSentence}${rest}\n\n## 関連 Issue\n\nCloses #1\n`;

describe('#4883 parseCommitSubject — Conventional Commits の scope 付きを取りこぼさない', () => {
	it('scope 無しを解釈する', () => {
		const parsed = parseCommitSubject('fix: #4556 レビューで拾った残懸念 3 件 (#4559)');
		expect(parsed?.type).toBe('fix');
		expect(parsed?.scope).toBeUndefined();
		expect(parsed?.prNumber).toBe(4559);
	});

	it('scope 付き (旧実装が取りこぼしていた形) を解釈する', () => {
		const parsed = parseCommitSubject(
			'fix(billing): #4548 解約フォールバックの行き止まりを塞ぐ (#4560)',
		);
		expect(parsed?.type).toBe('fix');
		expect(parsed?.scope).toBe('billing');
		expect(parsed?.prNumber).toBe(4560);
	});

	it('breaking marker (!) 付きでも型を落とさない', () => {
		expect(parseCommitSubject('feat(api)!: 破壊的変更 (#10)')?.type).toBe('feat');
	});

	it('Conventional Commits でない件名は null (fail-closed)', () => {
		expect(parseCommitSubject('とりあえず直した')).toBeNull();
	});

	it('PR 参照が無い件名でも型は取れるが prNumber は無い', () => {
		const parsed = parseCommitSubject('fix(test): 即時交換 E2E を切り離す');
		expect(parsed?.type).toBe('fix');
		expect(parsed?.prNumber).toBeUndefined();
	});
});

describe('#4883 classifyCommitType — 顧客に見える型だけを通す', () => {
	it('feat / fix / perf は顧客向け区分を返す', () => {
		expect(classifyCommitType('feat')).toBe('feature');
		expect(classifyCommitType('perf')).toBe('feature');
		expect(classifyCommitType('fix')).toBe('fix');
	});

	it('docs / test / chore / ci / build / refactor / style は除外する', () => {
		for (const t of ['docs', 'test', 'chore', 'ci', 'build', 'refactor', 'style']) {
			expect(classifyCommitType(t)).toBeNull();
		}
	});

	it('scope 付きの除外型も除外される (旧実装は素の prefix しか除外できなかった)', () => {
		const parsed = parseCommitSubject(
			'chore(audit): CodeQL new-alert (#47) を baseline に登録 (#4571)',
		);
		expect(classifyCommitType(parsed?.type ?? '')).toBeNull();
	});
});

describe('#4883 sanitizeNoteText — チケット参照除去が残骸を残さない', () => {
	it('末尾の PR 参照を空カッコにしない', () => {
		expect(sanitizeNoteText('解約できるようになりました (#4559)')).toBe(
			'解約できるようになりました',
		);
	});

	it('全角カッコ内のチケット参照も残骸を残さない', () => {
		expect(sanitizeNoteText('直しました（#123）')).toBe('直しました');
	});

	it('文中のチケット参照を消しても二重空白を残さない', () => {
		expect(sanitizeNoteText('#4517 と #4529 の続きです')).toBe('と の続きです');
	});

	it('HTML コメントを除去する', () => {
		expect(sanitizeNoteText('本文 <!-- 内部メモ --> です')).toBe('本文 です');
	});
});

describe('#4883 extractCustomerValueSentence — 出典は PR の 顧客価値・目的 第 1 文', () => {
	it('第 1 文だけを取り出す', () => {
		const body = customerValueBody(
			'解約するとき、どの記録を残すかを顧客自身が選べるようになります。',
			'これまでは請求パネルから解約した人だけが選択画面を通っていました。',
		);
		expect(extractCustomerValueSentence(body)).toBe(
			'解約するとき、どの記録を残すかを顧客自身が選べるようになります。',
		);
	});

	it('セクションが無ければ null (コミット件名へ落ちない)', () => {
		expect(extractCustomerValueSentence('## 変更内容\n\nいろいろ直した\n')).toBeNull();
	});

	it('セクションが説明コメントだけなら null', () => {
		expect(
			extractCustomerValueSentence('## 顧客価値・目的\n\n<!-- 書き方の説明 -->\n\n## 検証\n'),
		).toBeNull();
	});
});

describe('#4883 resolveReleaseNote — 顧客向けと確定できないものは落とす (fail-closed)', () => {
	it('顧客向けの文はそのまま採用する', () => {
		const r = resolveReleaseNote(
			customerValueBody(
				'取り返しのつかない操作の直前に出る警告が、保護者に実際に届くようになります。',
			),
		);
		expect(r.status).toBe('included');
		expect(r.source).toBe('customer-value');
	});

	it('コード片 (バッククォート) を含む文は落とす', () => {
		const r = resolveReleaseNote(
			customerValueBody('他の家庭を指すアドレスを `children.avatar_url` に書けなくする。'),
		);
		expect(r.status).toBe('rejected');
	});

	it('英字語 (開発者語彙の主要な運び手) を含む文は落とす', () => {
		expect(resolveReleaseNote(customerValueBody('approve gate の発火条件を変える。')).status).toBe(
			'rejected',
		);
		expect(resolveReleaseNote(customerValueBody('孤立 childId を観測する。')).status).toBe(
			'rejected',
		);
	});

	it('AI は顧客向け語彙として許可する', () => {
		expect(
			resolveReleaseNote(customerValueBody('AI が活動の候補を提案してくれるようになりました。'))
				.status,
		).toBe('included');
	});

	it('開発チーム宛と明記された PR は落とす', () => {
		const r = resolveReleaseNote(
			customerValueBody('**対象ユーザー**: 開発チーム（並行して作業する全員）'),
		);
		expect(r.status).toBe('rejected');
	});

	it('明示宣言があれば顧客向け文としてそれを使う', () => {
		const body =
			'## 顧客価値・目的\n\n<!-- release-note: 招待の受け取りに失敗したとき、理由と次にすることが画面に出るようになりました。 -->\n他の家庭を指すアドレスを書けなくする。\n';
		const r = resolveReleaseNote(body);
		expect(r.status).toBe('included');
		expect(r.source).toBe('declaration');
		expect(r.text).toBe(
			'招待の受け取りに失敗したとき、理由と次にすることが画面に出るようになりました。',
		);
	});

	it('明示的な none 宣言は静かに除外する', () => {
		const r = resolveReleaseNote(
			'## 顧客価値・目的\n\n<!-- release-note: none -->\n内部改善です。\n',
		);
		expect(r.status).toBe('opted-out');
	});

	it('長すぎる文は見出しとして成立しないので落とす', () => {
		const r = resolveReleaseNote(customerValueBody(`${'あ'.repeat(200)}。`));
		expect(r.status).toBe('rejected');
	});

	it('セクションが無い PR は落とす (コミット件名へ落ちない)', () => {
		expect(resolveReleaseNote('## 変更内容\n\n直した\n').status).toBe('rejected');
	});
});

describe('#4883 buildReleaseNotes — 統合', () => {
	const prBody = (s: string) => customerValueBody(s);

	it('顧客向け項目を 🆕 / 🐛 に振り分ける', () => {
		const result = buildReleaseNotes({
			commits: [
				'feat(child): #1 ごほうび交換の履歴を見られるようにする (#101)',
				'fix(auth): #2 招待を受け取れない不具合を直す (#102)',
			],
			pullRequests: [
				{
					number: 101,
					body: prBody('ごほうびの交換履歴を、あとから見返せるようになりました。'),
					labels: [],
				},
				{
					number: 102,
					body: prBody('家族からの招待を正しく受け取れるようになりました。'),
					labels: [],
				},
			],
		});
		expect(result.status).toBe('post');
		expect(result.description).toContain(
			'ごほうびの交換履歴を、あとから見返せるようになりました。',
		);
		expect(result.description).toContain('家族からの招待を正しく受け取れるようになりました。');
		expect(result.items.filter((i) => i.category === 'feature')).toHaveLength(1);
		expect(result.items.filter((i) => i.category === 'fix')).toHaveLength(1);
	});

	it('顧客向け項目が 0 件なら投稿しない (生テキストへ degrade しない)', () => {
		const result = buildReleaseNotes({
			commits: [
				'fix: #4556 レビューで拾った残懸念 3 件（認可述語の兼務明示） (#4559)',
				'chore(audit): CodeQL new-alert を baseline に登録 (#4571)',
			],
			pullRequests: [{ number: 4559, body: prBody('認可述語の兼務を明示する。'), labels: [] }],
		});
		expect(result.status).toBe('skip');
		expect(result.description).toBe('');
	});

	it('実際に配信されてしまった開発者語彙を 1 つも出力しない', () => {
		const result = buildReleaseNotes({
			commits: [
				'fix: #4123 approve gate の発火条件を表層依存から fail-closed に変える (#4130)',
				'fix: #4556 レビューで拾った残懸念 3 件（認可述語の兼務明示 / ポイント単位連結の統一 / 孤立 childId の観測） (#4559)',
			],
			pullRequests: [
				{
					number: 4130,
					body: prBody('approve gate の発火条件を表層依存から fail-closed に変える。'),
					labels: [],
				},
				{
					number: 4559,
					body: prBody('認可述語の兼務明示 / ポイント単位連結の統一 / 孤立 childId の観測。'),
					labels: [],
				},
			],
		});
		expect(result.status).toBe('skip');
		const serialized = `${result.title}\n${result.description}\n${JSON.stringify(result.items)}`;
		for (const phrase of LEAKED_PHRASES) {
			expect(serialized).not.toContain(phrase);
		}
	});

	it('PR body を引けなかったコミットはコミット件名で代替せず落とす', () => {
		const result = buildReleaseNotes({
			commits: ['fix(billing): #1 解約の行き止まりを塞ぐ (#999)'],
			pullRequests: [],
		});
		expect(result.status).toBe('skip');
		expect(result.warnings.join('\n')).toContain('999');
	});

	it('refactor:internal-no-doc-impact ラベルの PR は除外する', () => {
		const result = buildReleaseNotes({
			commits: ['fix(ui): #1 表示を直す (#201)'],
			pullRequests: [
				{
					number: 201,
					body: prBody('画面の表示が正しくなりました。'),
					labels: ['refactor:internal-no-doc-impact'],
				},
			],
		});
		expect(result.status).toBe('skip');
	});

	it('落とした PR を warning に列挙して Dev が明示宣言を足せるようにする', () => {
		const result = buildReleaseNotes({
			commits: ['fix(db): #1 テナント境界を機械検査する (#301)'],
			pullRequests: [
				{
					number: 301,
					body: prBody('他の家庭を指すアドレスを `children.avatar_url` に書けなくする。'),
					labels: [],
				},
			],
		});
		expect(result.warnings.join('\n')).toContain('301');
		expect(result.warnings.join('\n')).toContain('release-note');
	});

	it('同じ PR が 2 コミットに現れても 1 項目にまとめる', () => {
		const result = buildReleaseNotes({
			commits: ['fix(ui): #1 直した (#401)', 'fix(ui): #1 追随した (#401)'],
			pullRequests: [{ number: 401, body: prBody('表示のずれが直りました。'), labels: [] }],
		});
		expect(result.items).toHaveLength(1);
	});

	it('項目数の上限を超えない', () => {
		const commits: string[] = [];
		const pullRequests: { number: number; body: string; labels: string[] }[] = [];
		for (let i = 0; i < 20; i++) {
			const n = 500 + i;
			commits.push(`fix(ui): #1 直した (#${n})`);
			pullRequests.push({
				number: n,
				body: prBody(`表示のずれが直りました。その${i}`),
				labels: [],
			});
		}
		const result = buildReleaseNotes({ commits, pullRequests });
		expect(result.items.length).toBeLessThanOrEqual(8);
	});

	// テンプレートの案内文には `release-note:` の書式そのものが載っている。案内文を消さずに
	// 出しただけの PR がそれを「宣言」と誤認されると、案内文が顧客へ配信される。
	it('実 PR テンプレートの案内コメントを宣言と誤認しない', () => {
		const template = readFileSync('.github/PULL_REQUEST_TEMPLATE.md', 'utf8');
		expect(template).toContain('release-note'); // 案内が消えていたら本テストの前提が崩れる
		const r = resolveReleaseNote(`${template}\n`);
		expect(r.source).not.toBe('declaration');
	});

	it('日付は実行環境の TZ ではなく日本時間で出す', () => {
		// 2026-01-01T16:00:00Z = JST 2026-01-02 01:00
		expect(formatJstDate(new Date('2026-01-01T16:00:00Z'))).toBe('2026年1月2日');
	});

	it('固定文言は labels.ts の SSOT を出典にする', () => {
		const result = buildReleaseNotes({
			commits: ['fix(ui): #1 直した (#401)'],
			pullRequests: [{ number: 401, body: prBody('表示のずれが直りました。'), labels: [] }],
		});
		expect(result.title).toBe('🎉 アップデートのお知らせ');
		expect(result.description).toContain('設定 > サポート');
		expect(result.footer).toContain('がんばりクエスト');
	});
});

// ---------------------------------------------------------------------------
// #4883 adversarial review (tmp/adversarial-evidence/4884.json) で挙がった経路の封鎖
// ---------------------------------------------------------------------------

describe('#4883 顧客向け判定の境界（adversarial review 反映）', () => {
	const body = (s: string) => `## 顧客価値・目的\n\n${s}\n\n## 関連 Issue\n\nCloses #1\n`;

	it('顧客が画面で目にする固有名詞は落とさない', () => {
		for (const s of [
			'記録をまとめた PDF を保存できるようになりました。',
			'ごほうびの一覧を CSV で書き出せるようになりました。',
			'QR コードでお子さまの画面をひらけるようになりました。',
		]) {
			expect(resolveReleaseNote(body(s)).status, s).toBe('included');
		}
	});

	it('画面の作りを指す内部語彙は落とす', () => {
		for (const s of [
			'解約フローの行き止まりを塞ぎました。',
			'交換確認ダイアログの表記を揃えました。',
			'設定パネルのトグルを直しました。',
		]) {
			expect(resolveReleaseNote(body(s)).status, s).toBe('rejected');
		}
	});

	it('明示宣言でもリンクは通さない（配信面へのフィッシング注入を塞ぐ）', () => {
		const withLink =
			'## 顧客価値・目的\n\n<!-- release-note: [重要なお知らせ](https://example.com/phish) をご確認ください。 -->\n本文\n';
		expect(resolveReleaseNote(withLink).status).toBe('rejected');

		const withBareUrl =
			'## 顧客価値・目的\n\n<!-- release-note: 詳しくは https://example.com/phish をご覧ください。 -->\n本文\n';
		expect(resolveReleaseNote(withBareUrl).status).toBe('rejected');
	});

	it('明示宣言も顧客向け文として成立しない語は落とす（判定の素通りを作らない）', () => {
		const decl = '## 顧客価値・目的\n\n<!-- release-note: 孤立 childId を観測する。 -->\n本文\n';
		expect(resolveReleaseNote(decl).status).toBe('rejected');
	});

	it('security ラベルの PR は自動配信しない（開示順序は人が決める）', () => {
		const result = buildReleaseNotes({
			commits: ['fix(auth): #1 他の家庭の記録が見えていた問題を直す (#601)'],
			pullRequests: [
				{
					number: 601,
					body: body('他の家庭の記録が見えていた問題を直しました。'),
					labels: ['security'],
				},
			],
		});
		expect(result.status).toBe('skip');
		expect(result.warnings.join('\n')).toContain('601');
	});

	it('上限を超えた分は無言で捨てず「ほか N 件」を出す', () => {
		const commits: string[] = [];
		const pullRequests: { number: number; body: string; labels: string[] }[] = [];
		for (let i = 0; i < 12; i++) {
			const n = 700 + i;
			commits.push(`fix(ui): #1 直した (#${n})`);
			pullRequests.push({ number: n, body: body(`表示のずれが直りました。その${i}`), labels: [] });
		}
		const result = buildReleaseNotes({ commits, pullRequests });
		expect(result.items).toHaveLength(8);
		expect(result.description).toContain('ほか 4 件');
	});

	it('上限内なら「ほか N 件」を出さない', () => {
		const result = buildReleaseNotes({
			commits: ['fix(ui): #1 直した (#801)'],
			pullRequests: [{ number: 801, body: body('表示のずれが直りました。'), labels: [] }],
		});
		expect(result.description).not.toContain('ほか');
	});
});

// ---------------------------------------------------------------------------
// QM レビュー (PR #4884 M1 / M2) — 次に流れる実リリース (origin/main..origin/develop 50 commit)
// に本実装を当てて出た、顧客に見える欠陥 2 件の回帰固定
// ---------------------------------------------------------------------------

describe('#4883 QM M1 — 閉じていない強調記号を配信しない', () => {
	// PR #4885 の実文面。`**` の閉じが `。` の後ろにあるため、第 1 文で切ると開きっぱなしになる
	const real4885 =
		'## 顧客価値・目的\n\n**お金を払って登録した保護者だけが、セットアップウィザードを一度も通っていませんでした。**\n\n`hooks.server.ts` の判定は…\n';

	it('第 1 文の切り出しで `**` が奇数個になったら強調を全部外す', () => {
		const r = resolveReleaseNote(real4885);
		expect(r.status).toBe('included');
		expect(r.text).toBe(
			'お金を払って登録した保護者だけが、セットアップウィザードを一度も通っていませんでした。',
		);
		expect(r.text).not.toContain('**');
	});

	it('閉じている強調はそのまま通す（Discord が太字として描画する）', () => {
		expect(sanitizeNoteText('警告が保護者に**実際に届く**ようになります。')).toBe(
			'警告が保護者に**実際に届く**ようになります。',
		);
	});

	it('配信本文のどの行にも奇数個の `**` を残さない', () => {
		const result = buildReleaseNotes({
			commits: ['fix(setup): #4883 セットアップ必須 redirect を cognito にも広げる (#4885)'],
			pullRequests: [{ number: 4885, body: real4885, labels: [] }],
		});
		expect(result.status).toBe('post');
		for (const line of result.description.split('\n')) {
			expect((line.match(/\*\*/g) ?? []).length % 2, line).toBe(0);
		}
	});
});

describe('#4883 QM M2 — 「顧客に見える変更ではない」と明言した文を配信しない', () => {
	const body = (s: string) => `## 顧客価値・目的\n\n${s}\n\n## 関連 Issue\n\nCloses #1\n`;

	it('PR #4866 の実文面（英字語もコード片も含まない否定表明）を落とす', () => {
		const r = resolveReleaseNote(
			body('顧客に直接見える変更ではない。**CI が pin 無しで任意コードを引く経路を塞ぐ。**'),
		);
		expect(r.status).toBe('rejected');
		expect(r.reason).toContain('明言');
	});

	it('否定表明の言い回しの揺れも落とす', () => {
		for (const s of [
			'顧客に見える変化なし。',
			'顧客に見える変化はありません。',
			'顧客への影響はない。',
			'顧客には見えない内部の整理です。',
			'顧客に見える変化: なし。',
			'内部変更のみで、画面は変わりません。',
		]) {
			expect(resolveReleaseNote(body(s)).status, s).toBe('rejected');
		}
	});

	it('肯定文の「顧客に見える」は落とさない（否定だけを見る）', () => {
		expect(resolveReleaseNote(body('顧客に見える画面の読み込みが速くなりました。')).status).toBe(
			'included',
		);
	});
});

// ---------------------------------------------------------------------------
// 第 22 回リリース (2026-09-11、main e2a82f53a) の実配信の回帰固定
//
// 実際に顧客へ届いた全文:
//   🐛 修正
//   • 監査差し戻し 33 件 — release blocker (製品欠陥 8 / テスト 25 / severity 3) を develop で閉じる ()
// 199 commit / 184 PR のリリースで、顧客に出たのはこの 1 行だった（AI が SKIP を返したのに
// fallback が「唯一 scope 無しの fix: だった」1 件だけを拾って投稿した）。
// ---------------------------------------------------------------------------

describe('#4883 第 22 回リリースの実配信を再現させない', () => {
	// #4888 の実コミット件名と `## 顧客価値・目的` 第 1 文
	const commit4888 =
		'fix: #4887 監査差し戻し 33 件 — release blocker (製品欠陥 8 / テスト 25 / severity 3) を develop で閉じる (#4888)';
	const body4888 =
		'## 顧客価値・目的\n\n第22回統合 PR #4887 が **NO-GO**（監査、残 NG 13 件）となった原因のうち develop レーンに属する 33 件を閉じ、release を再 cut できる状態に戻します。顧客に届く変化は次の 8 点です。\n\n1. **運営ダッシュボード `/ops` に入れる**\n';
	const dependabot = (n: number) =>
		`build(deps-dev): bump vitest from 3.2.4 to 4.0.0 in the vitest group (#${n})`;

	it('実際に配信された 1 行を二度と出さない', () => {
		const result = buildReleaseNotes({
			commits: [commit4888, dependabot(4856), dependabot(4857)],
			pullRequests: [
				{ number: 4888, body: body4888, labels: [] },
				// dependabot PR は `## 顧客価値・目的` 節を持たない（実測: 節が無い 9 件は全部 build(deps)）
				{ number: 4856, body: 'Bumps vitest from 3.2.4 to 4.0.0.', labels: ['dependencies'] },
				{ number: 4857, body: 'Bumps vitest from 3.2.4 to 4.0.0.', labels: ['dependencies'] },
			],
		});
		expect(result.status).toBe('skip');
		const serialized = `${result.title}\n${result.description}\n${JSON.stringify(result.items)}`;
		expect(serialized).not.toContain('監査差し戻し');
		expect(serialized).not.toContain('release blocker');
		expect(serialized).not.toContain('()');
		// 落とした理由は warning に残る（#4888 は英字語 NO-GO / NG / develop / release を含む）
		expect(result.warnings.join('\n')).toContain('4888');
	});

	it('顧客価値・目的 節を持つ PR が 1 件も無ければ投稿しない（fallback で生件名を出さない）', () => {
		const result = buildReleaseNotes({
			commits: [
				dependabot(4812),
				dependabot(4813),
				'chore(graphify): regenerate knowledge graph (#4870)',
			],
			pullRequests: [
				{ number: 4812, body: 'Bumps foo.', labels: ['dependencies'] },
				{ number: 4813, body: 'Bumps bar.', labels: ['dependencies'] },
			],
		});
		expect(result.status).toBe('skip');
		expect(result.description).toBe('');
	});

	it('199 件の範囲でも先頭 30 件で切らない（旧 `head -30` と同 class の欠陥を作らない）', () => {
		const commits: string[] = [];
		const pullRequests: { number: number; body: string; labels: string[] }[] = [];
		for (let i = 0; i < 199; i++) {
			// 150 番目にだけ顧客向けの PR を置く。それ以外は通知対象外の型
			if (i === 150) {
				commits.push('fix(child-ui): #1 年齢だけで登録した子供が 0 歳と表示される (#4700)');
				pullRequests.push({
					number: 4700,
					body: '## 顧客価値・目的\n\n年齢だけを入力して登録したお子さまが 0 歳と表示されることがあった問題を直しました。\n',
					labels: [],
				});
			} else {
				commits.push(`chore(graphify): regenerate knowledge graph (#${5000 + i})`);
			}
		}
		const result = buildReleaseNotes({ commits, pullRequests });
		expect(result.status).toBe('post');
		expect(result.items.map((i) => i.prNumber)).toEqual([4700]);
	});
});

describe('#4883 labels.ts SSOT の読み取り', () => {
	it('RELEASE_NOTES_LABELS の全キーを実 labels.ts から読める', () => {
		// build-time パーサは namespace ブロックを最初の閉じ波括弧で切る。値かコメントに
		// 波括弧を 1 つ足すだけで、そこから下のキーが静かに欠落する（実際に踏んだ）。
		const { release, app } = loadLabels();
		for (const key of [
			'title',
			'sectionFeature',
			'sectionFix',
			'feedbackGuide',
			'bullet',
			'moreItems',
		]) {
			expect(release[key], `RELEASE_NOTES_LABELS.${key}`).toBeTruthy();
		}
		expect(app.name).toBeTruthy();
	});
});
