# Xavira Orbit Agent Architecture

This repository now includes a modular outbound swarm architecture with three layers:

- **Data Layer**: ingest leads, enrich profiles, manage domain risk and rate capacity.
- **Execution Layer**: schedule work, make rule-based send decisions, and execute queue-driven delivery.
- **Intelligence Layer**: personalization, subject ideation, and insight generation.

## Agent boundaries

### Data agents
- `lib/agents/data/lead-agent.ts`
  - Handles contact enrichment and lead profile maintenance.
- `lib/agents/data/risk-agent.ts`
  - Applies domain risk rules, refreshes daily send capacity, and updates domain health.

### Execution agents
- `lib/agents/execution/decision-agent.ts`
  - Central rule-based decision engine for whether jobs should send, defer, or skip.
- `lib/agents/execution/scheduler.ts`
  - Central scheduler for daily maintenance and operating cycles.

### Intelligence agents
- `lib/agents/intelligence/personalization-agent.ts`
  - Builds outbound copy and only uses AI for `{{AIIntro}}` personalization.
- `lib/agents/intelligence/subject-generation-agent.ts`
  - Generates subject line ideas using AI.
- `lib/agents/intelligence/insight-generation-agent.ts`
  - Produces and publishes daily outbound insights.

## Communication model

Agents communicate using:

- Database state: contacts, campaigns, domains, identities, events
- Redis queue: job scheduling and retry delivery
- Events: sent, retry, skipped, failed, bounce, reply

No agent calls another directly to execute behavior. Instead, the scheduler and decision agent use database state, queues, and events to coordinate the workflow.

## Workflow

1. Leads are ingested and optionally enriched by the Data layer.
2. Campaign jobs are queued for execution.
3. The Execution layer evaluates queue jobs rule-by-rule.
4. The Intelligence layer personalizes content and only uses AI for allowed tasks.
5. Email delivery is executed through the worker service.
6. Events are emitted for tracking, then daily insight cycles are run by the scheduler.

## Rate control and domain safety

- Domain limits are refreshed daily.
- Identity cooldown is enforced before each send.
- Spam risk copy is deferred.
- Domain pause rules apply when SPF/DKIM/DMARC fail or bounce rate spikes.
