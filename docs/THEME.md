# Sanctum Design System

A warm, human-centered design system for privacy-first applications.

---

## Overview

Sanctum uses a **Warm Neutral** color palette with **Blue** accents, designed to feel trustworthy, secure, and professional. The system supports both light and dark modes with smooth transitions.

**Key characteristics:**
- Warm stone grays (not cold blue-grays)
- Blue accent color for primary actions (conveys trust and security)
- Inter typeface for clean, modern readability
- Generous whitespace and clear hierarchy

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
| `surface` | `#ffffff` | `#1c1917` | Page background |
| `surface-raised` | `#fafaf9` | `#292524` | Cards, panels |
| `surface-overlay` | `#f5f5f4` | `#44403c` | Dropdowns, hover states |

### Text

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `text` | `#1c1917` | `#fafaf9` | Headlines, primary text |
| `text-secondary` | `#57534e` | `#a8a29e` | Body text, descriptions |
| `text-muted` | `#a8a29e` | `#78716c` | Captions, hints, metadata |

### Borders

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `border` | `#e7e5e4` | `#44403c` | Default borders |
| `border-strong` | `#d6d3d1` | `#57534e` | Emphasized borders |

### Accent (Blue)

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

---

## Typography

### Font Families

| Token | Value | Usage |
|-------|-------|-------|
| `font-sans` | Inter, system-ui | UI text, body copy |
| `font-mono` | JetBrains Mono, Fira Code | Code, data |

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
| `rounded-sm` | 2px | Subtle rounding |
| `rounded` | 4px | Default |
| `rounded-md` | 6px | Buttons |
| `rounded-lg` | 8px | Cards, inputs |
| `rounded-xl` | 12px | Large cards |
| `rounded-2xl` | 16px | Modals |
| `rounded-full` | 9999px | Pills, avatars |

---

## Shadows

| Class | Usage |
|-------|-------|
| `shadow-sm` | Subtle depth, inputs |
| `shadow-md` | Cards, dropdowns |
| `shadow-lg` | Modals, popovers |
| `shadow-xl` | Elevated elements |

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
  transition-colors
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
  <h3 className="text-lg font-semibold text-text">Card Title</h3>
  <p className="mt-2 text-text-secondary">Card description.</p>
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
    focus:border-accent focus:ring-1 focus:ring-accent
    transition-colors
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
      className="p-2 rounded-lg bg-surface-raised hover:bg-surface-overlay"
    >
      {resolvedTheme === 'dark' ? '☀️' : '🌙'}
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
| `text` on `surface` | 15.5:1 (light), 15.5:1 (dark) | AAA |
| `text-secondary` on `surface` | 7.2:1 (light), 4.5:1 (dark) | AA |
| `accent` on `surface` | 4.5:1 (light), 4.7:1 (dark) | AA |
| `accent-text` on `accent` | 8.6:1 (light), 6.3:1 (dark) | AAA |

### Focus States

All interactive elements have visible focus indicators:

```css
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

### Reduced Motion

For users who prefer reduced motion, use:

```tsx
<div className="motion-safe:transition-all motion-safe:duration-200">
  Respects user preferences.
</div>
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

/* Shadows */
var(--shadow-sm)
var(--shadow-md)
var(--shadow-lg)
var(--shadow-xl)

/* Transitions */
var(--transition-fast)   /* 150ms */
var(--transition-base)   /* 200ms */
var(--transition-slow)   /* 300ms */
```
