"use strict";

const hq = openCampaign(commandData.starters);
const profile = hq.state;
const node = id => document.getElementById(id);
const {country, stages, nextBase} = campaignFront(profile);
const americaOpen = country === "usa";
const front = americaOpen ? profile.usa : profile;
const openPanel = CommandShell.bind(hq, country, nextBase.id, syncLinks);
const squadCards = Array.from({length: 5}, (_, i) => commandData.roster.find(card => card.id === profile.slots[i]));
const portraits = new Map();
for (const card of squadCards) {
  if (!card || portraits.has(card.country)) continue;
  const sheet = new Image();
  sheet.src = card.country === "usa" ? "preview/media/units-usa.png" : "preview/media/units.png";
  portraits.set(card.country, sheet);
}

function element(tag, text) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  return item;
}
function linkTo(path, extra = {}) {
  return hq.href("preview/" + path, nextBase.id, {country, ...extra});
}
function syncLinks() {
  node("launch").href = profile.slots.some(Boolean) ? linkTo("battle-demo.html") : linkTo("formation-demo.html");
  node("team-link").href = linkTo("formation-demo.html");
  node("drill-link").href = linkTo("battle-demo.html", {exercise: "daily"});
}

function paintSquad() {
  const cap = allyLevelCap(profile);
  node("squad").replaceChildren(...squadCards.map(card => {
    const li = element("li");
    const img = element("canvas");
    img.width = 85; img.height = 62;
    img.setAttribute("aria-hidden", "true");
    if (card) {
      const [x, y, w, h] = card.frame;
      const scale = Math.min(82 / w, 60 / h);
      const ctx = img.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(portraits.get(card.country), x, y, w, h, (85 - w * scale) / 2, 62 - h * scale, w * scale, h * scale);
    }
    li.append(img, element("strong", card?.name ?? "空き枠"), element("small", card ? card.role + " Lv." + allyLevel(profile.levels[card.id], cap) : "未編成"));
    return li;
  }));
}
Promise.all([...portraits.values()].map(sheet => sheet.decode())).then(paintSquad).catch(() => {});
const records = [...Object.values(profile.records), ...Object.values(profile.usa.records)];
const medals = profile.cleared.length + profile.usa.cleared.length + records.filter(r => r.precision).length + records.filter(r => r.command).length;
const conquered = americaOpen && front.cleared.length === stages.length;
if (americaOpen) {
  document.body.classList.add("usa-front");
  node("front-name").textContent = nextBase.region;
  node("title").textContent = "アメリカ戦線";
  document.querySelector(".objective").textContent = front.cleared.length
    ? "各州の守備隊を突破し、アメリカ全50州を制圧せよ。" : "日本全47拠点を制圧。育てた部隊でメイン州に出撃せよ。";
  node("clear-label").textContent = "制圧した州";
}
node("target-index").textContent = (conquered ? "最終拠点" : "攻略目標") + "　" + String(nextBase.frontNumber).padStart(2, "0") + " / " + stages.length;
node("target-place").textContent = nextBase.name;
const targetLevel = node("target-enemy-level");
if (targetLevel && Number.isFinite(nextBase.averageEnemyLevel)) targetLevel.textContent = enemyLevelLabel(nextBase.averageEnemyLevel);
node("target-landmark").textContent = nextBase.landmark;
node("target-scenery").src = "preview/media/" + nextBase.image;
if (conquered) {
  node("title").textContent = "全戦線制圧";
  document.querySelector(".objective").textContent = "日米全97拠点を制圧。両戦線に再出撃して、残る勲章を獲得できます。";
  node("launch").firstChild.data = "最終拠点に再戦 ";
}
if (!profile.slots.some(Boolean)) node("launch").firstChild.data = "出撃部隊を編成 ";
node("clear-stat").replaceChildren(document.createTextNode(front.cleared.length + " "), element("small", "/ " + stages.length));
node("clear-meter").max = stages.length;
node("clear-meter").value = front.cleared.length;
node("medal-stat").textContent = medals;
node("unit-stat").textContent = profile.members.length;
let midnightTimer;
function showDaily() {
  const now = new Date();
  const day = FieldOrders.dayKey(now);
  node("drill-date").dateTime = day;
  node("drill-date").textContent = day.slice(5).replace("-", ".");
  node("drill-title").textContent = FieldOrders.daily(day).name;
  node("drill-brief").textContent = profile.exercise?.day === day
    ? "本日の自己ベスト　" + profile.exercise.best.toLocaleString("ja-JP") + " 点" : "貸与部隊で挑む、90秒の拠点戦。";
  clearTimeout(midnightTimer);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  midnightTimer = setTimeout(showDaily, tomorrow - now + 50);
}
syncLinks();
showDaily();
window.addEventListener("focus", () => {
  if (hq.sync()) GamePlayers.refresh();
  else showDaily();
});
function note(heading, body) {
  const item = element("div");
  item.append(element("strong", heading), element("p", body));
  return item;
}
function keyReference() {
  const list = element("dl");
  list.className = "records key-reference";
  for (const [label, keys] of [["次・前の項目", ["J", "K"]], ["値の変更", ["A", "D"]], ["決定", ["Enter", "Space"]], ["戻る", ["F"]]]) {
    const caps = element("dd");
    caps.append(...keys.map(key => element("kbd", key)));
    list.append(element("dt", label), caps);
  }
  return list;
}
node("open-help").addEventListener("click", () => openPanel("遊び方",
  keyReference(),
  note("敵拠点を制圧する", "お題をローマ字で打つと出撃コストが増えます。オート召喚で味方が進軍し、敵拠点のHPを0にすると勝利です。"),
  note("号令を選ぶ", "お題を打ち切ると指揮ゲージが1つ、ノーミスなら2つたまります。6つで「総攻撃」か「補給」を発令できます。"),
  note("部隊を育てる", "勝つと経験値を獲得し、初回制圧で門番が仲間になります。部隊編成で出撃枠と育成する仲間を選べます。")));
node("open-records").addEventListener("click", () => {
  const list = element("dl");
  list.className = "records";
  for (const [label, value] of [["日本の制圧拠点", profile.cleared.length + " / 47"], ["アメリカの制圧拠点", americaOpen ? front.cleared.length + " / 50" : "日本制圧で解放"],
    ["獲得勲章", medals + " / " + commandData.stages.length * 3], ["加入した仲間", profile.members.length + " / " + commandData.roster.length],
    ["勝利時の最高打鍵速度", Math.max(0, ...records.map(r => r.kpm)) + " 打/分"]]) {
    list.append(element("dt", label), element("dd", value));
  }
  openPanel("戦績", list, note("拠点ごとの勲章", "「制圧」は勝利、「精密」は3語以上を打ち切り正確率95%以上で勝利、「指揮」は号令を使って勝利すると獲得できます。"));
});
