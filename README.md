# Self-Growth Agent

Pure JavaScriptのDSLを使用した自己成長型エージェント。

## 使い方

### 1. エージェントの実行

新たに定義された Deno タスクまたはバッチファイルを使用してエージェントを起動できます。

**Deno タスクを使用する場合:**
```powershell
deno task start "文字列 'hello world' を反転させる新しいスキル reverseString を作成して実行してください。"
```

**バッチファイルを使用する場合:**
```cmd
.\run.bat "文字列 'hello world' を反転させる新しいスキル reverseString を作成して実行してください。"
```

### 2. テストの実行

```powershell
deno task test
```


## DSL仕様 (Pure JavaScript)

エージェントとランタイム間のメッセージは、XMLではなく以下のJavaScriptオブジェクト形式でやり取りされます。

### アクション (LLM出力)

#### スキルの作成・更新
```javascript
{
  type: "action",
  name: "create_skill",
  skillName: "スキル名",
  code: "export default async function run(agent, arg) { ... }"
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
