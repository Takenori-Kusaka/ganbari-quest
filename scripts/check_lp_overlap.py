"""LP ロゴ × ナビ重複 & コードブロックオーバーフロー詳細チェック"""
from playwright.sync_api import sync_playwright

JS_OVERLAP = """
(() => {
    var vw = document.documentElement.clientWidth;
    var logo = document.querySelector('.logo');
    var nav = document.querySelector('.header-nav');
    var logoRect = logo ? logo.getBoundingClientRect() : null;
    var navRect = nav ? nav.getBoundingClientRect() : null;
    var headerInner = document.querySelector('.header-inner');
    var headerRect = headerInner ? headerInner.getBoundingClientRect() : null;

    // Nav items detail
    var navItems = nav ? Array.from(nav.children).map(function(el) {
        var r = el.getBoundingClientRect();
        var style = window.getComputedStyle(el);
        return {
            text: el.textContent.trim().slice(0, 20),
            left: Math.round(r.left),
            right: Math.round(r.right),
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            width: Math.round(r.width),
            height: Math.round(r.height),
            fontSize: style.fontSize,
            overflow: r.right > vw || r.left < 0
        };
    }) : [];

    // Check if logo and nav overlap
    var overlap = false;
    if (logoRect && navRect) {
        overlap = logoRect.right > navRect.left;
    }

    // Check setup-code overflow
    var setupCode = document.querySelector('.setup-code');
    var codeOverflow = false;
    var codeScrollWidth = 0;
    if (setupCode) {
        codeScrollWidth = setupCode.scrollWidth;
        codeOverflow = setupCode.scrollWidth > setupCode.clientWidth;
    }

    // Check any text nodes/elements extending beyond container
    var overflowElems = [];
    document.querySelectorAll('p, h1, h2, h3, .btn, .badge').forEach(function(el) {
        var r = el.getBoundingClientRect();
        if (r.right > vw + 5 || r.left < -5) {
            overflowElems.push({ tag: el.tagName, cls: el.className.slice(0, 30), right: Math.round(r.right), left: Math.round(r.left), text: el.textContent.trim().slice(0, 30) });
        }
    });

    return {
        vw: vw,
        logo: logoRect ? { left: Math.round(logoRect.left), right: Math.round(logoRect.right), width: Math.round(logoRect.width) } : null,
        nav: navRect ? { left: Math.round(navRect.left), right: Math.round(navRect.right), width: Math.round(navRect.width) } : null,
        header: headerRect ? { width: Math.round(headerRect.width) } : null,
        logoNavOverlap: overlap,
        logoNavGap: navRect && logoRect ? Math.round(navRect.left - logoRect.right) : null,
        navItems: navItems,
        codeBlockOverflow: codeOverflow,
        codeScrollWidth: codeScrollWidth,
        overflowElems: overflowElems
    };
})()
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    viewports = [
        ("desktop_1280", 1280, 900),
        ("tablet_768", 768, 1024),
        ("mobile_390", 390, 844),
        ("mobile_small_360", 360, 640),
        ("mobile_tiny_320", 320, 568),
    ]

    for name, w, h in viewports:
        page = browser.new_page(viewport={"width": w, "height": h})
        page.goto("http://localhost:8788/")
        page.wait_for_load_state("networkidle")

        result = page.evaluate(JS_OVERLAP)

        print(f"\n=== {name} ({w}x{h}) ===")
        print(f"  Logo: {result['logo']}")
        print(f"  Nav:  {result['nav']}")
        print(f"  Header width: {result['header']}")
        print(f"  Logo-Nav gap: {result['logoNavGap']}px  (negative = OVERLAP)")
        print(f"  Logo-Nav overlap: {result['logoNavOverlap']}")
        print(f"  Code block overflow: {result['codeBlockOverflow']} (scrollWidth={result['codeScrollWidth']})")

        offscreen_items = [i for i in result.get("navItems", []) if i.get("overflow")]
        if offscreen_items:
            print(f"  OFFSCREEN nav items: {offscreen_items}")

        if result.get("overflowElems"):
            print(f"  OVERFLOW elements: {result['overflowElems']}")

        # Print nav items summary
        print(f"  Nav items ({len(result.get('navItems', []))}):")
        for item in result.get("navItems", []):
            print(f"    '{item['text']}' w={item['width']} left={item['left']}-{item['right']} overflow={item['overflow']}")

    browser.close()
