"use strict";
(() => {
  const media = matchMedia("(max-width: 680px)");
  const nav = $("mobileTabs"),
    tabs = [...nav.querySelectorAll("[data-tab]")],
    panels = [...document.querySelectorAll("[data-nav-panel]")];
  let current = "overview";
  function sync() {
    nav.hidden = false;
    nav.setAttribute("role", "tablist");
    for (const tab of tabs) {
      tab.setAttribute("aria-controls", "panel-" + tab.dataset.tab);
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(tab.dataset.tab === current));
      tab.tabIndex = tab.dataset.tab === current ? 0 : -1;
    }
    for (const panel of panels) {
      panel.hidden = media.matches
        ? panel.dataset.navPanel !== current
        : current === "overview"
          ? panel.dataset.navPanel === "analytics"
          : panel.dataset.navPanel !== current;
      if (panel.id) {
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", "tab-" + panel.dataset.navPanel);
      }
    }
    $("dashboard").dataset.view = current;
    document.dispatchEvent(new Event("finance-navigation"));
  }
  function choose(tab) {
    current = tab.dataset.tab;
    sync();
    tab.focus();
  }
  nav.onclick = (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) choose(tab);
  };
  nav.onkeydown = (e) => {
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    let next;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft")
      next = (index + tabs.length - 1) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    choose(tabs[next]);
  };
  media.addEventListener("change", sync);
  sync();
})();
