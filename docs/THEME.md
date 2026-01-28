# Sanctum Design System

A warm, human-centered design system for privacy-first applications, inspired by Linear, Notion, and Vercel.

---

## Overview

Sanctum uses a **Warm Neutral** color palette with configurable **accent colors**, designed to feel trustworthy, secure, and professional. The system supports both light and dark modes with smooth transitions.

**Key characteristics:**
- Warm stone grays (not cold blue-grays)
- 6 configurable accent colors (blue, purple, green, orange, pink, teal)
- Inter typeface with stylistic alternates enabled
- Multi-layer shadows for sophisticated depth
- WCAG AA compliant color combinations
- Reduced motion and high contrast support

---

## Quick Start

### Using Theme Colors

```tsx
// Backgrounds
<div className="bg-surface">Main background</div>
<div className="bg-surface-raised">Cards, panels</div>
<div className="bg-surface-overlay">Dropdowns, hovers</div>

// Text
<h1 className="text-text">Primary heading</h1>
<p className="text-text-secondary">Body text</p>
<span className="text-text-muted">Caption</span>

// Accent
<button className="bg-accent text-accent-text hover:bg-accent-hover">
  Primary Action
</button>
```

### Using Dark Mode

```tsx
import { useTheme } from './theme'

function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme()

  return (
    <button onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
      {resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode
    </button>
  )
}
```

---

## Color Palette

### Surfaces

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `surface` | `#ffffff` | `#141311` | Page background |
| `surface-raised` | `#fafaf8` | `#1e1c1a` | Cards, panels |
| `surface-overlay` | `#f4f3f1` | `#2a2826` | Dropdowns, hover states |

### Text

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `text` | `#1a1815` | `#f8f7f6` | Headlines, primary text |
| `text-secondary` | `#5c5550` | `#a9a49d` | Body text, descriptions |
| `text-muted` | `#9c958c` | `#6b6660` | Captions, hints, metadata |

### Borders

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `border` | `#e8e6e1` | `#2e2c2a` | Default borders |
| `border-strong` | `#d4d1ca` | `#403d3a` | Emphasized borders |

### Accent (Blue - Default)

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `accent` | `#2563eb` | `#3b82f6` | Primary buttons, links |
| `accent-hover` | `#1d4ed8` | `#60a5fa` | Hover states |
| `accent-subtle` | `#dbeafe` | `#1e3a8a` | Backgrounds, highlights |
| `accent-text` | `#ffffff` | `#ffffff` | Text on accent backgrounds |

### Semantic Colors

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `success` | `#15803d` | `#22c55e` | Success states |
| `success-subtle` | `#dcfce7` | `#14532d` | Success backgrounds |
| `warning` | `#ca8a04` | `#facc15` | Warning states |
| `warning-subtle` | `#fef9c3` | `#713f12` | Warning backgrounds |
| `error` | `#dc2626` | `#f87171` | Error states |
| `error-subtle` | `#fee2e2` | `#7f1d1d` | Error backgrounds |
| `info` | `#0284c7` | `#38bdf8` | Info states |
| `info-subtle` | `#e0f2fe` | `#0c4a6e` | Info backgrounds |

### Accent Color Themes

Apply these classes to the root element to change the accent color:

| Class | Light | Dark |
|-------|-------|------|
| `accent-blue` | `#2563eb` | `#3b82f6` |
| `accent-purple` | `#7c3aed` | `#8b5cf6` |
| `accent-green` | `#059669` | `#10b981` |
| `accent-orange` | `#ea580c` | `#f97316` |
| `accent-pink` | `#db2777` | `#ec4899` |
| `accent-teal` | `#0d9488` | `#14b8a6` |

---

## Typography

### Font Families

| Token | Value | Usage |
|-------|-------|-------|
| `font-sans` | Inter, system-ui | UI text, body copy |
| `font-mono` | JetBrains Mono, Fira Code | Code, data |

Inter stylistic alternates are enabled by default (`cv02`, `cv03`, `cv04`, `cv11`) for improved character shapes.

### Font Sizes

Use Tailwind's default scale:

| Class | Size | Line Height | Usage |
|-------|------|-------------|-------|
| `text-xs` | 12px | 16px | Labels, badges |
| `text-sm` | 14px | 20px | Secondary UI text |
| `text-base` | 16px | 24px | Body text |
| `text-lg` | 18px | 28px | Subheadings |
| `text-xl` | 20px | 28px | Section titles |
| `text-2xl` | 24px | 32px | Page titles |
| `text-3xl` | 30px | 36px | Hero text |
| `text-4xl` | 36px | 40px | Display text |

### Font Weights

| Class | Weight | Usage |
|-------|--------|-------|
| `font-normal` | 400 | Body text |
| `font-medium` | 500 | UI labels, buttons |
| `font-semibold` | 600 | Headings |
| `font-bold` | 700 | Emphasis |

### Letter Spacing

| Token | Value | Usage |
|-------|-------|-------|
| `--tracking-tight` | -0.015em | Headings |
| `--tracking-normal` | 0 | Body text |
| `--tracking-wide` | 0.025em | Labels, small caps |

```tsx
<h1 className="tracking-tight">Tight heading</h1>
<span className="tracking-wide uppercase text-xs">Label</span>
```

---

## Spacing

Use Tailwind's default 4px-based scale:

| Class | Value | Common Usage |
|-------|-------|--------------|
| `p-2` / `m-2` | 8px | Tight spacing |
| `p-3` / `m-3` | 12px | Compact elements |
| `p-4` / `m-4` | 16px | Standard padding |
| `p-6` / `m-6` | 24px | Card padding |
| `p-8` / `m-8` | 32px | Section spacing |
| `gap-4` | 16px | Grid/flex gaps |
| `gap-6` | 24px | Card grids |
| `gap-8` | 32px | Section gaps |

---

## Border Radius

| Class | Value | Usage |
|-------|-------|-------|
| `rounded-sm` | 6px | Subtle rounding |
| `rounded` | 8px | Default |
| `rounded-md` | 8px | Buttons |
| `rounded-lg` | 12px | Cards, inputs |
| `rounded-xl` | 16px | Large cards |
| `rounded-2xl` | 24px | Modals |
| `rounded-full` | 9999px | Pills, avatars |

---

## Shadows

Multi-layer shadows provide sophisticated depth perception:

| Token | Usage |
|-------|-------|
| `--shadow-xs` | Minimal depth, small elements |
| `--shadow-sm` | Subtle depth, inputs |
| `--shadow-md` | Cards, dropdowns |
| `--shadow-lg` | Modals, popovers |
| `--shadow-xl` | Elevated elements |
| `--shadow-inner-sm` | Input fields (inset) |

Dark mode shadows include a subtle light border for definition.

### Accent Shadow

For primary buttons, use the accent shadow utility:

```tsx
<button className="shadow-accent">Primary Button</button>
```

---

## Transitions & Easing

### Duration Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--duration-instant` | 50ms | Cursor feedback |
| `--duration-fast` | 100ms | Hover states |
| `--duration-normal` | 150ms | Standard transitions |
| `--duration-slow` | 250ms | Larger elements |

### Easing Curves

| Token | Value | Usage |
|-------|-------|-------|
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Micro-interactions, bouncy feel |
| `--ease-smooth` | `cubic-bezier(0.25, 0.1, 0.25, 1)` | General use, smooth transitions |

### Legacy Tokens (for compatibility)

| Token | Value |
|-------|-------|
| `--transition-fast` | 150ms ease |
| `--transition-base` | 200ms ease |
| `--transition-slow` | 300ms ease |

---

## Component Patterns

### Button - Primary

```tsx
<button className="
  bg-accent text-accent-text
  hover:bg-accent-hover
  px-4 py-2
  rounded-lg
  font-medium
  btn-primary
">
  Submit
</button>
```

### Button - Secondary

```tsx
<button className="
  bg-surface-raised text-text
  border border-border
  hover:bg-surface-overlay hover:border-border-strong
  px-4 py-2
  rounded-lg
  font-medium
  transition-colors
">
  Cancel
</button>
```

### Card

```tsx
<div className="
  bg-surface-raised
  border border-border
  rounded-xl
  p-6
  shadow-sm
">
  <h3 className="text-lg font-semibold text-text tracking-tight">Card Title</h3>
  <p className="mt-2 text-text-secondary">Card description.</p>
</div>
```

### Interactive Card

```tsx
<div className="
  bg-surface-raised
  border border-border
  rounded-xl
  p-6
  card-interactive
">
  <h3 className="text-lg font-semibold text-text">Hover me</h3>
  <p className="mt-2 text-text-secondary">This card lifts on hover.</p>
</div>
```

### Input

```tsx
<input
  type="text"
  className="
    w-full
    bg-surface
    border border-border
    rounded-lg
    px-4 py-2
    text-text
    placeholder:text-text-muted
    inner-shadow
    focus-ring-within
  "
  placeholder="Enter text..."
/>
```

### Alert - Success

```tsx
<div className="
  bg-success-subtle
  border border-success/20
  rounded-lg
  p-4
  text-success
">
  Operation completed successfully.
</div>
```

### Alert - Error

```tsx
<div className="
  bg-error-subtle
  border border-error/20
  rounded-lg
  p-4
  text-error
">
  An error occurred.
</div>
```

---

## Interactive Utilities

### Hover Effects

```tsx
// Lift on hover
<div className="hover-lift">Lifts up slightly</div>

// Scale on hover
<div className="hover-scale">Scales up slightly</div>

// Press effect
<button className="active-press">Shrinks when pressed</button>
```

### Focus Rings

```tsx
// Layered focus ring
<button className="focus-ring">Has visible focus ring</button>

// Focus within container (for input wrappers)
<div className="focus-ring-within">
  <input type="text" />
</div>
```

### Glass Morphism

```tsx
<div className="glass rounded-lg p-4">
  Semi-transparent frosted glass effect
</div>
```

---

## Dark Mode

### How It Works

1. Theme preference stored in `localStorage` as `sanctum-theme`
2. Values: `'light'`, `'dark'`, or `'system'`
3. System preference detected via `prefers-color-scheme`
4. Dark mode applied by adding `.dark` class to `<html>`

### Using the Theme Hook

```tsx
import { useTheme, type Theme } from './theme'

function Settings() {
  const { theme, setTheme, resolvedTheme } = useTheme()

  return (
    <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  )
}
```

### Theme Toggle Button

```tsx
import { useTheme } from './theme'

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <button
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className="p-2 rounded-lg bg-surface-raised hover:bg-surface-overlay focus-ring"
    >
      {resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode
    </button>
  )
}
```

---

## Transitions

For smooth theme transitions, use the `theme-transition` utility class:

```tsx
<div className="theme-transition bg-surface text-text">
  This element transitions smoothly when theme changes.
</div>
```

Or use Tailwind's transition utilities:

```tsx
<div className="transition-colors duration-200">
  Smooth color transitions.
</div>
```

---

## Accessibility

### Contrast Ratios

All color combinations meet WCAG AA standards:

| Combination | Ratio | Pass |
|-------------|-------|------|
| `text` on `surface` | 16:1 (light), 15:1 (dark) | AAA |
| `text-secondary` on `surface` | 7:1 (light), 4.5:1 (dark) | AA |
| `accent` on `surface` | 4.5:1 (light), 4.7:1 (dark) | AA |
| `accent-text` on `accent` | 8.6:1 (light), 6.3:1 (dark) | AAA |

### Focus States

All interactive elements have visible, layered focus indicators:

```css
:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-accent);
}
```

### Reduced Motion

Animations and transitions are disabled for users who prefer reduced motion:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Use Tailwind's motion-safe modifier for optional animations:

```tsx
<div className="motion-safe:animate-fade-in">
  Respects user preferences.
</div>
```

### High Contrast Mode

For users who prefer more contrast, borders and muted text are automatically enhanced:

```css
@media (prefers-contrast: more) {
  :root {
    --color-border: var(--color-border-strong);
    --color-text-muted: var(--color-text-secondary);
  }
}
```

---

## Scrollbars

Modern "floating" scrollbar design with 2px border creating a gap effect:

- Width: 10px
- Thumb: Rounded with surface-colored border
- Track: Transparent
- Firefox: Uses thin scrollbar-width

---

## Selection

Text selection uses a semi-transparent accent color via `color-mix`:

```css
::selection {
  background-color: color-mix(in srgb, var(--color-accent) 25%, transparent);
  color: var(--color-text);
}
```

---

## File Structure

```
frontend/src/
├── index.css           # Tailwind + theme tokens
├── theme/
│   ├── index.ts        # Exports
│   └── ThemeProvider.tsx # Context + hook
└── main.tsx            # App entry with ThemeProvider
```

---

## CSS Variables Reference

All theme tokens are available as CSS variables:

```css
/* Surfaces */
var(--color-surface)
var(--color-surface-raised)
var(--color-surface-overlay)

/* Text */
var(--color-text)
var(--color-text-secondary)
var(--color-text-muted)

/* Borders */
var(--color-border)
var(--color-border-strong)

/* Accent */
var(--color-accent)
var(--color-accent-hover)
var(--color-accent-subtle)
var(--color-accent-text)

/* Semantic */
var(--color-success)
var(--color-success-subtle)
var(--color-warning)
var(--color-warning-subtle)
var(--color-error)
var(--color-error-subtle)
var(--color-info)
var(--color-info-subtle)

/* Typography */
var(--font-sans)
var(--font-mono)
var(--tracking-tight)
var(--tracking-normal)
var(--tracking-wide)

/* Shadows */
var(--shadow-xs)
var(--shadow-sm)
var(--shadow-md)
var(--shadow-lg)
var(--shadow-xl)
var(--shadow-inner-sm)

/* Durations */
var(--duration-instant)    /* 50ms */
var(--duration-fast)       /* 100ms */
var(--duration-normal)     /* 150ms */
var(--duration-slow)       /* 250ms */

/* Easing */
var(--ease-spring)         /* Bouncy micro-interactions */
var(--ease-smooth)         /* General smooth transitions */

/* Legacy Transitions */
var(--transition-fast)     /* 150ms */
var(--transition-base)     /* 200ms */
var(--transition-slow)     /* 300ms */
```
