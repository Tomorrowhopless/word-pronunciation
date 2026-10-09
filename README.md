# word-pronunciation · 中英对照词典

同时提供网页版和 Chrome / Edge 离线插件。中文释义、英语解释、例句与逐句中文放在一起；英语朗读固定使用 Cori 英式声音。

- [打开网页版](https://Tomorrowhopless.github.io/word-pronunciation/)
- [下载完整离线插件](https://github.com/Tomorrowhopless/word-pronunciation/releases/latest)

## 使用网页版

打开网站，输入英文单词或短语并按回车。词库按需加载；词级中文与内置核对译文直接显示，其余逐句中文可点击“生成中文”。朗读和翻译都在当前设备计算，不调用在线翻译或语音 API。

首次使用需要联网读取资源：英语朗读约 155 MB，逐句翻译约 275 MB（部分运行资源共用），请保持页面打开。网页版不承诺全部词库在断网后可用；完整离线使用请选择插件。查词计算在本机，但托管平台仍会收到普通资源请求。

## 安装离线插件

1. 在 Releases 下载 `word-pronunciation-4.7.0.zip` 并解压，保留其中的 `word-pronunciation` 文件夹。
2. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`，开启开发者模式，点击“加载已解压的扩展程序”，选择该文件夹。
3. 在工具栏固定书本图标。点击图标查词，或在普通英文网页上双击单词。

插件包含完整词库与模型，不需要本地服务器。更新文件后重新加载插件并刷新英文网页。浏览器内部页、扩展页及部分 PDF 阅读器无法使用双击查词，可改用工具栏输入框。

设置试听直接播放 `assets/piper-gb-demo.wav` 原音频（Apple. Dictionary. Education.），查词采用同一 Cori 模型生成声音。旧声音偏好首次迁移为 Cori、1 倍速，之后可调整查词速度。

## 词库与模型

英语 1,241,489 个词条，中文 768,739 个词条；89,911 个英语词条带 IPA，202,081 个带例句。英语来源为 Wordset 和 Wiktionary 提取数据，中文来源为 ECDICT；模型为 Opus 英汉翻译与 Piper Cori high。来源、固定版本、许可和改编记录见 [DATA-LICENSE.html](DATA-LICENSE.html)、[models/NOTICE.md](models/NOTICE.md)、`data/*build-info.json`。

机器翻译、原始词库和生成的发音可能存在错误；保留英文供核对。缺少的音标和例句不会补造。本项目不是 Oxford 官方词典。

## 开发与发布

源码仓库不直接保存大型模型和生成资源。需要运行完整版本时，请从 Releases 下载完整包；源码 ZIP 不等于可离线运行的插件。

开发时，先将完整安装包中 `word-pronunciation` 文件夹的内容复制到源码目录，再执行下列测试、资源校验和打包命令。

- `npm test`：检查程序行为。
- `node scripts/verify-local-model.js`：校验完整安装包中的模型与运行库。
- `node scripts/verify-local-data.js`：校验完整词库。
- `npm run release:package`：生成完整 ZIP 与 SHA256。
- 发布流程见 [docs/GITHUB-PUBLISH.md](docs/GITHUB-PUBLISH.md)。

发布工作流使用同一完整包部署 GitHub Pages，网站资源从同一站点读取。源码、词库与各第三方模型分别遵循对应许可；完整安装包保留许可、模型卡与来源记录。

程序基于 [WordWorkshop](https://github.com/atishmish/dictionary_browser_extension)（MIT，源码修订 ebf2a88f36f9c1ff8f588b4e77724a995b84464d）改编。
