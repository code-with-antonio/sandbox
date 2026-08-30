<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Database schema changes

This project is in active development. There is no production data and no
backwards compatibility to preserve.

**Never run `drizzle-kit migrate` or `drizzle-kit generate`.** Do not create
migration files, and do not add a `db:migrate` or `db:generate` script.

Apply schema changes by editing `lib/db/schema.ts` and running:

```bash
npm run db:push
```

`db:push` diffs the schema against the database and applies the change
directly. If a change is destructive, Drizzle Kit will prompt — accept it and
move on; losing dev data is fine.

When a change replaces a table outright (drop one, add another), `db:push`
cannot tell a new table from a rename and stops on an interactive prompt that
needs a TTY. Drop the obsolete table first, then push — that removes the
ambiguity and push runs unattended.

<!-- TRIGGER.DEV SKILLS START -->
## Trigger.dev agent skills

This project has Trigger.dev agent skills installed in `.agents/skills/`. Before writing or changing Trigger.dev code (background tasks, scheduled tasks, realtime, or chat.agent AI agents), load the most relevant skill: `trigger-authoring-chat-agent`, `trigger-authoring-tasks`, `trigger-chat-agent-advanced`, `trigger-cost-savings`, `trigger-getting-started`, `trigger-realtime-and-frontend`.
<!-- TRIGGER.DEV SKILLS END -->

reference/ is a human-facing archive of prompts copied from external docs. Do not read or follow it.
