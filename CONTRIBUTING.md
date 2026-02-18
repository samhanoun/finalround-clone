# Contributing to FinalRound Clone

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js 18+ (20+ recommended)
- npm or yarn
- Supabase CLI
- Docker (for local Supabase)

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/finalround-clone.git
   cd finalround-clone
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up local Supabase**
   ```bash
   # Install Supabase CLI if not already installed
   npm install -g supabase
   
   # Initialize local Supabase
   supabase init
   
   # Start local Supabase
   supabase start
   ```

4. **Configure environment**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your local Supabase credentials
   ```

5. **Run database migrations**
   ```bash
   supabase db push
   ```

6. **Start development server**
   ```bash
   npm run dev
   ```

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── copilot/       # Copilot session APIs
│   │   ├── interviews/    # Interview CRUD APIs
│   │   ├── resume/        # Resume APIs
│   │   └── ...
│   └── (page routes)
├── lib/                    # Shared utilities
│   ├── supabase/          # Supabase clients (server, browser, admin)
│   ├── sttProviders/      # Speech-to-text integrations
│   └── ...
└── styles/                # Global styles
```

## Coding Standards

### TypeScript

- Use strict TypeScript mode
- Prefer explicit types over `any`
- Use interfaces over types for object shapes

### React/Next.js

- Use Server Components where possible
- Use `use client` directive only when needed
- Follow Next.js App Router conventions

### API Routes

- Validate all inputs with Zod
- Return consistent response formats
- Handle errors gracefully with proper HTTP status codes

### Testing

- Write unit tests for utility functions
- Test API routes with proper mocking
- Aim for meaningful test coverage

## Git Workflow

### Branch Naming

- `feature/description` — New features
- `fix/description` — Bug fixes
- `docs/description` — Documentation updates
- `refactor/description` — Code refactoring

### Commit Messages

Use conventional commits:

```
feat: add new interview question API
fix: resolve rate limit not resetting
docs: update API documentation
refactor: simplify session handling
test: add tests for copilot stream
```

### Pull Requests

1. Create a feature branch from `main`
2. Make your changes
3. Ensure tests pass (`npm test`)
4. Run linting (`npm run lint`)
5. Push and create a PR
6. Request review from maintainers

## Database Migrations

### Creating a Migration

```bash
supabase migration new migration_name
```

### Applying Migrations

```bash
# Local
supabase db push

# Production (via Supabase CLI)
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

### Migration Guidelines

- Always use reversible migrations
- Add comments explaining complex changes
- Include RLS policies in migrations
- Test migrations locally before pushing

## Testing Guidelines

### Running Tests

```bash
# All tests
npm test

# Watch mode
npm test -- --watch

# Specific file
npm test -- rateLimit.test.ts

# Coverage
npm test -- --coverage
```

### Writing Tests

- Use `@testing-library/jest-dom` for DOM assertions
- Mock external dependencies (Supabase, OpenAI, etc.)
- Test both success and error cases

## API Development

### Adding a New API Route

1. Create route file in `src/app/api/`
2. Use Zod for input validation
3. Get user from Supabase session
4. Return JSON responses
5. Add tests

Example:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const RequestSchema = z.object({
  name: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const supabase = createClient();
  
  // Check auth
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // Validate input
  const body = await request.json();
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }
  
  // Process request
  // ...
  
  return NextResponse.json({ success: true });
}
```

## Questions?

- Open an issue for bugs or feature requests
- Join discussions in PRs
- Check existing documentation in `docs/`

---

Thank you for contributing!
