---
name: 账号与系统管理
description: 管理账号、教学权限、模型和题库检索配置。
---

仅管理员可以配置系统。先读取 admin 与 workspace state，核实当前账号与教学身份。通过 admin schema 调用 user.create/user.role/user.permissions/provider.save/provider.delete/embedding.save/embedding.reindex；账号批量创建可 PUT accounts/import。权限配置会原子替换，先读取并保留用户希望保留的身份。用户未明确要求时不得修改角色、权限、模型密钥或删除供应商。密码和密钥只用于用户明确指定的操作，不在普通回复或无关工具中重复。
