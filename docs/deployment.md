# 公開カタログのクラウド配備

このリポジトリは2つの動作モードを持ちます。混ぜないでください。

| モード           | 対象           | データ                                                | 配備先              |
| ---------------- | -------------- | ----------------------------------------------------- | ------------------- |
| 認証あり（既定） | 本人のみ       | Moodle履修・締切、MyWaseda休講、Webシラバス、学事日程 | 本人のマシン、stdio |
| `--public-only`  | 複数人で共有可 | 公開Webシラバスと公開学事日程のみ                     | クラウド、HTTP      |

認証ありモードは本人のSSOセッションを保持します。**他人が到達できる場所で動かさないでください。**

## public-onlyモードの保証

`--public-only`（または`WASEDA_PORTAL_PUBLIC_ONLY=true`）では次がコードで強制されます。

- `ReadOnlyGuard`が`www.wsl.waseda.jp`と`www.waseda.jp`へのhttpsリクエストだけを通し、それ以外は`HOST_NOT_ALLOWED`で送信前に遮断します。Moodle、MyWaseda、class.waseda.jp、SSO（iaidp）にはプロセスから到達できません。
- `auth-state.json`を読み込みません。プロファイルディレクトリも認証用とは別（既定`~/.waseda-portal-mcp/chrome-profile-public`）です。
- ローカル学修プロフィールと`courseId → syllabusKey`対応表を読み込みません。
- MCPツールは`search_syllabi`と`get_syllabus`（`syllabusKey`のみ）の2つだけを登録します。`get_day_brief`、`list_courses`、`list_deadlines`、`list_changes`は存在しません。

`tests/integration/http-app.test.ts`は、認証系ソースが読まれたら失敗するfixtureでこれを検証します。

## 提供される入口

| パス                        | 用途                                                     |
| --------------------------- | -------------------------------------------------------- |
| `/mcp`                      | MCP streamable HTTP。開発者がMCPクライアントから接続する |
| `/api/syllabi/search`       | `POST`。JSON検索API                                      |
| `/api/syllabi/:syllabusKey` | `GET`。シラバス1件                                       |
| `/`                         | テスター向けWeb UI。アカウント不要                       |
| `/healthz`                  | 死活監視                                                 |

## ローカルで確認する

```bash
npm run build
npm run serve:public
# → http://127.0.0.1:8787/ をブラウザで開く
```

## Dockerで配備する

```bash
docker build -t waseda-portal-mcp .
docker run --rm -p 8787:8787 \
  -e WASEDA_PORTAL_HTTP_ALLOWED_HOSTS=example.invalid \
  waseda-portal-mcp
```

イメージはPlaywright公式イメージを使い、`WASEDA_PORTAL_BROWSER_CHANNEL`を空にしてバンドル版Chromiumを使います。Google Chromeのインストールは不要です。

コンテナ1つあたりChromiumが1プロセス常駐します。目安として512MB以上のメモリを割り当ててください。

## HTTPSとホスト検証

`/mcp`はMCPクライアントからHTTPSで到達できる必要があります。TLS終端はリバースプロキシ（Cloud Run、Fly.io、Caddy、nginxなど）に任せ、次を設定してください。

- `WASEDA_PORTAL_HTTP_HOST=0.0.0.0`
- `WASEDA_PORTAL_HTTP_ALLOWED_HOSTS` に公開ドメインを設定（DNSリバインディング対策。未設定だとHostヘッダ検証をしません）
- プロキシが`X-Forwarded-For`を付けること（レート制限のクライアント識別に使います）

## 環境変数

| 変数                                         | 既定                 | 説明                                               |
| -------------------------------------------- | -------------------- | -------------------------------------------------- |
| `WASEDA_PORTAL_PUBLIC_ONLY`                  | `false`              | 公開データのみに制限                               |
| `WASEDA_PORTAL_HTTP_HOST`                    | `127.0.0.1`          | 待ち受けアドレス                                   |
| `WASEDA_PORTAL_HTTP_PORT`                    | `8787`（`PORT`も可） | 待ち受けポート                                     |
| `WASEDA_PORTAL_HTTP_ALLOWED_HOSTS`           | 空                   | 許可するHostヘッダ（カンマ区切り）                 |
| `WASEDA_PORTAL_HTTP_ALLOWED_ORIGINS`         | 空                   | 許可するOriginホスト名（カンマ区切り）             |
| `WASEDA_PORTAL_HTTP_REQUESTS_PER_MINUTE`     | `20`                 | クライアントごとの`/api`上限。`/mcp`はこの5倍      |
| `WASEDA_PORTAL_HTTP_MAX_CONCURRENT_REQUESTS` | `4`                  | 共有ブラウザの同時使用数                           |
| `WASEDA_PORTAL_BROWSER_CHANNEL`              | `chrome`             | 空にするとバンドル版Chromium                       |
| `WASEDA_PORTAL_MIN_ACCESS_INTERVAL_MS`       | `250`                | 早稲田側への最小アクセス間隔（プロセス全体で直列） |

## 早稲田側への負荷

クラウド配備では全テスターのアクセスが1つのIPから出ます。上流アクセスは`LiveWasedaSources`の直列リミッタで1本に絞られ、`WASEDA_PORTAL_MIN_ACCESS_INTERVAL_MS`の間隔が入り、正規化済み結果は既定5分キャッシュされます。それでも、共有テストを始める前に次を決めてください。

- 同時テスター数の上限（まずは10人程度）
- `WASEDA_PORTAL_MIN_ACCESS_INTERVAL_MS`を`1000`以上に上げる
- テスト期間を区切り、終わったらコンテナを止める

これは非公式ツールであり、大学の利用規約とアクセス負荷について配備者が責任を持ちます。

## MCPクライアントの登録

`/mcp`は認証なしの公開エンドポイントです（公開データしか返さないため）。

- **Claude**: 設定 → コネクタ → カスタムコネクタを追加 → `https://<your-domain>/mcp`。無料プランでもカスタムコネクタを1つ登録できます。
- **ChatGPT**: 設定 → Apps → 開発者モードを有効化してMCPサーバーを追加。開発者モードはPlus・Pro・Business・Enterprise・Eduのみで、無料プランでは使えません。
- **Gemini CLI**: `~/.gemini/settings.json`のMCPサーバー設定に追加。Googleアカウントの無料枠で使えます。
- **VS Code / Cursor / Cline**: それぞれのMCP設定にHTTPエンドポイントとして登録。

無料プランのテスターにはWeb UI（`/`）を案内してください。アカウントもクライアント設定も不要です。
