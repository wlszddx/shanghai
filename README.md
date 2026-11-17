# 展小助：展会线索跟进 Agent

这是赛道二“快速构建项目”的可运行 MVP。默认业务模式只展示和保存用户自己录入的展会线索。仓库里的公开数据仅作为自动化测试 fixture；只有显式启动测试模式后，应用才会读取它。

## 启动

需要 Node.js 18 或更新版本，无需安装依赖。

```bash
npm run dev
```

打开 <http://localhost:4173>。默认模式从空白工作区开始，用户录入的线索保存在 `data/leads.json` 和浏览器本地缓存中。

## 部署到已有项目的服务器

使用 Docker Compose 将本应用作为独立容器运行。容器只在服务器本机开放 `4174` 端口，业务数据保存在专属 Docker volume，模型凭据只从项目目录下的 `.env` 读取。

在服务器安装 Docker Engine 和 Compose 插件后，将本项目文件放到独立目录，并执行：

```bash
cp .env.example .env
chmod 600 .env
nano .env
docker compose up -d --build
docker compose ps
docker compose logs -f
```

在 `.env` 中填写服务商提供的 `LLM_API_KEY`、`LLM_MODEL`，如有需要再填写 `LLM_BASE_URL`。腾讯云语音转写需在控制台开通「录音文件识别极速版」，然后填写 `TENCENTCLOUD_APP_ID`、`TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`，默认引擎为 `16k_zh_en`。密钥只保存在服务器 `.env`，请勿提交到 Git 或发在聊天里。访问或配置反向代理时使用 `http://127.0.0.1:4174`。容器更新用 `docker compose up -d --build`，停止用 `docker compose down`；不要添加 `-v`，这样可保留线索数据。反向代理应配置 HTTPS 和登录保护后再对外提供访问。

若服务器使用 Nginx，可为本应用单独分配一个子域名，并在该子域名的 HTTPS `server` 块中加入：

```nginx
location / {
    proxy_pass http://127.0.0.1:4174;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 110m;
    proxy_read_timeout 180s;
    proxy_send_timeout 180s;
}
```

录音上传需要 `client_max_body_size` 至少覆盖 100MB，语音转写可能持续两分钟，因此代理超时要放宽到 180 秒。

## 公开演示模式

比赛或评审需要公开链接时，在 `.env` 中设置：

```bash
DEMO_MODE=1
TRUST_PROXY=1
AI_RATE_LIMIT_PER_HOUR=30
STT_RATE_LIMIT_PER_HOUR=10
AI_DAILY_LIMIT=500
```

演示模式的行为：

- 线索和项目只保存在访客浏览器的 localStorage，服务端的线索/项目读写接口不落盘，评委之间互不影响，也不会覆盖真实业务数据。
- 每位访客首次打开会看到一条明确标注为“示例”的项目和线索，可直接点击重新分析体验模型匹配；也可以在“项目与标准”里重置演示数据。
- AI 分析、语音转写按客户端 IP 和全局额度限流，超限返回 429；`LLM_MAX_TOKENS` 和 `MAX_TRANSCRIPT_CHARS` 控制单次成本。
- `GET /api/health` 在演示模式下返回 `mode: "demo"`。
- 演示模式不要同时开启 `EXPO_TEST_DATA=1`，测试集接口在演示模式下保持关闭。

修改后执行 `docker compose up -d --build`，业务数据 volume 不受影响。

## 显式测试模式

```bash
npm run dev:test
```

## 配置模型 API

分析功能必须配置真实模型 API。模型服务由部署此应用的服务商在后端通过 `LLM_API_KEY`、`LLM_MODEL` 和 `LLM_BASE_URL` 环境变量配置；接口需兼容 OpenAI Chat Completions，默认地址为 `https://api.openai.com/v1`。工作台不提供模型配置入口，密钥不会发送给浏览器或终端用户。

未配置密钥或模型时，Agent 分析接口会明确返回未配置错误，不会使用关键词规则伪装成模型分析。真实密钥只存在服务端环境中，不要写入源码、前端或提交到 Git。模型调用失败时会明确提示失败，不会回退到其他分析方式。

测试模式会从 `tests/fixtures/uci-bank-marketing/bank-full.csv` 加载公开历史数据，仅通过 `/api/test-data` 和 `/api/test-data.csv` 提供。测试记录在界面中只读展示，不参与线索保存、用户统计或 Agent 分析。业务线索写入接口会剔除测试来源记录。

该 fixture 是 UCI Machine Learning Repository 的 Bank Marketing 原始数据：葡萄牙银行电话营销活动记录，不是展会或 B2B 线索。它可用于检查 CSV 读取、筛选和测试模式隔离，不能用于宣称 Agent 已通过展会销售效果验证。来源、许可与引用见 [fixture 说明](tests/fixtures/uci-bank-marketing/README.md) 和 [UCI 官方页面](https://archive.ics.uci.edu/dataset/222/bank%2Bmarketing)。

## 当前能力与限制

- 手动录入、修改展会访客线索，记录实际交流和后续跟进状态。
- 用户可创建多个项目，分别设置目标客户、必选条件、加分条件和排除项。保存访客谈话后，Agent 按各项目给出匹配、待核实或不匹配结果、原话依据和下一步建议；跟进决定由用户作出。
- 支持浏览器直接录音并自动转写。默认后端适配腾讯云「录音文件识别极速版」，返回的句子时间点和文本会一起保存；浏览器生成的 WebM 音频会在容器内转为腾讯云支持的 WAV 格式。也可将 `STT_PROVIDER` 设为 `openai`，使用 OpenAI-compatible 转写接口。语音服务未配置时仍可手动录入。浏览器录音需要 HTTPS 或 localhost。
- 谈话记录、目标客户和项目筛选标准会从本机服务端发送到所配置的模型服务商；录音文件会发送到单独配置的语音识别服务商。API 密钥只从服务端环境变量读取，不会发送到浏览器。部署者需确保已告知并获准处理录音和谈话内容。
- LLM 为每条标准整理“明确支持 / 明确否定 / 提到但不明确 / 未提及”状态，并核验输出的引文是否逐字出现在原文中。模型仍可能误解，须由用户复核；模型服务报错时不会静默退回关键词分析。
- 业务线索和多个项目标准保存在本机 `data/leads.json`、`data/projects.json` 中，无云端账号、团队协作或 CRM 同步。
- 公开演示模式（`DEMO_MODE=1`）只把线索和项目保存在访客浏览器，不写入服务端；演示用的示例项目与示例线索均已标注，不代表真实客户或真实效果。AI 与语音接口按 IP 和全局额度限流。
- 不会预置客户、公司、会话或转化数据。若要进行真实销售效果评估，需要先通过用户授权收集真实展会数据并建立可核验的评估集。

## 验证

```bash
npm test
```

测试会读取真实 fixture 并核验数据条数、标签计数、测试模式入口、业务存储隔离和用户标准比对结果。

## 数据引用

Moro, S., Rita, P., & Cortez, P. (2014). *Bank Marketing* [Dataset]. UCI Machine Learning Repository. <https://doi.org/10.24432/C5K306>. License: CC BY 4.0.
