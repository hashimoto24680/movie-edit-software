# Movie Edit Software 企画書

## 概要

人間が GUI で直感的に編集でき、LLM エージェントも同じ編集状態を安定して操作できる動画編集ソフトを作る。

既存の動画編集ソフトは、タイムライン GUI を人間が操作する前提で作られている。一方、LLM に既存 GUI を直接クリックさせる方式は遅く、壊れやすく、編集意図の再現性も低い。

この企画では、GUI の背後に動画編集プロジェクトを表す中間表現を置く。人間は GUI を編集し、LLM は中間表現を編集する。両者が同じ状態を読み書きすることで、AviUtl や Premiere Pro のような操作感と、エージェントによる自動編集のしやすさを両立する。

## コンセプト

一言で言うと、**GUI 付きの MNP 型動画編集ソフト**。

- 人間向けには、タイムライン、プレビュー、素材ビン、字幕エディタを持つ。
- LLM 向けには、動画編集状態を DSL または構造化 JSON として公開する。
- GUI 操作は内部状態へ反映され、内部状態はいつでも LLM 用の中間記法へ serialize できる。
- LLM が返した編集結果は parse / validate され、タイムライン GUI とプレビューへ反映される。
- 最終レンダーは Remotion と FFmpeg を使い分ける。

## 背景

### 既存の動画編集ソフトの限界

Premiere Pro、DaVinci Resolve、AviUtl などは強力だが、LLM エージェントにとっては操作対象が大きすぎる。

- 画面座標ベースの GUI 操作は不安定。
- 操作履歴やプロジェクト構造を LLM が把握しにくい。
- 「この字幕を短くして」「無音を詰めて」のような意味単位の編集を、GUI 操作列へ変換するのが重い。
- エージェントが失敗したときに差分確認やロールバックが難しい。

### Remotion の位置づけ

Remotion は、React コンポーネントをフレーム単位で描画して動画にする仕組み。CLI で動く動画編集ソフトというより、コードで動画を定義するレンダリング基盤に近い。

強い領域:

- テロップ、字幕、モーショングラフィックス
- テンプレート動画
- React / TypeScript によるプログラム生成
- LLM がコードや props を編集するワークフロー

弱い領域:

- 長尺動画を全フレーム Remotion で描画する処理
- GUI タイムラインによる人間向け編集
- 大量素材の手作業編集

そのため、このソフトでは Remotion を「編集 GUI そのもの」ではなく、プレビューや装飾レンダーの一部として使う。切り貼りや長尺合成は FFmpeg を併用する。

### MNP との接続

中間記法パターンでは、AI に GUI を直接操作させず、GUI の背後にある意味状態を DSL 化し、AI にはその DSL を編集させる。

動画編集に置き換えると、タイムライン上のクリップ、字幕、音声、エフェクト、トランジション、レンダー設定を中間表現として持つ。その中間表現を人間 GUI と LLM の共通インターフェースにする。

## 目指す体験

### 人間の操作

- 素材を読み込む。
- タイムラインにドラッグする。
- クリップを分割、トリム、移動する。
- 字幕を直接編集する。
- BGM 音量やフェードを調整する。
- プレビューで確認する。
- MP4 として書き出す。

### LLM エージェントの操作

ユーザーは自然言語で指示する。

- 「無音部分を詰めて、テンポをよくして」
- 「冒頭 5 秒にタイトルを入れて」
- 「字幕を読みやすい長さに分割して」
- 「この説明が長いところを 30 秒以内に収めて」
- 「BGM を声にかぶらないように下げて」
- 「YouTube Shorts 用に 9:16 で切り抜いて」

LLM は GUI を触らず、現在の中間表現を読み、編集後の中間表現または編集コマンドを返す。

## MVP

最初の MVP は「実用的なショート動画編集」に絞る。

### 対象

- 1 本から数本の動画素材
- 1 つの BGM
- 字幕付き動画
- 1 分から 10 分程度の動画

### 必須機能

- 素材インポート
- タイムライン表示
- クリップの分割、トリム、移動
- 字幕トラック
- BGM トラック
- プレビュー
- LLM チャットパネル
- 中間表現の表示と保存
- MP4 書き出し

### 現在の実装メモ

- デスクトップアプリとして `npm run desktop` で起動できる Electron シェルを持つ。
- タイムラインは AviUtl の拡張編集に近い汎用レイヤー方式で、動画・画像・音声・テキストを同じ種類のレイヤーへ配置できる。
- クリップ種別は色で区別し、同一レイヤー内の重なりは reducer / validator で拒否する。
- タイムラインの縮尺は、最小で画面幅あたり約 4 時間、最大で 60fps 換算約 5 フレーム相当まで変更できる。
- 素材追加ボタンから動画、画像、音声ファイルを読み込める。GIF は画像素材として読み込み対象に含める。
- テキストはプロパティから本文、フォント、サイズ、文字色、背景、太字/斜体、揃え、線幅、行間を編集できる。
- 書き出しボタンは FFmpeg renderer manifest と実行用コマンドファイルを保存する。実MP4合成は renderer 実装の次フェーズ。

### MVP でやらないこと

- 高度なカラーグレーディング
- 複雑な合成
- マルチカム編集
- 本格的な音声ミキシング
- チーム共同編集
- プラグイン市場

## 中間表現

内部状態は JSON/AST として持つ。LLM に渡すときは、人間にも読める短い DSL に serialize する。

### 例

```text
project "sample-short"
size 1080x1920
fps 30

asset v1 video "talk.mp4"
asset bgm audio "bgm.wav"

track video main:
  clip c1 asset=v1 in=00:00:12.000 out=00:00:25.000 at=00:00:00.000
  clip c2 asset=v1 in=00:01:03.000 out=00:01:18.000 at=00:00:13.000

track audio music:
  audio a1 asset=bgm at=00:00:00.000 out=00:00:28.000 volume=0.18 fade_in=1.0 fade_out=2.0

track caption ja:
  caption s1 at=00:00:02.000 dur=2.4 text="今日は動画編集ソフトの話をします" style=bottom
  caption s2 at=00:00:04.600 dur=2.0 text="AI がタイムラインを直接触らない設計です" style=bottom
```

### 設計方針

- 時刻は内部では frame または millisecond に正規化する。
- DSL は LLM が読みやすいように短く保つ。
- GUI 表示用の座標や一時状態は、必要がなければ LLM に渡さない。
- 編集操作後は必ず validate する。
- 破壊的変更の前には差分を表示する。

## LLM 操作方式

LLM への入出力は 2 種類を使い分ける。

### 1. 全体更新

小さいプロジェクトでは、現在の DSL 全体を渡して、更新後 DSL を返させる。

向いている操作:

- 字幕の整理
- タイトル追加
- 短いタイムラインの再構成
- スタイル一括変更

### 2. 編集コマンド

大きいプロジェクトでは、差分操作だけを返させる。

例:

```xml
<message>冒頭の無音を詰め、字幕を 2 件追加しました。</message>
<operations>
  <trim clip="c1" start="00:00:03.000" />
  <add_caption at="00:00:00.500" dur="2.0" text="AI で動画編集を速くする" style="title" />
  <set_volume target="a1" volume="0.15" />
</operations>
```

向いている操作:

- 長尺動画
- 複数素材
- 一部だけの修正
- Undo / redo をきれいに持ちたい場合

## アーキテクチャ

```text
Desktop / Web UI
  - Timeline
  - Preview
  - Asset Bin
  - Caption Editor
  - LLM Chat

Project Core
  - Project AST
  - Parser
  - Serializer
  - Validator
  - History / Undo
  - Diff Viewer

AI Layer
  - Prompt Builder
  - Context Trimmer
  - Operation Parser
  - Policy / Safety Check

Render Layer
  - Remotion Preview / Motion Graphics
  - FFmpeg Trim / Concat / Encode
  - Subtitle Burn-in
```

## Remotion と FFmpeg の使い分け

### Remotion を使う場面

- 動くテロップ
- タイトルアニメーション
- 図解オーバーレイ
- React コンポーネントで表現しやすい画面
- フレーム単位のプレビュー

### FFmpeg を使う場面

- 動画のトリム
- 無音カット
- concat
- 音声正規化
- 字幕焼き込み
- 長尺動画の高速エンコード

### 方針

全フレームを常に Remotion で描画する設計にはしない。編集構造は独立した Project AST に持ち、レンダー時に Remotion 向け構成と FFmpeg 向け構成へ変換する。

## UI 方針

### メイン画面

- 左: 素材ビン
- 中央上: プレビュー
- 中央下: タイムライン
- 右: プロパティ
- 右下またはドック: LLM チャット

### タイムライン

- 汎用レイヤーに video / audio / caption / title などを混在配置する。
- クリップは安定した ID を持つ。
- LLM が変更した箇所はハイライトする。
- 操作前後の差分を確認できる。

### LLM チャット

- 送信は Ctrl + Enter。
- IME 入力中の誤送信を防ぐ。
- 生成中はキャンセルできる。
- 返答は「説明」と「適用される変更」を分けて表示する。
- 自動適用と確認後適用を切り替えられる。

## 重要な設計原則

### 1. GUI を真実の源泉にしない

GUI は Project AST の表示であり、真実の源泉は内部状態に置く。

### 2. LLM に画面座標を触らせない

LLM はクリップ ID、時刻、字幕 ID、トラック ID を操作する。

### 3. Validate できない変更は適用しない

以下のような変更は拒否または修正候補として表示する。

- 存在しない asset を参照する。
- duration が負になる。
- クリップが素材長を超える。
- 字幕が空文字になる。
- 音量が範囲外になる。

### 4. 差分を人間が見られるようにする

LLM 編集は便利だが、勝手に壊すと信頼が落ちる。適用前に変更点を確認できる UI を用意する。

### 5. レンダリング基盤に依存しすぎない

Remotion でも FFmpeg でも出力できるように、中間表現を独立させる。

## ロードマップ

### Phase 1: コア設計

- Project AST の型定義
- DSL の初版
- Parser / Serializer
- Validator
- JSON 保存と読み込み

### Phase 2: 最小 GUI

- 素材インポート
- タイムライン表示
- クリップ移動、トリム、分割
- プレビュー
- 保存と読み込み

### Phase 3: LLM 編集

- 現在状態の serialize
- システムプロンプト
- XML 風レスポンスの抽出
- 編集後 DSL の parse
- 差分表示
- 適用 / 取り消し

### Phase 4: レンダー

- FFmpeg によるトリム / concat / encode
- Remotion によるテロップ / タイトル描画
- 字幕焼き込み
- 代表フレーム確認

### Phase 5: 実用化

- 無音検出
- 自動字幕分割
- ショート動画切り抜き
- プロジェクトテンプレート
- 操作ログ
- エラー復旧

## 初期ユースケース

### 1. 講義動画の短縮

長い講義動画から、無音や重複説明を詰め、字幕を整える。

### 2. YouTube Shorts / TikTok 切り抜き

横動画から見どころを抽出し、9:16 に再構成する。タイトル、字幕、BGM を自動追加する。

### 3. 解説動画テンプレート

資料画像、ナレーション、字幕、簡単な図解を組み合わせて、定型的な解説動画を作る。

### 4. 研究・授業用動画制作

スライド、VOICEVOX 音声、字幕、Remotion 装飾、FFmpeg 高速エンコードを統合する。

## 技術候補

### フロントエンド

- React
- TypeScript
- Zustand または Jotai
- Timeline 用 Canvas / SVG / DOM 実装
- Remotion Player

### デスクトップ化

- Tauri
- Electron

最初は Web アプリとして作り、ローカルファイル操作が必要になった段階で Tauri または Electron を検討する。

### レンダー

- FFmpeg
- Remotion
- Mediabunny

### LLM 接続

- OpenAI API
- Claude API
- ローカル LLM
- LLM CLI / MCP / local agent からの外部操作

## 競合との差別化

### Premiere Pro / DaVinci Resolve

プロ向け機能では勝たない。LLM が構造的に操作できることを差別化する。

### AviUtl

軽さや拡張性の思想は近い。違いは、エージェント操作を前提に Project AST と DSL を最初から設計する点。

### CapCut

自動字幕やショート動画編集では競合する。違いは、内部状態をユーザーと LLM が読める形で開くこと。

### Remotion

Remotion はコード動画生成基盤。この企画は GUI 編集と LLM 編集を両立する上位アプリケーション。

## リスク

### タイムライン GUI の実装負荷

動画編集 GUI は想像以上に細かい。最初は機能を絞り、ショート動画編集に限定する。

### LLM の編集ミス

中間表現を validate し、差分確認を必須にする。自動適用は安全な操作に限定する。

### レンダーの重さ

Remotion と FFmpeg を適切に分担する。長尺動画は FFmpeg 中心にする。

### DSL の肥大化

プロジェクトが大きくなったら、全体 DSL ではなく必要部分だけを渡す編集コマンド方式へ移行する。

## 最初に作るもの

1. `Project AST` の TypeScript 型
2. DSL の parser / serializer
3. `.mesproj` 保存と読み込み
4. クリップ 2 本、字幕 2 件、BGM 1 本を表示できるタイムライン
5. LLM なしで DSL 編集から GUI 更新できる確認
6. GUI 操作から DSL が更新される確認
7. LLM に「タイトル追加」「字幕分割」「BGM 音量変更」だけを任せる確認

## 実装ステータス（2026-06-02）

初期MVPとして、React / TypeScript / Zustand / Zod / Vitest によるWebアプリの骨格を実装した。

### 実装済み

- `schemaVersion` 付き Project AST。
- 任意数 `Track[]`、`video` / `audio` / `caption` / `overlay` / `adjustment` のtrack種別。
- `StaticOrKeyframed<T>` による静的値・キーフレーム値の共通表現。
- `EffectNode[]` を clip / track に保持し、未対応effectも保存して警告できる設計。
- `media` / `caption` / `title` / `composition` のclip種別。`composition` は将来のネストコンポ用に予約。
- Zod schema、legacy project migration、canonical JSON serializer。
- GUI / LLM / script が共通で通る純粋 command reducer。
- command log + checkpoint 型のhistory/undo/redo。
- LLM command parser と自然文LLM接続入口。
- FFmpeg renderer interface と deterministic manifest generation。
- 素材ビン、プレビュー、任意trackタイムライン、プロパティ、LLMCG指示欄、プロジェクトパネル。
- キャンバス解像度の変更UI。9:16 / 16:9 / 1:1 / 4:5 プリセットと任意の `width x height` を指定できる。
- 選択クリップの配置・拡大縮小・透明度・回転を `transform` として編集できるプロパティ。
- プレビューは固定9:16ではなく、Project AST の `render.size` に従って縦型・横型・正方形などのキャンバス比率を表示する。
- AviUtl風の汎用レイヤータイムライン。動画・音声・字幕・タイトルをどのレイヤーにも配置でき、種類は色で区別する。
- タイムライン上のオブジェクトをドラッグして時間・レイヤー移動できる。マウスカーソルに最も近いレイヤーへ真横に追従する。
- タイムライン上のオブジェクト移動とプレイヘッド移動は、他オブジェクトの開始/終了境界へ近づくとスナップする。
- タイムラインは縮尺スライダーで横方向の秒単位スケールを変更できる。
- タイムライン上のオブジェクトは角丸なしの長方形で表示し、背景の等間隔縦線は表示しない。
- 同じレイヤー上で複数オブジェクトの時間範囲が重なる配置はvalidationで拒否する。
- 新規テキストは、現在の時間で重ならない空きレイヤーへ自動配置する。字幕/タイトル追加ボタンは「テキスト」に統合する。
- タイムラインに選択中フレームを示す縦線プレイヘッドを表示し、ルーラー/空きレーンのドラッグやオブジェクトクリックで移動できる。
- 縦線プレイヘッドはタイムライン上のオブジェクト移動には追従せず、全レイヤーを横断する1本の線として表示する。
- ルーラーとレーン本体は同じ時間座標で揃え、秒数表示と縦線の横ズレを避ける。
- レイヤー名はカタカナ表記に統一し、レイヤー左側のアイコンは表示しない。
- 素材一覧は1行1素材で表示し、現在の編集シーケンスも素材一覧に含める。
- プレビュー上のオブジェクトをドラッグして配置変更できる。Ctrlを押しながらドラッグすると横/縦方向ロックになる。
- シーケンス設定は常時表示ではなく、トップバーの「シーケンス設定」から変更する。
- `.mesproj` 形式のプロジェクト保存/読み込み。Electronデスクトップ版ではOSのファイルダイアログを使う。
- Electronによる独立デスクトップアプリ起動。

### 実行

```bash
npm install
npm run dev -- --port 5173
npm run desktop
npm test
npm run build
```

`npm run dev` は開発確認用のブラウザプレビュー。通常のアプリとして使う場合は `npm run desktop` でElectronウィンドウを起動する。

### 検証済み

- `npm test`: 10 tests passed。
- `npm run build`: TypeScript check と Vite production build が成功。
- Browser で `http://127.0.0.1:5173` を開き、主要パネル表示、LLM差分生成、差分適用、FFmpeg manifest生成、コンソールエラーなしを確認。
- 2026-06-02追記: 16:9プリセット、1280x720カスタム解像度、選択クリップのX位置変更がプレビューとASTに反映されることをBrowserで確認。`npm test` は 7 tests passed。
- 2026-06-02追記: 汎用Layerタイムライン、色分けオブジェクト、シーケンス設定モーダル、保存/読み込みUI、自然文LLMCG指示欄、Electron起動スクリプトを追加。`npm test` は 9 tests passed。
- 2026-06-02追記: 素材1行表示、タイムライン縦線プレイヘッド、最寄りレイヤーへの真横ドラッグ追従、同一レイヤー重なり拒否、新規オブジェクトの空きレイヤー配置、高度なJSON/コンテキスト/音声/デモ操作の非表示化を追加。`npm run build` 成功。
- 2026-06-02追記: 縦線プレイヘッドをオブジェクトドラッグ非追従にし、全レイヤー横断表示へ変更。ルーラーとレーンの時間座標を揃え、レイヤー表記をカタカナへ統一。`npm test` は 9 tests passed、`npm run build` 成功。
- 2026-06-02追記: タイムラインの境界スナップ、スナップガイド線、縮尺スライダー、角丸なしオブジェクト、背景縦線削除、上部フレーム状態表示削除、テキスト追加ボタン統合、プロパティ名称変更、共通テキスト更新commandを追加。`npm test` は 10 tests passed、`npm run build` 成功。

## 参照ナレッジ

- `C:\Users\denjo\Dropbox\wiki\中間記法パターン（MNP）.md`
- `C:\Users\denjo\Dropbox\wiki\VOICEVOX・Remotion長尺授業動画ワークフロー.md`
