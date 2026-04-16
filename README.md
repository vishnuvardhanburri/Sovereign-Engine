# Xavira - Premium Cold Email Automation

A production-grade, white-labeled cold email automation platform built with Next.js 16, React Query, Zustand, and ShadCN UI components. Optimized for instant navigation (<200ms) and seamless user experience.

## Performance Features

- **Instant Navigation:** <200ms page transitions with no full reloads
- **Smart Data Caching:** 30-second freshness with background refetch
- **Prefetch on Hover:** Load data before user clicks
- **Optimistic Updates:** UI responds instantly to mutations
- **Keep Previous Data:** No loading spinners, seamless transitions
- **Pagination:** 50 items per page for lightning-fast responses
- **Client-Side Routing:** Next.js Link for instant navigation

See [PERFORMANCE_GUIDE.md](./PERFORMANCE_GUIDE.md) for detailed optimization documentation.

## Features

### Dashboard
- Real-time statistics (emails sent, replies, open rates, bounce rates)
- 30-day email performance chart
- Recent activity feed with event tracking

### Campaigns
- Create and manage email campaigns
- Campaign status control (active/paused/completed)
- Performance metrics per campaign
- Campaign detail pages with sequence preview
- Search, filter, and sort capabilities

### Domains & Rate Control
- **Domain Management**: Add and manage sending domains with daily limits
- **Identity Management**: Create email identities per domain
- **Health Scoring**: Real-time health metrics (0-100 based on bounce/reply rates)
- **Rate Limiting**: Token bucket algorithm with 60-120s jitter between sends
- **Auto Pause**: Domains automatically pause if bounce rate exceeds 5%
- **Limit Scaling**: Daily limits scale from 50 to 500 emails based on domain health
- **Queue Management**: Redis-backed job queue for reliable email delivery
- **Event Tracking**: Track sent, bounce, reply, and complaint events

### Contacts
- Bulk CSV contact import with deduplication
- Contact status tracking (active/replied/bounced)
- Search and filter by email/name/company
- Delete individual contacts
- Contact management interface

### Email Sequences
- Visual sequence editor with multi-step support
- Configure day delays, subject lines, and email body
- Variable support ({{FirstName}}, {{Company}})
- Create, edit, and preview sequences
- Use sequences for multiple campaigns

### Analytics
- Campaign performance metrics visualization
- Reply rate by campaign (bar chart)
- Performance comparison (replies, bounce, open rates)
- Detailed campaign analytics table
- Key metrics overview (avg reply rate, open rate, bounce rate)

### Inbox
- Review prospect replies
- Email thread view with conversation history
- Reply status management (interested/not interested/unread)
- Search and filter replies
- Quick status indicators and statistics

### Settings
- User profile information
- Timezone configuration
- Auto-unsubscribe on bounce toggle
- API key management (for worker service)
- Account management

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Frontend**: React 19, TypeScript, ShadCN UI + Radix UI
- **State Management**: Zustand (auth & UI state) + React Query (server state)
- **Styling**: Tailwind CSS v4 (dark theme)
- **Database**: PostgreSQL via `pg` driver
- **Caching/Queue**: Upstash Redis (serverless)
- **Charts**: Recharts
- **Notifications**: Sonner (toast notifications)
- **Validation**: Zod + React Hook Form
- **Worker Service**: Node.js with Resend email API integration
- **Deployment**: Vercel (API) + External worker (Render/Fly.io)

## Project Structure

```
├── app/
│   ├── (auth)/login/               # Login page
│   ├── (dashboard)/                # Protected routes
│   │   ├── dashboard/              # Main dashboard
│   │   ├── campaigns/              # Campaign management
│   │   ├── domains/                # Domain management
│   │   ├── contacts/               # Contact management
│   │   ├── sequences/              # Email sequences
│   │   ├── analytics/              # Analytics dashboard
│   │   ├── inbox/                  # Reply management
│   │   ├── settings/               # User settings
│   │   └── layout.tsx
│   ├── api/                        # API routes
│   │   ├── domains/                # Domain CRUD + pause/resume
│   │   ├── identities/             # Email identity endpoints
│   │   ├── queue/                  # Job queue management
│   │   ├── events/                 # Event tracking
│   │   ├── health/                 # Health scoring
│   │   └── cron/                   # Scheduled tasks
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── ui/                         # ShadCN UI components
│   ├── domain-manager.tsx          # Domain table & controls
│   ├── add-domain-modal.tsx        # Add domain form
│   ├── identities-list.tsx         # Email identities
│   ├── sidebar.tsx
│   ├── header.tsx
│   ├── app-layout.tsx
│   └── ...
├── lib/
│   ├── api.ts                      # Frontend API client
│   ├── db.ts                       # PostgreSQL client
│   ├── db/types.ts                 # Database types
│   ├── redis.ts                    # Redis utilities & queue
│   ├── rate-limiter.ts             # Rate limiting logic
│   ├── integration-tests.ts        # Backend integration test
│   ├── store.ts                    # Zustand store
│   ├── hooks/index.ts              # React Query hooks
│   └── utils.ts
├── scripts/
│   ├── init-db.sql                 # Database schema
│   └── seed-data.ts                # Test data seeding
├── worker/                         # External worker service
│   ├── index.ts                    # Email queue processor
│   └── package.json
├── DOMAIN_RATE_CONTROL_README.md   # Detailed documentation
└── package.json
```

## Getting Started

### Demo Credentials

The application includes mock authentication. Use these credentials:
- **Email**: `demo@example.com`
- **Password**: `password`

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   # or
   pnpm install
   ```

3. Run the development server:
   ```bash
   npm run dev
   # or
   pnpm dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## Key Features Explained

### Mock API Layer
- All data is generated and cached locally in `lib/api.ts`
- Includes realistic 300-500ms delays for UI feedback
- Easy to replace with real backend API

### Authentication
- Zustand-based auth state management
- JWT token stored in localStorage
- Protected routes with automatic redirect to login
- Logout clears auth state

### React Query Integration
- Separate hooks for each data type (campaigns, contacts, sequences, replies, analytics)
- Built-in loading and error states
- Automatic cache invalidation on mutations
- Optimized re-renders

### Dark Theme
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
