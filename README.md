# 打鍵戦線

タイピングで部隊を出撃させるタワーディフェンスの試作。

## デモ

- [日本マップ](preview/japan-stage-map.html)から、ステージ情報、編成、出撃、戦闘結果まで進める。初回ガイドもここから開ける。
- [キャラクター図鑑](preview/character-roster.html)
- [編成](preview/formation-demo.html)
- [バトル](preview/battle-demo.html)
- [アメリカマップ](preview/usa-stage-map.html)

`preview/` フォルダ内のHTMLをブラウザーで直接開ける。画像素材はHTMLに埋め込まれ、共通の表示・進行処理も同じフォルダにある。画面はiPad Air第5世代の横向きでスクロールを使わず操作できる構成とする。 [画面構成](docs/screen-flow.md)

## 更新

[地形マップ生成](docs/stage-map-generation.md)の手順でPlaywrightとChromiumを用意すると、図鑑と日本マップから編成・バトルのHTMLを再生成できる。既存環境を使う場合は、両方のコマンドに `--playwright` と `--browser` を指定できる。

~~~text
node tools/preview/build-formation.cjs
node tools/preview/build-battle.cjs
~~~

[ゲーム進行](docs/game-lifecycle.md)・[バトル仕様](docs/battle-spec.md)・[役割とバランス](docs/battle-balance.md)
