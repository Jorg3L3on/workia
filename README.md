# workia

A [Next.js](https://nextjs.org) app with shadcn/ui, Drizzle ORM, PostgreSQL, Auth.js, and RBAC — single tenant.

## Tech stack

- **Next.js** 16 (App Router, Turbopack, `proxy.ts`)
- **React** 19
- **Auth.js v5** (NextAuth) + Drizzle adapter
- **shadcn/ui** + Tailwind CSS v4 + `next-themes`
- **Drizzle ORM** + PostgreSQL (Neon free tier)
- **pino** structured logging
- **Vitest** + **Playwright** + GitHub Actions CI

## Getting started

### 1. Install dependencies

```bash
npm ci --legacy-peer-deps
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Required variables:

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Auth.js secret (32+ chars) |

Optional:

| Variable | Description |
| --- | --- |
| `AUTH_GOOGLE_ID` | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret |

Generate `AUTH_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### 3. Set up the database

```bash
npm run db:push
npm run db:seed
```

### 4. Run the development server

```bash
npm run dev
```

| URL | Description |
| --- | --- |
| http://localhost:3000 | Marketing home |
| http://localhost:3000/login | Sign in |
| http://localhost:3000/app | End-user app (auth required) |
| http://localhost:3000/admin | Admin back-office (admin permissions) |

### Demo credentials

After seeding:

| Email | Password | Role |
| --- | --- | --- |
| `admin@workia.local` | `Workia123!` | Super Admin |
| `editor@workia.local` | `Workia123!` | Editor |
| `viewer@workia.local` | `Workia123!` | Viewer |

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run start` | Serve production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm run test` | Vitest unit tests |
| `npm run test:e2e` | Playwright E2E tests |
| `npm run format` | Prettier write |
| `npm run db:push` | Push Drizzle schema |
| `npm run db:seed` | Seed RBAC + demo users |

## Architecture

```
/              Public home
/login         Auth.js sign-in
/app/*         End-user app (authenticated)
/admin/*       Back-office (admin permissions via RBAC)
/api/auth/*    Auth.js handlers
```

RBAC helpers live in `src/lib/rbac/`. Route protection uses `src/proxy.ts` for session checks; fine-grained permission checks run in server components via `requirePermission()`.

## Deployment (free tier)

1. Push to GitHub
2. Import repo on [Vercel Hobby](https://vercel.com)
3. Set `DATABASE_URL` and `AUTH_SECRET` in Vercel env vars
4. Use [Neon](https://neon.tech) free tier for PostgreSQL

Logs are emitted as JSON via **pino** and appear in Vercel Runtime Logs — no paid observability required.

## Project structure

```
src/
  app/
    admin/          # Back-office
    app/            # End-user app
    login/          # Sign-in page
    api/auth/       # Auth.js routes
  auth.ts           # Auth.js config
  proxy.ts          # Route protection
  env.ts            # Typed environment
  lib/
    db/             # Drizzle schema + client
    rbac/           # Permission helpers
    logger.ts       # pino logger
e2e/                # Playwright tests
.github/workflows/  # CI pipeline
```
