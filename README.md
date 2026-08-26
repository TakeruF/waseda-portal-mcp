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

`npm run auth`（またはビルド後の`waseda-portal-mcp auth`）は専用Chromeプロファイルを開きます。Waseda MoodleとMyWasedaへのログインはユーザー本人がChrome上で行い、最後にMyWasedaの「授業 → 授業関連 → 休講」を開いてください。休講ページへの到達をURLだけで確認すると、認証状態を保存して専用Chromeを自動で閉じます。CLIはユーザー名・パスワードを要求しません。既存Chromeプロファイルや通常利用中のCookieもコピーしません。

既定の専用プロファイルは`~/.waseda-portal-mcp/chrome-profile`、サーバーが読み込む認証状態は`~/.waseda-portal-mcp/auth-state.json`です。どちらもリポジトリ外にあり、認証状態ファイルはowner-only（0600）にします。場所は`WASEDA_PORTAL_PROFILE_DIR`と`WASEDA_PORTAL_AUTH_STATE_PATH`で変更できます。同じ専用プロファイルを使うChromeとMCPサーバーは同時に起動できません。

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
- `search_syllabi`: 履修状況に関係なく、現年度のWebシラバスを科目名または内容から検索

`search_syllabi`の`mode`は、既知の科目名なら`course_name`、学びたい内容から探すなら`content`です。内容検索では自然文を最大3語へ分解します。MCPクライアントは`relatedTerms`へ最大3個の短い関連語を渡すことで、検索回数と意図を明示できます。

```json
{
  "query": "日本の貨幣の歴史を学びたい",
  "mode": "content",
  "relatedTerms": ["貨幣", "通貨", "経済史"],
  "maxResults": 3
}
```

結果には完全なシラバス、公式検索で一致した語、照合できたフィールド、字句的な関連度があります。内容検索は意味的な履修推薦や履修可否の保証ではありません。

日時はISO 8601で保持し、元ページにタイムゾーンがなければ`Asia/Tokyo`として解釈します。全結果に取得元URLと確認時刻があります。競合時はMyWaseda、Moodle構造化情報、Webシラバス、自由記述の順です。

## read-only保証

通常取得はページ表示とDOM読み取りだけです。`ReadOnlyGuard`は課題提出、アップロード、小テスト・アンケート回答、出欠、完了変更、予定作成、投稿、メッセージ、履修変更などの既知URLと、許可されていない非GETリクエストを拒否します。

Webシラバスの公式検索フォームだけは、検索であるにもかかわらずHTTP POSTを使います。このため、公式ホスト・`/syllabus/JAA101.php`・read-only controller `JAA103SubCon`がすべて一致する検索POSTのみを狭く許可しています。Moodleの遅延読み込みも、`/lib/ajax/service.php`に対する既知の参照専用メソッドだけを許可します。詳細ページはGETで読みます。認証フローは別プロセスで、認証情報の入力・送信はユーザー本人の操作です。

成績、評点、教員フィードバック、提出ファイル名はモデルに存在せず、通常レスポンスにも含まれません。Moodle外部カレンダートークンは発行・保存・利用しません。

## 個人情報とキャッシュ

認証済みHTMLはメモリ上で解析後に破棄し、永続保存しません。Cookieとセッショントークンはリポジトリ外の専用プロファイルと認証状態ファイルだけにあり、MCPレスポンスやログへ出しません。正規化済みの最小データだけをプロセスメモリへ既定5分間キャッシュします。TTLは`WASEDA_PORTAL_CACHE_TTL_MS`、無効化は`--no-cache`または`WASEDA_PORTAL_CACHE=false`です。

確定できた`courseId → syllabusKey`だけは、再検索を減らすため`~/.waseda-portal-mcp/cache/course-syllabus-map.json`へ保存できます。この対応表に科目名、担当者名、学生番号などは含めず、ディレクトリ0700・ファイル0600で原子的に更新します。曖昧候補や一致なしは保存しません。

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
npm run test:live:auth-state     # 新規一時プロファイルでAUTH_REQUIREDを確認
npm run test:live:authenticated  # 認証必須。AUTH_REQUIRED/SESSION_EXPIREDは失敗
npm run test:live:catalog        # 公開シラバスの内容検索と科目名検索
npm run test:e2e:authenticated   # ビルド後、MCPクライアントからstdio E2E
npm run test:e2e:catalog         # search_syllabiのstdio E2E
```

`test:live`は`test:live:authenticated`の別名です。認証必須ライブ検証は同時実行1、アクセス間隔1秒、正規科目1件、シラバス候補最大3件、課題詳細最大1件に制限します。未認証なら成功扱いにせず失敗します。fixture成功、認証済みライブ成功、MCPクライアントE2E成功は別々の証拠として扱ってください。

## 既知の制約

- Moodle、MyWaseda、WebシラバスのDOM変更でparser更新が必要になる場合があります。
- 内容検索は公式Webシラバスの全項目キーワード検索を使う字句検索です。同義語や抽象的な関心は`relatedTerms`で補い、最大3検索・最大5詳細に制限します。
- 検索結果に表示される科目が実際に履修可能とは限りません。所属、学年、前提科目、定員、登録時期は別途公式情報で確認してください。
- MyWasedaは履修科目向け初期表示のみで、学部全体表示のPOST操作は実装していません。
- 授業回は、確定できたシラバスの曜日時限と学期・休業日から生成します。集中・補講・個別回の自由記述は断定しません。
- Moodleとシラバスの照合は年度、開講箇所、正規化科目名、クラス、担当者、利用可能なら曜日時限を根拠にします。Moodle名とシラバス名が異なる場合は担当者の部分一致で候補を最大件数まで取得します。根拠が弱い、または上位候補の差が小さい場合は曖昧候補だけを返し、教室・試験情報を確定しません。
- 常駐通知、書き込み、成績取得、教材一括取得、カレンダートークン、Chrome拡張、クラウド認証、リモートMCP、複数大学は対象外です。

## 他大学adapter

共通化するのは取得手段ではなく、利用者が必要とする結果です。まず同一パッケージ内で`UniversityAdapter`を実装し、大学固有のselector・ID・照合規則はadapter配下に置きます。固有情報は`extensions`へ入れます。2校目の実装で実際の境界が確認できるまで、別パッケージへ分割しません。詳しくは[docs/architecture.md](docs/architecture.md)を参照してください。

## License

MIT
