# Better Auth 委托子路由索引

本站 catch-all 共有32条库HTTP路径、34个方法绑定；这是已注册的路由表，不代表所有业务已启用。`setPassword` 是库服务端操作，无HTTP路径，故不列入。库schema提取自当前安装包，不初始化认证或数据库。精确body/query及库OpenAPI响应说明分在下列资源中；应用配置约束、认证与错误见frontend.md。

默认需要登录的用户/会话/关联账号操作均使用当前Cookie并经库middleware校验。sign-in、用户名可用性、重置链接等可公开访问，但注册已禁用；未配置OAuth提供商、发送验证/重置邮件回调、changeEmail和deleteUser启用项，相关路径会拒绝/报错，不承诺这些功能可用。requireHeaders字段不等于完整权限判定，业务权限仍由每条库middleware与配置执行。

| 方法/路径                              | 参数与响应资源                             |
| -------------------------------------- | ------------------------------------------ |
| GET /api/auth/account-info             | [auth-schemas-1.json](auth-schemas-1.json) |
| GET,POST /api/auth/callback/:id        | [auth-schemas-1.json](auth-schemas-1.json) |
| POST /api/auth/change-email            | [auth-schemas-1.json](auth-schemas-1.json) |
| POST /api/auth/change-password         | [auth-schemas-1.json](auth-schemas-1.json) |
| POST /api/auth/delete-user             | [auth-schemas-1.json](auth-schemas-1.json) |
| GET /api/auth/delete-user/callback     | [auth-schemas-1.json](auth-schemas-1.json) |
| GET /api/auth/error                    | [auth-schemas-1.json](auth-schemas-1.json) |
| POST /api/auth/get-access-token        | [auth-schemas-1.json](auth-schemas-1.json) |
| GET,POST /api/auth/get-session         | [auth-schemas-2.json](auth-schemas-2.json) |
| POST /api/auth/is-username-available   | [auth-schemas-2.json](auth-schemas-2.json) |
| POST /api/auth/link-social             | [auth-schemas-2.json](auth-schemas-2.json) |
| GET /api/auth/list-accounts            | [auth-schemas-2.json](auth-schemas-2.json) |
| GET /api/auth/list-sessions            | [auth-schemas-2.json](auth-schemas-2.json) |
| GET /api/auth/ok                       | [auth-schemas-2.json](auth-schemas-2.json) |
| POST /api/auth/refresh-token           | [auth-schemas-2.json](auth-schemas-2.json) |
| POST /api/auth/request-password-reset  | [auth-schemas-2.json](auth-schemas-2.json) |
| POST /api/auth/reset-password          | [auth-schemas-3.json](auth-schemas-3.json) |
| GET /api/auth/reset-password/:token    | [auth-schemas-3.json](auth-schemas-3.json) |
| POST /api/auth/revoke-other-sessions   | [auth-schemas-3.json](auth-schemas-3.json) |
| POST /api/auth/revoke-session          | [auth-schemas-3.json](auth-schemas-3.json) |
| POST /api/auth/revoke-sessions         | [auth-schemas-3.json](auth-schemas-3.json) |
| POST /api/auth/send-verification-email | [auth-schemas-3.json](auth-schemas-3.json) |
| POST /api/auth/sign-in/email           | [auth-schemas-3.json](auth-schemas-3.json) |
| POST /api/auth/sign-in/social          | [auth-schemas-3.json](auth-schemas-3.json) |
| POST /api/auth/sign-in/username        | [auth-schemas-4.json](auth-schemas-4.json) |
| POST /api/auth/sign-out                | [auth-schemas-4.json](auth-schemas-4.json) |
| POST /api/auth/sign-up/email           | [auth-schemas-4.json](auth-schemas-4.json) |
| POST /api/auth/unlink-account          | [auth-schemas-4.json](auth-schemas-4.json) |
| POST /api/auth/update-session          | [auth-schemas-4.json](auth-schemas-4.json) |
| POST /api/auth/update-user             | [auth-schemas-4.json](auth-schemas-4.json) |
| GET /api/auth/verify-email             | [auth-schemas-4.json](auth-schemas-4.json) |
| POST /api/auth/verify-password         | [auth-schemas-4.json](auth-schemas-4.json) |

重新生成：`node skills/xiaozhi/site-api/scripts/auth-catalog.mjs --write`；检查：同命令 `--check`（不传--write也只检查）。仅username插件启用，若更改src/server/auth/index.ts的插件需同步提取器。JSON Schema无法表达的refine、cookie设置、重定向与配置检查以库实现为准。认证失败通常为库`{code,message}`等结构；成功可能JSON、Set-Cookie或跳转，响应细节见各分片metadata，不能都当作站内`{error}`。
