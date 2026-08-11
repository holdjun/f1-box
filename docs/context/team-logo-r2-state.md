# 车队 Logo R2 状态

本次车队目录 PR 使用 R2 覆盖层承载策展后的 logo，不把带有外部来源的二进制图片直接提交到 Git。

## 当前状态

- 预览桶：`f1-box-preview-overrides`
- 对象前缀：`vendor/team-logos/`
- 内容：65 个 logo 文件 + 1 个 `logos.json` 索引
- 预览 Worker：通过 `F1_PREVIEW_OVERRIDES` 读取覆盖层，未覆盖的内容回退到 `f1-box-data`
- 生产桶：`f1-box-data` 未修改

## 发布

本地拥有策展资产时，可使用以下命令发布到指定的远端桶：

```sh
scripts/publish-team-logo-overrides.sh f1-box-preview-overrides
```

命令使用 `--remote`，不会写入 Wrangler 本地模拟存储。合并 PR 并完成线上验收后，如需推广到生产，执行：

```sh
scripts/publish-team-logo-overrides.sh f1-box-data
```

生产发布完成并验证后，可以移除预览 Worker 的覆盖层绑定和预览桶。当前 PR 不执行生产推广。
