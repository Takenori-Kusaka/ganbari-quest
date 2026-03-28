"""LP ヘッダーナビとsetup-grid集中チェック"""
from playwright.sync_api import sync_playwright

JS_NAV = """
(() => {
    var vw = document.documentElement.clientWidth;
    var nav = document.querySelector('.header-nav');
    if (!nav) return {error: 'nav not found'};
    var navRect = nav.getBoundingClientRect();
    var headerInner = document.querySelector('.header-inner');
    var headerRect = headerInner ? headerInner.getBoundingClientRect() : null;
    var items = Array.from(nav.children).map(function(el) {
        var r = el.getBoundingClientRect();
        return { text: el.textContent.trim().slice(0,20), w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), offscreen: r.right > vw + 5 };
    });
    var navStyle = window.getComputedStyle(nav);
    return {
        vw: vw,
        navWidth: Math.round(navRect.width),
        navRight: Math.round(navRect.right),
        navOverflow: navRect.right > vw + 5,
        navWrap: navStyle.flexWrap,
        navGap: navStyle.gap,
        logoWidth: headerRect ? Math.round(document.querySelector('.logo').getBoundingClientRect().width) : 0,
        headerWidth: headerRect ? Math.round(headerRect.width) : 0,
        items: items
    };
})()
"""

JS_SETUP = """
(() => {
    var setupGrid = document.querySelector('.setup-grid');
    if (!setupGrid) return {error: 'setup-grid not found'};
    var options = Array.from(setupGrid.querySelectorAll('.setup-option'));
    var style = window.getComputedStyle(setupGrid);
    var gridRect = setupGrid.getBoundingClientRect();
    return {
        optionCount: options.length,
        gridTemplate: style.gridTemplateColumns,
        gridWidth: Math.round(gridRect.width),
        options: options.map(function(o) {
            var r = o.getBoundingClientRect();
            return { h3: o.querySelector('h3') ? o.querySelector('h3').textContent.trim().slice(0,30) : '', w: Math.round(r.width), h: Math.round(r.height) };
        })
    };
})()
"""

JS_SCREENSHOTS_SECTIONS = """
(() => {
    var vw = document.documentElement.clientWidth;
    var results = [];
    document.querySelectorAll('section').forEach(function(s) {
        var r = s.getBoundingClientRect();
        var title = s.querySelector('h2,h3');
        results.push({
            id: s.id || '',
            cls: s.className.slice(0,30),
            title: title ? title.textContent.trim().slice(0,30) : '',
            w: Math.round(r.width),
            h: Math.round(r.height),
            overflow: r.width > vw + 1
        });
    });
    return results;
})()
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    viewports = [
        ("desktop_1280", 1280, 900),
        ("tablet_768", 768, 1024),
        ("mobile_390", 390, 844),
        ("mobile_small_360", 360, 640),
    ]

    for name, w, h in viewports:
        page = browser.new_page(viewport={"width": w, "height": h})
        page.goto("http://localhost:8788/")
        page.wait_for_load_state("networkidle")
        page.screenshot(path=f"site_{name}.png", full_page=True)

        nav = page.evaluate(JS_NAV)
        setup = page.evaluate(JS_SETUP)
        sections = page.evaluate(JS_SCREENSHOTS_SECTIONS)

        print(f"\n=== {name} ({w}x{h}) ===")
        if "error" not in nav:
            overflow_items = [i for i in nav.get("items", []) if i.get("offscreen")]
            print(f"Nav: width={nav['navWidth']} right={nav['navRight']} vw={nav['vw']} overflow={nav['navOverflow']}")
            if overflow_items:
                print(f"  OFFSCREEN nav items: {overflow_items}")
            else:
                print(f"  Nav items OK ({len(nav.get('items', []))} items), wrap={nav['navWrap']}")
        else:
            print(f"Nav error: {nav}")

        if "error" not in setup:
            print(f"Setup grid: {setup['optionCount']} options, template={setup['gridTemplate']}, width={setup['gridWidth']}")
        else:
            print(f"Setup: {setup}")

        overflow_secs = [s for s in sections if s["overflow"]]
        if overflow_secs:
            print(f"OVERFLOW sections: {overflow_secs}")

    browser.close()
    print("\nScreenshots saved.")
