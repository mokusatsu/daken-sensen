# 打鍵戦線

**[作戦本部からゲームを始める](https://mokusatsu.github.io/daken-sensen/)**

ローマ字で指令を打ち、部隊を送り出す拠点攻略ゲーム。沖縄から日本の全47拠点を制圧すると、アメリカ戦線が解放される。育てた部隊でメイン州からハワイ州まで全50州に挑める。敵拠点のHPを0にすると勝利し、各拠点の初回制圧で門番が仲間になる。作戦本部には、次に攻略する拠点の風景と名所名が表示される。

公開版はブラウザーでそのまま遊べる。ダウンロードして遊ぶ場合は、フォルダー構成を保ったまま `index.html` を開けばオフラインでも遊べる。起動時と再読み込み時にユーザー名を選ぶか、新しいユーザーを作成する。攻略状況、部隊、勲章、演習記録、音量はこのブラウザーにユーザー別で保存される。作戦本部の「ユーザー切替」、または戦闘中の「戦況・設定」から交代できる。以前のセーブは「これまでの記録」から再開できる。

## 戦い方

| 操作 | 効果 |
| --- | --- |
| 本部の `A` ／ `S` ／ `D` ／ `L` | 戦区マップ ／ 前線へ出撃 ／ 編成・育成 ／ 図鑑 |
| `J`・`K` ／ Enter・Space ／ `F` | 次・前の項目 ／ 決定 ／ 戻る |
| 選択欄の `A`・`D`（`H`・`L`でも可） | 拠点、絞り込み条件、音量の変更 |
| 戦闘中の Space | 一時停止。停止中は `A` で総攻撃、`D` で補給、`F` で再開。 |
| お題のローマ字を打つ | 正しい1打で出撃コスト＋18。オート召喚が部隊を送り出す。画面キーでも入力できる。 |
| ノーミスで1語打ち切る | 指揮ゲージ＋2。ミスのある語も完了すると＋1。 |
| `1` 総攻撃 ／ `2` 補給 | ゲージ6で発令。総攻撃は味方の威力を6秒間1.5倍にし、補給は拠点HPを120、コストを90回復する。 |
| カード ／ Shift＋A・S・D・F・G | 指定した編成枠を召喚する。Shift＋Jでオート切り替え。 |
| Esc ／ 一時停止 | 戦いを止めて再開する。「戦況・設定」で音量と指令の位置を調整できる。 |

作戦本部の**日替わり演習**では、日ごとに決まる貸与部隊・相手・指令で90秒の拠点戦に挑戦できる。拠点に与えたダメージ、打鍵成績、制圧までの残り時間で自己ベストを競う。

## ゲームデータの更新

- [日本戦区](preview/japan-stage-map.html)・[アメリカ戦区](preview/usa-stage-map.html)・[キャラクター図鑑](preview/character-roster.html)・[編成の試用](preview/formation-demo.html)・[模擬戦](preview/battle-demo.html)
- [ゲーム進行](docs/game-lifecycle.md)・[戦闘ルール](docs/battle-spec.md)・[役割とバランス](docs/battle-balance.md)・[地図の生成](docs/stage-map-generation.md)

図鑑や日米のマップを更新したら、次のコマンドで配布用データを再生成する。編成・バトルの生成に使うPlaywrightとChromiumは地図生成と共通。既存環境のパスは `--playwright` と `--browser` で指定できる。

~~~text
node tools/preview/build-formation.cjs
node tools/preview/build-battle.cjs
node tools/preview/build-command.cjs
~~~

効果音はLumina SFXのレシピから生成する。再生成にはNode.js 22.12以降を使う。

~~~text
npx skills add LuminaBench/lumina-sfx -g
node tools/sound/build.cjs
~~~
