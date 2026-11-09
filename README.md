# @local/dsh-balance

在输入框下方的统计行（`conversation.composer.dock`）里显示当前登录账号的剩余金额。

## 安装

直接从 Git 仓库安装（把地址换成你自己的仓库）：

```
plugin_manager install_bundle target=git+https://github.com/<owner>/dsh-balance.git#v1.0.0
```

也可以解压 tgz 或用目录路径安装，见仓库根目录的安装说明。安装后需要重启 DSH。

## 显示规则

- 金额来自 Host 已挂载的账户能力 `ctx.remote.account.getBalance()`，读取的是 Platform 充值钱包（`normal_wallets`）与赠送钱包（`bonus_wallets`），与「设置 → 账户」的余额卡片同源。
- 主文案形如 `余额 ¥12.30 · $4.50`；悬停标题里分别列出充值余额与赠送余额。
- 未登录、读取失败、或钱包列表为空时整枚控件隐藏，不显示 0 元。
- 金额格式与账户页一致：两位小数、千分位、正的亚分金额显示 `<0.01`、负值最小显示 0.01。

## 刷新策略

余额不是流式的，所以控件在以下时机重读：

- 挂载时一次；
- **一轮对话结束时**：dock 条目从 shell 拿到 `useSession` / `useProjection`，`running` 由 true 变 false（Turn 结束）或 `tokenUsage` 投影前进（每次模型尝试完成）都会触发一次重读，两个信号经 1.5 秒尾随去抖合成一次请求；
- 窗口重新获得焦点时；
- 页面从后台变为可见时；
- 点击控件时（绕过 15 秒缓存）；
- 页面持续打开时每 5 分钟一次（兜底）。

同一页面上多个 composer 实例共用 15 秒缓存与同一个进行中的请求。若将来的 shell 不再向 dock 条目转发这两个 hook，控件会退化为「挂载 + 焦点 + 点击 + 5 分钟」的旧行为，不会报错。

## 结构

| 文件 | 作用 |
|---|---|
| `client.js` | 浏览器半：注册 `balance` dock 条目（order 2，排在 activity/usage 之后）并渲染 |
| `index.js` | Host 半：空 `apply`，让包出现在 Loader 行里 |
| `cordis.patch.yml` | 插入一个 `dsh-balance` 行 |
| `locale/*.json` | 插件列表里的标题与描述 |
| `dev/client-harness.mjs` | 离线桩测试：桩化 module loader、React、context，跑注册与格式化断言 |

## 本地验证

```powershell
node dev/client-harness.mjs
```

## 安装与卸载

安装（已执行）：

```
plugin_manager install_bundle target=<本目录绝对路径>
```

卸载：`plugin_manager remove_bundle target=@local/dsh-balance`。

当前 profile 以 `link:` 方式引用本目录，因此改完 `client.js` 后需要重启 DSH（仅刷新页面可能仍拿到旧代码）；Host 半的重启在安装时会自动 HMR。

## 已知限制

- `clientVersion()` 先读 `window.__DSH_BOOT__` 上的版本；读不到时回退到 `0.2.2-rc.1`。DSH 升级后若版本回退值过期，余额读取可能被 Platform 拒绝，此时控件会安静隐藏。
- 余额只在上述时机刷新，一轮对话进行中不会逐 token 变化。
