# Quick change guide

Use Ctrl+Shift+F in your editor to search the exact tag. Paths below are relative to the repository root and exist now. Search tags have one authoritative implementation location; documentation repeats them for lookup. Change only the relevant source and verify the smallest affected flow.

## Navbar background/text/hover colors

- Tag: `@edit:NAVBAR_COLORS`
- File: client/src/styles/tokens.css
- Variables: --navbar-bg, --navbar-text, --navbar-hover-bg, --navbar-border.
- Consumed by client/src/components/Navbar.css.
- Verify: desktop and mobile menu, readable text, hover and keyboard focus. Brand SVG colors do not inherit navbar variables.

## Navbar links/order/labels

- Tag: `@edit:NAVBAR_LINKS`
- File: client/src/config/navigation.js
- Component: client/src/components/Navbar.jsx
- Verify: each public link reaches an existing section, mobile closes after selection and Escape restores menu-button focus. member/staff arrays are planned and not rendered as authenticated navigation. Do not enable links before routes/permissions exist.

## App name, logo and homepage copy

- Tag: `@edit:BRAND_NAME`
- File: client/src/config/site.js
- Logo: client/public/logo.svg. Tab title, description and favicon: client/index.html.
- Verify: navbar, hero, footer, browser title and narrow-screen wrapping. Modify the SVG only when the logo itself changes.

## Global palette and spacing

- Tag: `@edit:GLOBAL_COLORS`
- File: client/src/styles/tokens.css
- Layout selectors: client/src/styles/global.css
- Verify: text/status contrast, cards, small screens and no horizontal overflow. Navbar has separate variables by design.

## Buttons

- Tag: `@edit:BUTTON_STYLES`
- Colors: client/src/styles/tokens.css
- Shape/layout: .button and .button-secondary in client/src/styles/global.css.
- Verify: primary and secondary buttons, focus, hover and disabled “Checking…” state.

## Database health / error display

- Tag: `@flow:DATABASE_HEALTH`
- Query: server/controllers/health.controller.js, createHealthController.
- UI: client/src/components/ConnectionStatus.jsx.
- Request: client/src/services/healthApi.js, getHealth.
- Retry/cancellation: client/src/hooks/useHealth.js, useHealth.
- Verify: configured/live DB → green connected status; missing/stopped DB → honest attention state; retry recovers. Never replace this with a hardcoded success.

## Server host/port/database destination

- Examples: server/.env.example and client/.env.example.
- Parser: server/config/env.js, readConfig; pool: server/config/db.js, createDatabase.
- Vite proxy: client/vite.config.js. If API port changes, update API_PROXY_TARGET in client/.env and restart Vite.
- Verify GET /api/live and /api/health through both API and frontend proxy. Never paste credentials in a screenshot or commit .env.

## Planned features — no implementation to edit yet

Membership prices/expiry, ticket rules, stock, expense approvals, business navigation and user permissions have no business implementation on this branch. Use API_CONTRACT.md to coordinate future files. Once implemented, put @rule comments beside the authoritative server/SQL logic and add the actual file/function here. Do not create fictional file references or change frontend constants to simulate a business-rule update.
