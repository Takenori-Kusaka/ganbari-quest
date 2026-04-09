// site/js/contact.js
// #592: お問い合わせ mailto テンプレート — 全 LP ページ共通スクリプト
//
// 使い方:
//   <a href="mailto:ganbari.quest.support@gmail.com"
//      data-contact-context="利用規約">メール</a>
//   <script src="/js/contact.js"></script>
//
// data-contact-context 属性がある mailto リンクに、件名・本文テンプレートを自動付与する。

(function () {
  'use strict';

  var SUPPORT_EMAIL = 'ganbari.quest.support@gmail.com';

  var links = document.querySelectorAll('a[href^="mailto:' + SUPPORT_EMAIL + '"]');

  links.forEach(function (link) {
    var context = link.getAttribute('data-contact-context') || '';
    var pageName =
      location.pathname.split('/').pop() || 'index.html';

    var subject = context
      ? '[' + context + '] お問い合わせ'
      : '[お問い合わせ]';

    var body = [
      'お問い合わせ種別: ',
      'ご利用アカウント (登録メールアドレス): ',
      'お問い合わせ内容: ',
      '',
      '',
      '---',
      '参照ページ: ' + pageName,
      'ブラウザ: ' + navigator.userAgent,
    ].join('\n');

    link.href =
      'mailto:' +
      SUPPORT_EMAIL +
      '?subject=' +
      encodeURIComponent(subject) +
      '&body=' +
      encodeURIComponent(body);
  });
})();
