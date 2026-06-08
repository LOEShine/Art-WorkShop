# Art Workshop Design System

Art Workshop is a dense creative production workspace for image and video generation. The UI should feel like a quiet studio control desk: precise, compact, low-glare, and built for repeated use.

## Design Direction

- Audience: creators and operators who repeatedly tune prompts, models, references, and output settings.
- Product tone: professional creative tooling, not a marketing site.
- Visual mood: Gemini-inspired creative console: clean white-blue light mode, deep luminous navy dark mode, and restrained blue/violet/cyan energy accents.
- Priority: clarity, scan speed, stable controls, strong contrast, and restrained color.

## Source Of Truth

Design tokens live in [src/styles/app.css](src/styles/app.css). Existing utility classes such as `bg-card`, `text-muted-foreground`, `border-input`, and `ring-ring` must resolve through these tokens.

Do not introduce one-off palette classes such as `bg-blue-500`, `text-blue-500`, hardcoded `rgb(...)`, or raw hex values for normal UI controls. Use a semantic token or add one here first.

## Token Architecture

The project uses a three-layer token model.

1. Primitive intent: Gemini-like neutrals, blue/violet/cyan accent energy, soft luminous detail, restrained teal system indicators.
2. Semantic aliases: `--background`, `--foreground`, `--card`, `--muted`, `--accent`, `--selection`, `--system`.
3. Component decisions: selected option buttons, model tabs, prompt tool chips, modals, and reference tokens consume semantic aliases.

## Color Roles

### Light Theme

- `--background`: cool white-blue workspace canvas.
- `--card`: near-white panel surfaces.
- `--foreground`: ink-like text.
- `--muted`: low-contrast blue-tinted control fills.
- `--accent`: quiet violet-blue hover surface.
- `--selection`: Gemini blue active selection, with violet/cyan detail where a component supports gradient.
- `--system`: cyan system-token color for automatic prompt augmentations.

### Dark Theme

- `--background`: deep luminous navy canvas, never pure black.
- `--card`: raised navy panel with only a small lift from the canvas.
- `--foreground`: cool paper text.
- `--muted`: recessed control fill.
- `--accent`: quiet violet-blue hover surface.
- `--selection`: soft Gemini blue active selection, used consistently across image/video controls.
- `--system`: cyan system-token color for generated prompt modifiers.

## Component Rules

### Header

- Logo must be visible in both themes. Use the SVG as a CSS mask colored by `--foreground`; do not show the white SVG directly on light backgrounds.
- Icon buttons are square, compact, and use `hover:bg-accent`.
- No text navigation in the header unless it is a primary route.

### Panels

- Panels use `bg-card`, `border`, and restrained shadows.
- Avoid nested card styling. A panel may contain controls, not more card-like sections.
- Section headings stay compact: `text-base font-semibold`.

### Model And Option Selectors

- Selected model uses `bg-primary text-primary-foreground`.
- Selected parameter options use `--selection` and `--selection-foreground`.
- Primary selected surfaces may use the semantic Gemini gradient; do not introduce one-off gradient colors.
- Unselected options use `bg-muted/50` with foreground or muted foreground text.
- Selection color must be consistent between image and video controls.

### Prompt Tools

- Optional tools are quiet by default.
- Enabled tools use `--selection`.
- System prompt chips use `--system`, not primary or selection colors.

### Status And Media Overlays

- Status colors are semantic: success, warning, error, info.
- Media overlays may use translucent black only when placed on images or videos for legibility.
- The multi-angle Three.js preview follows theme tokens: light mode uses a light stage with a dark camera, dark mode uses a graphite stage with a light camera.

## Spacing And Shape

- Base spacing follows 4px increments.
- Primary panel padding: `p-6`.
- Small internal gaps: `gap-2` or `gap-3`.
- Cards and controls use radius 6-8px; avoid pill shapes except toggles and intentionally circular icon controls.

## Typography

- Interface text stays compact and task-focused.
- Header brand may use Caveat; functional UI uses the app font.
- Do not use hero-scale type inside tool panels.
- Letter spacing should remain normal except inherited utility usage already present.

## Dark Mode Requirements

Dark mode must be a full token override, not a handful of component exceptions.

- Body, cards, inputs, borders, muted controls, focus rings, and selected states must all change through variables.
- Avoid flat cold blue/slate dominance; use blue with violet/cyan accent and neutral surface contrast.
- Avoid pure black backgrounds for normal UI surfaces.
- Keep media preview backgrounds dark when the content itself requires it.

## Implementation Checklist

Before shipping UI changes:

- `npm run build`
- Search for new hardcoded UI colors in changed files.
- Verify light and dark mode in browser.
- Confirm logo contrast in both themes.
- Confirm selected states use the same semantic role across image and video panels.
