# 模型接口说明

本分支将“写故事”和“分析故事”分别配置。两者可以使用同一组配置，也可以选择不同厂商。默认分析使用 Chat Completions 返回的 JSON，不需要 Gemini Key；原生 Gemini Decisions 是可选后端。

**文档核验日期：2026-11-20。** 下列国内厂商的地址、型号和参数依据当日查阅的官方文档整理；Cerebras 与 Gemini 原生接口保留上游配置。已经完成本地协议模拟和错误处理测试，没有逐家使用真实付费账户测试可用性、延迟或中文效果。型号和接口权限请以自己的账户为准。

## 预设地址和模型

设置中的 Base URL 应填写接口前缀，程序追加 `/chat/completions`；若已填完整 Chat Completions 地址，也不会重复追加。

| 厂商             | Base URL                                            | 本分支默认模型                  | 快速模式发送的顶层参数           |
| ---------------- | --------------------------------------------------- | ------------------------------- | -------------------------------- |
| DeepSeek         | `https://api.deepseek.com`                          | `deepseek-flash`                | `thinking: {"type":"disabled"}`  |
| 通义千问 · 百炼  | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-flash`                    | `enable_thinking: false`         |
| 豆包 · 火山方舟  | `https://ark.cn-beijing.volces.com/api/v3`          | `doubao-seed-2-0-mini-260428`   | `thinking: {"type":"disabled"}`  |
| 硅基流动         | `https://api.siliconflow.cn/v1`                     | `deepseek-ai/DeepSeek-V4-Flash` | `enable_thinking: false`         |
| 智谱 GLM         | `https://open.bigmodel.cn/api/paas/v4`              | `glm-4.7-flash`                 | `thinking: {"type":"disabled"}`  |
| Command Code     | `https://api.commandcode.ai/provider/v1`            | `deepseek/deepseek-v4-flash`    | 默认关闭，不自动添加上游厂商参数 |
| Cerebras（上游） | `https://api.cerebras.ai/v1`                        | `gpt-oss-120b`                  | `reasoning_effort: "low"`        |
| 自定义           | 自行填写                                            | 自行填写                        | 不自动添加厂商专有参数           |

每个预设的模型名与地址都可编辑。关闭快速模式后，不发送表中的专有参数，交给厂商默认处理。换用仅支持思考的型号时，不要沿用“关闭思考”设置。

请求使用 `stream:true` 接收正文。Cerebras 使用 `max_completion_tokens`，其他预设使用 `max_tokens`。智谱温度限制在 0–1；其他厂商按请求传入。某些型号会忽略温度或要求固定值，本分支不保证其采样参数与所有型号完全一致。

### DeepSeek

官方首页当前推荐 `deepseek-flash`。快速模式使用非思考模式；JSON 分析请求使用 `response_format:{"type":"json_object"}`，提示词明确包含 JSON 要求。

官方文档说明 JSON 输出可能返回全空格。本分支会将空内容识别为失败，不把它当成有效评分；也不会无限重试。

官方来源：[首次调用](https://api-docs.deepseek.com/)、[Chat Completions 参数](https://api-docs.deepseek.com/api/create-chat-completion/)、[JSON 输出](https://api-docs.deepseek.com/guides/json_mode/)。

### 通义千问 / 阿里云百炼

默认使用北京地域的通用域名。官方文档也提供工作空间专属域名，例如 `https://工作空间ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`；使用其他地域时，需要对应地域的地址和 API Key。

专属工作空间域名需另外加入本机代理允许来源。通用旧域名在核验日的官方文档中仍注明可用。直接发送 HTTP JSON 时，`enable_thinking` 放在请求顶层，不使用 Python SDK 示例中的 `extra_body` 外壳。

官方来源：[OpenAI 兼容 Chat](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions)、[结构化输出](https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output)、[思考模式](https://www.alibabacloud.com/help/en/model-studio/deep-thinking)。

### 豆包 / 火山方舟

预设选择官方列表中的 Mini LTS 型号。也可填写账户已开通的模型或推理接入点 ID。接口返回模型不存在或无权访问时，应检查模型服务开通状态和 ID。

结构化输出能力以型号为单位，不应认为所有豆包模型都接受相同的 JSON、思考或温度参数。

官方来源：[快速入门](https://docs.volcengine.com/docs/ark/quick-start)、[模型列表](https://docs.volcengine.com/docs/ark/model-list?lang=en)、[结构化输出](https://docs.volcengine.com/docs/ark/structured-output-beta?lang=zh)。

### 硅基流动

默认模型名来自官方 Chat Completions 示例，包含 `deepseek-ai/` 前缀。平台可能调整可用型号；若该 ID 不可用，请从账户模型列表复制完整 ID，不要仅填写模型显示名称。

`enable_thinking` 和 JSON 模式的支持取决于具体模型。取消快速模式或强制 JSON 模式可以停止发送对应参数，但不能让本来不支持结构化输出的模型自动获得该能力。

官方来源：[快速上手](https://docs.siliconflow.cn/docs/userguide/quickstart)、[Chat Completions 参数](https://docs.siliconflow.cn/docs/api/chat-completions-post)、[JSON 模式](https://docs.siliconflow.cn/docs/userguide/guides/json-mode)。

### 智谱 GLM

默认 `glm-4.7-flash`，按照官方接口的温度范围处理。切换到要求开启思考的型号时，应取消快速模式。普通文本和推理文本在流中分开返回，本分支只将正文 `delta.content` 用于故事或分析。

官方来源：[OpenAI API 兼容](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction)、[GLM-4.7-Flash](https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash)、[对话补全](https://docs.bigmodel.cn/api-reference/模型-api/对话补全)。

### Command Code

预设使用官方 Provider API 的 Base URL `https://api.commandcode.ai/provider/v1`，通过 `/chat/completions` 与 `Authorization: Bearer ...` 调用。API Key 应来自 Command Code。默认模型 `deepseek/deepseek-v4-flash` 来自官方快速入门与流式示例；不要替换为 DeepSeek 官方接口的 `deepseek-flash`，除非 Command Code 的模型列表明确包含该 ID。模型名称仍可在界面修改。

官方说明支持 `stream:true`，流末尾可能包含独立用量帧；本分支会处理这类帧。预设默认关闭快速模式，不照搬 DeepSeek、通义或其他上游厂商的专有思考参数。兼容 JSON 评分沿用 Chat Completions 的结构化提示和结果校验，具体型号是否接受 `response_format` 仍需连接后验证；不支持强制 JSON 时可在模型设置中关闭。

**协议范围：** 官方说明 OpenAI 与开放模型可使用 Chat Completions，但 Claude 只能使用 `/messages`。本项目未实现 Anthropic Messages、Responses 或 Command Code 的 `/systemone` 决策协议，因此不能仅修改模型名就使用这些专用接口。选择其他模型时，应查看模型列表中的 `supported_endpoints`。

**当前验证状态：** 已完成预设和代理的本地模拟请求测试，也已读取公开 `/provider/v1/models` 目录。真实连接检查遇到了 `HTTP 403 / upgrade_required`，未取得生成正文，也未继续执行 JSON 评分。官方文档将该错误解释为套餐未开放 Provider API；使用前需要在平台检查账户的 API 权限。成功的流式续写、JSON 评分、真实响应速度和中文效果仍待有相应权限的账户验证。测试脚本只记录受控错误码和服务实际返回的用量，不保存密钥。

官方来源：[Provider API、模型协议与流式请求](https://commandcode.ai/docs/provider)。

### Cerebras 与 Gemini 原生模式

Cerebras 的 `gpt-oss-120b` 生成配置和 Google 的 `https://generativelanguage.googleapis.com/v1beta/decisions` 来自上游。保留它们用于兼容原版，不代表本分支已经验证当前账户拥有其权限。

选择原版 Gemini Decisions 后，仅评分交给它，重点选择和方向菜单仍调用分析聊天模型。界面的“测试分析模型”测试聊天接口，不测试 Gemini Decisions。

来源：[上游 Cerebras 实现](https://github.com/chuanqisun/spaceship/blob/master/src/llm/cerebras.ts)、[上游 Decisions 实现](https://github.com/chuanqisun/spaceship/blob/master/src/llm/decisions.ts)、[Cerebras 官方 Chat Completions 文档](https://inference-docs.cerebras.ai/api-reference/chat-completions)。

## JSON 评分的含义

兼容模式把原版分析问题转换成结构化提示词，使用分析模型的非流式 Chat Completions 请求。默认启用 `response_format:{"type":"json_object"}`；关闭强制 JSON 后仍要求模型返回 JSON，并执行相同校验。

- `score`：返回评分标准中的位置，范围为 0 至标准条数减 1，允许小数。
- `noul`：返回 0–1 的符合程度估计。
- `choice`：必须返回题目中已有的选项键。

缺少问题、错误类型、超出范围或不存在的选项都会报错。评分问题每批最多 8 个，同一时刻最多执行一个决策批处理任务；取消排队任务不会使旧结果覆盖新文本。

这些结果是**模型对文字的估计**，不是模型内部注意力，也不是经过校准的概率。兼容模式不会填造概率分布。`confidence` 若由模型输出会校验 0–1 范围；缺失时保留为 0，不据此宣称分析可靠。

## 本地代理与自定义地址

`npm run dev` 和 `npm run preview` 提供同源 `/api/llm` 代理。前端把完整目标 URL、认证头和 JSON 请求体发送给本机代理；代理只转发有限认证头、仅允许 Chat Completions 和原版 Gemini Decisions 路径，不保存密钥。

默认允许这些来源：

- `https://api.deepseek.com`
- `https://dashscope.aliyuncs.com`
- `https://dashscope-intl.aliyuncs.com`
- `https://ark.cn-beijing.volces.com`
- `https://api.siliconflow.cn`
- `https://api.siliconflow.com`
- `https://open.bigmodel.cn`
- `https://api.commandcode.ai`
- `https://api.cerebras.ai`
- `https://generativelanguage.googleapis.com`

其他来源需写入项目 `.env`：

```dotenv
SPACESHIP_ALLOWED_ORIGINS=https://example-workspace.cn-beijing.maas.aliyuncs.com,http://127.0.0.1:11434
```

这里填写真实的完整来源 `协议://主机:端口`，不能包含路径、账号密码、查询参数或片段。示例工作空间域名需替换。外部服务要求 HTTPS；HTTP 只允许 localhost、127.0.0.1、IPv6 回环本机地址。修改后重启服务器。

自定义无密钥接口可以留空 Key，例如自己运行的本机模型服务。是否兼容流式输出、JSON 格式和请求参数，仍需具体服务验证。浏览器直连同样限制外部地址使用 HTTPS，且必须满足服务端 CORS；未对表内每家厂商的浏览器直连权限做实测。

此代理只供个人本机使用，不是可公开部署的通用转发服务。静态 `dist/` 不含代理；部署到 GitHub Pages 等静态托管时，应使用满足 CORS 的直连服务，或自行实现安全的后端。

## 已验证与未验证

已通过模拟请求验证的项目包括：

- 中文 UTF-8 分包、CRLF 拆分、多行 SSE 事件、最后未闭合帧和 `[DONE]`。
- 忽略推理文本与纯用量帧，处理 JSON 回退、空内容和长度截断。
- 取消请求、提前停止后释放响应流、决策排队取消和批处理。
- HTTP 错误提示、密钥脱敏、JSON 类型与范围校验。
- 默认会话密钥、主动持久化、旧密钥迁移、清除密钥，以及跨标签页配置变化时的密钥绑定。
- 本机代理的来源限制、路径限制、请求大小限制、超时与上游取消。

尚未验证：各厂商账户的真实权限、模型是否对该账户可用、真实首段延迟与吞吐量、所有型号的参数差异、真实中文创作效果，以及各网站来源的浏览器 CORS 权限。模拟测试通过不能代替这些检查，也不构成 60 FPS 性能承诺。

返回 [使用说明](../README.md)。
