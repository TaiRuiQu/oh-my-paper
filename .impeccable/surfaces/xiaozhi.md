---
version: 1
slug: xiaozhi
primary_target: src/components/xiaozhi/chat.tsx
related_targets:
  - src/components/xiaozhi/skills-panel.tsx
  - src/app/xiaozhi
---

# 小纸综合助手

Mode: Operate. Reference: user-supplied ChatGPT / Gemini screenshots. This is an extension of the incumbent green-and-white teaching product. The independent conversation layout inherits Geist / Noto Sans SC, ink, muted text, borders and the restrained green action color; it does not replace the teaching workspace's visual system.

THESIS: A familiar chat interface connects plain-language goals to real, permission-checked teaching operations. The assistant autonomously discovers platform capabilities and skills, chooses its tools and returns inspectable results.

FIRST VIEWPORT: Muted left conversation sidebar, spacious white main area, centered origami mark, role-appropriate greeting and composer. The composer contains attachments, skills, the available-model selector and send. Suggested requests fill the draft without sending it. The sidebar contains new conversation, title search, skills, teaching workspace, recent conversations and the current account. Desktop users can collapse and reopen it. No decorative images or artificial progress metrics.

NAVIGATION: Login and the authenticated root land on `/xiaozhi`. An active conversation has a restorable `/xiaozhi?chat=<id>` URL; browser back and forward switch conversations. History can be searched by title, and the conversation menu offers rename and two-step delete. `/workspace` retains the role-specific teaching home, reached from both the sidebar and header; teaching navigation links back to 小纸. Resource links in replies lead to their ordinary teaching pages.

VISITOR PATH: Start or restore a conversation → select an available model / optional skills → send text or images / PDF → read the response and expandable real tool records → open the resulting teaching resource. Enter sends, Shift+Enter adds a line, and Chinese input composition does not trigger send. Attachments show removable page chips before sending; each file is at most 30 MB and each message at most 20 pages. Replies render the existing Markdown and math components, show attached images and offer text copy.

SIGNATURE INTERACTION: A Pi Durable worker continues a long-running task after refresh, conversation switching or leaving the browser. Restoring history reconnects to its persisted state. The same composer remains available for steering the current task or queuing a follow-up; pending input names its handling mode. A visible stop action remains alongside send while the task is queued or running. Model and skill selection for that conversation lock until the task stops.

EXECUTION FEEDBACK: Queued, working, context compaction and model retry have distinct status text. A dropped connection explains automatic reconnection and continued background work. Tool rows expose running, completed or failed state with readable operation labels; their native disclosure shows actual parameters and results. Available thinking content is separately collapsible. Errors appear above the composer, completed replies have a polite live announcement, and progress animation stops for reduced-motion preferences. These states describe execution rather than claiming a percentage or result quality.

RESPONSIVE: Above 760px, a persistent sidebar and flexible main column fill the viewport; at 1000px the sidebar narrows. At 760px and below, conversation navigation uses a focus-managed left Sheet, with the same account, history and workspace controls. The right skills Sheet fits the viewport. The transcript scrolls while the composer remains in the main viewport; its textarea grows to a bounded height. Mobile composer text is 16px to prevent zoom, and the busy-message controls can wrap.

SKILLS: Built-in and personal skills appear in a right drawer. Users can inspect the working instructions, select multiple skills for a conversation, and create, edit or delete personal skills with a name, usage description and working method. The agent can discover suitable skills itself; explicit selection gives the chosen methods priority. Running conversations show why selection is locked. Built-in packages and their reference resources extend on the server independently from the UI. Skill editing is a normal form with visible labels and inline save errors.

RISK: Models must be configured and the independent worker running. An empty model list links administrators to model settings and tells other roles to contact an administrator. Platform operations retain the current account's authorization and data scope. Hardware scanning and browser printing require the user to operate the corresponding teaching page. Important results remain available for user inspection.

SURFACE TOKENS: White main, sidebar (#f2f5f3), inherited accent (#08745f), ink and muted text. Conversation and composer measure (780px); desktop sidebar (264px, then 230px); header height (76px, mobile 64px); mobile navigation (280px, at most 85vw); skills drawer (460px, at most 100vw). Composer radius (22px, mobile 18px), user bubble (18px with a 5px lower corner), tool rows (8px) and compact controls (7–9px). Welcome title (34px, mobile 28px), chat prose (14px), supporting controls (10–13px). These conversation-specific scales stay local; ordinary teaching panels retain their incumbent compact geometry. Local button, link and disclosure focus uses an accent outline (2px, offset 3px), and the composer uses a visible focus-within border. Flat tonal separation and fine borders carry depth.
