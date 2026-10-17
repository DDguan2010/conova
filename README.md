# Conova

基于 Node.js 的 Bilibili 音乐播放器，使用 React、Electron 和 Capacitor 适配 Windows 与 Android。

应用标题统一为 `Conova`，图标为黑底白色空心矩形框。图形源文件是 `public/favicon.svg`，`scripts/generate-icons.py` 使用 Pillow 生成 Windows ICO/PNG 和 Android 各分辨率图标。

播放界面只保留方形封面。点击封面播放或暂停，左右滑动切歌，上下滑动切换收藏夹或合集，长按封面打开文字设置。播放时封面恢复彩色，暂停时变为黑白；单曲循环时只把当前封面留在中央。

波形和进度条位于当前封面内部的下沿，使用高斯模糊后的封面颜色填充自身轮廓。设置界面的封面随机错位散落在四周。弹簧动画在切换目标时保留当前位置和速度，可以连续打断。

## 本地开发

使用 Node.js 22.12+ 或 24，在项目目录运行：

```powershell
npm install
npm run dev
```

打开 http://127.0.0.1:5173 登录 Bilibili。打开 http://127.0.0.1:5173/?demo=1 可直接查看交互样本，样本使用本地封面和原创合成音频。

## Windows

```powershell
npm run desktop
npm run pack:win:dir
```

打包后的程序为 `release/win-unpacked/Conova.exe`，运行和分发时需要保留整个 `win-unpacked` 目录。`npm run pack:win` 可生成 NSIS 安装包。

Windows 程序内置本地 Node.js 服务。账号登录会打开 Bilibili 官方登录页，也可扫码登录。

## GitHub 自动发布

在 GitHub **Actions → Build and release → Run workflow** 输入版本号，即可并行构建 Android APK 和 Windows EXE 安装包，并发布到对应版本的 Release。首次使用需配置 Android 签名 Secrets，详见 [发布安装包](docs/releases.md)。

## Android

```powershell
npm run android:sync
npm run android:open
```

Android 是可独立使用的完整客户端，无需部署服务或填写服务地址。它与 Windows 复用 B 站接口逻辑，通过 Android 原生 HTTPS 网络访问 B 站，支持扫码和官方页面账号登录、收藏夹与合集同步、音频播放和拖动进度。登录凭据和已选专辑由 Android Keystore 加密保存在本机；退出登录会清理凭据和播放授权。

浏览器版也可独立部署 Node.js 服务：

```powershell
npm run build
npm start
```

浏览器服务默认监听 `127.0.0.1:3210`。构建 APK 需要 Android SDK 和 JDK 21，也可以直接使用 GitHub Actions。Android 仪器测试覆盖独立启动、原生桥接、本机加密存储、音频 Range 和 WebView 播放/拖动。

## 收藏夹与同步

长按封面进入“管理专辑”，选择“我的收藏夹”或“我追的合集/收藏夹”，点选需要加载的条目。每个来源占一行，横向排列其视频封面。移除只改变 Conova 本地选择。

打开自动同步后，前台每五分钟刷新已选来源，返回前台时也会检查刷新。可以在设置中手动刷新。加载使用完整分页；单个来源同步失败时保留其上次完整数据。

## 验证

```powershell
npm test
npm run test:ui
```

界面测试使用本机 Microsoft Edge，包括无文字播放画面、封面内波形和进度条、手机滑动、长按设置、单曲循环以及动画途中反向切换。接口测试覆盖分页、来源类型、登录校验、会话存储、同步失败保留和音频 Range 请求。

已验证真实 Bilibili 二维码生成。实际扫码、真实账号收藏夹和音频播放仍需账号联调；自动化测试使用模拟接口验证对应流程。

## 参考

- https://github.com/bbplayer-app/bbplayer
- https://github.com/eason919191/BiliMusic
- https://github.com/chthollyphile/folia-major

参考了功能与接口组织，当前界面和实现独立编写。
