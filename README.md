# waseda-portal-mcp

早稲田大学のWaseda Moodle、MyWaseda休講情報、Webシラバス、公式学事日程をまとめる、非公式・ローカル・read-onlyのMCPサーバーです。早稲田大学とは無関係であり、大学による承認・保証・サポートはありません。

主な用途は、MCPクライアントから「明日の授業と締切を出して」と尋ね、授業、休講・変更、当日締切、未提出の期限超過課題を出典付きで確認することです。

## 対応データソース

- Waseda Moodle: 正規科目、活動種別、構造化された開始・期限、提出・完了状態
- MyWaseda休講情報: ログイン後の初期表示にある履修科目向け休講・変更
- Webシラバス: 年度、科目・クラスコード、開講箇所、担当者、曜日時限、教室、方式、概要、計画、評価、試験記載
- 早稲田大学公式学事日程: 授業開始・終了、休業、祝日授業、授業休止、試験期間

大学ロゴ、画面キャプチャ、教材、取得したシラバス本文、実在する個人データはリポジトリに含めません。

## 必要環境とセットアップ

- Node.js 22以上
- npm
- システムにインストールされたGoogle Chrome

```bash
git clone https://github.com/TakeruF/waseda-portal-mcp.git
cd waseda-portal-mcp
npm install
npm run build
npm run auth
```

`npm run auth`（またはビルド後の`waseda-portal-mcp auth`）は専用Chromeプロファイルを開きます。MyWasedaへのログイン操作はユーザー本人がChrome上で行い、完了後にウィンドウを閉じてください。CLIはユーザー名・パスワードを要求しません。既存ChromeプロファイルのCookieもコピーしません。

既定の専用プロファイルは`~/.waseda-portal-mcp/chrome-profile`です。リポジトリ外の別の場所にする場合は`WASEDA_PORTAL_PROFILE_DIR`を設定します。同じプロファイルを使うChromeとMCPサーバーは同時に起動できません。

## MCPクライアント設定

絶対パスは実際のcheckoutに置き換えてください。

```json
{
  "mcpServers": {
    "waseda-portal": {
      "command": "node",
      "args": ["/absolute/path/to/waseda-portal-mcp/dist/cli.js"]
    }
  }
}
```

キャッシュを無効にする場合は`args`へ`"--no-cache"`を追加します。stdioの標準出力はMCPプロトコル専用で、運用メッセージは標準エラーへ出します。

## ツール

- `get_day_brief`: `date`（`YYYY-MM-DD`）の授業、変更、当日締切、未提出の期限超過を統合
- `list_courses`: 通常はカテゴリが`正規科目/`で始まる科目のみ。`includeNonRegular`で案内コース等も含める
- `list_deadlines`: ISO 8601の`from`・`to`内に期限がある活動を列挙。通常は提出済み・完了済みを除外
- `list_changes`: 指定日範囲の休講・変更を列挙
- `get_syllabus`: `courseId`または`syllabusKey`から詳細または曖昧な候補を返す

日時はISO 8601で保持し、元ページにタイムゾーンがなければ`Asia/Tokyo`として解釈します。全結果に取得元URLと確認時刻があります。競合時はMyWaseda、Moodle構造化情報、Webシラバス、自由記述の順です。

## read-only保証

通常取得はページ表示とDOM読み取りだけです。`ReadOnlyGuard`は課題提出、アップロード、小テスト・アンケート回答、出欠、完了変更、予定作成、投稿、メッセージ、履修変更などの既知URLと、許可されていない非GETリクエストを拒否します。

Webシラバスの公式検索フォームだけは、検索であるにもかかわらずHTTP POSTを使います。このため、公式ホスト・`/syllabus/index.php`・read-only controller `JAA103SubCon`がすべて一致する検索POSTのみを狭く許可しています。詳細ページはGETで読みます。認証フローは別プロセスで、認証情報の入力・送信はユーザー本人の操作です。

成績、評点、教員フィードバック、提出ファイル名はモデルに存在せず、通常レスポンスにも含まれません。Moodle外部カレンダートークンは発行・保存・利用しません。

## 個人情報とキャッシュ

認証済みHTMLはメモリ上で解析後に破棄し、永続保存しません。Cookieとセッショントークンは専用Chromeプロファイル内だけにあり、MCPレスポンスやログへ出しません。正規化済みの最小データだけをプロセスメモリへ既定5分間キャッシュします。TTLは`WASEDA_PORTAL_CACHE_TTL_MS`、無効化は`--no-cache`または`WASEDA_PORTAL_CACHE=false`です。

fixtureはすべて人工データです。実データをissue、ログ、fixture、テスト出力へ貼らないでください。詳細は[SECURITY.md](SECURITY.md)を参照してください。

## エラー

`AUTH_REQUIRED`、`SESSION_EXPIRED`、`MAINTENANCE`、`SOURCE_UNAVAILABLE`、`PAGE_STRUCTURE_CHANGED`、`AMBIGUOUS_COURSE_MATCH`、`RATE_LIMITED`、`READ_ONLY_VIOLATION`を区別します。主要selectorが消えた場合は空配列を成功扱いせず、`PAGE_STRUCTURE_CHANGED`を返します。正規の空リスト用コンテナを確認できた場合だけ空配列を返します。

未認証なら`npm run auth`を実行してください。構造変更なら、個人情報を含まない最小のDOM構造を人工fixtureとして再現し、対象parserとfixtureテストを更新します。認証済みの生HTMLをissueやコミットへ追加しないでください。

## 開発と検証

```bash
npm test             # 外部アクセスなしの人工fixtureテスト
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run test:live    # 明示的なライブ確認。少数のread-onlyページのみ
```

`test:live`は専用プロファイルの認証状態を使用します。未認証なら安全に`AUTH_REQUIRED`または`SESSION_EXPIRED`を確認するだけです。fixture成功はライブ動作確認の証拠ではありません。

## 既知の制約

- Moodle、MyWaseda、WebシラバスのDOM変更でparser更新が必要になる場合があります。
- MyWasedaは履修科目向け初期表示のみで、学部全体表示のPOST操作は実装していません。
- 授業回は、確定できたシラバスの曜日時限と学期・休業日から生成します。集中・補講・個別回の自由記述は断定しません。
- Moodleとシラバスの照合は年度、開講箇所、正規化科目名、クラス、担当者、利用可能なら曜日時限を根拠にします。上位候補の差が小さい場合は候補だけを返し、教室・試験情報を確定しません。
- 常駐通知、書き込み、成績取得、教材一括取得、カレンダートークン、Chrome拡張、クラウド認証、リモートMCP、複数大学は対象外です。

## 他大学adapter

共通化するのは取得手段ではなく、利用者が必要とする結果です。まず同一パッケージ内で`UniversityAdapter`を実装し、大学固有のselector・ID・照合規則はadapter配下に置きます。固有情報は`extensions`へ入れます。2校目の実装で実際の境界が確認できるまで、別パッケージへ分割しません。詳しくは[docs/architecture.md](docs/architecture.md)を参照してください。

## License

MIT
