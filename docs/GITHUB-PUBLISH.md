# GitHub 分享与发布

项目有两种入口：完整 ZIP 是无需服务器的 Chrome/Edge 离线扩展；GitHub Pages 是可直接打开的网页。网页版首次访问需要网络取得站点资源；只有网页明确完成离线保存后才可承诺断网可用。浏览器存储可能被清理，扩展安装包始终自带资源。

## 源码与完整安装包

源码仓库保留程序、测试、构建脚本、模型卡、许可证、来源和哈希记录；`.gitignore` 排除生成的模型权重、WASM、词库压缩桶及运行库 bundle。直接下载 GitHub 自动生成的 Source code ZIP **不能作为完整扩展安装包**。

在有全部正式资源的本地目录执行：

```sh
npm test
node scripts/verify-local-data.js
node scripts/verify-local-model.js
npm run release:package
```

需要单独上传可公开源码时执行 `python3 scripts/package-release.py --source-output dist/source`；此目录剔除大资源和本机验证记录，并拒绝含具体用户主目录路径的文本。

生成 `dist/wordworkshop-<版本>.zip` 和同名 `.zip.sha256`。ZIP 顶层为 `WordWorkshop/`，包含 manifest、所有运行模块、完整 data/models/vendor/assets、web 以及许可资料；不包含本机部署说明、历史验证记录、PRODUCT.md、测试及开发临时资料。打包器只收录明确的运行目录与文件，并检查作者文本中的本机绝对路径；发布前仍应检查源码 diff 和公开许可资料。

插件使用者解压后，在 Chrome/Edge 的扩展管理页启用开发者模式，以“加载已解压的扩展”选择 `WordWorkshop` 文件夹。不要选择外层下载目录。

## 发布顺序

1. 确认目标 GitHub 仓库、公开性及版本号，再提交源码和 tag；首次提交前检查 `git status --short`，不要强行添加被忽略的大资源或本机记录。
2. 仓库 Settings → Pages → Build and deployment 选择 **GitHub Actions**。
3. 创建该版本的 **Draft Release**，上传上述完整 ZIP 和 SHA256 两个资产；确认上传完成后再发布 Release。
4. `publish.yml` 在 Release published 时执行，也可从 Actions 手动输入已有 Release tag 重跑。流程通过 GitHub CLI 下载完整资产、核对 SHA256、检查解压路径及站点大小，然后发布 Pages。
5. Pages 输出根目录保留资源相对路径，入口跳转 `./web/`。网页通过 `../data/`、`../models/`、`../vendor/` 和根模块访问同源资源，不在用户浏览器中跨域下载 Release 模型。

该流程不会创建仓库，也不会自动上传本地文件；发布需由拥有目标仓库权限的人完成。仓库 Pages 配置或套餐不满足要求时，部署会如实失败。

## 容量与许可

- GitHub 普通 Git 文件超过 **100 MiB** 会被阻止：[大文件说明](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)。模型通过 Release 分发，不进入 Git 历史。
- Release 每个资产必须小于 **2 GiB**：[Release 限制](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)。
- Pages 发布站点不超过 **1 GB**，并有每月 **100 GB** 软带宽限制：[Pages 限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)。脚本以十进制 1 GB 保守检查安装包解压体积。大规模使用时需重新评估分发方式。
- GitHub Free 的 Pages 用于公开仓库；其他套餐的私有仓库能力见 [Pages 官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)。不要假设私有源码会使已发布网站内容保密。

所有模型、词库、音素引擎和运行库的现有许可、模型卡、NOTICE、provenance 一并保留。项目程序的 MIT 许可不能替代 eSpeak NG 的 GPL 或数据自身的许可；具体归属以 `DATA-LICENSE.html`、`models/NOTICE.md`、`vendor/piper/NOTICE.txt` 为准。
