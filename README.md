# Wifex

A Next.js foundation for a Wi-Fi hotspot billing system.

## Development

Requires Node.js 20.9 or later and npm.

```sh
npm install
npm run dev
```

Open http://localhost:3000.

## Checks

```sh
npm run lint
npm run build
```

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- ESLint

## Starting points

- `src/app/page.tsx`: starter page
- `src/app/layout.tsx`: app layout and metadata
- `src/app/globals.css`: global styles
- `public/`: static assets

## Planned modules

- Hotspot plans and pricing
- Customers and sessions
- Payments and billing
- Router integration and access vouchers

The current app is a starter UI. Authentication, persistence, payment processing,
and router integrations are not implemented yet.
