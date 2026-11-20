# 🕹️ Spaceship IDE 中文版

用旋钮和滑块参与故事创作：向前探索，向后重写，随时调整人物、线索与叙事方向。

这是 [Chuanqi Sun 的 Spaceship IDE](https://github.com/chuanqisun/spaceship) 的中文分支，代码位于 [leoz32/spaceship · zh-CN](https://github.com/leoz32/spaceship/tree/zh-CN)。保留原作者的交互设计、生成调度与 MIT 许可证。上游英文介绍见 [README.en.md](README.en.md)。

本分支提供中文界面、中文示例与文本适配，以及可配置的生成和分析模型。**模拟模式无需 API Key；实时模式默认只需一家厂商的一个 API Key，不依赖 Gemini。**

## 在本机运行

使用 **Node.js 24 或更新版本**、npm 和桌面浏览器。本机负责界面与请求转发，模型由所选 API 服务提供，不需要为这个前端安装 CUDA 或下载模型权重。

```bash
git clone --branch zh-CN https://github.com/leoz32/spaceship.git
cd spaceship
npm ci
npm run dev
```

打开终端显示的本机地址，通常为 `http://127.0.0.1:5173/`。首次安装依赖需要联网。默认进入模拟模式，使用中文故事和演示评分，可先体验交互。

验证构建后的版本：

```bash
npm run build
npm run preview
```

`dev` 和 `preview` 都包含本机模型代理，默认只监听 `127.0.0.1`。

## 接入自己的模型

1. 打开页面底部的 **模型设置**。
2. 选择生成模型厂商，填写该厂商的 **API Key**。接口地址和模型名会带入预设，也可以修改。
3. 初次使用保留 **分析复用生成模型**，只需一组配置。取消勾选后，可为重点选择、方向菜单和 JSON 评分单独选择分析模型。
4. 本机运行保留 **本地代理**。需要时点击 **测试生成模型** 或 **测试分析模型**，检查流式连接和首段响应时间。
5. 点击 **保存并开始实时生成**。

连接测试和实时生成会消耗所选服务的 API 额度。测试按钮只测试聊天模型的流式连接，不测试独立的 Gemini Decisions 权限，也不代表已验证所有评分功能。

**保存并应用设置、切换模式会重新载入页面，当前故事重新开始。** 这个原型没有故事自动保存功能；需要保留的文字请先复制。

### 可选厂商

| 厂商                   | 默认模型                        | 用法提示                                                               |
| ---------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| DeepSeek               | `deepseek-flash`                | 本分支默认选择；快速模式关闭深度思考                                   |
| 通义千问 · 阿里云百炼  | `qwen-flash`                    | 默认北京地域；其他地域或专属工作空间需修改接口地址                     |
| 豆包 · 火山方舟        | `doubao-seed-2-0-mini-260428`   | 可替换为账户已开通的模型 ID 或推理接入点 ID                            |
| 硅基流动               | `deepseek-ai/DeepSeek-V4-Flash` | 模型名包含组织前缀，需与平台模型列表一致                               |
| 智谱 GLM               | `glm-4.7-flash`                 | 温度会限制在该接口支持的 0–1 范围                                      |
| Command Code           | `deepseek/deepseek-v4-flash`    | 使用 Command Code API Key；仅接入 Chat Completions 模型，不支持 Claude |
| Cerebras（原版）       | `gpt-oss-120b`                  | 保留上游的生成接口                                                     |
| 自定义 OpenAI 兼容接口 | 自行填写                        | 支持 Chat Completions 协议；不直接支持 Responses 或 Anthropic 原生协议 |

国内厂商预设依据 **2026-11-20 查阅的官方文档**配置；Cerebras 保留上游配置。本分支进行了协议模拟测试，**没有逐家使用真实账户实测**。预设不表示所有账户均已开通，也不表示该厂商所有型号都兼容。型号、Base URL、快速模式和强制 JSON 模式均可调整。详细地址、参数差异和文档来源见 [模型接口说明](docs/providers.md)。

Command Code 的 Base URL 为 `https://api.commandcode.ai/provider/v1`，默认模型来自其[官方示例](https://commandcode.ai/docs/provider)，可改为账户支持的其他 Chat Completions 模型。它使用 Command Code 的密钥，不是 DeepSeek 官方密钥；预设不额外发送上游厂商的思考参数。**当前验证范围**：公开模型目录和本地协议测试已完成，成功的真实续写与 JSON 评分仍待验证。使用该接口需要账户具备 Provider API 权限；若返回 `HTTP 403 / upgrade_required`，请在平台账户设置中检查套餐的 API 权限。该平台的 Claude 仅支持 `/messages`，不适用于本项目当前的聊天协议。

评分方式默认是 **兼容模型 · JSON 评分**。也可选择 **原版 Gemini Decisions** 并填写单独的 Gemini Key；此时仅评分使用原版 Decisions 接口，重点选择与方向菜单仍由上面的分析模型完成。

## 基本操作

- **阅读与重写**：拖动正文末尾的圆点向前阅读；往回拖动可丢弃后续文本，探索新写法。
- **重点高亮与锁定**：双击圆点查看模型选出的重点；拖动高亮内容，让后续生成围绕该人物或线索。
- **方向旋钮**：双击圆点后按住，拉出方向旋钮，调节张力、节奏、语气等；拉远旋钮增加影响强度，双击删除。
- **模拟 / 实时**：底部切换模式。模拟用于体验；实时使用自己的模型配置。

中文按字、英文按词控制阅读位置与速度，关键词高亮使用中文分词。这些计数不是模型计费的 token 数。

## 代理与部署

### 本机代理

本机代理用于避免浏览器直连厂商时的跨域限制。它只接受本机访问、校验页面来源和上游目标，不保存 API Key，也不会跟随上游重定向。

内置厂商的常用来源已允许。使用自定义服务、百炼专属工作空间或本地模型时，在项目根目录新建 `.env`，填写额外允许的**完整来源地址**：

```dotenv
SPACESHIP_ALLOWED_ORIGINS=https://example-workspace.cn-beijing.maas.aliyuncs.com,http://127.0.0.1:11434,http://localhost:1234
```

将示例工作空间替换为自己的实际域名。这里仅写 `协议://主机:端口`，**不含 `/v1` 等路径**；多个来源以逗号分隔。`localhost` 与 `127.0.0.1` 是不同来源，端口也必须一致。

例如界面 Base URL 为 `http://127.0.0.1:11434/v1`，`.env` 中对应填写 `http://127.0.0.1:11434`。修改 `.env` 后需重启 `npm run dev` 或 `npm run preview`。

此代理面向个人本机使用，**不能直接作为公开网站的后端部署**。多人服务需要另外实现身份验证、密钥管理、额度限制与上游目标管理。

### 静态网页 / GitHub Pages

`npm run build` 输出的 `dist/` **只包含前端，不包含本机代理**。部署到仓库子路径时，可在 `.env` 中设置：

```dotenv
SPACESHIP_BASE=/spaceship/
```

然后重新构建。静态网站的模拟模式可以运行；实时模式需在模型设置中选择 **浏览器直连**，且厂商必须允许对应网站的 CORS 请求。另一个选择是自行接入安全的后端。仅上传 `dist/` 不会让 `/api/llm` 自动可用。

## 密钥与数据

- 默认密钥放在当前标签页的 `sessionStorage`，页面刷新仍可使用；不自动长期记住。
- 勾选 **记住密钥** 后，密钥才会写入当前浏览器的 `localStorage`。不要在共享浏览器上勾选。
- 模型名称、接口地址等非秘密设置会保存在当前浏览器。密钥绑定厂商和地址，避免另一标签页改变配置后误用旧密钥。
- 可通过 **清除已保存密钥** 删除新旧设置中的密钥；已经发送的请求可能仍会完成。
- 实时模式会把需要续写或分析的故事内容发送给所选 API 服务。本机代理只负责转发，使用它不代表模型离线运行。
- 应用从设置界面读取密钥；`.env.example` 中旧开发脚本使用的密钥变量不是界面的配置入口。不要将真实密钥提交到仓库。

## 常见问题

| 现象                                           | 检查方法                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| HTTP 401 / 403                                 | 检查 Key、模型权限、账户地域；若提示“来源未获允许”，检查代理的 `SPACESHIP_ALLOWED_ORIGINS` |
| HTTP 403 / `upgrade_required`                  | 当前套餐未开放 Provider API；到平台账户设置核对 API 权限                                   |
| HTTP 429                                       | 检查额度和限流，稍后重试；频繁调整旋钮会产生新的生成或分析请求                             |
| 提示模型不存在                                 | 将模型名改为当前账户实际可用的 ID；不要把网页产品名当成 API 模型 ID                        |
| 提示 `thinking` / `enable_thinking` 参数不支持 | 取消 **快速模式**，使用该模型默认参数；部分型号强制开启思考                                |
| 分析 JSON 无效或字段不完整                     | 检查模型是否支持结构化输出；按厂商要求开启或关闭强制 JSON 模式，并优先使用非思考分析模型   |
| 输出达到长度上限                               | 当前结果可能被截断；尝试关闭深度思考、减少上下文或换用适合短响应的模型                     |
| 浏览器直连显示网络错误                         | 检查网络和 CORS；本机使用时改为本地代理                                                    |
| 静态网页代理 404                               | 静态构建没有代理；使用浏览器直连，或自行接入后端                                           |

## 开发与验证

```bash
npm run check
npm run format:check
```

`check` 运行单元 / 协议模拟测试，并执行 TypeScript 检查与生产构建。测试覆盖中文文本范围、流式分包、取消、评分 JSON 校验、密钥存储与代理边界，使用模拟请求，不调用真实厂商。

如需在自己的网络与账户下验证 Command Code，可运行：

```bash
npm run test:commandcode
```

脚本运行时会提示输入 API Key，输入内容不显示，也无需写入 `.env`。默认依次发出两次真实请求，分别检查中文流式输出和两题 JSON 评分，输出上限分别为 512 / 600 token，**会消耗少量 API 额度**。第一轮失败就停止，不会继续第二轮或自动重试。只想先检查连接时，可运行 `npm run test:commandcode -- --smoke`，仅发送一次请求，最多 256 个输出 token；思考内容也可能占用此额度。请勿将密钥写进命令行或提交到仓库。

浏览器交互回归需要本机安装 Chromium 或 Chrome：

```bash
npm run test:ui
```

找不到浏览器时，用 `CHROME_PATH` 指向其可执行文件。例如 Linux：

```bash
CHROME_PATH=/usr/bin/chromium npm run test:ui
```

Windows PowerShell 可先设置 `$env:CHROME_PATH` 再执行命令。交互回归使用本机模拟接口，不产生真实模型费用。

## 汉化范围与实现边界

本分支汉化了主界面、无障碍标签、操作说明、默认故事、生成与分析提示词，并适配中文标点、逐字回退和高亮定位。`extra/` 保留上游的英文设计过程与历史实验；它们不代表主应用当前的多厂商配置流程。

“60 FPS”是上游探索的未来交互设想，**不是每秒完成 60 次模型推理的承诺**。当前体验来自流式生成、提前生成、缓存与取消过期请求，真实响应还取决于网络、模型和限流。

重点高亮与 JSON 分数是模型对文本的语义估计，**不是模型内部注意力权重，也不是经过校准的概率**。本分支没有直接修改模型内部激活向量，兼容分析不会虚构选项概率来冒充原生 Decisions 的返回值。

## 致谢、许可与引用

原作者：[Chuanqi Sun](https://github.com/chuanqisun)。上游：[chuanqisun/spaceship](https://github.com/chuanqisun/spaceship)。使用和再分发请保留 [MIT LICENSE](LICENSE) 与原作者信息；完整引用元数据见 [CITATION.cff](CITATION.cff)。

```bibtex
@misc{sun2026spaceship,
  author       = {Sun, Chuanqi},
  title        = {Spaceship {IDE}: Steer Your Ideas in Realtime, Space Pilot Style},
  year         = {2026},
  publisher    = {GitHub},
  howpublished = {\url{https://github.com/chuanqisun/spaceship}},
  note         = {Demo: \url{https://chuanqisun.github.io/spaceship/}}
}
```
