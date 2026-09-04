# waseda-portal-mcp

早稲田大学のWaseda Moodle、MyWaseda休講情報、Webシラバス、公式学事日程をまとめる、非公式・ローカル・read-onlyのMCPサーバーです。早稲田大学とは無関係であり、大学による承認・保証・サポートはありません。

主な用途は、MCPクライアントから「明日の授業と締切を出して」と尋ね、授業、休講・変更、当日締切、未提出の期限超過課題を出典付きで確認することです。

## 対応データソース

- Waseda Moodle: 正規科目、活動種別、構造化された開始・期限、提出・完了状態
- MyWaseda休講情報: ログイン後の初期表示にある履修科目向け休講・変更
- Webシラバス: 年度、科目・クラスコード、開講箇所、担当者、配当年次、公開されている対象者・前提条件、曜日時限、教室、方式、概要、計画、評価、試験記載
- 早稲田大学公式学事日程: 授業開始・終了、休業、祝日授業、授業休止、試験期間

大学ロゴ、画面キャプチャ、教材、取得したシラバス本文、実在する個人データはリポジトリに含めません。

## 必要環境とセットアップ

- Node.js 22以上
- npm
- システムにインストールされたGoogle Chrome（認証ありモードのみ。`--public-only`では不要）

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

## 公開カタログの共有配備

`--public-only`（または`WASEDA_PORTAL_PUBLIC_ONLY=true`）は、公開Webシラバスと公開学事日程だけを読む共有可能なモードです。認証セッションを持たず、個人情報を扱わず、**ブラウザも起動しません**。

```bash
npm run build
npm run serve:public   # http://127.0.0.1:8787
```

公開Webシラバスは素のHTTPで完結します。詳細ページは通常の`GET`、検索は`ControllerParameters=JAA103SubCon`を含むフォーム`POST`で、Cookieも事前のGETも不要です。このため公開モードは`FetchPageReader`を使い、Playwrightを必要としません。科目名検索は約0.6秒で完了します。

このモードでは`ReadOnlyGuard`が`www.wsl.waseda.jp`と`www.waseda.jp`へのhttpsリクエストだけを通し、それ以外は送信前に`HOST_NOT_ALLOWED`で遮断します。Moodle、MyWaseda、class.waseda.jp、SSOにはプロセスから到達できません。`auth-state.json`、学修プロフィール、`courseId → syllabusKey`対応表も読み込まず、MCPツールは`search_syllabi`と`get_syllabus`（`syllabusKey`のみ）の2つだけになります。

入口は3つです。

- `/mcp`: MCP streamable HTTP。MCPクライアントから接続します
- `/api/syllabi/search`（POST）と`/api/syllabi/:syllabusKey`（GET）: JSON API
- `/`: アカウント不要のWeb UI

既定のレート制限はクライアントごとに`/api`が毎分20回、`/mcp`がその5倍、共有ブラウザの同時使用は4です。上流の早稲田側アクセスはプロセス全体で1本に直列化されます。

プロジェクト直下の`server.mjs`は、Vercelなど`server`エントリポイントを検出するホスト向けの入口です。`node server.mjs`でローカルでも同じものを起動できます。ポートは同期的に確保し、アプリは初回リクエスト時に構築します（捕捉型ホストはモジュール評価中の`listen`を監視するため）。

認証ありモードは本人のSSOセッションを保持します。他人が到達できる場所では動かさないでください。Vercelとコンテナへの配備、環境変数、サーバーレスでの注意点、MCPクライアント登録手順は[docs/deployment.md](docs/deployment.md)にあります。

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
  "maxResults": 3,
  "useAcademicProfile": true
}
```

結果には完全なシラバス、公式検索で一致した語、照合できたフィールド、字句的な関連度があります。ローカル学修プロフィールが設定されていれば`profileApplied`が`true`となり、候補ごとに所属・年次・前提条件の助言的な照合も付きます。内容検索は意味的な履修推薦や履修可否の保証ではありません。

### 任意のローカル学修プロフィール

本人が明示した最小限の学修情報だけを、既定では`~/.waseda-portal-mcp/academic-profile.json`へ任意で保存できます。MyWasedaやMoodleから氏名、学生番号、所属、学年、履修歴を自動取得する機能はありません。

```json
{
  "schemaVersion": 1,
  "affiliations": ["例示学部"],
  "academicLevel": "undergraduate",
  "year": 3,
  "completedPrerequisites": ["合成基礎科目"]
}
```

`affiliations`は正式な学部・研究科名を最大5件、`academicLevel`は`undergraduate`・`masters`・`doctoral`・`other`、`year`は1〜6です。`completedPrerequisites`は照合に使いたい科目名・前提条件だけを最大30件まで本人が選んで記載します。履修履歴にあたるため、不要なら省略してください。

親ディレクトリを0700、ファイルを0600にし、リポジトリ外へ置いてください。ファイルが存在しなければ従来どおり検索します。別の場所を使う場合は`WASEDA_PORTAL_ACADEMIC_PROFILE_PATH`で指定できます。権限が広すぎるファイルや他ユーザー所有のファイルは読み込みません。

プロフィールの値はMCPレスポンス、ログ、snapshot、キャッシュへ複製しません。出力するのは`profileApplied`と、値を伏せた`consistent`・`conflict`・`review_required`・`unavailable`の判定根拠だけです。呼び出しごとに`useAcademicProfile: false`とすれば使用しません。

日時はISO 8601で保持し、元ページにタイムゾーンがなければ`Asia/Tokyo`として解釈します。全結果に取得元URLと確認時刻があります。競合時はMyWaseda、Moodle構造化情報、Webシラバス、自由記述の順です。

## read-only保証

通常取得はページ表示とDOM読み取りだけです。`ReadOnlyGuard`は課題提出、アップロード、小テスト・アンケート回答、出欠、完了変更、予定作成、投稿、メッセージ、履修変更などの既知URLと、許可されていない非GETリクエストを拒否します。

Webシラバスの公式検索フォームだけは、検索であるにもかかわらずHTTP POSTを使います。このため、公式ホスト・`/syllabus/JAA101.php`・read-only controller `JAA103SubCon`がすべて一致する検索POSTのみを狭く許可しています。Moodleの遅延読み込みも、`/lib/ajax/service.php`に対する既知の参照専用メソッドだけを許可します。詳細ページはGETで読みます。認証フローは別プロセスで、認証情報の入力・送信はユーザー本人の操作です。

成績、評点、教員フィードバック、提出ファイル名はモデルに存在せず、通常レスポンスにも含まれません。Moodle外部カレンダートークンは発行・保存・利用しません。

## 個人情報とキャッシュ

認証済みHTMLはメモリ上で解析後に破棄し、永続保存しません。Cookieとセッショントークンはリポジトリ外の専用プロファイルと認証状態ファイルだけにあり、MCPレスポンスやログへ出しません。任意の学修プロフィールもリポジトリ外のowner-onlyファイルから起動時に一度だけ読み、値をレスポンスやキャッシュへ保存しません。正規化済みの最小データだけをプロセスメモリへ既定5分間キャッシュします。TTLは`WASEDA_PORTAL_CACHE_TTL_MS`、無効化は`--no-cache`または`WASEDA_PORTAL_CACHE=false`です。

確定できた`courseId → syllabusKey`だけは、再検索を減らすため`~/.waseda-portal-mcp/cache/course-syllabus-map.json`へ保存できます。この対応表に科目名、担当者名、学生番号などは含めず、ディレクトリ0700・ファイル0600で原子的に更新します。曖昧候補や一致なしは保存しません。

fixtureはすべて人工データです。実データをissue、ログ、fixture、テスト出力へ貼らないでください。詳細は[SECURITY.md](SECURITY.md)を参照してください。

## エラー

`AUTH_REQUIRED`、`SESSION_EXPIRED`、`MAINTENANCE`、`SOURCE_UNAVAILABLE`、`PAGE_STRUCTURE_CHANGED`、`AMBIGUOUS_COURSE_MATCH`、`RATE_LIMITED`、`READ_ONLY_VIOLATION`、`HOST_NOT_ALLOWED`を区別します。`HOST_NOT_ALLOWED`は公開カタログモードで許可ホスト外へのリクエストを遮断したことを表します。主要selectorが消えた場合は空配列を成功扱いせず、`PAGE_STRUCTURE_CHANGED`を返します。正規の空リスト用コンテナを確認できた場合だけ空配列を返します。

未認証なら`npm run auth`を実行してください。構造変更なら、個人情報を含まない最小のDOM構造を人工fixtureとして再現し、対象parserとfixtureテストを更新します。認証済みの生HTMLをissueやコミットへ追加しないでください。

## 開発と検証

```bash
npm test             # 外部アクセスなしの人工fixtureテスト（HTTP配備の統合テストを含む）
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run test:live:auth-state     # 新規一時プロファイルでAUTH_REQUIREDを確認
npm run test:live:authenticated  # 認証必須。AUTH_REQUIRED/SESSION_EXPIREDは失敗
npm run test:live:catalog        # 公開シラバスの内容検索と科目名検索（ブラウザ経由）
npm run test:live:public         # 公開カタログをブラウザなしで検証。配備される経路そのもの
npm run test:e2e:authenticated   # ビルド後、MCPクライアントからstdio E2E
npm run test:e2e:catalog         # search_syllabiのstdio E2E
```

`test:live`は`test:live:authenticated`の別名です。認証必須ライブ検証は同時実行1、アクセス間隔1秒、正規科目1件、シラバス候補最大3件、課題詳細最大1件に制限します。未認証なら成功扱いにせず失敗します。fixture成功、認証済みライブ成功、MCPクライアントE2E成功は別々の証拠として扱ってください。

## 既知の制約

- Moodle、MyWaseda、WebシラバスのDOM変更でparser更新が必要になる場合があります。
- 内容検索は公式Webシラバスの全項目キーワード検索を使う字句検索です。同義語や抽象的な関心は`relatedTerms`で補い、最大3検索・最大5詳細に制限します。
- 学修プロフィールによる判定は助言です。Webシラバスで独立項目になっている配当年次は構造的に照合しますが、開講箇所を所属制限とはみなしません。対象者・前提科目・定員・登録時期が自由記述や学部要項にある場合は自動で履修可能と断定せず、公式情報の確認が必要です。
- MyWasedaは履修科目向け初期表示のみで、学部全体表示のPOST操作は実装していません。
- 授業回は、確定できたシラバスの曜日時限と学期・休業日から生成します。集中・補講・個別回の自由記述は断定しません。
- Moodleとシラバスの照合は年度、開講箇所、正規化科目名、クラス、担当者、利用可能なら曜日時限を根拠にします。Moodle名とシラバス名が異なる場合は担当者の部分一致で候補を最大件数まで取得します。根拠が弱い、または上位候補の差が小さい場合は曖昧候補だけを返し、教室・試験情報を確定しません。
- 常駐通知、書き込み、成績取得、教材一括取得、カレンダートークン、Chrome拡張、クラウド認証、複数大学は対象外です。
- リモートMCPは公開シラバス限定の`--public-only`モードだけで提供します。認証済みポータルをクラウドで扱う予定はありません。SSO資格情報や`auth-state.json`をサーバーへ渡す運用は想定していません。

## 他大学adapter

共通化するのは取得手段ではなく、利用者が必要とする結果です。まず同一パッケージ内で`UniversityAdapter`を実装し、大学固有のselector・ID・照合規則はadapter配下に置きます。固有情報は`extensions`へ入れます。2校目の実装で実際の境界が確認できるまで、別パッケージへ分割しません。詳しくは[docs/architecture.md](docs/architecture.md)を参照してください。

## License

MIT
