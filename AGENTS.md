<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## UI/UX (mandatory)

Before **any** UI or UX change, read and follow [`.cursor/rules/ui-system.mdc`](.cursor/rules/ui-system.mdc). It is `alwaysApply: true` in Cursor — treat it as non-negotiable. Complete the pre-ship checklist in that file before claiming work is done.

Key patterns: footer-first modals via `AppModalFooter` (title in footer, Close top-right outside), action differentiation (view vs delete), compact `h-9` controls, semantic color for state.
