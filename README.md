# 💧 三张德州 · 喝水局

纯前端（HTML + JS）的多人牌桌：打开网页 → 输入昵称 → 全部准备 → 自动开局。
不需要后端、不需要数据库，**只靠一个公开 MQTT broker 转发消息**。

## 启动（推荐：自带中继，局域网可用，无需公网）

```bash
cd waterpoker
npm install ws          # 只需一次
node server.js          # 默认 8010 端口
# 电脑 http://localhost:8010   手机 http://<本机IP>:8010
```

`server.js` 同时做两件事：静态文件服务 + `/ws` 房间中继（按 4 位房号隔离）。
**纯静态托管也能跑**，此时自动退回公网 MQTT（需要外网）。

放到 Nginx / 云主机静态目录 / GitHub Pages 都能用，把整个目录上传即可：

```
index.html   app.js   engine.js   net.js   mqtt.min.js
```

> 建议用 **http(s) 访问**（而不是 file://），手机连同一个 WiFi 时用 `http://<电脑IP>:8000`。

## 玩法

| 项目 | 规则 |
|---|---|
| 人数 | 3–10 人，全部点「准备」自动开局 |
| 牌 | 52 张去大小王，每人 2 张私牌 + 台面 3 张公牌（逐张发，每张一轮下注） |
| 比牌 | 5 选 3：同花顺 > 三条 > 顺子 > 同花 > 一对 > 高牌（顺子压同花） |
| 筹码 | 每人每手 8 份 = 1 纸杯；盲注 1/2；下注 1 份、抬注 +1 份 |
| 加注 | **每人每街只能抬 1 次**，后位抬完前面只能跟或弃 |
| 全下 | 推掉全部 8 份 = 1 杯，单局最多喝 1 杯 |
| 结算 | 输家喝自己投入；弃牌喝一半；**赢家不喝** |
| 按钮 | 每手自动轮换（庄家/小盲/大盲） |

## 房间

- 默认一个房间 `main`，也可用 `?room=xxx` 开多个房间（同一房间的 MQTT topic 不同）。
- 邀请按钮会复制带房间号的链接。

## 技术说明

- **无后端**：`mqtt.min.js`（本地文件）+ 公共 broker `wss://broker.emqx.io:8084/mqtt`。
- **房主制**：第一个进房的人成为房主，状态由房主计算并广播；房主掉线 9 秒后，最先进房的在线玩家自动接管（状态完整保存在每个人本地）。
- **换 broker**：控制台执行 `localStorage.setItem('wp_broker','wss://你的broker:8084/mqtt');location.reload()`
  （自建 mosquitto/EMQX 记得开 WebSocket 端口和匿名访问）。
- **注意**：公共 broker 是明文的，且所有人收到的 JSON 里包含全部手牌 —— 这是**朋友局**（靠自觉）。要防作弊需要自己加后端做按人裁剪。

## 文件

| 文件 | 作用 |
|---|---|
| `engine.js` | 规则引擎（发牌/下注轮/比牌/结算），node 可直接 require 测试 |
| `app.js` | 房主状态机 + 同步 + 渲染 |
| `net.js` | MQTT 封装 |
| `mqtt.min.js` | 本地 mqtt.js |
| `test_engine.js` | 6400 手随机对局压测（0 异常） |
| `test_live.js` | 3 个虚拟客户端跑完整联机流程 |

---

## 部署到 GitHub Pages（免服务器）

Pages 只有静态托管，没有 Node 进程，所以会**自动改用公网 MQTT** 做房间同步（页面启动时探测 `/api/ping`：
通 → 走局域网 WS；404 → 走 MQTT）。两端只要用同一个域名打开，就一定在同一通道，不会串。

### 一次性步骤

```bash
./build_pages.sh          # 生成 docs/（6 个文件 + .nojekyll）
git add docs && git commit -m "release: pages build"
git push origin main
```

仓库设置 → **Settings → Pages** →
- Source: `Deploy from a branch`
- Branch: `main` / 目录选 **`/docs`**
- 保存后等 1~2 分钟，地址形如 `https://<用户名>.github.io/<仓库名>/`

### 注意

1. **必须 HTTPS**（Pages 默认 https），MQTT 走 `wss://broker.emqx.io:8084/mqtt`，浏览器不会拦。
2. 房间号 4 位数字 → MQTT 主题 `gzpoker/v1/<房号>`，公共 broker 上是明文的，别用房号谈机密。
3. 想自建 broker：控制台执行 `localStorage.wp_broker='wss://你的域名:8084/mqtt'` 后刷新。
4. 仓库要 public（免费账号的 Pages 限制）。
5. 局域网那套（`node server.js`）依旧可用，两边**不能混用**：局域网玩家和 Pages 玩家看不到彼此。
