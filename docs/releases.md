# 发布安装包

工作流文件：`.github/workflows/release.yml`。它只通过手动触发运行，唯一输入项是版本号。

## 一次性配置 Android 签名

APK 使用固定的正式签名，后续版本也必须使用同一把密钥。已有发布密钥时直接使用原密钥。

如果没有密钥，在已安装 JDK 的电脑上生成一次：

```powershell
keytool -genkeypair -v -keystore conova-release.p12 -storetype PKCS12 -alias conova -keyalg RSA -keysize 4096 -validity 10000
```

按提示设置密码和证书信息。妥善备份密钥文件和密码；PKCS12 的密钥密码通常与密钥库密码相同。密钥文件已加入 `.gitignore`，不要提交到 GitHub。

在仓库 **Settings → Secrets and variables → Actions → Secrets** 添加四个 Repository secrets：

| Secret | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 密钥文件的 Base64 字符串 |
| `ANDROID_KEYSTORE_PASSWORD` | 密钥库密码 |
| `ANDROID_KEY_ALIAS` | 密钥别名；上述命令生成的是 `conova` |
| `ANDROID_KEY_PASSWORD` | 该别名的密钥密码 |

Windows PowerShell 可用以下命令把 Base64 字符串复制到剪贴板，再粘贴到对应 Secret：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path .\conova-release.p12))) | Set-Clipboard
```

工作流缺少任何一项时会在构建前报出对应名称。运行期间密钥仅写入临时目录，构建结束后清理，不会进入安装包、Artifacts 或 Release。

## 可选：预设 Android 服务地址

在同一设置页的 **Variables** 中添加 `CONOVA_API_BASE`，值为你的 HTTPS Node.js 服务源地址，例如 `https://music.example.com`。

不配置时，用户首次打开 APK 后可在连接设置中输入地址。Windows 安装包内置 Node.js 服务，无需此变量。不要将 Bilibili Cookie 放入变量或构建参数。

## 触发发布

1. 把工作流和项目文件提交到 GitHub；要在 Actions 页面看到手动运行入口，工作流需要存在于默认分支。
2. 打开 **Actions → Build and release → Run workflow**，选择需要发布的分支。
3. 输入版本号，例如 `0.1.0` 或 `v0.1.0`，点击运行。

版本统一为三段数字，不能有前导零或预发布后缀，必须大于 `0.0.0`。主版本范围为 0–2099，次版本和修订版本为 0–999。Android `versionCode` 根据 `主版本 × 1,000,000 + 次版本 × 1,000 + 修订版本` 生成，例如 `1.2.3` 对应 `1002003`。升级时使用更高版本号。

工作流会校验版本、签名配置和现有标签，然后运行逻辑测试。通过后在 Linux 上构建已签名的 Android release APK，在 Windows 上构建 x64 NSIS 安装程序。两项构建都成功后，使用 GitHub 自带的 `GITHUB_TOKEN` 发布对应提交，无需另外配置 GitHub PAT。

例如输入 `1.2.3`，会创建标签 `v1.2.3`、标题 `Conova 1.2.3` 的 Release，并包含：

- `Conova-1.2.3-android.apk`
- `Conova-1.2.3-windows-x64-setup.exe`
- `SHA256SUMS.txt`

安装包会先上传到草稿 Release，上传完成后才公开。Release 发布后自动标为 Latest，并生成更新说明。已存在的标签或 Release 会阻止重复发布，不会覆盖已发布文件。

构建失败时不会创建公开 Release，已完成的安装包可在该次运行的 Artifacts 中下载，保存 14 天。若上传阶段失败留下草稿或标签，重试前需要删除未完成的草稿及其标签，或改用新版本号。

APK 使用上述正式密钥签名。Windows EXE 当前未配置代码签名证书。
