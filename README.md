> Deepseek Harness 插件：显示账号余额

# dsh-balance

在 DSH 输入框下方的统计行显示当前登录账号的剩余余额。

## 安装

```
plugin_manager install_bundle target=git+https://github.com/Oceanisher/dsh_balance.git#v1.0.1
```

安装后重启 DSH。卸载：`plugin_manager remove_bundle target=@local/dsh-balance`。

## 效果

输入框下方最后会出现一枚钱包图标 + 余额，例如 `¥12.30`。

- 悬停显示充值余额与赠送余额的拆分，点击立即刷新；
- 每轮对话结束、窗口重新聚焦、页面回到前台时自动更新，最长 5 分钟兜底一次；
- 未登录或读取失败时不显示，不影响其他界面。

需要 DeepSeek 账号登录；API Key 模式下没有余额可读。
