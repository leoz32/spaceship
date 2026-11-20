# 🕹️ Spaceship IDE 中文版

用旋钮和滑块参与故事创作：向前探索，向后重写，随时调整人物、线索与叙事方向。

这是 [Chuanqi Sun 的 Spaceship IDE](https://github.com/chuanqisun/spaceship) 的中文分支。保留原作者的交互设计、生成调度与 MIT 许可证。上游介绍见 [README.en.md](README.en.md)。

## 运行

建议使用 Node.js 24 LTS 和桌面浏览器。

```bash
git clone --branch zh-CN https://github.com/leoz32/spaceship.git
cd spaceship
npm ci
npm run dev
```

打开终端显示的地址。模拟模式不需要 API 密钥，使用中文故事和演示评分。首次运行需要联网安装依赖。

## 操作

- **阅读与重写**：拖动正文末尾的圆点向前阅读；往回拖动可丢弃后续文本，探索新写法。
- **重点高亮与锁定**：双击圆点查看模型选出的重点；拖动高亮内容，让后续生成围绕该人物或线索。
- **方向旋钮**：双击圆点后按住，拉出方向旋钮，调节张力、节奏、语气等；拉远旋钮增加影响强度，双击删除。
- **模拟 / 实时**：底部切换模式。模拟模式用于体验；实时模式使用你配置的模型并消耗 API 额度。

中文按字、英文按词控制阅读位置与速度，关键词高亮使用中文分词。这些计数不是模型计费的 token 数。

## 本分支的汉化范围

主应用界面、无障碍标签、操作说明、默认故事、生成与分析提示词，以及中文标点、逐字回退与高亮定位。`extra/` 保留上游的英文设计过程和历史实验，入口已注明。

## 实现边界

“60 FPS”是上游探索的未来交互设想，不是每秒完成 60 次模型推理的性能承诺。当前体验来自流式生成、提前生成、缓存和取消过期请求。界面重点和分数是对文本的分析，不是模型内部注意力权重，也没有直接修改模型的激活向量。

## 致谢与许可

原作者：[Chuanqi Sun](https://github.com/chuanqisun)。上游：[chuanqisun/spaceship](https://github.com/chuanqisun/spaceship)。使用和再分发请保留 [MIT LICENSE](LICENSE) 与原作者信息。引用信息见 [CITATION.cff](CITATION.cff)。
