# Xavira Orbit

Xavira Orbit is an outbound infrastructure platform: validation, decisioning, queueing, sending, tracking, reputation, and closed-loop outcome optimization. It is built to protect domains first, then maximize replies (and meetings when available) with measurable A/B proof.

## Architecture (Monorepo)

Key folders:

- `apps/`: UI + API Gateway (Next.js)
- `services/`: engines (sending, tracking, reputation, outcome, optimizer, etc.)
- `workers/`: queue-driven workers (sender-worker, optimizer-worker, etc.)
- `libs/`: shared utilities (smtp, rate-limiter, circuit-breaker, types)
- `configs/`: env + limits config
- `docs/`: architecture + ops notes

Flow:

`Lead → Validator → Decision Engine → Queue → Sender Worker → SMTP → Tracking → Outcome Engine → (feeds next decisions)`

## Core Principles

- Decision-first: no direct sending without validation and routing logic.
- Safety-first: circuit breakers, caps, idempotency (practical exactly-once), and explainability.
- Outcomes > activity: optimize reply/meeting rates with A/B proof.
- Auditability: every decision is logged and attributable.

## Local Run

Requirements: Node + pnpm, Docker (Postgres + Redis).

1. Install deps
```bash
pnpm install
```

2. Start local infra
```bash
docker compose up -d
```

3. Configure env
```bash
cp .env.example .env
```

4. Init DB + run app
```bash
pnpm db:init
pnpm dev -p 3000
```

5. (Optional) run sender worker
```bash
pnpm worker:sender
```

## Demo Credentials (local)

- Email: `demo@xavira.local`
- Password: `Demo1234!`

## Demo Endpoints

- `GET /api/system/health` (live stability + reliability metrics)
- `GET /api/demo/campaign/:id` (human-readable campaign story)
- `GET /api/report/campaign/:id` (baseline vs treatment proof)
- `GET /api/report/export?format=csv|json`
- `POST /api/support/trace/:id` (full explainability trace)

- Fully implemented dark mode using Tailwind CSS
- Custom color tokens in globals.css
- Consistent across all pages and components

### Responsive Design
- Mobile-first approach
- Hamburger menu on mobile (width < 768px)
- Responsive tables and modals
- Touch-friendly buttons and inputs
- Optimized layout for all screen sizes

## Testing Checklist

- [x] Login/logout flow
- [x] Navigation links functional
- [x] Create campaign with sequence
- [x] Campaign status toggle
- [x] CSV contact upload with deduplication
- [x] Search and filter functionality
- [x] Sequence editor (create/edit steps)
- [x] Reply status management
- [x] Analytics charts rendering
- [x] Settings persistence
- [x] Toast notifications
- [x] Loading states with skeletons
- [x] Empty states
- [x] Mobile responsiveness (320px+)
- [x] Dark theme applied

## Backend Integration

To connect to a real backend:

1. **Update API layer** (`lib/api.ts`):
   - Replace mock data generators with real API calls
   - Update endpoints to point to your backend

2. **Update hooks** (`lib/hooks/index.ts`):
   - Modify query functions to call real API routes
   - Keep the same hook interface for zero component changes

3. **Authentication**:
   - Replace mock login in `useAuth` store with real JWT flow
   - Add refresh token logic if needed

## Performance Optimizations

- React Query caching and deduplication
- Skeleton loaders for better perceived performance
- Lazy loading of charts and components
- Optimized re-renders with Zustand
- CSS-in-JS minimization with Tailwind

## Deployment

Deploy to Vercel with one click:

1. Push code to GitHub
2. Connect to Vercel
3. Set any required environment variables
4. Deploy

## Future Enhancements

- Real backend API integration
- Email sending via SMTP/SendGrid
- Advanced analytics and reporting
- A/B testing for email content
- Webhook support for email events
- Multi-user collaboration
- Team management and permissions
- Custom email templates
- Scheduled sending
- Integration with CRM systems

## License

MIT

## Support

For issues or questions, please open an issue on GitHub.
