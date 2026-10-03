# Requirements and scope

> Milestone update: signup/login/logout, sessions, membership enrollment/profile and organizer directory are implemented. See [AUTH_MEMBERSHIP_HANDOFF.md](AUTH_MEMBERSHIP_HANDOFF.md) for current scope and verification. Foundation-only statements below describe the prior milestone.

## Source boundaries

Sources: user instructions, the supplied four-page Student Organization System PDF, and the supplied must-have/nice-to-have screenshot. No organization video was provided. Do not claim video-specific requirements. The Sports Club brief is not this project's scope. Requirements below describe the eventual product; this branch implements only the foundation.

## Explicit product requirements — student PDF

- Membership signup, dues state, membership benefits including ticket/merchandise discounts, year-end expiry, renewal reminders and membership verification.
- Online event tickets with member/non-member prices and seat limits; fast ticket verification, attendance and event income.
- A simple website, mailing list, announcements and announcement history.
- Hoodie/T-shirt ordering with size selection, payment and size-specific inventory.
- Volunteer assignments and task progress for fundraisers.
- Dues/ticket/merchandise receipts, reimbursed volunteer expenses with receipts, and a readable remaining-balance summary.

## Explicit implementation requirements

The user selected React + Vite + JavaScript, Express/Node.js, PostgreSQL through pg, plain CSS variables and Git. All teammates must contribute through their own accounts. Dynamic runtime data, responsive consistent UI, robust input validation and intuitive navigation are mandatory. Static seed files may initialize PostgreSQL; business screens must query the API rather than load static JSON as their source of truth.

The screenshot also recommends understanding AI-generated code, local/offline fallback, API/data-modeling skills and avoiding fashionable tools without a concrete need.

## Engineering inferences / proposed decisions

- Authentication, password hashing, server-side sessions, server-enforced role/record permissions, CSRF protection for cookie-authenticated writes, audit records and private receipt access.
- Proposed roles: member, volunteer, organizer and treasurer. Confirm whether staff need multiple roles before schema implementation. Organization membership and application role are different concepts.
- Capacity/stock transactions, idempotent payment recording and atomic one-time check-in.
- QR codes implement fast check-in; QR specifically is not mandated by the PDF. Manual token entry is a useful fallback.
- Exact money in minor units, a configured currency and timestamp timezone. INR is a suggested demo currency, not a source requirement.
- Proposed member benefit check occurs when the order/registration is created; snapshot the selected price. Confirm policies before business implementation.
- Define the association's calendar/academic year end rather than assuming 365 days from signup.
- Accessibility details: semantic controls, keyboard navigation, labels, visible focus, readable contrast and meaningful errors.
- No numeric performance target is stated. Use bounded queries, pooling and pagination; measure against an agreed dataset later.

## Optional / not established

Chatbot, voice, WebSockets, native mobile apps, multi-tenant SaaS, voting/elections, a specific payment provider and Odoo integration. Annual leadership elections are context, not a request for election software. Local mail capture and manual/sandbox payment are proposed demo mechanisms, not real delivery/payment processing. Verify the official rubric before choosing them.

## Current branch acceptance

- Runnable React foundation and Express server; no fake member/ticket/financial data.
- Live database readiness check with honest unavailable state and separate process liveness.
- Required directories and reproducible dependency lockfile.
- Shared navbar, navigation/site configuration and CSS design tokens.
- Searchable implementation comments and accurate quick-change guide.
- Requirements, ownership, API/model contract, setup and walkthrough documentation.
- Available tests/builds executed and limitations disclosed.

## Not implemented on this branch

Business tables/migrations/seeds, auth/sessions/roles, business endpoints/forms, uploads, mailing, reminders, scanner, payments, financial reports, deployment and GitHub CI. Empty directories are tracked with .gitkeep. Planned navigation definitions have no invented routes.
