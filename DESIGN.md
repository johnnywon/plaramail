# PluraMail design

PluraMail has one mail view, the postal view, described here. The Console takes the mail's place inside the same frame, and errors are a page in the same look.

## Postal

A dark, quiet workspace for many addresses on many domains. Mail content comes first; colour is spent on identity (which address and domain), state (unread, selected) and the agent.

### Tokens

- Tokens live on `.postal` in `app/index.css`, for a dark theme (default) and a real light theme (`data-theme="light"`), not a CSS invert. Components in `app/components/postal/postal.css` read only these variables.
- Dark neutrals: base `#141518`, sidebar and rails `#121316`, raised `#1c1d21`, modal `#16171a`, input `#17181b`, hover `#1f2025` on base and `#24262b` on raised, dividers `#26282d` and `#2a2c31`.
- Text, brightest to faintest: `#f0f0ed`, `#e4e4e1`, `#d5d5d2`, `#c9c9c5`, `#a3a4a0`, `#8b8d93`, `#7f8187`, `#6f7177`. `#7f8187` is the faintest colour allowed for body text (4.5:1). Fainter values are for glyphs, separators and placeholders.
- Accents, each with one job (orange is mail, green is the agent): mail orange `oklch(0.76 0.16 58)` (selection, focus, the accent in the mail nav icons), agent green `oklch(0.82 0.17 152)` (anything the agent does, the robot's eyes), yellow `oklch(0.87 0.15 95)` (stars, warnings, search highlights), danger rose `oklch(0.64 0.19 15)` (log out). Blue is not an accent; it stays only as the cool cast in the neutrals and for links.
- Type: Space Grotesk for the interface, JetBrains Mono for metadata: dates, addresses, counts, captions and key hints. Sizes 10, 11, 12, 13, 15, 22 and 26px (the reader subject). Oxanium is not used in this view.
- Recessed controls (`--pg-recess`, `--pg-recess-face`, `--pg-recess-pressed`): the sidebar footer buttons (Console, Keyboard shortcuts, Log out) are flat wells set into the rail: a face a shade darker than the rail, a soft shadow along the inside top edge and a lit edge below, no border, no gradient, no drop shadow. Held, the well goes deeper. Use it only for controls on a rail edge.
- Icons: Phosphor at 10, 12, 14 and 16px, 20px in empty states.
- Navigation icons are drawn like the robot, in `NavIcons.tsx`: a 24 grid with a 20px live area, 2px round strokes, 3px corners on bodies and 1.5 on small parts. Mail icons (All addresses, Inbox, Unread, By address, Drafts) carry one solid mail-orange accent, the robot's eye block where it fits; folder icons and Labels stay plain. By address runs 28 wide so the cursor block can follow the @.
- The agent is always the robot (`AgentIcon`): a rounded head, green cursor eyes, an @ on the antenna. The shell takes the surrounding colour; the eyes stay green. Use it at 14px or larger so the @ reads.
- Scrollbars are 7px and square: `oklch(0.4 0.035 250)`, brighter on hover, mail orange while dragged. The sidebar reserves a stable gutter.

### Radius

One radius: 6px, from the global rule in `app/index.css`. The exceptions, enforced by `tests/design-rules.test.mjs`:

- Circles (`50%`): switch knobs and the agent's activity dot.
- Pills: the switch track, 36×20 with a 10px radius, holding a 14px knob 3px in from each edge. Round is reserved for the agent and controls; domains never use it.
- 2px: domain swatches and search-highlight marks.
- 0: scrollbar thumbs, the full-screen mobile composer, and anything with a border on one side only (row and table dividers, headers, footers, the side columns). A radius would curl a divider's ends, and dividers are straight. The `.postal :is(...)` rule near the top of `postal.css` lists them, and the design test fails when a new one is missing.
- Split controls may square their inner corners (`6px 0 0 6px`).
- Window corners: on macOS the window's bottom corners are round, and the controls in them follow the curve. The agent input's and send button's bottom-right corners get `--window-corner` (26px) minus their inset from the window edge, never under 6px. The sidebar's Console button keeps 6px. `data-os="mac"` on `<html>` turns it on (`app/lib/window-os.ts`); phone widths, other systems, full screen and a page narrower than its window (vertical tabs, a side panel, docked DevTools) keep 6px.

### Domain identity

Each domain gets a hue and a shape, derived from its position in `DOMAINS`: square, diamond, triangle, hexagon, repeating with a shifted hue after four. Shapes are drawn with `clip-path` (`.pg-shape-*`) so colour-blind readers can tell domains apart. Shapes are never round.

An address always renders as **bold handle**, muted `@`, then the domain in its hue (`AddressText` in `identity.tsx`). Use it everywhere an address appears: sidebar, list rows, reader, From pickers, search suggestions and settings.

### Layout

- Left column 236px (collapses to a 52px rail), centre, and the agent column 328px (collapses to a 44px rail: its head mirrors the left rail's, the caret then the robot on the outer edge, over "PLURAMAIL AGENT" set vertically in mono). Both rail states persist per browser.
- The reader takes what the other columns leave and never slides under the agent rail. When it is under 560px wide (a small window with both rails), its toolbar wraps to a second row and the sender line breaks, name and address over the date.
- Every column starts with a 38px header bar on one line: PLURAMAIL, the search bar, PLURAMAIL AGENT.
- While search is focused, the bar and its window lift off the columns beside them: a soft side shadow (`--pg-shadow-lift`) falls onto the sidebar and the agent panel.
- Mail is always which addresses plus which folder, and the list header reads them in that order, each with its own icon: the address picker as its mark and a caret (the PO-box wall for All addresses, a domain's or address's swatch otherwise; the name is in its title and the menu), a caret-right, then the folder with its sidebar icon and name (or a label with its tag). The folder is a menu too, with no caret. The two are one unit: the folder menu lists exactly what the sidebar shows under the picked parent (`ALL_FOLDERS` then the labels for All addresses, `ADDRESS_FOLDERS` for a domain or address, both in `NavIcons.tsx`, which the sidebar also reads), and switching address keeps the folder when the new parent has it.
- One meaning per icon. The PluraMail mark (the Fold: three flaps, the last in Signal `#E46F2C`, `FoldMark`) sits only in the top-left corner: the sidebar header and the collapsed rail. The PO-box wall is every address at once: the All addresses choice. The tray is the Inbox folder, everywhere. `VIEW_ICONS` in `NavIcons.tsx` maps each folder to its icon.
- There is no logo in the app. The name appears only in the page title.
- The list column is `clamp(280px, 30vw, 430px)`. Nothing may overflow at 280px.
- At 1100 to 1300px the left column starts as its rail and opens as an overlay; the agent panel overlays the reader.
- On a demo build the agent panel keeps its place and buttons but has no agent behind it. The chat opens on the demo notice (`.pg-demo-notice`): a raised 6px card with the robot and a mono DEMO caption, the title "The agent is off in the demo" and one muted line on what it does in a deployment. Anything asked gets the compact card, title only, as the reply.
- Side columns move on one curve, `cubic-bezier(.32, .72, 0, 1)`: 420ms to open, 320ms to close. Every move is a CSS transition on `data-open`, so a toggle mid-move reverses from where it is; closed columns stay mounted, hidden and `inert`. Docked (1300px and up), the dock width eases between rail and column while the column slides under the rail by the same distance, so its surface and divider ride the edge; what is on it fades out in the first 160ms of a close and in after 60ms on an open, and the rail crossfades the other way. Sidebar rows settle in top to bottom, 14ms apart. Overlay columns and the phone sheet slide in from their edge over a fading scrim. While a column moves, the email frame holds its height (`layout-motion.ts`) so the reader lays out once a frame. A column that closes with focus inside hands it to its rail. Reduced motion skips it all.
- The search window moves in the same language at popover scale: the same curve, 300ms to open and 200ms to close. It unrolls down from the bar with its bottom edge and shadow leading (a `clip-path` reveal), what is on it fades in after 60ms, and it stays mounted and `inert` when closed so a close that turns back reverses. Closing, it keeps what it last showed. The result count and clear button fade in when a query starts.
- Rail groups (By address, Labels, and an address's folders) open on the same curve: the group's height eases between closed and open while its rows settle in top to bottom, 14ms apart, and the caret turns a quarter. Closing is quicker and all at once. The rows stay mounted and inert while closed, so a click mid-move reverses from where it is (`Reveal.tsx`).
- AI models uses the same pieces. Change model and Back swap the summary and the picker as forward and back do (20px from the right, 20px from the left), and Back returns focus to Change model. The test message and the key row are `Reveal` panels. A new test result settles 3px up with its check or warning a beat ahead of the words. Test holds its width while it runs: its two labels share one cell and cross 4px, the running one with a steady 5px dot.
- Switching between mail and the console moves on the side columns' curve, translate and opacity only, and never on first load (`data-arrive` on `.postal`). Into the console: its rail slides 28px out from the left edge like a column opening, its items fade in late, and the page comes in 20px from the right, as forward does. Back to mail: each rail settles 16px in from its own edge and the list comes in 20px from the left, as back does.
- Popovers, menus, row tools, the composer, toasts and tooltips enter on the same curve, translate only (no scaling, so text stays crisp): menus and popovers drop 4px, toasts rise 8px. The motion tokens (`--pg-side-ease`, `--pg-side-ms`, `--pg-pop-ms`) live on `:root` and `.postal`.
- At 600px and below: one pane at a time with a Back control, the left column as a drawer, the agent as a bottom sheet, the composer full screen, 44px targets and 16px inputs.

### State

- Unread: a lifted row fill (`#191a1e`) plus bright, bold text. Read rows are dimmed.
- Current row: fill plus a full 1px ring. Checked rows: an orange tint plus a full 1px orange ring.
- Active nav item: fill, bright text, weight 600. A selected address only brightens; its folder carries the fill.
- Days are separated by a 10px dark band, not a heading.
- Key hints (`/`, `Z`, `⌘J`) next to controls and the keys in tooltips are off by default and turn on with Show key hints, in Console > Preferences or Console > Keyboard shortcuts (one setting, `prefs.keys`); shortcuts work either way. Keyboard shortcuts and the ? map always show keys, since there the keys are the content. Console > Keyboard shortcuts opens with the same keyboard map as the ? dialog (`ShortcutMap`), showing the keys being edited, above the full list: click a key on the map or in the list, then press the new one. The map lays out by its own width (a container query), so on the narrower console page and on phones the message column goes across the top. Hints and tooltip keys come from `shared/shortcuts.ts` through `useShortcuts()`, never typed into a title, so a rebound key shows everywhere.
- Tooltips: one layer (`Tooltip.tsx`) serves every button. Write a `title` as `Label (Key) · hint`; the key renders as keycaps and the hint as a muted second line. The browser's own tooltip never shows. Tooltips open after 450ms, then instantly while moving between buttons, and on keyboard focus. Touch never shows them. A button whose text already says everything gets none.

### No accent stripes or edge bars

This rule applies to every view. Rows, cards, nav items, callouts and panels never use a coloured or 2px-or-thicker one-sided border, a one-sided inset or hard box-shadow bar, a `::before` or `::after` bar, or a gradient on one edge. Selected, active and unread state is shown with fill, text weight, a full-perimeter ring, an icon or glyph, or inverse colours. Nesting is shown by indentation only. Quoted text has no fill and no left bar: earlier messages sit under 1px hairlines. Allowed: 1px neutral dividers between regions, the 1px white top highlight on controls, square glyphs, blurred drop shadows, and stripes inside `/brand` artwork. Third-party message HTML inside the sandbox is not rewritten. Enforced by `tests/design-rules.test.mjs`.

### Message HTML

The reader reads like a mail client: subject (26px semibold, 22px on mobile), then the message page. Subject, name and body share one left edge: the subject is inset by the letterhead's padding. A labelled message's page opens with the label rail (`.pg-mrail`): a 28px band on the well surface, the labels as tag and name at 11px, right-aligned over the date. Then the letterhead (`.pg-mhead`), a band on the raised surface over a hairline: on the left the name (15px semibold) and the sender's address (13px, no brackets), sharing a line when both fit; otherwise the address drops below and only it is cut, and the name wraps to two lines before it is cut, under them "to", the receiving address with its swatch and any attachment count; on the right the date (13px, 500) over the time (12px), right-aligned so the two columns share their baselines. No avatar. In the list, a row's labels are their tags alone, beside the star and paperclip under the date; the name shows on hover and the sidebar is the key. When the reader is under 560px the date and time run on one line under the address.

Mail renders in the sandboxed iframe, and every message is a page: a 1px-bordered card at the same left edge as the Reply bar, letterhead first; on mobile it runs edge to edge. Plain mail (no tables, images, colours or backgrounds of its own, see `isPlainHtml`) sits on the raised surface in the reader's colours and a serif (Iowan Old Style, then Charter, Cambria, Georgia) at 16px, line height 1.65, with a 66ch measure, so a message never reads as interface. Designed HTML mail keeps its own fonts on a white page. Text-only bodies go through `plain-text.ts`: paragraphs on blank lines, links for bare URLs and addresses, the signature after `-- ` muted under a rule, quoted replies folded behind a `···` toggle. HTML replies fold the same way (`.gmail_quote`, Apple Mail's `blockquote[type=cite]`, Yahoo, Proton). Opened, the history is flat: each earlier message under a hairline, headed by its sender in 13px semibold and the date, rewritten from the "On … wrote:" line, then its text in the muted colour at 15px. No fills, no indents. Remote images are blocked until the reader allows them (Console > General: Ask, Always, Never); the page then opens with an Images hidden row and Show images, and each blocked image is a dashed box with its alt text.

### Console

The Console holds the agents, their review and log, AI models, MCP, and the mail client's settings. It opens with `?console=<page>` and takes the mail's place between the edges: its rail replaces the mailbox column, its search replaces the mail search, and the agent panel stays on the right. All three heads are the same 38px bar. A demo build shows only the Mail and App pages, read-only apart from Labels.

- **Colour.** A darker black built from the mail's neutrals (`--pg-con-*` in `app/index.css`: base `#0c0d0f`, rail `#08090a`, raised `#131417`). Purple (`--pg-con-accent`) marks the console's own highlights: the current page, the search icon, focus, the "Console" word, and the Draft mode. Orange stays mail and the Send mode. Light theme keeps the off-white surfaces with the same purple.
- **Rail.** Defined once in `console-tabs.ts` (`CONSOLE_RAIL`, `CONSOLE_LABELS`); the rail, page titles and console search read the same labels. Overview; Agents: Your agents, Draft review, Activity log; Connections: AI models, MCP; Mail: Addresses, Signatures, Labels; App: Preferences, Keyboard shortcuts, Mail storage. The PluraMail Agent's page sits under Your agents.
- **Your agents.** Three panels, like mail: the rail, a list column (PluraMail Agent first, then the agents in the order they take mail; drag to reorder), and the picked agent beside it. With nothing picked the detail shows the PluraMail Agent, which also holds "When no agent matches". Below 760px one column shows: the list, then the agent with a trail back.
- **Draft review.** Mail's list, not a console panel: the same rows as the inbox (date column, from swatch and address to the recipient, subject), then the agent's reply in full (up to six lines, quoted original left out), the agent's chip, and Discard, Edit, Send. Send is one click and sends the draft as written. Clicking a row opens the draft in the compose window over the console, bottom right, with its notes and Redraft.
- **Search.** Searches pages (with extra words, so "key" finds AI models and MCP), agents and drafts waiting for review. `/` and ⌘K focus it.

#### Design system

Every console page is built from `ConsoleUI.tsx` and its `.pg-ui-*` styles. A new kind of element is added there first, then used in a page.

| Element | Use |
|---|---|
| `Page` | Title, an optional line of data such as an agent's job (never a description of the page), actions, an optional trail back (`Your agents /`). One per page. |
| `Section` | A titled group: 11px mono caps heading, optional lede and actions. |
| `Note` | A sentence, or a state: loading, empty, error (rose), warning (yellow), ok (green, such as zero retention). |
| `Async` | Loading, error and empty for a query, then the content. |
| `Table` | Data on a panel: mono headers, right-aligned numbers, dim zeros, rose for a limit reached, rows that open. |
| `Name` | First cell of a row: name, icon, tags, second line. |
| `List` + `Item` | Stacked rows: drafts, log entries, signatures. Badge, title, time or aside, meta line, quote. An `Item` with children opens in place. `busy` dims the rows while a new filter loads, so a click never blanks the list. |
| `Split` + `Row` | A list column beside a detail column, like mail's list and reader. A row has an icon, title, tags, a mark on the right (a mode), a second line and a mono meta line. `tools` puts small buttons beside a row, outside its main button: Your agents uses them for Move up and Move down, the keyboard's way to reorder. |
| `Stats` + `Stat` | Numbers in tiles; a tile can open where its number comes from. |
| `Fields` + `Field` | Settings rows. `inline` for a switch, segmented control or number; otherwise a label column and a control column. |
| `Track` | Steps left to right: the current one filled, the ones before it checked, later ones numbered. New agent's head (Job, Addresses, Name) and an agent's Trust (Watch, Draft, Send). |
| `Summary` + `SummaryRow` | Label, value, Edit (a small `Button` with a pencil; Done is primary). A row with an `editor` opens in place under its value; Done closes it. New agent's last step and an agent's How it works. |
| `InlineText` | A value that edits where it sits: plain text at rest, a field outline on hover, the focus ring on click. Autosaves. Use it for a single field; keep `editor` for rows that hold several controls. |
| PluraMail Agent page | Same shape as an agent's: When no agent matches (Leave it or PluraMail Agent drafts) in the Trust card's place, then How it works as Summary rows: Prompt (per address), Model (Change opens AI models), New mail (the config switch), Limits. |
| Agent page | One column in the order you decide: Trust, Activity (the latest six runs, Show all), How it works (Reads with rules behind Edit; Job, Reply, Limits and Name edit in place), then Delete Agent <name>, set apart by a rule. The head holds Working (or Paused) and Pause / Turn on Agent <name>; both agent buttons carry the agent mark. No tabs or stat cards. |
| Trust (`.pg-ui-rungs`, `.pg-ui-gate`) | Three rungs as columns, Watch, Draft, Send, each listing what it lets the agent do and what it never does. The current rung is ringed with a Now badge, earlier ones checked, Send locked until 0.9; a rung is a button that moves the agent. Under them, the gate to the next rung: its criteria with a meter each (Draft: 10 matched messages and none failed this week, `TRUST_GATE`; Send: Test on past mail and unedited drafts, both 0.9), the move (primary when the gate is met, "anyway" when not), Back to the rung below, and a 7-day bar chart of handled, skipped and failed runs. Meters and bars are SVG, so no inline styles. |
| `Chips` + `Chip` | Pick several from a short list. A picked chip has a purple check and ring. |
| `Choices` | Two to four big options as a radio group of cards: a square mark, the label, and a mono `meta` at the right. Stacks to one column on a phone. All addresses or Only some; use it wherever one pick changes what shows below. |
| `Picker` | A checklist in groups with search always on top. Each group heads with its mark, `n of m` and Pick all or Clear for what's showing; Clear N in the search bar empties the pick. Search matches an item or its group's label; Escape clears it. The list scrolls past 264px with sticky group heads. |
| Address picker (Console.tsx) | `Choices` (All addresses, Only some) over a `Picker` grouped by domain with each domain's swatch. Used in New agent and an agent's How it works. |
| New agent (`.pg-ui-wiz`, `.pg-modal.is-roomy`) | Three steps, left to right: Job (a large box with starting-point cards until you type your own), Addresses (the address picker), Name over a summary of the first two with Edit links and the Watch badge. Panels slide one width per step and the modal keeps one height. The head's tracker jumps back to a done step. Back and Next in the foot; Enter or Cmd+Enter moves on. |
| `NumberInput` | A number with its unit. |
| `SaveBar` | A failed autosave and its retry, stuck to the bottom. Console edits save on their own. |
| `CopyField` | A value to copy, such as the MCP server URL. |
| `Code` | A block of shell or JSON to copy: file name on top, light tints (commands bright, flags and keys purple, strings green, `$VARIABLES` yellow). |
| `Button` | Default, primary (one per view), quiet, danger (only after a confirm). |
| `Badge` | Watch (grey ring), Draft (purple), Send (orange), ok, warn, danger, neutral. `live` pulses while an agent is working. |
| `Tabs`, `Toolbar`, `Segmented`, `Switch`, `Modal` | Page tabs, a row of small controls, and the shared controls and dialog. In the console the picked `Segmented` option is marked like a picked `Choices` option: purple tint and ring. A setting with more than a few values, such as how long the log is kept, is a select, not a `Segmented`. |

#### MCP

MCP (`McpTab.tsx`) is three things, top to bottom: the server URL (`CopyField`), Connect (`Tabs` for Claude Code, Claude Desktop, Codex, Cursor, Grok and Other, one `Code` block each, and a Reference link to `docs/mcp.md`), and Connected apps (a `Table`: the app, what it can do as an `ok` Read or `danger` Read and send `Badge`, when it was last used, Revoke). While Cloudflare Access blocks MCP clients (the page fetches the OAuth metadata without its cookies), a `warn` `Note` sits under the URL with the two paths to bypass as `CopyField`s and Check again; otherwise nothing shows. It has no classes of its own. Keep it that small: the tool list, the sign-in flow and the error codes live in `docs/mcp.md`.

Addresses is a `Field` per address: the display name and how recipients see it. An address that has received nothing yet adds a `warn` `Note` under it: route mail to the Worker in Email Routing (a dashboard link) with a catch-all rule for the domain, and the command that enables sending. The note goes once mail arrives. Below the addresses, Blocked senders is a `Table` (sender, the address it is blocked for, when, and Remove), from `BlockedSenders.tsx`. It has no classes of its own.

One-offs earn their place, and `tests/console-design-system.test.mjs` fails on any other class: the console shell (`pg-console-*`), the search bar and window it shares with mail, the thread viewer (`pg-cmsg-*`), Draft review's mail rows (`pg-list-*`, `pg-row-*`, `pg-review-*`), the label editor and colour picker, the shortcut recorder (`pg-keys-*`), and the model picker below. No inline styles.

#### AI models

AI models has two steps, and colour has one meaning each: a provider's hue appears only on its 8px square (`.pg-prov-mark`), green marks the chosen, recommended, connected or zero retention, yellow marks a missing key. Prices and context are plain numbers, never tinted. The first step opens straight under the page title, with no subtitle and no section heading, on the agent model card: its name, then its facts as a labelled list (`.pg-model-facts`: Provider with its square, Maker when it differs, Model ID in mono, Retention (a green shield and "Zero retention", or "Not promised"), Context, Price in / out per 1M tokens, Tools only when it has none), then Change model and Test below the facts. The card carries no badge. Under it, Providers is a `Table` (`.pg-prov-table`) with the same columns for both: the provider with Models and Policy links to its own pages, Training, Retention ("Not promised" on Cloudflare; on OpenRouter a green shield and how many of its models have zero retention), the model count, and Key ("Built in", or the key's last four with Manage, or Add key). Retention and Training state only what the provider's policy page states. Zero retention is a guide, never a filter: every paid model is listed, and those with it carry the shield. Add key or Manage opens the key field in a box under the table. Below 640px the table drops Training and Models, the links stack, and the cells tighten so it fits without scrolling. One `Note` closes the step: free models are turned off. Change model opens the second step in place: Back, a full-width search that also takes any paid model id, filters (All, the two providers, then Anthropic, OpenAI, Google and xAI on OpenRouter) with a sort menu, then the list. With nothing typed and All chosen, the picker shows the four suggested models as cards (`.pg-pick`, two columns, one below 640px), each with its role above the name (Recommended in green, Cheapest, Balanced, Best quality); the chosen card has a green border and a check. The sort menu is hidden there. Below the cards, a Browse list has a row per provider and per maker. Each list opens with a mono column header (title, Context, $ per 1M in / out) that labels the numbers once, then the provider's data line once. The list's data line, warnings and empty state are `Note`s, and Recommended is an `ok` `Badge`. Rows (`.pg-model-row`): a square check, the name with Recommended, a muted line of provider, maker, a green shield with "Zero retention" when the model has it, "No tools" and "Needs key" separated by dots, then context and price right-aligned in tabular figures, output price in the stronger colour. A typed id that matches nothing gets a dashed "Use" row with a provider menu; a free id says why it's refused. Picking a row returns to the first step; if its provider has no key, that provider's row opens, tinted yellow, and the card says the key is needed. Escape in the picker clears the search, then the filter, then goes back. Below 640px the card stacks, the column header keeps only its title, price sits beside the name with context under it, and the filters scroll sideways. Below 600px the dialog fills the screen and the tabs scroll sideways.

### Figures

A count, a size or a length of time shown in a small space is a figure: a number of at most six characters over a unit in caps (`shared/figures.ts`, tested in `tests/figures.test.mjs`). The unit steps up before the number grows, so a figure always fits its cell.

| Kind | Steps | Examples |
|---|---|---|
| Count (`countFigure`) | commas to 99,999, then k, then M | 1 EMAIL, 12,408 EMAILS, 248k, 2.4M |
| Bytes (`bytesFigure`) | KB, MB, GB, TB, PB, decimal; steps up rather than round to 1000 | 600 KB, 412 MB, 1.39 GB, 48.6 GB, 1.28 TB |
| Time (`durationFigure`) | minutes under an hour, hours under 2 days, days under 2 weeks, weeks under 8 weeks, months under 2 years, then years | 45 MINS, 47 HRS, 3.1 DAYS, 13 DAYS, 5.7 WKS, 11 MOS, 2.4 YRS |

- The unit agrees with the value: 1 EMAIL, 2 EMAILS; 1 HR, 3 HRS.
- One decimal under 10, none from 10. Time rounds down, so it never claims more than has passed.
- Unknown is a grey "—" with the unit kept in place, so nothing moves when the value arrives. A screen reader hears "Storage: unavailable" (`figureLabel`).

### Colophon

The console rail ends with the colophon (`ConsoleColophon.tsx`): four figures, then the mark and the version. It is 116px on a 4px grid, pressed into the rail with one 2px groove at its top (`--pg-con-groove`, `--pg-con-groove-edge`) and nothing raised or boxed. No line between the figures and the imprint: 6px of space separates them.

- Figures in a fixed order: messages, storage (every message's size, D1 and R2), addresses, uptime (since the running version was deployed, from the `version_metadata` binding). No fifth figure: a fifth stat belongs on a page.
- Four auto columns, space-between, at least 12px apart, 20px in from the rail's edges. Figures are 16px at weight 400, the rail links' weight, in the 236px rail; the widest values (99,999 · 48.6 · 1,206 · 7.9) still keep the 12px gap.
- Units are the mono caps at 9px, weight 500 like the rail's group labels, with an 8px unit glyph, 4px apart.
- Colours step with the rail: figures `--pg-text-3`, one shade over the links; units and glyphs `--pg-text-5`, the links' grey; the version and GitHub glyph `--pg-text-7`, the group labels' grey; an unknown dash `--pg-text-8`. The logo keeps its own full contrast.
- The imprint: the logo lockup (`public/brand/lockup-dark.png` on the dark console, `lockup-light.png` on the light one) at 18px, then the version and the GitHub glyph, the colophon's only link, with a 24px hit area. The lockup is the real logo; don't rebuild it from type.
- The logo comes up once when the console opens, quietly: a grey watermark pressed into the rail (a dark top edge, a light bottom edge) holds a beat, then the colour lifts 1px out of it over 1.8s on one even ease, a touch soft and muted at first and settling into focus, while the watermark gives way. No steps or flicker. Both themes' logos stay laid out (the hidden one is `visibility: hidden`), so a theme switch doesn't replay it. Reduced motion shows only the finished logo.

### Error pages

Every error the app shows uses one layout (`ErrorPage.tsx`): the postal surface and theme, the status code in mono, a 22px heading, one line, and Back to mail (plus Reload when a retry can help). The 404 page, the root error boundary and the Worker's Access errors all use it; the Worker's version is static HTML in `workers/lib/error-page.ts` that follows the system theme. A developer stack trace shows only in dev builds. API clients still get plain text.

Validation: `npm test`, `npm run typecheck`, and `npm run build`.
