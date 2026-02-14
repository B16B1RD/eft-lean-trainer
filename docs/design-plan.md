# EFT リーン操作トレーニングアプリ 設計計画 (v5 — Codex 4thレビュー反映・最終版)

## Context
Escape From Tarkov (EFT) では WASD移動 + Q/Eリーン の組み合わせ操作が重要だが、キーマウ初心者にとって習得が難しい。ジグルピーク、ワイドピーク等の実戦テクニックを安全に反復練習できるWebアプリを作る。

## 技術構成
- **単一HTMLファイル** (HTML + CSS + JavaScript)
- Canvas APIで描画
- 外部依存なし（ブラウザだけで動作）
- ファイル: `/home/akiyoshi/eft-lean-trainer/index.html`
- **論理モジュール分割**: 1ファイル内でもクラスで以下を分離し、各クラスの公開APIを明確化

### リソース責務表

| コンポーネント | 所有者 | ライフサイクル | モード切替時の扱い |
|--------------|--------|-------------|-------------------|
| `InputManager` | App（共有） | アプリ起動〜終了 | キー状態・leanStateをリセット。インスタンス維持 |
| `Renderer` | App（共有） | アプリ起動〜終了 | `render()` に渡す state が変わるだけ。インスタンス維持 |
| `AudioEngine` | App（共有） | アプリ起動〜終了 | モードが `suspend()`/`resume()` で制御。**`destroy()` しない** |
| `GameClock` | App（共有） | アプリ起動〜終了 | モードが `reset()` で再起動。インスタンス維持 |
| `Storage` | App（共有） | アプリ起動〜終了 | 常時利用可能。インスタンス維持 |
| `DrillEngine` | App（共有） | アプリ起動〜終了 | モードが判定関数を呼ぶだけ。インスタンス維持 |
| モード専有リソース | 各モード | `enter()`〜`dispose()` | **`dispose()` で必ず全解放**: タイマーID、イベントリスナー、描画コールバック |

### 公開API一覧
- `InputManager` — `leanState`, `pressedKeys`, `on(event, cb)`, `off(event, cb)`, `resetState()`
- `Renderer` — `render(state)`, `resize()`
- `DrillEngine` — `evaluate(input, expected)`, `getScore()`
- `AudioEngine` — `init()`, `playBeat(time)`, `resume()`, `suspend()`, `isReady()`, `state`
- `GameClock` — `now()`, `elapsed()`, `reset()`
- `Storage` — `load()`, `save(data)`, `clear()`, `migrate()`
- 各モードクラス — 共通インターフェース `ModeLifecycle` を実装

## モードライフサイクル (ModeLifecycle)

全モード共通の状態遷移。モード切替時のリソースリーク防止を保証する。

```
状態: idle → running → paused → running → result → idle
                 ↑                              │
                 └──────── restart ──────────────┘
```

| 状態 | 説明 |
|------|------|
| `idle` | モード未開始。UIは説明/開始ボタン表示 |
| `running` | ドリル実行中。入力受付・判定・描画アクティブ |
| `paused` | 一時停止。タイマー停止、AudioEngine.suspend() |
| `result` | セット完了。スコア表示、リトライ/次へボタン |

### 共通インターフェース
```js
class ModeLifecycle {
  enter()    // モード切替時: UI初期化、idle状態へ
  start()    // 開始ボタン: running状態へ、タイマー開始
  pause()    // Escキー/blur: paused状態へ、タイマー停止、AudioEngine.suspend()
  resume()   // 再開ボタン: running状態へ、タイマー再開、AudioEngine.resume()、timeOffset再計測
  stop()     // 終了/結果表示: result状態へ
  dispose()  // モード離脱時: モード専有リソース全解放（リスナー、タイマーID）
}
```

### モード切替時の処理順序
1. 現モードの `dispose()` 呼出 → モード専有リソース（タイマー・リスナー）を全解除
2. `InputManager.resetState()` — キー状態・leanState をリセット
3. `AudioEngine.suspend()` — 音を止める（destroy しない）
4. 新モードの `enter()` 呼出

## リーン操作モード（設定で切替可能）
- **ホールド式**: キーを押している間だけリーン。離すと戻る
- **トグル式**: Q/Eを1回押すとリーン状態維持。もう1回押すと戻る
- 画面上部の設定トグルで切替

## リーン状態遷移表

`leanState`: `neutral` | `left` | `right`

### ホールド式
| 現在の状態 | イベント | 次の状態 | 備考 |
|-----------|---------|---------|------|
| neutral | Q keydown | left | |
| neutral | E keydown | right | |
| left | Q keyup | neutral | |
| left | E keydown | right | **後押し優先**: 右に切替 |
| right | E keyup | neutral | |
| right | Q keydown | left | **後押し優先**: 左に切替 |
| left | E keydown → Q keyup | right | Eが残るので右維持 |
| right | Q keydown → E keyup | left | Qが残るので左維持 |

### トグル式
| 現在の状態 | イベント | 次の状態 | 備考 |
|-----------|---------|---------|------|
| neutral | Q keydown | left | |
| neutral | E keydown | right | |
| left | Q keydown | neutral | 同キーで解除 |
| left | E keydown | right | **反対キーで直接切替** |
| right | E keydown | neutral | 同キーで解除 |
| right | Q keydown | left | **反対キーで直接切替** |

### 共通ルール
- `event.repeat === true` は**無視**する（長押しで連打扱いにしない）
- `blur` / `visibilitychange` で `leanState = neutral`、全キー状態リセット
- モード切替時は `leanState = neutral` にリセット

## 画面構成
```
┌─────────────────────────────────────────────┐
│ EFT LEAN TRAINER   [Hold/Toggle] [モード▼]  │
├─────────────────────────────────────────────┤
│                                             │
│    ┌─────────────────────────────┐          │
│    │                             │          │
│    │      ゲームビュー (Canvas)    │          │
│    │    上面図: 自キャラ+遮蔽物    │          │
│    │    リーン方向・移動を描画     │          │
│    │                             │          │
│    └─────────────────────────────┘          │
│                                             │
│  ┌────────┐  ┌───────────────────────────┐  │
│  │ [Q]    │  │ ドリル指示 / フィードバック │  │
│  │[W]     │  │ スコア / 反応速度          │  │
│  │[A][S][D]│  │                           │  │
│  │ [E]    │  │                           │  │
│  └────────┘  └───────────────────────────┘  │
│              ┌───────────────────────────┐  │
│              │ KRO診断 / 設定            │  │
│              └───────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## 同時押し判定仕様

複数キーの「同時押し」は物理的に完全同時にならないため、許容窓を設ける。

### 判定ルール
- **同時押し許容窓**: 最初のキーから **80ms以内** に全キーが押されれば「同時」と判定
- **順序非依存**: D→E でも E→D でも同等に扱う
- **判定タイミング**: 最後のキーが押された瞬間に判定確定
- **反応速度の起算**: 指示表示時刻 → 最後のキーが押された時刻

### コンボドリルでの同時判定
- `press` ステップで `keys` が複数の場合、同時押し許容窓を適用
- `release` ステップも同様（80ms以内に全キー離す）

### KRO誤検知の分離
- 同時押し許容窓を超えた場合:
  - 一部キーが検出されている → **ユーザーの操作遅延**（Miss判定）
  - 一部キーが全く検出されない → **KRO制限の可能性**（後述の閾値判定で警告）

## 4つの練習モード

### 1. フリープラクティス
- WASD + Q/E を自由に操作
- 上面図でキャラの移動・リーン角をリアルタイム表示
- 壁・角の遮蔽物を配置し、ピーク動作の感覚を掴む
- **視線レイキャスト判定**: キャラ位置からリーン方向に視線レイを飛ばし、遮蔽物エッジを越えて敵マーカーが見えるか判定
  - 見える → 緑フィードバック + 露出面積％表示
  - 見えない → 赤フィードバック
- 初回起動時に**ウォームアップガイド**表示（各キーの役割を順に説明）

### 2. キー反応ドリル
- 指示が表示される → 正しいキーを押す → 反応速度を計測（`GameClock` 基準）
- レベル段階:
  - Lv1: 単キー（Q, E, W, A, S, D）
  - Lv2: 2キー同時（D+E, A+Q, W+E 等）— 同時押し許容窓80ms適用
  - Lv3: 3キー同時（W+D+E 等）— 同時押し許容窓80ms適用
- 10問1セット、平均反応速度を表示
- **段階的難易度**: Lv1をクリア（平均500ms以下）で自動的にLv2解放
- **KRO警告**: 同時押しが検出されない場合、KRO誤検知閾値（後述）に基づいて警告表示

### 3. コンボドリル（実戦テクニック）
- 各テクニックに説明 + 手本アニメーション付き
- ドリル定義はデータ駆動（JSON形式の内部定義）:
```js
const COMBOS = [
  {
    id: 'jiggle_right',
    name: 'ジグルピーク右',
    steps: [
      { action: 'press', keys: ['KeyE'], maxDuration: 300, simultaneousWindow: 0 },
      { action: 'release', keys: ['KeyE'], maxDuration: 200, simultaneousWindow: 0 }
    ],
    repeatCount: 3,
    description: '右リーンで素早く出入り。EFTの基本テクニック'
  },
  {
    id: 'strafe_peek_right',
    name: 'ストレイフピーク右',
    steps: [
      { action: 'press', keys: ['KeyD', 'KeyE'], maxDuration: 500, simultaneousWindow: 80 },
      { action: 'release', keys: ['KeyD', 'KeyE'], maxDuration: 300, simultaneousWindow: 80 },
      { action: 'press', keys: ['KeyA', 'KeyQ'], maxDuration: 500, simultaneousWindow: 80 },
      { action: 'release', keys: ['KeyA', 'KeyQ'], maxDuration: 300, simultaneousWindow: 80 }
    ],
    repeatCount: 2,
    description: '右移動+右リーンで飛び出し、左で引く'
  },
  // ... 他テクニック
];
```
- 各テクニックの成功判定: 正しいキー順序 + 制限時間内に完了
- テクニックごとに成功率を表示
- **段階的解放**: ジグルピーク → ストレイフピーク → 前進ピーク → 交互ピーク

### 4. リズムドリル
- BPM設定可能（60〜180、デフォルト100）
- **AudioContext管理**:
  - 初回は「START」ボタンでユーザー操作を取得し `audioCtx.resume()`
  - ビート音は **先読みスケジューリング**（100〜200ms先を予約再生）
  - `AudioContext.currentTime` 基準で正確なビート生成
  - **バックグラウンド復帰時**: `visibilitychange` で `document.hidden === false` になったら `audioCtx.state` を確認し、`suspended` なら `audioCtx.resume()` → ドリルは `paused` 状態へ遷移（自動再開しない）
  - **`resume()` 失敗時のフォールバック**: `audioCtx.resume()` は Promise を返す。reject された場合:
    1. ドリルを `paused` 状態に留める
    2. UIに「音声を開始できません。ボタンを押して再開してください」と再開ボタンを表示
    3. ユーザーのクリックイベント内で再度 `audioCtx.resume()` を試行
    4. それでも失敗 → 「音声なしモードで続行しますか？」と選択肢を表示（視覚的ビート表示のみで判定続行）
- パターン例: 拍ごとに E→戻→Q→戻 を繰り返す
- **タイミング判定閾値**（固定値）:
  - Perfect: ±40ms
  - Good: ±90ms
  - Miss: それ以上
  - ※ 固定閾値を採用。BPMが上がると拍間隔が短くなるため、高BPMほど相対的に難しくなる（意図通り）
- **performance.now() ↔ AudioContext.currentTime の突き合わせ**:
  - ビートスケジュールは `AudioContext.currentTime` で予約
  - 入力タイミングは `performance.now()` で記録
  - 突き合わせ: ドリル開始時に `timeOffset = performance.now() - audioCtx.currentTime * 1000` を記録し、判定時に変換
  - **`resume()` 時に `timeOffset` を再計測**（pause中にズレが蓄積するため）
- **ウォームアップ**: 最初の4拍はカウントイン（判定なし）
- **段階的BPM**: 初回60BPMから開始、成功率80%以上で10BPM加速

## キー入力仕様
| キー | `event.code` | アクション |
|------|-------------|-----------|
| W | `KeyW` | 前進 |
| A | `KeyA` | 左移動 |
| S | `KeyS` | 後退 |
| D | `KeyD` | 右移動 |
| Q | `KeyQ` | 左リーン |
| E | `KeyE` | 右リーン |
| Esc | `Escape` | 一時停止（pause） |

- **`event.code` を使用**（`event.key` はIME・キーボード配列の影響を受けるため）
- `keydown` / `keyup` イベントで押下状態を `Set<string>` で管理
- `event.repeat === true` は無視
- 同時押し対応（W+D+E = 右前方移動+右リーン）— 許容窓80ms
- **キー状態リセット条件**:
  - `blur` イベント
  - `visibilitychange` イベント（`document.hidden === true` 時）
  - モード切替時（`InputManager.resetState()` で実行）
- **`preventDefault` 適用範囲**: ゲーム用キー（WASDQE + Space + Escape）のみ。`document.activeElement` が入力欄（input/textarea/select）の場合は抑制しない

## 時間管理 (GameClock)
- 全計測は `performance.now()` 基準で統一
- 描画ループは `requestAnimationFrame`
- 反応速度・コンボ制限時間・リズム判定すべて `GameClock` から取得
- AudioContextのビートは `AudioContext.currentTime` で先読みスケジュール
- **2つの時間軸の突き合わせ**: ドリル開始時 + `resume()` 時に `timeOffset` を記録

## 視線レイキャスト仕様

### 幾何モデル
- **キャラクター**: 中心座標 `(cx, cy)`, 半径 `r = 15px`
- **正面方向**: **Canvas上方向（-Y方向）に固定**。移動やマウスでは変化しない
  - 上面図で「上が正面」という前提。EFTの実戦でも壁を前にして左右にピークする状況を再現
- **リーン時の視点オフセット**: リーン方向に `offsetX = ±20px`（左: -20, 右: +20）
  - 視点座標: `(cx + offsetX, cy)`
- **視野角**: 正面方向（-Y）を基準に左右 `±30°`（計60°の扇形）
  - リーン時: 扇形の中心方向もオフセット方向にわずかに回転（±5°）
- **遮蔽物**: 軸平行矩形 (AABB)。複数配置可。座標 `(x, y, w, h)`
- **敵マーカー**: 円形ヒットボックス、中心 `(ex, ey)`, 半径 `er = 10px`

### 判定アルゴリズム
1. 視点座標から敵中心へのレイを生成
2. レイと全遮蔽物AABBの交差判定（最も近い交差点を取得）
3. 交差点が敵までの距離より近い → **遮蔽**（赤フィードバック）
4. 交差なし、かつ敵が視野角内 → **視認可能**（緑フィードバック）
5. **露出面積％**: 敵円周上の複数サンプル点（16点）からレイを逆に飛ばし、遮蔽されない点の割合

## KRO（キーロールオーバー）診断

### 診断モード
- 設定画面に「キーボード診断」ボタン
- 指示された3キー同時押しを試行 → 全キー検出されたかテスト
- 結果表示: 「**推定**: お使いのキーボードは○キー同時押しまで対応しています」
  - ※ キーマトリクス依存のため完全な判定は不可能であることを明記
- **問題が出やすいキー組み合わせ**: テスト結果で失敗した組み合わせを保存・表示

### ドリル中のKRO警告閾値
- 単発失敗では警告しない（誤検知防止）
- **前提条件**: 同一キー組み合わせの試行が **最低5回以上** に達してから判定開始
- **警告条件**: そのうち **60%以上（例: 5回中3回以上）** でキーが全く検出されなかった場合にKRO警告を表示
- 警告文: 「この組み合わせはキーボードの制限で検出できない可能性があります（推定）」
- 保存済みKRO診断結果がある場合、該当組み合わせと照合して確度を補強

## データ永続化 (localStorage)

### スキーマバージョン管理
- 保存データに `schemaVersion: 1` を含める
- アプリ起動時に `schemaVersion` を確認:
  - **古い場合** (`storedVersion < currentVersion`): マイグレーション実行
  - **未来バージョンの場合** (`storedVersion > currentVersion`): データに触れず読み取り専用で利用。UIに「このデータは新しいバージョンで作成されました。一部機能が正しく動作しない可能性があります。最新版をお使いください」と警告バナーを表示。スコア更新・設定変更は保存しない（上書き防止）
- **マイグレーションマップ**: `fromVersion → 変換関数` の形式
  ```js
  const MIGRATIONS = {
    1: migrateV1toV2,  // schemaVersion 1 → 2 への変換
    2: migrateV2toV3,  // schemaVersion 2 → 3 への変換
    // ...
  };
  ```
- 現行バージョンになるまで順次適用: `v1 → v2 → v3 → ... → current`

### 破損データのフォールバック
- `Storage.load()` で `JSON.parse()` が失敗した場合:
  1. コンソールに警告を出力
  2. 破損データを `eft-lean-trainer-backup-{timestamp}` に退避（タイムスタンプ付きで上書き回避）
  3. バックアップキーは最新3件のみ保持。古いものは削除
  4. デフォルト初期値で再初期化
  5. ユーザーに「データを初期化しました」と通知

### 保存項目
- `schemaVersion`: データ構造バージョン
- `settings`: リーンモード（ホールド/トグル）
- `reactionDrill`: レベル別平均反応速度、ベスト
- `comboDrill`: テクニック別成功率、解放状態
- `rhythmDrill`: 最高到達BPM、Perfect率
- `kro`: 診断結果、問題のあったキー組み合わせ、ドリル中の失敗カウント
- キー: `eft-lean-trainer`
- 「データリセット」ボタンで全消去可能

## ビジュアルデザイン（ミリタリー風ダーク）
- 背景: `#1a1a2e` 系の暗い紺
- アクセント: `#e94560`（赤）、`#0f3460`（ネイビー）、`#16c79a`（ターコイズ）
- フォント: `monospace` 系、ミリタリーステンシル風
- Canvas描画:
  - 地面: グリッド線（暗めの緑/灰）
  - キャラクター: 円 + 視野角の扇形（視線レイ付き）
  - リーン表現: キャラの傾き + 視野角のシフト
  - 遮蔽物: 矩形（コンクリート風の灰色）
  - 敵マーカー: 赤い菱形
  - 視線判定: レイが敵に到達 → 緑破線、遮蔽 → 赤破線
- キーインジケータ: キーボード配列を模したブロック、押下時に光る

## 実装ステップ
1. HTML骨格 + CSS（ダークテーマ、レイアウト）
2. `GameClock` + `InputManager`（event.code、状態遷移表、ホールド/トグル、resetState、同時押し許容窓）
3. `Renderer`（Canvas描画エンジン: キャラ、遮蔽物、視線レイキャスト）
4. `AudioEngine`（AudioContext初期化、ビート先読みスケジューラ、suspend/resume — 共有インスタンス）
5. `Storage`（localStorage CRUD、schemaVersion、マイグレーション、破損フォールバック）
6. `ModeLifecycle` 基底 + `ModeManager`（enter/dispose 順序保証、共有/専有リソース管理）
7. フリープラクティスモード（視線レイキャスト判定含む）
8. キー反応ドリル（段階的難易度、同時押し判定窓、KRO警告閾値）
9. コンボドリル（データ駆動定義、手本アニメ、段階的解放）
10. リズムドリル（先読みスケジュール、timeOffset突き合わせ+resume再計測、固定閾値判定、段階的BPM）
11. モード切替UI、設定パネル、KRO診断
12. **自己テスト関数**（後述）

## 検証方法

### 手動テスト
- ブラウザで `index.html` を開いて各モードを動作確認
- ホールド式/トグル式の切替が正しく動作するか
- 全キーの同時押し（W+D+E等）が正しく検知されるか
- AudioContextのビート音が正しいBPMで鳴るか
- `visibilitychange` でキー状態リセット + AudioContext再開が正しいか
- モード間を行き来しても状態がリークしないか

### 自己テスト関数 (devモード)
コンソールから `EFTTrainer.runTests()` で実行可能な純JS自己テスト:
- **入力遷移テスト**: 全状態遷移パターン（ホールド式8パターン + トグル式6パターン）をシミュレートし、期待状態と比較
- **同時押し判定テスト**: 許容窓の境界値（79ms=同時, 81ms=非同時）を検証
- **リズム判定境界テスト**: Perfect/Good/Miss の ±ms 境界が正しいか（±39ms=Perfect, ±41ms=Good, ±91ms=Miss）
- **レイキャスト判定テスト**: 既知の遮蔽物配置で視認可否が正しいか
- **Storageマイグレーションテスト**: 旧バージョンデータを正しく変換できるか
- **Storage破損フォールバックテスト**: 不正JSONで初期値に復帰するか
- **ライフサイクルリーク検証**:
  - モード切替を10回連打し、各切替後に以下を確認:
    - `InputManager` に登録されたモード専有リスナー数が 0
    - アクティブな `setTimeout`/`setInterval` IDが前モードのものでない（モードが管理するIDリストが空）
    - アクティブな `requestAnimationFrame` IDが前モードのものでない
    - `window`/`document`/`canvas` に登録されたモード専有の生リスナーが 0（モードが `addEventListener` した分をカウント）
    - `AudioEngine` が `suspended` 状態（running のまま残っていない）
  - テスト結果はコンソールに出力（pass/fail + 件数）
- **AudioEngine resume失敗テスト**: `audioCtx.resume()` をモックで reject させ、フォールバックUIが表示されるか確認
