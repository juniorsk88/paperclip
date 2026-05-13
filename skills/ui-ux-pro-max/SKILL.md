---
name: ui-ux-pro-max
description: UI/UX design system guide for building consistent, polished frontend interfaces. Use when creating UI components, styling pages, or improving visual quality of frontend work. Covers design tokens, spacing, typography, color systems, component composition, responsive patterns, and accessibility.
required: false
---

# UI/UX Pro Max

Expert guidance for building high-quality frontend interfaces. Apply these principles when working on UI tasks.

## Design Principles

1. **Consistency first** — Reuse existing patterns and components. Do not invent new conventions when the codebase already has established patterns.
2. **Progressive enhancement** — Start with semantic HTML, add CSS for layout/styling, then JavaScript for interactivity.
3. **Accessibility by default** — Use proper ARIA labels, keyboard navigation, focus management, and sufficient color contrast (WCAG AA minimum).
4. **Mobile-first responsive** — Design for smallest viewport first, then add breakpoints for larger screens.
5. **Performance-aware** — Minimize layout shifts (CLS), optimize images, lazy-load below-fold content.

## Visual Quality Checklist

Before marking a UI task complete, verify:
- [ ] Spacing follows the design system (consistent padding/margins using defined tokens like 4px, 8px, 16px, 24px, 32px)
- [ ] Typography uses proper hierarchy (h1-h6, body, caption sizes)
- [ ] Colors come from the theme/design tokens, not hardcoded
- [ ] Interactive elements have hover, focus, active, and disabled states
- [ ] Loading states are handled (skeletons, spinners, or progressive loading)
- [ ] Empty states have helpful messages
- [ ] Error states show user-friendly messages with recovery actions
- [ ] Forms have proper validation feedback
- [ ] Transitions/animations respect `prefers-reduced-motion`
- [ ] Touch targets are at least 44x44px on mobile
- [ ] Content is readable without horizontal scroll at 320px width

## Component Patterns

- Prefer composition over inheritance
- Use `children` or render props for flexible component APIs
- Keep components focused — single responsibility
- Extract reusable logic into hooks (React) or composables (Vue)
- Avoid inline styles — use CSS modules, Tailwind, or styled-components consistently with the project

## Responsive Strategy

- Default: single-column layout
- ≥768px: two-column where appropriate
- ≥1024px: full desktop layout
- Use `min-width` media queries (mobile-first)
- Test breakpoints, not specific devices
