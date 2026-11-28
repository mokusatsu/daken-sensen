"use strict";

const CommandShell = (() => {
  const onMap = document.body.hasAttribute("data-country");
  const base = onMap ? "" : "preview/";
  const home = onMap ? "../index.html" : "#main";
  const get = id => document.getElementById(id);
  document.querySelector(".mast").innerHTML = `<div class="shell mast-inner">
    <a class="wordmark" href="${home}" aria-label="打鍵戦線 作戦本部"><i class="keyboard-mark" aria-hidden="true"></i><span>打鍵戦線<small>DAKEN SENSEN</small></span></a>
    <nav aria-label="メインメニュー">
      <a id="nav-home" href="${home}" ${onMap ? 'data-command-home data-key-back aria-keyshortcuts="F"' : 'aria-current="page"'}>作戦本部</a>
      <a id="nav-map" href="${onMap ? "#main" : base + "japan-stage-map.html"}" ${onMap ? 'aria-current="page"' : 'aria-keyshortcuts="A"'}>戦区マップ</a>
      <a id="nav-roster" href="${base}character-roster.html" aria-keyshortcuts="${onMap ? ";" : "L"}">図鑑</a>
    </nav>
    <div class="mast-tools"><span class="wallet" aria-label="所持経験値"><b>XP</b> <output id="hq-xp">0</output></span>
      <button class="player-switch" ${onMap ? "" : 'aria-keyshortcuts="F" data-key-back'} data-player-switch aria-haspopup="dialog" hidden><strong data-player-name></strong><small>ユーザー切替</small></button>
      <button class="sound-button" id="sound-settings" aria-label="サウンド設定" aria-haspopup="dialog" title="サウンド設定"><span class="sound-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span></button>
    </div>
  </div>`;
  document.querySelector(".fronts").innerHTML = `
    <a id="front-japan" data-map-country="japan" href="${base}japan-stage-map.html"><b>日本戦線</b><small id="japan-progress">0 / 47</small></a>
    <a id="front-usa" data-map-country="usa" aria-disabled="true"><b>アメリカ戦線</b><small id="usa-progress">日本47拠点の制圧で解放</small></a>`;
  document.body.insertAdjacentHTML("beforeend", `<dialog id="hq-dialog" aria-labelledby="dialog-title">
    <header><h2 id="dialog-title"></h2><form method="dialog"><button class="close" aria-label="閉じる" autofocus>×</button></form></header>
    <div class="dialog-body" id="dialog-body"></div></dialog>`);

  function bind(session, country, stageId, refreshPageLinks) {
    const profile = session.state;
    const radio = fieldRadio(profile.volume);
    const sound = get("sound-settings");
    function update() {
      get("hq-xp").textContent = profile.experience.toLocaleString("ja-JP");
      sound.dataset.muted = String(!profile.volume);
      get("front-" + country).setAttribute("aria-current", "true");
      get("japan-progress").textContent = profile.cleared.length + " / 47";
      if (usaUnlocked(profile)) {
        get("front-usa").removeAttribute("aria-disabled");
        get("usa-progress").textContent = profile.usa.cleared.length + " / 50";
      }
      for (const link of document.querySelectorAll(".fronts a:not([aria-disabled])")) {
        const destination = link.dataset.mapCountry;
        link.href = onMap && destination === country ? "#main"
          : session.href(base + destination + "-stage-map.html", destination === country ? stageId : 0, {country: destination});
      }
      if (onMap) {
        document.querySelector(".wordmark").href = get("nav-home").href = session.href(home);
      } else {
        get("nav-map").href = session.href(base + country + "-stage-map.html", stageId, {country});
      }
      get("nav-roster").href = session.href(base + "character-roster.html", stageId, {country});
    }
    function openPanel(title, ...contents) {
      radio.play("deploy");
      get("dialog-title").textContent = title;
      get("dialog-body").replaceChildren(...contents);
      get("hq-dialog").showModal();
    }
    sound.addEventListener("click", () => {
      const row = document.createElement("label");
      const slider = document.createElement("input");
      slider.type = "range"; slider.min = "0"; slider.max = "100";
      slider.value = String(Math.round(profile.volume * 100));
      const caption = document.createElement("span");
      const updateCaption = () => { caption.textContent = "効果音　" + slider.value + "%"; };
      updateCaption();
      row.append(caption, slider);
      slider.addEventListener("input", () => {
        updateCaption();
        radio.setVolume(Number(slider.value) / 100);
      });
      slider.addEventListener("change", () => {
        session.sync();
        profile.volume = Number(slider.value) / 100;
        session.save();
        update();
        refreshPageLinks();
        radio.play("word");
      });
      openPanel("サウンド設定", row);
    });
    update();
    return openPanel;
  }
  return {bind};
})();
