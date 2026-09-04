# 公開カタログの配備

このリポジトリは2つの動作モードを持ちます。混ぜないでください。

| モード           | 対象           | データ                                                | ブラウザ           | 配備先                     |
| ---------------- | -------------- | ----------------------------------------------------- | ------------------ | -------------------------- |
| 認証あり（既定） | 本人のみ       | Moodle履修・締切、MyWaseda休講、Webシラバス、学事日程 | 必要（Playwright） | 本人のマシン、stdio        |
| `--public-only`  | 複数人で共有可 | 公開Webシラバスと公開学事日程のみ                     | 不要               | Vercel、コンテナ、どこでも |

認証ありモードは本人のSSOセッションを保持します。**他人が到達できる場所で動かさないでください。**

## public-onlyモードの保証

`--public-only`（または`WASEDA_PORTAL_PUBLIC_ONLY=true`）では次がコードで強制されます。

- `ReadOnlyGuard`が`www.wsl.waseda.jp`と`www.waseda.jp`へのhttpsリクエストだけを通し、それ以外は`HOST_NOT_ALLOWED`で送信前に遮断します。Moodle、MyWaseda、class.waseda.jp、SSO（iaidp）にはプロセスから到達できません。
- `FetchPageReader`が素のHTTPで読みます。ブラウザを起動せず、Cookieもセッションも持ちません。
- `auth-state.json`、ローカル学修プロフィール、`courseId → syllabusKey`対応表を読み込みません。
- MCPツールは`search_syllabi`と`get_syllabus`（`syllabusKey`のみ）の2つだけを登録します。

`tests/integration/http-app.test.ts`は、認証系ソースが読まれたら失敗するfixtureでこれを検証します。

## なぜブラウザが要らないのか

公開Webシラバスは素のHTTPで完結します。詳細ページは通常の`GET`で、検索は`ControllerParameters=JAA103SubCon`を含むフォーム`POST`です。**Cookieも事前のGETも不要**で、`multipart`でも`url-encoded`でも同じ結果を返します。url-encodedを使うことで、`ReadOnlyGuard`が実際に送信するボディをそのまま検査できます。

その結果、科目名検索は**約0.6秒**で完了します（Playwright経由では約4.3秒でした）。

## Vercelへ配備する

Vercelはプロジェクト直下の`server.mjs`をエントリポイントとして検出し、1つのFunctionにまとめます。ルーティング設定は不要で、ローカルと同じ挙動になります。

```bash
npm i -g vercel
vercel        # プレビュー配備
vercel --prod # 本番配備
```

`vercel.json`は同梱済みです。`public/index.html`はVercelの静的配信で`/`に出ます。

配備後に設定する環境変数（Project Settings → Environment Variables）:

| 変数                                     | 推奨値       | 理由                                   |
| ---------------------------------------- | ------------ | -------------------------------------- |
| `WASEDA_PORTAL_HTTP_ALLOWED_HOSTS`       | 公開ドメイン | Hostヘッダ検証。未設定だと検証しません |
| `WASEDA_PORTAL_MIN_ACCESS_INTERVAL_MS`   | `1000`       | 早稲田側への最小アクセス間隔           |
| `WASEDA_PORTAL_HTTP_REQUESTS_PER_MINUTE` | `20`程度     | クライアントごとの`/api`上限           |

### サーバーレスで弱くなる点

`TtlCache`とレートリミッタは**プロセス内メモリ**です。Vercelがインスタンスを複数立てると、それぞれが独立したキャッシュとバケットを持ちます。つまり:

- キャッシュのヒット率が下がり、早稲田側へのアクセスが増えます
- レート制限がインスタンスごとに分裂します

短時間に約8回アクセスした時点で実際にスロットリングを受けたことがあるため、これは無視できません。テスター数が増える場合は次のいずれかを検討してください。

1. `WASEDA_PORTAL_MIN_ACCESS_INTERVAL_MS`を上げる（まず`1000`）
2. Upstash等の共有ストアでトークンバケットとキャッシュを共有する
3. 常駐1プロセスのホスト（Fly.io、Cloud Runの`--max-instances=1`）へ移す

## コンテナへ配備する

ブラウザが不要になったので、イメージは`node:22-slim`です。

```bash
docker build -t waseda-portal-mcp .
docker run --rm -p 8787:8787 \
  -e WASEDA_PORTAL_HTTP_ALLOWED_HOSTS=example.invalid \
  -e WASEDA_PORTAL_MIN_ACCESS_INTERVAL_MS=1000 \
  waseda-portal-mcp
```

常駐1プロセスなので、直列リミッタとキャッシュが設計どおりに効きます。共有テストの規模が大きくなるならこちらが安全です。

## ローカルで確認する

```bash
npm run build
npm run serve:public   # CLI経由 http://127.0.0.1:8787
node server.mjs        # Vercelと同じエントリポイント
```

## 提供される入口

| パス                        | 用途                                                     |
| --------------------------- | -------------------------------------------------------- |
| `/mcp`                      | MCP streamable HTTP。開発者がMCPクライアントから接続する |
| `/api/syllabi/search`       | `POST`。JSON検索API                                      |
| `/api/syllabi/:syllabusKey` | `GET`。シラバス1件                                       |
| `/`                         | テスター向けWeb UI。アカウント不要                       |
| `/healthz`                  | 死活監視                                                 |

## 環境変数

| 変数                                         | 既定                 | 説明                                          |
| -------------------------------------------- | -------------------- | --------------------------------------------- |
| `WASEDA_PORTAL_PUBLIC_ONLY`                  | `false`              | 公開データのみに制限                          |
| `WASEDA_PORTAL_HTTP_HOST`                    | `127.0.0.1`          | 待ち受けアドレス                              |
| `WASEDA_PORTAL_HTTP_PORT`                    | `8787`（`PORT`も可） | 待ち受けポート                                |
| `WASEDA_PORTAL_HTTP_ALLOWED_HOSTS`           | 空                   | 許可するHostヘッダ（カンマ区切り）            |
| `WASEDA_PORTAL_HTTP_ALLOWED_ORIGINS`         | 空                   | 許可するOriginホスト名（カンマ区切り）        |
| `WASEDA_PORTAL_HTTP_REQUESTS_PER_MINUTE`     | `20`                 | クライアントごとの`/api`上限。`/mcp`はこの5倍 |
| `WASEDA_PORTAL_HTTP_MAX_CONCURRENT_REQUESTS` | `4`                  | 同時処理数の上限                              |
| `WASEDA_PORTAL_MIN_ACCESS_INTERVAL_MS`       | `250`                | 早稲田側への最小アクセス間隔                  |

## 早稲田側への負荷

共有配備では全テスターのアクセスが少数のIPから出ます。これは非公式ツールであり、大学の利用規約とアクセス負荷について配備者が責任を持ちます。共有テストを始める前に、同時テスター数の上限とテスト期間を決めてください。

## MCPクライアントの登録

`/mcp`は認証なしの公開エンドポイントです（公開データしか返さないため）。

- **Claude**: 設定 → コネクタ → カスタムコネクタを追加 → `https://<your-domain>/mcp`。無料プランでもカスタムコネクタを1つ登録できます。
- **ChatGPT**: 設定 → Apps → 開発者モードを有効化してMCPサーバーを追加。開発者モードはPlus・Pro・Business・Enterprise・Eduのみで、無料プランでは使えません。
- **Gemini CLI**: `~/.gemini/settings.json`のMCPサーバー設定に追加。Googleアカウントの無料枠で使えます。
- **VS Code / Cursor / Cline**: それぞれのMCP設定にHTTPエンドポイントとして登録。

無料プランのテスターにはWeb UI（`/`）を案内してください。アカウントもクライアント設定も不要です。
