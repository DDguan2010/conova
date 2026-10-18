<p align="center">
  <img src="public/favicon.svg" width="96" alt="Conova 图标">
</p>

<h1 align="center">Conova</h1>

<p align="center">面向 Bilibili 内容的极简音乐播放器</p>

<p align="center">
  <a href="https://github.com/DDguan2010/conova/releases/tag/v0.1.0">最新版本</a>
  ·
  <a href="https://github.com/DDguan2010/conova/actions">构建状态</a>
</p>

Conova 是一款基于 Node.js、React、Electron 和 Capacitor 构建的音乐播放器。它将 Bilibili 收藏夹、合集和追更内容整理为专辑式播放界面，当前支持 Windows 和 Android，并提供浏览器开发模式。

项目的核心设计是克制、直接和连续：主播放界面不显示多余文字或传统播放按钮，用户通过点击封面播放或暂停，通过手势切换音乐和专辑；设置与管理操作以统一的文字界面呈现。

## 功能特性

- **极简播放界面**：黑色背景、白色文字、方形封面和纯色平面视觉风格。
- **直接操作**：点击封面播放或暂停，左右滑动切换音乐，上下滑动切换专辑。
- **封面内播放反馈**：进度条和波形图直接显示在当前封面内部，并使用封面颜色生成模糊视觉效果。
- **连续动画**：专辑切换和设置界面使用可打断的弹簧动画，支持在动画过程中反向操作。
- **播放模式**：支持顺序播放、随机播放和单曲循环。
- **Bilibili 内容同步**：支持账号收藏夹以及“我追的专辑/收藏夹”，支持分页加载、自动同步和手动刷新。
- **Android 后台播放**：提供系统通知栏、锁屏播放控制、上一首、下一首、播放/暂停和进度调整。
- **长音频优化**：支持 HTTP/HTTPS 音频地址、备用节点切换、Range 分段读取和长音频快速拖动。
- **独立客户端**：Android 和 Windows 均可直接运行，不要求额外部署 Conova 服务。

## 下载

当前版本：**0.1.0**

- [Android APK](https://github.com/DDguan2010/conova/releases/download/v0.1.0/Conova-0.1.0-android.apk)
- [Windows x64 安装包](https://github.com/DDguan2010/conova/releases/download/v0.1.0/Conova-0.1.0-windows-x64-setup.exe)
- [SHA256 校验文件](https://github.com/DDguan2010/conova/releases/download/v0.1.0/SHA256SUMS.txt)

Android APK 的签名由仓库正式签名密钥生成。Windows 安装包当前未配置代码签名证书。

## 快速开始

### 环境要求

- Node.js 22.12+ 或 Node.js 24
- npm
- Windows 开发需要 Electron 依赖
- Android 构建需要 Android SDK 和 JDK 21

### 安装依赖

```powershell
npm install
```

### 启动开发环境

```powershell
npm run dev
```

开发服务器默认使用 `http://127.0.0.1:5173`。浏览器开发模式通过本地 Node.js 服务访问 Bilibili 接口，服务默认监听 `127.0.0.1:3210`。

如需直接查看交互样本，可打开：

```text
http://127.0.0.1:5173/?demo=1
```

演示模式使用本地封面和原创合成音频，不需要登录 Bilibili。

## Windows

启动桌面开发版本：

```powershell
npm run desktop
```

生成目录版程序：

```powershell
npm run pack:win:dir
```

生成 NSIS 安装包：

```powershell
npm run pack:win
```

目录版程序位于 `release/win-unpacked/Conova.exe`。分发目录版程序时，应保留整个 `win-unpacked` 目录。

Windows 客户端内置本地 Node.js 服务。账号登录使用 Bilibili 官方登录页面，支持扫码登录和账号登录流程。

## Android

Android 客户端是可独立运行的完整应用，不需要填写服务地址，也不依赖外部 Conova 服务。

同步并打开 Android 工程：

```powershell
npm run android:sync
npm run android:open
```

Android 客户端通过原生 HTTPS 网络访问 Bilibili，并在本地完成以下功能：

- Bilibili 扫码和官方页面登录
- 收藏夹、合集和追更来源同步
- 音频播放、进度拖动和备用节点切换
- Android 通知栏与锁屏播放控制
- 本地登录状态、专辑和播放授权管理

登录凭据由 Android 本机安全存储保护。退出登录时会清理本机凭据、音频授权和已缓存的播放来源。

## 项目结构

| 目录 | 作用 |
| --- | --- |
| `src/` | React 播放界面、手势交互、播放状态和 Android 桥接 |
| `server/` | 浏览器和 Windows 客户端使用的 Node.js 服务及 Bilibili 接口封装 |
| `electron/` | Windows Electron 主进程和桌面端服务启动逻辑 |
| `android/` | Capacitor Android 工程、原生网络、媒体服务和安全存储 |
| `tests/` | Node.js 接口测试、状态逻辑测试和 Playwright 界面测试 |
| `docs/` | 发布、签名和 GitHub Actions 说明 |
| `public/` | 图标和静态资源 |

## 测试与验证

运行 Node.js 测试：

```powershell
npm test
```

运行 Playwright 界面测试：

```powershell
npm run test:ui
```

测试覆盖播放界面、封面内波形和进度条、手机手势、长按设置、播放模式、动画反向切换、登录校验、收藏夹分页、同步失败保留、第三方 CDN 回退和长音频 Range 请求。

真实 Bilibili 账号登录、收藏夹内容和音频播放需要在实际设备或桌面环境中进行联调；自动化测试使用隔离的模拟接口验证对应逻辑。

## 自动发布

项目使用 GitHub Actions 自动构建 Android APK 和 Windows x64 安装包。发布流程只支持手动触发：

1. 打开仓库的 **Actions → Build and release**。
2. 点击 **Run workflow**。
3. 输入三段式版本号，例如 `0.1.1` 或 `v0.1.1`。
4. 工作流完成后，安装包会发布到对应版本的 GitHub Release。

发布前需要配置 Android 签名 Secrets。完整的密钥生成、Secrets 配置、版本规则和故障处理说明见 [docs/releases.md](docs/releases.md)。

如需修复已经发布版本的 Android APK，使用 **Rebuild Android APK** 工作流。该流程只替换指定 Release 的 APK 和校验文件，不修改 Windows 安装包或 Git 标签。

## 配置说明

浏览器或服务端开发可参考 `.env.example`：

```env
PORT=3210
HOST=127.0.0.1
```

Android 和 Windows 客户端独立运行，不需要配置 `CONOVA_API_BASE`。请勿将 Bilibili Cookie、签名密钥或其他凭据提交到仓库、环境文件或构建参数中。

## 参考项目

- [bbplayer-app/bbplayer](https://github.com/bbplayer-app/bbplayer)
- [eason919191/BiliMusic](https://github.com/eason919191/BiliMusic)
- [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major)

Conova 参考了上述项目在媒体播放、Bilibili 数据接入和交互组织方面的思路，界面设计与当前实现独立完成。
