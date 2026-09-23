// labels 層 (ADR-0045 / #4965): デモ・ローカル配備 (NUC) (画面をまたぐ機能)。置き場所の規則は docs/DESIGN.md §6

// ============================================================
// デモ実行モード関連ラベル（#1180 / ADR-0039）
// ============================================================

/**
 * デモモード関連の文言 SSOT（ADR-0048 / #2189 PR-B4: env-only 判定で配信される）。
 * ハードコードせず本定数を介して参照すること（ADR-0037 準拠）。
 * baby / preschool モードではひらがな併記を優先する。
 *
 * #2097 Phase B (PO 報告 2026-05-17 12:00 JST): DemoBanner は demo Lambda
 * (demo.ganbari-quest.com) 上で大人 (保護者) 向けに表示されるため、漢字表記が適切。
 * リンク先は本番ドメイン (ganbari-quest.com) への absolute URL に変更し、
 * demo Lambda 上で /auth/signup や /demo/exit を叩いて 404 / 認証エラーになるのを防ぐ。
 */
export const DEMO_LABELS = {
	/** 上部バナーのメイン文言 */
	bannerTitle: 'おためしモード',
	bannerDescription: 'これはおためしです。記録やせっていはほぞんされません。',
	/** 「本当に始める」CTA — 大人 (保護者) 向けバナーなので漢字表記 (#2097 Phase B Bug 1) */
	ctaStart: '本当に始める',
	/** 退出ボタン */
	ctaExit: 'おためしをやめる',
	/**
	 * 退出先 (LP に戻す)。
	 * #2097 Phase B Bug 3: demo Lambda には `/demo/exit` route が存在しないため
	 * 本番 LP (https://www.ganbari-quest.com/) への absolute URL とする。
	 * NUC 本番 (local mode) からも同じ absolute URL でアクセス可能。
	 * #2261 (2026-05-19 PO 報告): apex (ganbari-quest.com) ではなく www. canonical
	 * に統一。CloudFront / Route53 の canonical は www. のため、apex 経由だと
	 * 301 リダイレクトが挟まり UX が劣化する。
	 */
	exitHref: 'https://www.ganbari-quest.com/',
	/**
	 * サインアップ CTA 先 (本当に始める)。
	 * #2097 Phase B Bug 2: demo Lambda では Cognito 未注入のため /auth/signup を
	 * relative で叩くと中途半端な signup 画面 (失敗確定) が表示される。本番 (Cognito)
	 * への absolute URL に固定する。
	 * #2261 (2026-05-19 PO 報告): exitHref と同じく www. canonical に統一。
	 */
	signupHref: 'https://www.ganbari-quest.com/auth/signup',
	/**
	 * ログイン CTA 先。
	 * #4712: demo Lambda には Cognito が無いため relative `/auth/login` はフォームだけ出て
	 * 送信しても何も起きない (write no-op)。signupHref と同じく本番 absolute に固定する。
	 */
	loginHref: 'https://www.ganbari-quest.com/auth/login',
} as const;

// ============================================================
// おやカギコード関連ラベル（#1360）
// ============================================================

/**
 * 保護者の見守り画面ロック（旧称「PINコード」→「おやカギコード」）の UI 文言 SSOT。
 * ロジック定数（DEFAULT_PIN）は `$lib/domain/constants/oyakagi` を参照。
 *
 * #2353 (PR #2325 follow-up 設計欠陥 6 点総合改修):
 *   - 設計欠陥 2 (SSOT 違反): 「おやカギコード」「ご家族の見守り画面」直書きを
 *     `${OYAKAGI_TERMS.name}` / `${ADMIN_VIEW_TERMS.canonical}` template literal 経由化
 *   - 設計欠陥 5 (初期 PIN 5086 ヒント): `gateDefaultHint` を空文字に変更
 *     (子が見て即入力する脆弱性。setup 完了画面 / onboarding dialog でのみ伝達)
 *
 * #4698: 桁数は `${OYAKAGI_TERMS.digitRange}` (PIN_LENGTH 由来) 経由に統一 (4 / 4〜6 / 4〜8 の三重食い違い是正)。
 *   旧 `defaultValueHint` (初期値 5086) は誤案内のため撤去し `forgotHint` (忘れた場合の導線) に置換。
 *   - 設計欠陥 4 (PIN 忘れ救済導線): `gateForgotPinLink` 等 PIN reset 関連 compound 追加
 */
/**
 * #4716 item 15: 子供画面の form action が返すエラー文言 SSOT。
 *
 * 旧実装は 25 箇所で `'パラメータが不正です'` を直書きしており、3〜5 歳が使う
 * preschool 画面に漢字の開発者語がそのまま出ていた (docs/DESIGN.md §6 内部コード
 * 露出禁止 / §8 preschool = ひらがなのみ)。子供に届く失敗はすべてひらがなで、
 * 「次に何をすればよいか」まで書く。
 */
/**
 * #4716 item 4: セルフホスト (NUC / ローカル) 起動時の既定家族名。
 *
 * 旧値は `'ローカル家族'` を `sqlite/auth-repo.ts` に直書きしており、/admin/settings の
 * 「家族名」に開発者語 (ローカル) がそのまま出ていた (docs/DESIGN.md §6 内部コード露出禁止)。
 */
export const LOCAL_DEPLOYMENT_LABELS = {
	defaultFamilyName: 'わが家',
} as const;
