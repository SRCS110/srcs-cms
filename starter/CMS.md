# Editing this site

This site is connected to the SRCS editor. Clients edit at `https://{{PRIMARY_DOMAIN}}/?edit`.

## Markup rules
- `data-cms="key"` marks an editable area. Keys are lowercase, hyphenated, unique per page.
- `data-cms-type`: `text` (default), `rich` (bold, italic, links, lists), `link` (an `<a>`: words + address), `image` (an `<img>`), `list` (repeatable children).
- `data-cms-max="60"`: character limit for text.
- `data-cms-global="phone"`: the same detail on many pages; one edit updates every page.
- Lists: the container gets `data-cms-type="list"`; each direct child is an item; editable parts inside items use `data-cms-field="name"` (with `data-cms-type` if not text).
- `data-cms-label="services list"`: friendly name shown in the editor.
- Never mark `<head>`, nav structure, scripts, schema JSON-LD, or anything inside another editable area.
- Text areas that need line breaks need `white-space: pre-line` in CSS.
- Every page with editable areas needs the loader before `</body>`:
  `<script src="https://cms.srcs.online/loader.js" data-site="{{SITE_KEY}}" defer></script>`

## AI assistant add-on
If the client has the assistant add-on, add before `</body>` on every page:
  `<script src="https://cms.srcs.online/agent.js" data-agent="{{SITE_KEY}}" async></script>`
and create its `agents` row (see srcs-cms `docs/AGENTS.md`). The client manages it from **Assistant** in the editor.

Check the markup with `node <srcs-cms>/tools/check-site.mjs .` before pushing.
