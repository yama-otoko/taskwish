# TaskWish open banking

This project uses TaskWish. Before planning or modifying code, read and follow
`.agents/skills/taskwish/SKILL.md` for the framework's architecture, APIs, and
conventions.

Never place bank API credentials or access tokens in prompts, client-side code,
logs, or source control. Treat account identifiers and transaction data as
sensitive personal data and add production-grade access and retention controls.
