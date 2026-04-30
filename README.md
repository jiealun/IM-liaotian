# WebChat - 网页版1v1聊天工具

一个轻量级的网页版即时通讯工具，类似早期网页版QQ。

## 功能

- 输入昵称直接进入，无需注册登录
- 1v1 实时聊天（基于 Supabase Realtime）
- 在线/离线状态实时同步
- 未读消息计数
- Cmd+V 粘贴截图发送
- 文件上传发送
- 表情包选择器
- 右键回复消息
- 消息按日期分组
- 每日定时清理聊天记录

## 技术栈

- 纯前端：HTML + CSS + JavaScript
- 后端：Supabase（数据库 + 实时推送 + 文件存储）

## 部署

1. 创建 Supabase 项目
2. 在 SQL Editor 中执行 `schema.sql`
3. 在 Storage 中创建 `chat-files` 公开 bucket
4. 修改 `app.js` 中的 `SUPABASE_URL` 和 `SUPABASE_KEY`
5. 直接用浏览器打开 `index.html`
