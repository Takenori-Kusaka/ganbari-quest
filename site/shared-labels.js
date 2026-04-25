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
			"card2Title": "習慣化が目的のメタ層",
			"card2Desc": "ログイン → おみくじ → スタンプカード、というサイクルは活動記録 (L1) とは独立した L2 習慣エンジン。射幸心ではなく「毎朝アプリを開くこと」を習慣にする設計です。",
			"card3Title": "1 日 1 回 cap — 煽らない設計",
			"card3Desc": "「もっと引きたい」の誘導はありません。1 日 1 回という制限が、逆に「明日もやろう」という継続を生みます。",
			"pamphletNote": "スタンプカードのレア度分散（N/R/SR/UR）は変動比率強化による習慣形成エンジン。射幸心ではなく、三日坊主を防ぐ設計です。"
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
