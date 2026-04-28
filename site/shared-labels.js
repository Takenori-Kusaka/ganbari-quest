/**
 * LP共通用語辞書 (#561, #565, #1344)
 *
 * ⚠️ このファイルは自動生成されます。直接編集しないでください。
 * 生成元: src/lib/domain/labels.ts + src/lib/domain/validation/age-tier.ts
 * 生成コマンド: node scripts/generate-lp-labels.mjs
 *
 * 用法:
 * <script src="shared-labels.js"></script>
 * <div data-age-tier="elementary" data-label="age-tier-name">小学生モード</div>
 * <h2 data-lp-key="retention.sectionTitle">三日坊主にならない設計</h2>
 *
 * data-label の値:
 *   - "age-tier-name"  : モード名（乳幼児モード/幼児モード/小学生モード/中学生モード/高校生モード）
 *   - "age-tier-range" : 年齢範囲（0〜2歳 等）
 *   - "age-tier-formal": 正式名（乳幼児（0〜2歳） 等）
 *
 * data-lp-key の値: "セクション名.キー名" 形式 (LP_LABELS を参照)
 */
(function () {
	'use strict';

	const AGE_TIERS = {
		"baby": {
			"name": "準備モード",
			"range": "0〜2歳",
			"formal": "準備モード（0〜2歳）",
			"ageMin": 0,
			"ageMax": 2
		},
		"preschool": {
			"name": "幼児モード",
			"range": "3〜5歳",
			"formal": "幼児（3〜5歳）",
			"ageMin": 3,
			"ageMax": 5
		},
		"elementary": {
			"name": "小学生モード",
			"range": "6〜12歳",
			"formal": "小学生（6〜12歳）",
			"ageMin": 6,
			"ageMax": 12
		},
		"junior": {
			"name": "中学生モード",
			"range": "13〜15歳",
			"formal": "中学生（13〜15歳）",
			"ageMin": 13,
			"ageMax": 15
		},
		"senior": {
			"name": "高校生モード",
			"range": "16〜18歳",
			"formal": "高校生（16〜18歳）",
			"ageMin": 16,
			"ageMax": 18
		}
	};

	const PLAN_LABELS = {
		"free": "無料プラン",
		"standard": "スタンダードプラン",
		"family": "ファミリープラン"
	};

	const LP_LABELS = {
		"retention": {
			"sectionTitle": "三日坊主にならない設計",
			"sectionDesc": "「有料アプリって三日坊主になりがち…」という不安に先回りで答えます。スタンプカードのレア度分散は行動心理学の「変動比率強化」— 最も強固な習慣形成メカニズムです。",
			"card1Title": "飽きを防ぐレア度分散",
			"card1Desc": "普通のスタンプ (N) から超レアスタンプ (UR) まで 4 段階。毎回違うスタンプが押される「変動比率強化」が、子供の「明日もやろう」を支えます。",
			"card2Title": "習慣を育てるおみくじスタンプ",
			"card2Desc": "毎朝のログイン → おみくじ → スタンプカードは、活動の記録とは別の「毎日アプリを開く習慣」を育てるための仕組みです。射幸心を煽るのではなく「ちょっとした楽しみ」で継続を支えます。",
			"card3Title": "1 日 1 回まで — 煽らない設計",
			"card3Desc": "「もっと引きたい」の誘導はありません。1 日 1 回という制限が、逆に「明日もやろう」という継続を生みます。",
			"pamphletNote": "スタンプカードのレア度分散（N/R/SR/UR）は変動比率強化による習慣形成エンジン。射幸心ではなく、三日坊主を防ぐ設計です。"
		},
		"coreloop": {
			"sectionTitle": "3 つの仕組みで、毎日のがんばりが本物の報酬になる",
			"sectionDesc": "活動を記録してポイントを貯め、ポイントでごほうびショップの好きなものと交換する。3 つの仕組みが子供の「やりたい」を持続させます。",
			"parentPerspectiveTitle": "親の視点",
			"parentPerspectiveDesc": "プリセット活動で設定は 2 分。子供の取り組みをポイントで定量把握できます。",
			"childPerspectiveTitle": "子供の視点",
			"childPerspectiveDesc": "活動を重ねてポイントを貯め、ごほうびショップで欲しいものと交換できます。",
			"l1Title": "毎日の活動 — がんばりを記録する",
			"l1Step1Title": "活動を 2 タップで記録",
			"l1Step1Desc": "「はみがきした」「宿題おわった」をタップするだけ。プリセット活動がそのまま使えるので設定は最小限です。",
			"l1Step2Title": "ポイントが獲得できる",
			"l1Step2Desc": "記録した活動に応じてポイントが加算。「今日どれだけ頑張ったか」が数字で見えます。",
			"l2Title": "習慣カード — 毎日の楽しみで続ける",
			"l2Step1Title": "毎朝ログインしておみくじ",
			"l2Step1Desc": "1 日 1 回までのおみくじスタンプ。スタンプのレア度に応じてボーナスポイントが獲得でき、毎朝アプリを開く習慣につながります（1 日 1 回までで煽らない設計）。",
			"l2Step2Title": "スタンプカードが完成する",
			"l2Step2Desc": "1 週間続けるとスタンプカードが 1 枚完成。三日坊主を防ぐ「継続の見える化」です。",
			"l3Title": "ごほうび交換 — ポイントを欲しいものに換える",
			"l3Step1Title": "ポイントを蓄積する",
			"l3Step1Desc": "毎日の活動ポイントと習慣カードのボーナスポイントが積み上がります。ポイントは家庭内の通貨として機能します。",
			"l3Step2Title": "ごほうびショップで交換",
			"l3Step2Desc": "貯めたポイントはごほうびショップが唯一の出口。実物のプレゼント・お小遣い・特権（夜ふかし権など）を親が設定し、子供が自分で選んで交換できます。",
			"shopNote": "ごほうびショップは唯一の出口。ポイントは「欲しいものと交換できる通貨」として機能するので、子供の自律的な目標設定を促します。",
			"pamphletNote": "毎日の活動でポイント / 習慣カードのおみくじスタンプ（習慣形成）/ ごほうびショップ（唯一の出口）の 3 つの仕組みで、毎日のがんばりが本物の報酬になります。",
			"l1Badge": "活動",
			"l2Badge": "習慣",
			"l3Badge": "ごほうび"
		},
		"nav": {
			"hamburgerAriaLabel": "メニュー",
			"logoAlt": "がんばりクエスト",
			"home": "ホーム",
			"marketplace": "テンプレートを探す",
			"pricing": "料金プラン",
			"faq": "よくあるご質問",
			"selfhost": "仕組みを公開（開発者向け）",
			"signup": "無料で始める",
			"login": "ログイン",
			"features": "できること"
		},
		"footer": {
			"brandName": "がんばりクエスト",
			"brandTagline": "お子さまの「がんばり」を冒険に変える<br>家庭向けWebアプリ",
			"linksHeading": "リンク",
			"pricingLink": "料金プラン",
			"faqLink": "よくあるご質問",
			"selfhostLink": "仕組みを公開（開発者向け）",
			"githubLink": "GitHub",
			"contactLink": "お問い合わせ",
			"sponsorLink": "Sponsor",
			"legalHeading": "法的情報",
			"termsLink": "利用規約",
			"privacyLink": "プライバシーポリシー",
			"slaLink": "SLA",
			"tokushohoLink": "特定商取引法に基づく表記",
			"copyright": "© 2026 がんばりクエスト. All rights reserved."
		},
		"common": {
			"ctaSignup": "無料で始める",
			"ctaDemo": "デモを見る",
			"ctaPricing": "料金プラン",
			"ctaContact": "お問い合わせ",
			"ctaPricingDetail": "料金の詳細を見る →",
			"contactHint": "メールでお気軽にお問い合わせください",
			"contactEmail": "ganbari.quest.support@gmail.com",
			"trialPeriodLabel": "7 日間無料トライアル",
			"trialPeriodShort": "7 日間無料",
			"trialPeriodFull": "7 日間の無料トライアル",
			"priceStandardMonthly": "月 ¥500",
			"priceFamilyMonthly": "月 ¥780",
			"priceMinFrom": "月 ¥500〜",
			"noCreditCardNote": "クレジットカード登録不要",
			"cancelAnytime": "いつでも解約 OK"
		},
		"legalDisclaimer": {
			"cancelDisclaimer": "※解約後はプラン別の読み取り専用猶予期間（スタンダード 7 日 / ファミリー 30 日）後にすべてのデータが完全に削除されます。日割り返金はありません。",
			"cancelDisclaimerLinks": "FAQ / 特定商取引法に基づく表記",
			"cancelDisclaimerCta": "※解約後はプラン別の猶予期間（スタンダード 7 日 / ファミリー 30 日）後にすべてのデータが完全に削除されます。",
			"cancelDisclaimerCtaLink": "FAQ",
			"liabilityTitle": "サービス利用に関する重要なご案内",
			"liabilityBody": "万一の障害・不具合等による損害賠償は、有料プランは「直近 3 ヶ月の支払額」を上限、無料プランは 0 円とさせていただいております（消費者契約法等の強行法規に基づく権利は対象外）。",
			"liabilityLinks": "利用規約 第 12 条 / FAQ「賠償について」",
			"faqLiabilityIntro": "本サービスは個人開発者が運営する小規模サービスであり、利用規約 第 12 条（免責事項）に基づき、賠償額には上限を設けております。",
			"faqLiabilityPaid": "有料プランをご利用の方: 損害発生月を含む直近 3 ヶ月間に実際にお支払いいただいた利用料の総額を上限とします",
			"faqLiabilityFree": "無料プランをご利用の方: 賠償額の上限は 0 円とさせていただきます",
			"faqLiabilityNote": "※ 消費者契約法その他の強行法規が適用される場合は、その範囲で当該規定が優先されます。重要事項のため、ご契約前に 利用規約 第 12 条 全文をご確認のうえ、ご納得いただいた方のみご利用ください。",
			"faqLiabilityQuestion": "サービスの不具合等で損害が発生した場合、賠償の上限はありますか？"
		},
		"versus": {
			"sectionTitle": "シール帳・ホワイトボードでも、いいんじゃない？",
			"sectionDesc": "わかります。私たちもまずは紙で試しました。<br>でも「3 歳から 18 歳まで」「家族みんなで」「ずっと続ける」には、デジタルだから届く差があります。",
			"tagAnalog": "シール帳・紙",
			"tagDigital": "がんばりクエスト",
			"row1AnalogTitle": "集計が手作業で計算ミスが起きがち",
			"row1DigitalTitle": "自動集計でいつでもポイントが見える",
			"row1DigitalDesc": "子供が「あと 50 ポイントで欲しいごほうび」と自分で計画できます。",
			"row2AnalogTitle": "年齢が変わるたびに冊子を買い替え",
			"row2DigitalTitle": "3 歳から 18 歳まで同じアプリで継続",
			"row2DigitalDesc": "15 年分の成長履歴がひとつにまとまります。",
			"row3AnalogTitle": "続けることが目的になりがち",
			"row3DigitalTitle": "子供が自律したらアプリは不要",
			"row3DigitalDesc": "「使わなくなる」が成功のゴール。卒業を最終地点として設計しています。",
			"row4AnalogTitle": "家を離れると続けられない",
			"row4DigitalTitle": "旅行先・祖父母宅でも続けられる",
			"row4DigitalDesc": "スマホ・タブレットで開けば連続記録が途切れません。"
		},
		"growthRoadmap": {
			"sectionTitle": "3 歳から 18 歳まで、そして「卒業」へ",
			"sectionDesc": "お子さまの成長に合わせて UI と機能が変化。最後は「アプリを使わなくても自分で計画できる」自律へ。",
			"preschoolAge": "幼児",
			"preschoolRange": "3-5",
			"preschoolUnit": "歳",
			"preschoolTitle": "はみがき・おかたづけを自分で",
			"preschoolDesc": "大きなボタンとひらがな UI で「自分で押した！」の達成感を毎日体験。",
			"elementaryAge": "小学生",
			"elementaryRange": "6-12",
			"elementaryUnit": "歳",
			"elementaryTitle": "宿題・お手伝いを自分から",
			"elementaryDesc": "漢字 UI に切替、称号で「次は何を達成しよう？」と自分で目標を立てる力が育ちます。",
			"juniorAge": "中学生",
			"juniorRange": "13-15",
			"juniorUnit": "歳",
			"juniorTitle": "習い事・部活と勉強の両立",
			"juniorDesc": "月次レポートで「自分のペース」を客観視し、自律的なリズム調整が可能に。",
			"seniorAge": "高校生",
			"seniorRange": "16-18",
			"seniorUnit": "歳",
			"seniorTitle": "受験・将来設計を自分の手で",
			"seniorDesc": "15 年分の活動ログが「自分はこれだけやってきた」という自信に。",
			"graduateLabel": "そして",
			"graduateAccent": "卒業",
			"graduateTitle": "アプリが必要なくなる日へ",
			"graduateDesc": "「使わなくなる」ことが私たちの成功。15 年分の記録はいつでも書き出してご家族の手元に残せます。"
		},
		"pricing": {
			"pageTitle": "料金プラン - がんばりクエスト",
			"metaDescription": "がんばりクエストの料金プラン。基本無料で始められます。スタンダード月額500円（税込）、ファミリー月額780円（税込）。すべての有料プランに7日間の無料体験付き。",
			"ogTitle": "料金プラン - がんばりクエスト",
			"ogDescription": "基本無料で始められます。お子さまのポイント・レベルアップ・ログインボーナス（おみくじ + スタンプカード）などの冒険体験は無料プランでも一切制限ありません。",
			"heroTitle": "料金プラン",
			"heroLead1": "お子さまの成長を冒険に変える。",
			"heroLeadHighlight": "基本無料",
			"heroLead2": "で今日から始められます。",
			"heroSubtext": "有料プランはすべて",
			"heroSubtextStrong": "7日間の無料体験",
			"heroSubtextSuffix": "付き（クレジットカード登録不要）",
			"heroPriceBand": "基本無料 ・ 月 ¥500（税込）から ・ 7 日間無料体験 ・ いつでも解約 OK",
			"heroCtaPrimary": "7 日間無料で試す",
			"heroCtaSecondary": "プランを比較する",
			"planFreeName": "フリー",
			"planFreePrice": "¥0",
			"planFreePriceSub": "ずっと無料 ・ クレカ登録不要",
			"planFreePersona": "こんなご家族におすすめ: まずはお子さま 1〜2 人で試したいご家族へ",
			"planFreeDesc": "ポイント・レベルアップ・おみくじ・スタンプカードなど、お子さまの冒険体験はすべて無料。",
			"planFreeCta": "無料ではじめる",
			"planFreeBadge": "永久無料",
			"planStandardBadge": "おすすめ",
			"planStandardName": "スタンダード",
			"planStandardPrice": "¥500",
			"planStandardUnit": "/月（税込）",
			"planStandardYearly": "年額 ¥5,000（税込・2ヶ月分お得）",
			"planStandardPersona": "こんなご家族におすすめ: お子さま 3 人以上 / 我が家ルールをカスタマイズしたいご家族へ",
			"planStandardDesc": "カスタマイズ自由自在。お子さまにぴったりの環境を作れます。",
			"planStandardCta": "7日間 無料体験",
			"planFamilyName": "ファミリー",
			"planFamilyPrice": "¥780",
			"planFamilyUnit": "/月（税込）",
			"planFamilyYearly": "年額 ¥7,800（税込・2ヶ月分お得）",
			"planFamilyPersona": "こんなご家族におすすめ: 祖父母・離れた家族と一緒に応援したいご家族へ",
			"planFamilyDesc": "家族みんなで見守る。きょうだいの比較やレポートで成長を応援できます。",
			"planFamilyCta": "7日間 無料体験",
			"ctaDisclaimerBadges": "✅ クレジットカード登録不要 ✅ 自動課金なし ✅ いつでも解約 OK",
			"ctaDisclaimerNote": "※ 7 日間無料体験は初回お申込み時のみ。価格はすべて税込表示です。",
			"allPlansNote": "💡 お子さまが楽しめる冒険の仕組み（レベル・おみくじ・スタンプカード・ログインボーナス・コンボなど）は",
			"allPlansNoteStrong": "全プラン共通",
			"allPlansNoteSuffix": "で制限なし",
			"comparisonTitle": "機能比較表",
			"comparisonSubtitle": "冒険の仕組みは全プラン共通で制限なく楽しめます",
			"trialHeading": "7日間の無料体験",
			"trialSubheading": "7 日間の無料体験では、選択したプランの全機能を制限なくお試しいただけます",
			"trialStep1Title": "いつでも好きなタイミングで開始",
			"trialStep1Desc": "アカウント登録後、管理画面からワンタップで無料体験を開始できます。クレジットカードの登録は不要です。",
			"trialStep2Title": "7日間、選択したプランの全機能が使い放題",
			"trialStep2Desc": "スタンダード/ファミリーいずれもプランの全機能（カスタム活動・レポート・データエクスポート・AI 自動提案・きょうだいランキング・離れた家族応援メッセージなど）を制限なくお試しいただけます。",
			"trialStep3Title": "終了後は自動で無料プランに戻ります",
			"trialStep3Desc": "無料体験期間が終わると、自動的に無料プランへ移行します。自動課金は一切ありません。",
			"trialStepHighlight": "無料体験中にいつでもプラン選択可能",
			"trialStepHighlightDesc": "気に入ったら無料体験中にそのままプランを選択できます。もちろん、何もしなければ自動で無料プランに戻ります。",
			"trialDataReassureLine1Strong": "無料体験中に作成したオリジナル活動・ごほうび・もちものチェックリスト・シール・レベル・お子さま登録",
			"trialDataReassureLine1Suffix": "は、無料プランに移行した後もそのまま保持されます。",
			"trialDataReassureLine2Strong": "活動履歴・ポイント獲得履歴・ログインボーナス履歴",
			"trialDataReassureLine2Suffix": "は無料プランの保持期間（90 日）を超えたものから順次削除されます。",
			"trialDataReassureLine3": "有料プランにアップグレードすれば、より長期間（スタンダード: 1 年 / ファミリー: 無制限）の履歴をご利用いただけます。",
			"familyPatternsTitle": "家族での使い方",
			"familyPatternsSubtitle": "ご家庭の環境に合わせて、2つのスタイルからお選びいただけます",
			"familyPatternSharedTag": "全プラン対応",
			"familyPatternSharedTitle": "親アカウント共用型",
			"familyPatternSharedDesc": "親が1つのアカウントを作成し、同じ端末でお子さまと画面を切り替えて使います。設定も操作もシンプルで、すぐに始められます。無料プランを含む全プランで利用できます。",
			"familyPatternInviteTag": "スタンダード以上",
			"familyPatternInviteTitle": "個別アカウント＋招待リンク型",
			"familyPatternInviteDesc": "家族グループを作成し、招待リンクで家族を招待。家族メンバーがそれぞれの端末からアクセスでき、離れた場所からもお子さまの成長を見守れます。スタンダードは4人まで、ファミリープランは無制限で招待できます。",
			"faqTitle": "よくある質問",
			"faqFreeQ": "無料プランでも十分使えますか？",
			"faqFreeA": "はい。プリセットの活動とチェックリストで基本的な機能はすべてお使いいただけます。お子さまの冒険体験（レベル、ポイント、おみくじ、スタンプカード、毎日のログインボーナス）は無料プランでも一切制限ありません。",
			"faqAfterTrialQ": "無料体験後はどうなりますか？",
			"faqAfterTrialA": "7日間の無料体験終了後は無料プランに移行します。有料プランをご希望の場合は、管理画面からアップグレードしてください。クレジットカードの事前登録は不要です。無料体験中に作成したオリジナル活動・ごほうび・チェックリスト・シール・レベルは保持されますが、活動履歴・ポイント獲得履歴・ログインボーナス履歴は無料プランの保持期間（90 日）を超えたものから順次削除されます。",
			"faqCancelQ": "解約したらデータはすぐに削除されますか？",
			"faqCancelA": "プランによって猶予期間が異なります。スタンダードプランは解約申請から 7 日間、ファミリープランは解約申請から 30 日間の読み取り専用猶予期間が設けられ、その後すべてのデータが完全に削除されます（復旧不可）。猶予期間中はログインしてエクスポートが可能です。",
			"faqBillingDateQ": "お支払い日はいつですか？",
			"faqBillingDateA": "お申し込み日を起算日として、月額プランは毎月、年額プランは毎年自動更新されます。例えば4月15日にお申し込みの場合、次回のお支払い日は5月15日（月額）または翌年4月15日（年額）です。",
			"faqYearlyCancelQ": "年額プランを途中解約した場合は？",
			"faqYearlyCancelA": "年額プランを途中解約しても、お支払い済みの残り期間は引き続きご利用いただけます。日割りでの返金は行っておりません。",
			"faqPaymentQ": "支払い方法は？",
			"faqPaymentA": "クレジットカード（Visa, Mastercard, JCB, American Express）に対応しています。Stripeによる安全な決済処理を使用しており、カード情報は当サービスのサーバーには保存されません。",
			"faqPlanChangeQ": "プランの変更はできますか？",
			"faqPlanChangeA": "はい。スタンダード↔ファミリー、月額↔年額の切り替えが可能です。管理画面の「プラン・お支払い」→「プラン変更・支払い管理」からお手続きいただけます。プラン変更方法についてご不明な点は、お問い合わせください。",
			"faqAdsQ": "子供の画面に広告は出ますか？",
			"faqAdsA": "いいえ。無料プランでも広告は一切表示しません。お子さまが安心して使える環境を最優先にしています。",
			"faqMultiDeviceQ": "家族で複数端末から使えますか？",
			"faqMultiDeviceA": "はい。スタンダード以上のプランで、家族メンバーを招待して複数端末からアクセスできます。スタンダードプランは4人まで、ファミリープランは無制限に招待可能です。無料プランでも1つの端末でお子さまを切り替えて使えます。",
			"faqGraduationQ": "ずっと使い続ける必要がありますか？",
			"faqGraduationA": "いいえ、お子さまが自立して習慣化できたら「卒業」していただいて構いません。がんばりクエストは「子供の自立」を最終ゴールとして設計されており、ずっと依存して使い続けることを想定していません。卒業の目安は小学校高学年〜中学生頃です。",
			"ctaBottomTitle": "お子さまの冒険を始めよう",
			"ctaBottomDesc": "まずは無料ではじめて、お子さまの反応を見てみませんか？",
			"ctaBottomPrimary": "無料ではじめる",
			"ctaBottomSecondary": "デモで体験する"
		},
		"founderInquiry": {
			"sectionHeading": "👋 開発者に直接相談（無料）",
			"sectionLead": "個人開発のため、Pre-PMF 期は開発者本人が一人ひとりの相談に直接お返事します。商業的な売り込みではなく、「ご家庭に本当に合うかどうか」を一緒に判断します。",
			"bullet1": "導入前のご相談（向き / 不向きを率直にお伝えします）",
			"bullet2": "使い方が分からない・困っている",
			"bullet3": "解約を検討中（その前に一度お話しさせてください）",
			"ctaButton": "直接相談する（無料）",
			"ctaSeparator": "／",
			"mailtoFallback": "メールで送る"
		}
	};

	// グローバルへエクスポート
	window.GANBARI_LABELS = {
		ageTiers: AGE_TIERS,
		plans: PLAN_LABELS,
		lp: LP_LABELS,
	};

	/**
	 * data-age-tier + data-label 属性を持つ要素を辞書値で上書きする
	 */
	function applyAgeTierLabels() {
		const elements = document.querySelectorAll('[data-age-tier][data-label]');
		elements.forEach((el) => {
			const tier = el.getAttribute('data-age-tier');
			const labelType = el.getAttribute('data-label');
			const tierData = AGE_TIERS[tier];
			if (!tierData) return;

			let value;
			switch (labelType) {
				case 'age-tier-name':
					value = tierData.name;
					break;
				case 'age-tier-range':
					value = tierData.range;
					break;
				case 'age-tier-formal':
					value = tierData.formal;
					break;
				default:
					return;
			}
			el.textContent = value;
		});

		// 親要素に data-age-tier、子要素に data-label を持つパターンも対応
		const parentTiers = document.querySelectorAll('[data-age-tier]');
		parentTiers.forEach((parent) => {
			const tier = parent.getAttribute('data-age-tier');
			const tierData = AGE_TIERS[tier];
			if (!tierData) return;
			parent.querySelectorAll('[data-label]').forEach((child) => {
				if (child.hasAttribute('data-age-tier')) return; // 直接指定優先
				const labelType = child.getAttribute('data-label');
				let value;
				switch (labelType) {
					case 'age-tier-name':
						value = tierData.name;
						break;
					case 'age-tier-range':
						value = tierData.range;
						break;
					case 'age-tier-formal':
						value = tierData.formal;
						break;
					default:
						return;
				}
				child.textContent = value;
			});
		});
	}

	/**
	 * data-plan + data-label 属性を持つ要素を辞書値で上書きする
	 *
	 * data-label の値:
	 *   - "plan-name": プラン名（無料プラン/スタンダードプラン/ファミリープラン）
	 */
	function applyPlanLabels() {
		var elements = document.querySelectorAll('[data-plan][data-label]');
		elements.forEach(function(el) {
			var plan = el.getAttribute('data-plan');
			var labelType = el.getAttribute('data-label');
			var planName = PLAN_LABELS[plan];
			if (!planName) return;

			if (labelType === 'plan-name') {
				el.textContent = planName;
			}
		});
	}

	/**
	 * data-lp-key 属性を持つ要素を LP_LABELS 辞書値で上書きする (#1344)
	 *
	 * data-lp-key の形式: "section.key" (例: "retention.sectionTitle")
	 * SEO のため HTML 側にはフォールバックテキストを残してよい。
	 * JS ロード後に labels.ts の値で確認・置換する。
	 */
	function applyLpKeys() {
		var elements = document.querySelectorAll('[data-lp-key]');
		elements.forEach(function(el) {
			var key = el.getAttribute('data-lp-key');
			var parts = key.split('.');
			if (parts.length !== 2) return;
			var section = parts[0];
			var field = parts[1];
			var sectionData = LP_LABELS[section];
			if (!sectionData) return;
			var value = sectionData[field];
			if (value !== undefined) {
				el.textContent = value;
			}
		});
	}

	function applyAll() {
		applyAgeTierLabels();
		applyPlanLabels();
		applyLpKeys();
	}

	// DOMContentLoaded 後に適用
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', applyAll);
	} else {
		applyAll();
	}
})();
