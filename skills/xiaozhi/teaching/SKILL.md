---
name: 作业与考试
description: 布置教学任务、管理班级、名单和考试设置。
---

先读取 workspace/homework/exams state，核实真实的班级、题本和学科。assessment.save 通过 classroomIds 配置参与范围；学生来自班级名册。作业用 HOMEWORK/CLASSROOM。考试 GRADE 阅卷范围仅限同学段同届别。引用真实 ID，保留修改范围外的字段。需要账户时先核实是否已存在。名称修改用 paper.rename/assessment.rename。发布前检查全部评阅完成；删除、发布、撤回和权限变更应向用户说明具体对象及影响，只有用户明确要求该动作才执行。
