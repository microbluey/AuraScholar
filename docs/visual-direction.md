# AuraScholar Visual Direction

## Direction

AuraScholar should feel like a modern research workspace for young academics:
scholarly, calm, efficient, and lightly futuristic without becoming decorative or
antique. The default experience combines the clarity of `Fresh Academia` with
the workflow density of `Research Flow`. The night experience references
`Nocturne Lab`: focused, high-contrast, and technical, but still quiet enough
for long reading sessions.

## Product Personality

- Scholarly, but not old-fashioned.
- Young and crisp, but not playful in a consumer-app way.
- Local-first and trustworthy, with visible control over data, sync, AI, and
  publication monitoring.
- Built for repeated daily use: scanning, importing, reading, annotating,
  checking status, and exporting notes.

Avoid visual cues that read as antique research software: parchment tones,
heavy serif typography everywhere, skeuomorphic paper stacks, emoji-led
navigation, ornate dividers, and dense gray enterprise tables.

## Theme Strategy

### Dawn

Dawn is the default theme. It should read as a bright academic workbench:
clean paper surfaces, cool ink, subtle teal actions, and small highlight colors
for research states.

Recommended adjustments:

- Keep the off-white paper foundation, but bias toward cleaner whites and cooler
  neutrals so it does not become beige.
- Use teal as the primary action and identity color.
- Use amber, blue, pink, and green only for annotations, status chips, and graph
  semantics.
- Keep shadows very shallow. Prefer spacing, grouping, and separators before
  elevation.
- Use serif typography for brand and paper titles only; keep operational UI in
  sans-serif.

### Nocturne

Nocturne is the focused night-reading theme. It should feel like a restrained
research lab: dark slate surfaces, crisp cyan focus, warm annotation colors, and
clean PDF contrast.

Recommended adjustments:

- Keep dark surfaces layered, but avoid making the whole UI one flat dark blue.
- Let the PDF page, annotation highlights, and graph accents provide warmth.
- Use cyan for focus, active state, and AI-related affordances, not for every
  border.
- Use glow only for focus states or active graph nodes.
- Keep metadata and technical status in mono sparingly.

## Layout Principles

- Use a compact left navigation with clear icons from a proper icon set, not
  emoji. Labels should remain visible on desktop.
- Treat the center as the main research surface: library rows, PDF pages,
  citation graph, or homepage preview.
- Use a right contextual panel for AI highlights, citation context, sentinel
  state, flashcard progress, or selected paper details.
- Prefer grouped lists with row separators over one card per row.
- Cards are for real objects or bounded tools, not for every section.
- Dense pages should still have strong scanning structure: title, command area,
  filters, content, contextual panel.

## Component Language

- Buttons: 8px radius, icon plus label for primary workflow actions, icon-only
  with tooltips for compact toolbar commands.
- Inputs: command-like search/import fields should be visually prominent and
  keyboard-friendly.
- Badges: small semantic chips for `PDF`, `OA`, `AI 重点`, `Online First`,
  `已收录`, `需确认`, and sync states.
- Tabs: use segmented tabs for reader side panels: `批注`, `重点`, `脉络`.
- Tables/lists: use soft row hover, selected row tint, and compact metadata
  columns rather than separated cards.
- Graphs: use color meaning consistently. Teal/cyan for active focus, amber for
  pending, green for completed, pink/purple for annotation categories.

## Page Direction

### Library

Move the page toward a research command center:

- Top command bar for DOI, arXiv, URL, title search, and PDF upload.
- Left or inline collection filters with compact counts.
- Main paper list as a grouped surface with title, authors, venue, year, tags,
  attachment state, AI state, and sentinel state.
- Right panel for selected paper details: AI summary, open PDF, generate
  flashcards, move collection, status timeline.

### Reader

Make this the flagship experience:

- Edge-to-edge reading workspace.
- Slim top toolbar with title, page count, view filter, export, and panel toggle.
- PDF surface should be visually quiet, with clear annotation affordances.
- Right panel uses tabs for annotations, AI digest, and citation context.
- In Nocturne, keep the PDF readable and let annotations provide the color.

### Sentinel

Make status monitoring feel active and useful:

- Timeline or pipeline states: `Accepted`, `Online`, `正式出版`, `数据库收录`.
- Evidence snapshots should feel inspectable, not like logs hidden in settings.
- Use progress chips and time stamps for quick trust.

### Flashcards

Make this feel like a study workspace rather than a generic card grid:

- Queue/generation state near the top.
- Paper-linked decks with review status.
- Compact review controls and clear confidence states.

### Academic Homepage

Keep it elegant and export-focused:

- Form and preview split view.
- Publication selection should feel like curating a profile, not filling a long
  settings form.
- The exported themes should mirror Dawn and Nocturne without copying app chrome.

## Implementation Priority

1. Replace emoji navigation with icon components and tighten sidebar spacing.
2. Update library from stacked cards to a grouped, scannable paper list.
3. Add a reusable right contextual panel pattern.
4. Refine tokens for cleaner Dawn neutrals and more balanced Nocturne layers.
5. Upgrade reader toolbar and side panel tabs.
6. Add consistent semantic chips for AI, OA, PDF, sync, and sentinel states.

## Design References From Exploration

- Default theme: combine `Fresh Academia` and `Research Flow`.
- Night theme: reference `Nocturne Lab`.
- Generated concepts are stored under:
  `/Users/wade/.codex/generated_images/019ebb5e-01ed-7530-8e8a-4d93f6243138/`.
