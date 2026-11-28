"use strict";

const GamePlayers = (() => {
  const prefix = "typing-war.player.v1.";
  const tabKey = "typing-war.tab.v1";
  const home = new URL("../index.html", document.currentScript.src);
  const address = new URL(location.href);
  const isFile = address.protocol === "file:";
  let active = null;
  let picker;
  let finishPick;

  function decode(raw) {
    try { return JSON.parse(raw); } catch { return null; }
  }
  function tab() {
    // ファイルごとに保存領域が異なるブラウザーでも、同じタブなら画面間で引き継げる。
    if (window.name.startsWith(tabKey + ":")) return decode(window.name.slice(tabKey.length + 1)) || {};
    try { return decode(sessionStorage.getItem(tabKey)) || {}; } catch { return {}; }
  }
  function keepTab(data) {
    const raw = JSON.stringify(data);
    try {
      sessionStorage.setItem(tabKey, raw);
      if (!isFile && !window.name.startsWith(tabKey + ":")) return;
    } catch { /* タブ名で選択を引き継ぐ。 */ }
    window.name = tabKey + ":" + raw;
  }
  function validId(id) {
    return typeof id === "string" && /^(?:legacy|[0-9a-f]{32})$/.test(id);
  }
  function validProgress(value) {
    return value && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
      Array.isArray(value.members) && Array.isArray(value.cleared);
  }
  function validRecord(value) {
    return value && typeof value.name === "string" && value.name.trim() &&
      (value.progress == null || validProgress(value.progress));
  }
  function newer(first, second) {
    if (!validRecord(first)) return validRecord(second) ? second : null;
    if (!validRecord(second)) return first;
    return (second.progress?.revision ?? -1) > (first.progress?.revision ?? -1) ? second : first;
  }
  function get(id) {
    if (!validId(id)) return null;
    let stored;
    try { stored = decode(localStorage.getItem(prefix + id)); } catch { /* タブ内の記録を使う。 */ }
    return newer(stored, tab().copies?.[id]);
  }
  function put(id, record) {
    let durable = false;
    try { localStorage.setItem(prefix + id, JSON.stringify(record)); durable = true; } catch { /* タブ内に保存する。 */ }
    const data = tab();
    if (isFile || !durable || data.copies?.[id]) {
      data.copies = {...data.copies, [id]: record};
      keepTab(data);
    }
  }
  function entries() {
    const ids = new Set(Object.keys(tab().copies || {}));
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) ids.add(key.slice(prefix.length));
      }
    } catch { /* タブが保持するユーザーを一覧にする。 */ }
    return [...ids].map(id => ({id, record: get(id)})).filter(entry => entry.record)
      .sort((a, b) => a.record.name.localeCompare(b.record.name, "ja"));
  }
  function importProgress(id, name, progress) {
    if (!validId(id) || !validProgress(progress)) return;
    const old = get(id);
    if (!old || (old.progress?.revision ?? -1) < progress.revision) {
      put(id, {name: old?.name || name.slice(0, 48), progress});
    }
  }
  function importSaves() {
    let legacy;
    try { legacy = decode(localStorage.getItem("typing-war.japan-preview.v1")); } catch { /* リンク内の記録も確認する。 */ }
    importProgress("legacy", "これまでの記録", legacy);
    const owner = address.searchParams.get("player");
    const carried = decode(address.searchParams.get("play"));
    if (owner === null) importProgress("legacy", "これまでの記録", carried);
    else importProgress(owner, address.searchParams.get("playerName") || "プレイヤー", carried);
  }
  function tag(params, id, record) {
    params.set("player", id);
    if ((isFile || tab().copies?.[id]) && record.progress) {
      params.set("playerName", record.name);
      params.set("play", JSON.stringify(record.progress));
    } else {
      params.delete("playerName");
      params.delete("play");
    }
  }
  function mark(target, refresh = false) {
    const data = tab();
    data.next = {path: target.pathname, id: target.searchParams.get("player"), refresh};
    keepTab(data);
  }
  function go(href) {
    const target = new URL(href, location.href);
    mark(target);
    location.replace(target.href);
  }
  function refresh() {
    if (active && tab().active === active) mark(new URL(location.href), true);
    location.reload();
  }
  function toHome(id, record) {
    const target = new URL(home);
    tag(target.searchParams, id, record);
    go(target);
  }
  function select(id) {
    const record = get(id);
    if (!record) return;
    const data = tab();
    data.active = id;
    delete data.next;
    keepTab(data);
    finishPick(id, record);
  }
  function previewFront(progress) {
    const scene = campaignFront(progress).nextBase;
    const image = new URL("preview/media/" + scene.image, home);
    picker.style.setProperty("--player-scenery", 'url("' + image.href + '")');
  }
  function buildPicker() {
    const dialog = document.createElement("dialog");
    dialog.id = "player-picker";
    dialog.setAttribute("aria-labelledby", "player-picker-title");
    dialog.innerHTML = `<div class="player-banner">
      <span class="player-wordmark">打鍵戦線</span><h2 id="player-picker-title" tabindex="-1">ユーザー選択</h2>
      <button type="button" class="player-close" aria-label="閉じる" hidden>×</button></div>
      <div class="player-body"><p class="player-warning" hidden>別のユーザーを選ぶと、この戦闘を終了して作戦本部に戻ります。</p>
      <section class="player-roster" aria-label="登録済みのユーザー"><div class="player-list"></div></section>
      <form class="player-form" novalidate><h3>新しいユーザー</h3>
      <label for="player-name">ユーザー名</label><div class="player-fields"><input id="player-name" type="text" maxlength="24" autocomplete="off" required aria-describedby="player-feedback">
      <button type="submit">作成して始める</button></div>
      <p id="player-feedback" role="status"></p></form></div>`;
    if (typeof GameKeys !== "undefined") GameKeys.addGuide(dialog);
    document.body.append(dialog);
    const input = dialog.querySelector("input");
    const feedback = dialog.querySelector("#player-feedback");
    dialog.querySelector(".player-close").onclick = () => dialog.close();
    dialog.addEventListener("cancel", event => { if (!active) event.preventDefault(); });
    input.addEventListener("focus", () => previewFront(null));
    input.addEventListener("input", () => { input.removeAttribute("aria-invalid"); feedback.textContent = ""; });
    dialog.querySelector("form").addEventListener("submit", event => {
      event.preventDefault();
      const name = input.value.trim();
      const fold = value => value.normalize("NFKC").toLocaleLowerCase("ja");
      let error = "";
      if (!name) error = "ユーザー名を入力してください。";
      else if (entries().some(({record}) => fold(record.name) === fold(name))) error = "この名前は登録済みです。一覧から選ぶか、別の名前を入力してください。";
      if (error) {
        input.setAttribute("aria-invalid", "true");
        feedback.textContent = error;
        input.focus();
        return;
      }
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
      put(id, {name, progress: null});
      select(id);
    });
    return dialog;
  }
  function listPlayers() {
    const roster = picker.querySelector(".player-roster");
    const list = picker.querySelector(".player-list");
    const previous = active || tab().active;
    const rows = entries().sort((a, b) => Number(b.id === previous) - Number(a.id === previous));
    roster.hidden = !rows.length;
    const focused = document.activeElement?.dataset.player;
    list.replaceChildren(...rows.map(({id, record}) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.player = id;
      const title = document.createElement("strong");
      title.textContent = record.name;
      const detail = document.createElement("small");
      const bases = usaUnlocked(record.progress) ? "日本 47/47　アメリカ " + (record.progress.usa?.cleared?.length ?? 0) + "/50"
        : "制圧 " + (record.progress?.cleared.length ?? 0) + " / 47";
      detail.textContent = bases + "　" + (record.progress?.experience ?? 0).toLocaleString("ja-JP") + " XP";
      if (id === active) detail.textContent += "　選択中";
      const arrow = document.createElement("span");
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "→";
      button.append(title, detail, arrow);
      button.addEventListener("focus", () => previewFront(record.progress));
      button.onclick = () => select(id);
      return button;
    }));
    if (validId(focused)) list.querySelector('[data-player="' + focused + '"]')?.focus();
  }
  function showPicker(done) {
    if (!picker) picker = buildPicker();
    finishPick = done;
    picker.querySelector(".player-close").hidden = !active;
    picker.querySelector(".player-warning").hidden = !document.getElementById("battle-details")?.open;
    picker.querySelector("form").reset();
    picker.querySelector("input").removeAttribute("aria-invalid");
    picker.querySelector("#player-feedback").textContent = "";
    listPlayers();
    if (!picker.querySelector("[data-player]")) previewFront(null);
    picker.showModal();
    const first = picker.querySelector("[data-player]");
    (first || (matchMedia("(pointer: coarse)").matches ? picker.querySelector("h2") : picker.querySelector("input"))).focus();
  }
  function switchPlayer() {
    showPicker((id, record) => {
      picker.close();
      if (id !== active) toHome(id, record);
    });
  }
  function boot(screen) {
    const mount = () => screen.replaceWith(document.importNode(screen.content, true));
    const mode = screen.dataset.players;
    if (mode === "stage" && !address.searchParams.has("stage") && campaignCountry() !== "usa") {
      mount();
      return;
    }
    importSaves();
    const owner = address.searchParams.get("player");
    const data = tab();
    const nav = performance.getEntriesByType("navigation")[0]?.type;
    const next = data.next;
    delete data.next;
    keepTab(data);
    const handoff = next?.id === owner && next.path === address.pathname && (nav !== "reload" || next.refresh);
    function play(id, record) {
      active = id;
      if (mode !== "home" && campaignCountry() === "usa" && !usaUnlocked(record.progress)) {
        toHome(id, record);
        return;
      }
      if (mode === "stage" && !address.searchParams.has("stage")) address.searchParams.set("stage", "0");
      tag(address.searchParams, id, record);
      try { history.replaceState(history.state, "", address); } catch { /* 次の画面へのリンクに選択を含める。 */ }
      mount();
      for (const button of document.querySelectorAll("[data-player-switch]")) {
        button.hidden = false;
        const name = button.querySelector("[data-player-name]");
        if (name) name.textContent = record.name;
        button.setAttribute("aria-label", "ユーザー切替　" + record.name);
        button.onclick = switchPlayer;
      }
    }
    const known = get(owner);
    if (known && data.active === owner && (handoff || nav === "back_forward")) play(owner, known);
    else showPicker((id, record) => {
      picker.close();
      if (owner && owner !== id && mode !== "home") toHome(id, record);
      else play(id, record);
    });
  }
  document.addEventListener("click", event => {
    const link = event.target.closest?.("a[href]");
    if (!active || !link || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
        link.target && link.target !== "_self") return;
    const target = new URL(link.href);
    if (target.searchParams.get("player") === active &&
        (target.pathname !== location.pathname || target.search !== location.search)) mark(target);
  });
  window.addEventListener("pageshow", event => {
    if (event.persisted) refresh();
  });
  window.addEventListener("storage", event => {
    if (picker?.open && (!event.key || event.key.startsWith(prefix))) listPlayers();
  });
  return {boot, go, refresh, get, put, tag, get active() { return active; }};
})();

GamePlayers.boot(document.getElementById("campaign-screen"));
