# Self-Growth Agent

Pure JavaScriptのDSLを使用した自己成長型エージェント。

## 使い方

### 1. エージェントの実行

以下のコマンドでエージェントを起動します。

```bash
deno run --allow-read --allow-write --allow-env --allow-net agent.js "文字列 'hello world' を反転させる新しいスキル reverseString を作成して実行してください。"
```

> [!NOTE]
> `deno` コマンドが認識されない場合は、ユーザープロファイル下のパスを使用してください：
> `& "$env:USERPROFILE\.deno\bin\deno.exe" run --allow-read --allow-write --allow-env --allow-net agent.js "..."`

### 2. テストの実行

```bash
deno test --allow-read --allow-write --allow-env --allow-net
```

> [!NOTE]
> コマンドが認識されない場合は `& "$env:USERPROFILE\.deno\bin\deno.exe" test ...` を使用してください。

## DSL仕様 (Pure JavaScript)

エージェントとランタイム間のメッセージは、XMLではなく以下のJavaScriptオブジェクト形式でやり取りされます。

### アクション (LLM出力)

#### スキルの作成・更新
```javascript
{
  type: "action",
  name: "create_skill",
  skillName: "スキル名",
  code: `export default async function run(agent, arg) {
    // スキルの実装コード（複数行文字列にはバッククォートを使用）
    return "result";
  }`
}
```

#### スキルの実行
```javascript
{
  type: "action",
  name: "run_skill",
  skillName: "スキル名",
  arg: "引数"
}
```

#### 処理の完了
```javascript
{
  type: "action",
  name: "finish",
  message: "ユーザーへの最終回答メッセージ"
}
```

### イベント (履歴管理・実行結果のフィードバック)

#### ユーザー入力
```javascript
{
  type: "event",
  eventType: "user_input",
  text: "ユーザー入力の内容"
}
```

#### スキルの実行・作成結果
```javascript
{
  type: "event",
  eventType: "execution_result",
  status: "success", // もしくは "error"
  output: "実行出力またはエラー内容"
}
```
