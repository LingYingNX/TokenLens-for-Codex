# 数据证据（2026-11-24）

- 本机 rollout 脱敏采样：20 个文件，113 条 turn_context、2263 条 token_usage_record；本次样本中的用量按同线程 turn_id 均匹配模型上下文，出现两种模型的文件有 2 个。样本不证明所有版本都有该字段或不会冲突。
- 采样中 4 个子代理的 parent_thread_id 与另一 session_meta.id 直接匹配；子代理 usage.thread_id 对应子线程，usage.session_id 对应该片段 session_meta.session_id，不必等于子线程 ID。合成回归覆盖冲突、身份缺失及父子关系。
- 现有 Magpie 7d 任务查询返回 HTTP 200；响应有 input、cache_read、output、rows、series、period 等字段，rows 样本包含 model、response_id、session、native_session、session_role，但它们的父子语义与调用覆盖未在此核实，不能据此假定可安全与 rollout 合并。
- 本机一个当前线程直接调用本地归属读取，得到 141 条记录、1 种模型、0 条子代理，返回 partial 与 truncated；不能代表全部线程。相关数据未输出会话内容或凭据。
- 扫描有字节、目录与文件数量限制；模型上下文冲突或缺失为未知。使用合成用例验证模型按 turn_id、子代理按明确父线程 ID 关联，不使用时间邻近推测。
