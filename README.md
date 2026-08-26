# workia

A [Next.js](https://nextjs.org) app with shadcn/ui, Drizzle ORM, PostgreSQL, and role-based access control (RBAC).

## Tech stack

- **Next.js** 16 (App Router, Turbopack)
- **React** 19
- **shadcn/ui** + Tailwind CSS v4
- **Drizzle ORM** + PostgreSQL (Neon)
- **TypeScript** + ESLint

## Getting started

### 1. Install dependencies

```bash
npm ci
```

### 2. Configure environment

Copy the example env file and set your PostgreSQL connection string:

```bash
cp .env.example .env.local
```

Required variable:

- `DATABASE_URL` — PostgreSQL connection string (Neon recommended for Vercel)

### 3. Set up the database

Push the schema and seed default RBAC data:

```bash
npm run db:push
npm run db:seed
```

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and visit [http://localhost:3000/admin/rbac](http://localhost:3000/admin/rbac) for the RBAC admin dashboard.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint |
| `npm run db:push` | Push Drizzle schema to PostgreSQL |
| `npm run db:generate` | Generate SQL migrations |
| `npm run db:seed` | Seed roles, permissions, and demo users |
| `npm run db:studio` | Open Drizzle Studio |

## RBAC model

Typical role-based access control with five tables:

- `users` — application users
- `roles` — named role definitions (`super_admin`, `admin`, `editor`, `viewer`)
- `permissions` — resource/action pairs (e.g. `users:read`, `content:update`)
- `role_permissions` — many-to-many role → permission mapping
- `user_roles` — many-to-many user → role mapping

### Default roles

| Role | Description |
| --- | --- |
| Super Admin | Full access to all permissions |
| Admin | Manage users, roles, content, and settings |
| Editor | Create and update content |
| Viewer | Read-only access |

### Permission helpers

Use the RBAC utilities in server code:

```typescript
import { requirePermission, userHasPermission } from "@/lib/rbac";

await requirePermission(userId, "users:update");
const canEdit = await userHasPermission(userId, "content:update");
```

## Project structure

```
src/
  app/
    admin/rbac/     # RBAC admin dashboard
    layout.tsx
    page.tsx
  components/ui/    # shadcn/ui components
  lib/
    db/             # Drizzle client + schema
    rbac/           # Permission check helpers
scripts/
  seed.ts           # Database seed script
drizzle/            # Generated migrations
```

## Learn more

- [Next.js Documentation](https://nextjs.org/docs)
- [shadcn/ui](https://ui.shadcn.com)
- [Drizzle ORM](https://orm.drizzle.team)
