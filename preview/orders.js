"use strict";

const FieldOrders = (() => {
  const words = lines => lines.trim().split(/\s+/).map(pair => pair.split("/"));
  const short = words(`
    前へ/まえへ 守れ/まもれ 進め/すすめ 合図/あいず 盾/たて 旗/はた
    門/もん 援護/えんご 部隊/ぶたい 前線/ぜんせん 指揮/しき 作戦/さくせん
    補給/ほきゅう 集合/しゅうごう 守備/しゅび 交代/こうたい 照準/しょうじゅん
    点呼/てんこ 確保/かくほ 待機/たいき 攻勢/こうせい 増援/ぞうえん
  `);
  const field = words(`
    隊列を組め/たいれつをくめ 持ち場につけ/もちばにつけ 信号を送れ/しんごうをおくれ
    門を開け/もんをあけ 旗を掲げろ/はたをかかげろ 橋を守れ/はしをまもれ
    援護を頼む/えんごをたのむ 道を開け/みちをあけ 前列を交代/ぜんれつをこうたい
    報告を待つ/ほうこくをまつ 陣形を保て/じんけいをたもて 合図を待て/あいずをまて
    右へ展開/みぎへてんかい 左へ展開/ひだりへてんかい 予備隊を呼べ/よびたいをよべ
    次の部隊へ/つぎのぶたいへ 通信良好/つうしんりょうこう 配置完了/はいちかんりょう
  `);
  const columns = {
    advance: words(`速攻/そっこう 先頭/せんとう 先陣/せんじん 突破/とっぱ 一気に進め/いっきにすすめ 先手を取れ/せんてをとれ 隙を突け/すきをつけ 足並みをそろえろ/あしなみをそろえろ 突破口を開け/とっぱこうをひらけ`),
    guard: words(`防壁/ぼうへき 砦/とりで 門番/もんばん 城壁/じょうへき 壁を築け/かべをきずけ 盾を並べろ/たてをならべろ 前線を支えろ/ぜんせんをささえろ 拠点を固めろ/きょてんをかためろ 修復を急げ/しゅうふくをいそげ`),
    range: words(`後列/こうれつ 射程/しゃてい 高台/たかだい 遠方/えんぽう 距離を保て/きょりをたもて 後列を守れ/こうれつをまもれ 標的を確認/ひょうてきをかくにん 視界は良好/しかいはりょうこう 前衛を援護/ぜんえいをえんご`),
    support: words(`支援/しえん 通信/つうしん 救援/きゅうえん 妨害/ぼうがい 足止め/あしどめ 物資を運べ/ぶっしをはこべ 補給班を呼べ/ほきゅうはんをよべ 交代を知らせろ/こうたいをしらせろ 集中を切らすな/しゅうちゅうをきらすな`),
    siege: words(`包囲/ほうい 城門/じょうもん 攻城/こうじょう 制圧/せいあつ 一斉攻撃/いっせいこうげき 敵陣を崩せ/てきじんをくずせ 攻勢に出ろ/こうせいにでろ 前線を押し上げろ/ぜんせんをおしあげろ 守備隊を分けろ/しゅびたいをわけろ`),
  };
  const rolePack = {m: "advance", r: "advance", s: "advance", w: "guard", b: "guard",
    l: "range", u: "range", c: "support", h: "siege", a: "siege"};
  const bossWords = words(`総攻撃/そうこうげき 本陣/ほんじん 反攻/はんこう 決戦/けっせん 増援に備えろ/ぞうえんにそなえろ 最後の防衛線/さいごのぼうえいせん 本陣を制圧/ほんじんをせいあつ 全隊前進/ぜんたいぜんしん`);

  function deck(stage, role, seed) {
    const pool = [...short, ...columns[rolePack[role] ?? "guard"]];
    if (stage.number > 2) pool.push(...field);
    if (stage.boss) pool.push(...bossWords);
    let bag = [];
    let last;
    function next() {
      if (!bag.length) {
        bag = pool.slice();
        for (let i = bag.length - 1; i > 0; i--) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          const j = Math.floor((seed / 4294967296) * (i + 1));
          [bag[i], bag[j]] = [bag[j], bag[i]];
        }
        if (bag[bag.length - 1] === last) [bag[0], bag[bag.length - 1]] = [last, bag[0]];
      }
      last = bag.pop();
      return last;
    }
    if (stage.number === 1) last = short[0];
    return {first: last ?? next(), next};
  }

  function dayKey(date = new Date()) {
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map((part, i) => i ? String(part).padStart(2, "0") : String(part)).join("-");
  }
  function daySeed(day) {
    let hash = 2166136261;
    for (const ch of day) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
    return hash >>> 0;
  }
  const drills = [
    {name: "密集陣を崩せ", enemy: "rush", ally: "area"},
    {name: "城門を突破せよ", enemy: "guard", ally: "siege"},
    {name: "前衛を押し返せ", enemy: "siege", ally: "rush"},
    {name: "後列を守り抜け", enemy: "area", ally: "guard"},
  ];
  function daily(day) {
    const seed = daySeed(day);
    return {...drills[seed % drills.length], seed, day, limit: 90};
  }
  const fullCharge = 6;
  function scorecard() {
    return {correct: 0, misses: 0, words: 0, clean: true, chain: 0, longest: 0, charge: 0, orders: 0};
  }
  function strike(score, result) {
    if (!result.accepted) {
      score.misses++;
      score.clean = false;
      score.chain = 0;
      return;
    }
    score.correct++;
    if (!result.completed) return;
    score.words++;
    score.chain = score.clean ? score.chain + 1 : 0;
    score.longest = Math.max(score.longest, score.chain);
    score.charge = Math.min(fullCharge, score.charge + (score.clean ? 2 : 1));
    score.clean = true;
  }
  function metrics(score, seconds) {
    const total = score.correct + score.misses;
    const accuracy = total ? Math.floor(100 * score.correct / total) : 0;
    return {accuracy, kpm: seconds > 0 ? Math.round(score.correct * 60 / seconds) : 0,
      precision: score.words >= 3 && accuracy >= 95, command: score.orders > 0};
  }
  return {deck, dayKey, daily, fullCharge, scorecard, strike, metrics};
})();
if (typeof module !== "undefined") module.exports = FieldOrders;
