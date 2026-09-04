# Waseda Portal Companion

macOS、iOS、Android向けのコンパニオンです。公開シラバス検索Webとは異なり、Moodleの本人用情報は端末内WebViewでだけ処理します。

## 開発

```bash
flutter pub get
flutter analyze
flutter test
flutter run -d macos
```

実行時はMoodleの公式SSO入口を開き、本人がWaseda University Login画面でログインします。ログイン後はMoodleとMyWasedaの公式ページを自動で巡回し、所属・在学年次を検出して端末内に保存します。氏名・学生番号・成績・資格情報は取得しません。シラバス検索へ移る際は、検出できた所属・年次で明記された対象外を最初から除外します。

## プライバシー

- Cookieを含む認証セッションと検出したプロフィールをクラウド同期・分析・ログ送信しません。
- 端末右上の削除操作でWebView Cookieと端末内プロフィールを消去できます。
