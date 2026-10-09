# 本机英汉模型与运行库许可

本插件打包 onnx-community/opus-mt-en-zh 的 int8 ONNX 模型，来自 Hugging Face ONNX Community，转换自 Helsinki-NLP/opus-mt-en-zh。仅选择原仓库的配置、分词器、量化编码器和合并解码器，模型权重未另行修改。固定版本、文件哈希与运行库版本见 model-info.json。

ONNX 仓库声明 CC BY 4.0，许可正文：https://creativecommons.org/licenses/by/4.0/legalcode 。归属及原模型说明见 opus-mt-en-zh/MODEL-CARD.md、BASE-MODEL-CARD.md。原 Helsinki-NLP 模型当前声明 Apache 2.0，正文保留在 APACHE-2.0.txt。

Transformers.js 3.8.1 为 Apache 2.0（vendor/transformers/LICENSE）；ONNX Runtime Web 为 MIT，许可及第三方通知保留在 vendor/onnx/。本机模型生成的中文明确标作机器翻译，可能需要结合英文理解。

## 自带离线英语朗读

4.6.0 只使用 Piper 的英式 Cori high 模型，权重、配置及原始模型卡保持原样。来源：https://huggingface.co/rhasspy/piper-voices/tree/c10ece1aade47bb51c153c893d14e5bf8e5b7117 ，固定版本、各文件大小与 SHA256 见 speech-model-info.json。

仓库在 README 的元数据中声明 MIT，原声明完整保留在 piper-en/REPOSITORY-CARD.md；未为模型编造额外版权持有人。保留 piper-en/gb/MODEL_CARD；它声明 LibriVox 数据集属于 public domain，这不代表仓库所有音色的数据都适用相同许可。正式使用的 Cori 模型为 114,219,352 字节。“high”为来源的模型配置标签，听感仍需要试听判断。

设置试听文件 assets/piper-gb-demo.wav 是本机用该 Cori 模型生成并由用户选定的原始音频，文字为 Apple. Dictionary. Education.，22,050 Hz、约 2.7374 秒、120,764 字节；SHA256 2cd9357341e2e327d590589274421e0156deb452813ed6a42c42944d4099a67d。设置播放其原字节，查词使用同一模型生成。

项目用本地 ONNX Runtime Web 运行模型，新增 ort.wasm.min.mjs 与原有 jsep WASM 来自相同固定 npm 版本。ONNX Runtime 为 MIT，全文与第三方通知在 vendor/onnx/，来源与 npm 完整性记录在 speech-model-info.json。

音素前端使用 @diffusionstudio/piper-wasm 1.0.0（发布者源码 69522c832bd52d7c16389e9a8aee568065027689），仅在原 JS 末尾加入 ESM 导出；WASM 和音素数据不变。包声明 MIT，Piper-phonemize 为 MIT，内嵌 eSpeak NG 适用 GNU GPL v3 或更高版本。Emscripten 为 MIT / UIUC，uni-algo 为 MIT。不能将整个前端描述为 MIT。许可全文、源码链接、原构建步骤、哈希和本地改动保留在 vendor/piper/。

来源边界：发布者步骤固定 Emscripten 3.1.47，但浅克隆引擎源码未固定提交，因此未宣称已核实预编译引擎的精确 C++ 源码版本或能逐字节重建。见 vendor/piper/provenance.json 和 BUILD-SOURCE.md。模型、前端与声音仅从插件自身资源加载，不调用网络语音服务。原项目 MIT 许可不替代第三方组件各自的许可。
