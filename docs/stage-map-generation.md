# 打鍵戦線の地形マップ生成

行政境界と公開標高データを同じピクセル格子に載せ、土地があるセルだけを標高に応じた高さまで積む。地方は別々にPNGへ書き出し、地図全体では共通の座標で重ねる。HTMLには素材を埋め込むので、ブラウザーで開いたあとの地図操作はオフラインで行える。 [日本戦区](../preview/japan-stage-map.html)・[アメリカ戦区](../preview/usa-stage-map.html)

## 再生成する

作業フォルダーのルートで実行する。下の組み合わせで確認した。

| ソフトウェア | 確認したバージョン |
| --- | --- |
| Node.js | 24.18.0 |
| Python | 3.14.7 |
| NumPy / Pillow | 2.4.6 / 13.0.0 |
| Playwright | 1.65.1、Chromiumを使用 |

初回はPythonとChromiumの実行環境を用意する。以下はWindowsのPowerShell 7での手順。

```powershell
python -m venv .codex-temp/stage-map-python
$stageMapPython = Join-Path (Get-Location) '.codex-temp/stage-map-python/Scripts/python.exe'
& $stageMapPython -m pip install numpy==2.4.6 Pillow==13.0.0

$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.codex-temp/stage-map-browsers'
npm.cmd install --prefix .codex-temp/stage-map-runtime playwright@1.65.1
& '.\.codex-temp\stage-map-runtime\node_modules\.bin\playwright.cmd' install chromium
```

同じターミナルで、入力を取得してから地図を生成する。

```powershell
& $stageMapPython -B tools/stage-map/sources.py japan download
& $stageMapPython -B tools/stage-map/sources.py usa download

node tools/stage-map/build.cjs japan --python $stageMapPython
node tools/stage-map/build.cjs usa --python $stageMapPython
```

取得した境界と標高は `.codex-temp/stage-maps/japan` と `.codex-temp/stage-maps/usa` に保存される。入力が揃っていれば、`build.cjs` はネット接続なしで実行できる。出力先を試作用のフォルダーに変えるときは `--out-dir .codex-temp/map-reproduction` を指定する。既存のPlaywrightとChromiumを使う場合は `--playwright` にパッケージの場所、`--browser` にChromiumの実行ファイルを渡す。

`preview/` に `*-stage-map.html` と `*-map-sprites/` を出力する。後者の `manifest.json` に原典、入力のSHA-256、断面寸法、組み立て座標が入る。標高の配信元が更新されたあとも同じ地形を再現するには、元の標高ファイルと境界ファイルを保管する。同じ門番を再現するには、キャラクター図鑑のIDと抽選のシードも揃える。

## 入力と投影

| 国 | 行政境界 | 標高 | 地形の分け方 |
| --- | --- | --- | --- |
| 日本 | 国土数値情報 N03 2026年版の都道府県別GeoJSON | 地理院タイル DEM10B、ズーム7 | 47都道府県、8地方。地図全体を20°回す |
| アメリカ | 米国国勢調査局 2025年州境KML、1:5,000,000 | USGS 3DEPの浮動小数点GeoTIFF | 50州、6組。連続する48州を国勢調査局の4地域に分け、アラスカとハワイを別縮尺の枠に置く |

取得先と地域の設定は [maps.json](../tools/stage-map/maps.json) にまとめている。 [国土数値情報](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html)・[都道府県別データの配布元](https://geo.maderaojen.me/en/)・[地理院標高タイルの仕様](https://maps.gsi.go.jp/development/demtile.html)・[米国国勢調査局の州境データ](https://www.census.gov/geographies/mapping-files/2025/geo/carto-boundary-file.html)・[米国国勢調査局の地域区分](https://www.census.gov/data/data-tools/survey-explorer/geo.html)・[USGS 3DEP](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services)

1. **境界のIDを揃える。** 日本は都道府県コード、アメリカは州のFIPSコードを使う。外周、内側の穴、島の複数ポリゴンを保った状態で取り込む。
2. **表示用の格子へ投影する。** [geometry.cjs](../tools/stage-map/geometry.cjs) は経度差を中央緯度の余弦で縮め、緯度を画面の下向きが正になるよう変換する。地方間の境界を合わせるには、同じ地続きの地域で中心経緯度、縮尺、原点、回転角を揃える。アラスカでは日付変更線をまたぐ経度を中心経度の近くへ巻き直す。
3. **地図の縮尺に合わせて線を減らす。** 投影後に0.32ピクセルの許容差で輪郭を簡略化し、座標を0.25ピクセルに丸める。描画格子より小さい島や穴を省き、各州・都道府県の中で境界から離れた点を門番位置にする。
4. **同じ格子で標高をサンプリングする。** [sources.py](../tools/stage-map/sources.py) は各ピクセルの中心を経緯度に戻し、周囲の有効な画素から標高を補間する。DEM10BはRGBを符号付きの標高値に戻す。USGSのGeoTIFFは取得時の経緯度範囲と画像の座標タグを照合する。標高の未取得セルは低地の層で描き、件数を集計する。 [USGS標高画像の取得先](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage)

## 断面PNGの作り方

[bake.cjs](../tools/stage-map/bake.cjs) は境界を地方ごとにラスタライズする。同じピクセルに複数の区域が重なる場合は、塗りが占める割合の大きい区域を採用する。海には区域ID `0` を割り当てるので、標高が0m付近の陸と海を分けられる。

陸の各セルについて、標高帯を `floor(max(0, 標高) / 1段あたりのメートル数)` で求める。最高面のインデックスは `baseLand + 標高帯`。層0から最高面までの各断面にそのセルを描く。上面に隣接セルとの高低差から陰影をつけ、側面と土台は別の色で描く。

| 設定 | 日本 | アメリカ |
| --- | ---: | ---: |
| 標高の1段 | 250 m | 350 m |
| 海抜0mの上面インデックス `baseLand` | 4 | 4 |
| PNGに並べる断面数 `layers` | 20 | 24 |
| 1層ごとの画面上の持ち上げ量 `spacing` | 2.4 | 2.5 |
| 奥行きの縮小率 `pitch` | 0.85 | 0.85 |

`spacing` は拡大前の地図ピクセル単位。値を大きくすると、標高帯の段差が強調される。`elevationStepMetres` を小さくすると段数が増える。山の上部を残すには、最大の標高帯が `layers - baseLand - 1` に収まるかも見る。粗い入力格子で平均化された山頂は、断面だけ細かくしても戻らない。

1枚のPNGに、幅 `W`・奥行き `D` の断面を足元から上へ左詰めで並べる。PNG全体は `W × layers` ピクセルの幅、`D` ピクセルの高さになる。層 `z` の切り出しは `(z × W, 0, W, D)`。各地方の `worldOrigin` に置き、地図全体で同じ高さの断面を描いてから次の層へ進むと、地方をまたぐ斜面でも前後が揃う。 [Sprite Stacking](https://github.com/danielwh2/sprite-stacking)

## ステージを重ねる

- **色と選択** HTMLは各セルの区域ID、標高帯、陰影を持つ。区域IDを使って占領中と解放済みの色を塗り替える。選択時の縁取りは実際に見えている面の輪郭から作る。クリック判定も上の層から調べるため、手前の斜面で隠れた区域は選択から外れる。
- **門番** [キャラクター図鑑](../preview/character-roster.html) の描画処理から、門番の画像を1枚のアトラスに焼く。初期手持ちの5体を候補から外し、`seed` を使って重複なく選ぶ。各地方の `ids` の最後をボスとして、複合タイプを割り当てる。日本は通常ステージで単タイプを優先する。アメリカは日本に置いた門番も候補から外す。
- **別枠** 地続きの地方は共通の座標で置く。離れた領域を別枠に入れるときは、`grid` に中心経緯度、縮尺、表示範囲と組み立て座標を設定する。アラスカとハワイはこの方法で並べている。

今回のアメリカ版では、初期手持ちと日本の門番を除いた候補が複合タイプだったため、50州の門番はすべて複合タイプになった。

## 別の地域に応用するとき

1. 公開境界と標高を選び、版、取得先、利用条件を記録する。境界を `id`・`name`・`geometry` の組に変換し、同じIDを地方の `ids` に登録する。
2. 標高をメートル単位の値と欠測の区別に変換する。海岸や別枠の周囲で陸の標高が拾えているかを見る。
3. 全国表示で地形の輪郭が分かり、地方表示で尾根と平地の段差が見える縮尺を選ぶ。1層の高さ、標高帯の幅、総層数の順に調整すると違いを追いやすい。
4. 全区域に陸地があり、門番の足元がその区域に入っているか確かめる。ブラウザーでは拡大・移動、地方表示、区域選択、解放色、選択の縁取りを試す。既存地図の再生成ではPNGの寸法とSHA-256、門番のIDと座標を比較する。

日本の既存素材をこの手順で再生成し、8枚すべての積層PNGのSHA-256、47体の門番と配置、門番アトラスが一致することを確認した。
