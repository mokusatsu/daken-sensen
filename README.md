# 打鍵戦線

タイピングで部隊を出撃させるタワーディフェンスの試作。

## デモ

- [キャラクター図鑑](preview/character-roster.html)
- [編成](preview/formation-demo.html)
- [バトル](preview/battle-demo.html)
- [日本マップ](preview/japan-stage-map.html)・[アメリカマップ](preview/usa-stage-map.html)

各デモは必要な素材をHTMLに埋め込んでいるので、ブラウザーで直接開ける。マップの積層PNGも `preview/` に置く。

## 更新

[地形マップ生成](docs/stage-map-generation.md)の手順でPlaywrightとChromiumを用意すると、図鑑と日本マップから編成・バトルのHTMLを再生成できる。既存環境を使う場合は、両方のコマンドに `--playwright` と `--browser` を指定できる。

~~~text
node tools/preview/build-formation.cjs
node tools/preview/build-battle.cjs
~~~

[ゲーム進行](docs/game-lifecycle.md)・[バトル仕様](docs/battle-spec.md)・[役割とバランス](docs/battle-balance.md)
