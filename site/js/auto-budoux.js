// #1786: BudouX 全長文セクション自動 wrap (ADR-0016 整合)
//
// 役割: site/index.html / pricing.html / faq.html 等の長文段落を
//   <budoux-ja> Web Component (cdn.jsdelivr.net/npm/budoux@latest) でラップし、
//   Safari iOS / 古い Chromium で文節境界での折り返しを実現する。
//
// 第一選択 (CSS) は shared.css の `text-wrap: balance + word-break: auto-phrase`
// で短い見出しに対応。本スクリプトは長文段落のフォールバックとして対象を絞り込む。
//
// 対象セレクタ:
//   .section-desc        — 各 section の H2 直下の説明文
//   .section-sub-note    — 各 section の補足注記
//   .cta-bottom p        — 最終 CTA セクションの段落
//   .faq-answer          — FAQ Q&A の回答段落
//   .faq-item summary    — FAQ Q&A の質問テキスト
//   .gr-body p           — growth-roadmap 各 stage の説明文 + ベネフィット行
//   .gr-benefit          — growth-roadmap ベネフィット行 span 全体
//   .age-panel-desc      — 年齢パネル説明文
//   .core-loop-card p    — コアループ 3 card の本文
//   .versus-card p       — versus 比較カードの補足文
//   .soft-card p         — soft-features 各カードの本文 + ベネフィット
//   .tour-card p         — machine-tour 各カードの本文 + ベネフィット
//   .trust-badge p       — trust-badges 各カードの本文
//   .pp-footnote         — pricing-promise 注記
//
// SSR 二重適用回避: data-budoux-applied="true" フラグを使用 (ADR-0016)。
// Web Component が未登録 (CDN 失敗時) でも plain text として描画される fail-safe。
//
// XSS 対策: 元の textContent を取得して budoux-ja の中に textNode として挿入。
//   innerHTML 経由のラップを避けることで sanitize 不要 (ADR-0025 整合)。
//
// 実装方針 (10 行超 = OSS 確認対象、#1350):
//   - 既存 CDN BudouX ライブラリの公式推奨パターン (Web Component で wrap) を踏襲
//   - 独自の文節分割ロジックは書かない (CDN 側の AI モデルに委譲)
//   - npm package `budoux` の Svelte action 例 ($lib/ui/actions/budoux.ts) と整合
(()=>{
	'use strict';
	const SELECTORS = [
		'.section-desc',
		'.section-sub-note',
		'.cta-bottom p',
		'.faq-answer',
		'.faq-item summary',
		'.gr-body p',
		'.gr-benefit',
		'.age-panel-desc',
		'.core-loop-card p',
		'.versus-card p',
		'.soft-card p',
		'.tour-card p',
		'.trust-badge p',
		'.pp-footnote',
		'figcaption'
	];
	function applyBudoux(){
		const targets = document.querySelectorAll(SELECTORS.join(','));
		for(let i=0;i<targets.length;i++){
			const el = targets[i];
			if(el.getAttribute('data-budoux-applied')==='true')continue;
			// 子要素 (a / strong / span / small) を持つ場合は子の textNode のみ wrap
			// (innerHTML 全体を <budoux-ja> でラップすると DOMPurify (ADR-0025) との整合が取りづらいため、
			//  各 textNode を個別にラップする)
			wrapTextNodes(el);
			el.setAttribute('data-budoux-applied','true');
		}
	}
	function wrapTextNodes(root){
		// TreeWalker で textNode のみ列挙して wrap。
		// element 子は再帰的に拾う (anchor 等の中の textNode も対象)。
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode(node){
				const t = node.nodeValue || '';
				// 空白のみの textNode はスキップ (folding 阻害しない)
				if(!t.trim())return NodeFilter.FILTER_REJECT;
				// 親が既に budoux-ja なら二重 wrap 回避
				if(node.parentElement && node.parentElement.tagName === 'BUDOUX-JA'){
					return NodeFilter.FILTER_REJECT;
				}
				return NodeFilter.FILTER_ACCEPT;
			}
		});
		const nodes = [];
		let n;
		while((n = walker.nextNode())){nodes.push(n);}
		for(let i=0;i<nodes.length;i++){
			const tn = nodes[i];
			const wrap = document.createElement('budoux-ja');
			wrap.textContent = tn.nodeValue;
			tn.parentNode.replaceChild(wrap, tn);
		}
	}
	// shared-labels.js の applyLpKeys 後に再実行する必要があるため、
	// DOMContentLoaded + load + 軽い遅延 timer の 3 段で確実にカバーする。
	if(document.readyState === 'loading'){
		document.addEventListener('DOMContentLoaded', applyBudoux);
	}else{
		applyBudoux();
	}
	window.addEventListener('load', applyBudoux);
	// shared-labels.js (defer) が DOM を上書きする場合に備えて 1 frame 遅らせて再適用
	if(typeof requestAnimationFrame === 'function'){
		requestAnimationFrame(()=>requestAnimationFrame(applyBudoux));
	}
})();
