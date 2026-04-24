# Xavira Orbit

![Node](https://img.shields.io/badge/node-22.x-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Status](https://img.shields.io/badge/status-Production--ready-success)

## Autonomous Outbound Infrastructure

Not a tool.  
A decision-driven outbound system that controls sending, protects domains, and optimizes for replies.

---

## Problem

Cold email systems fail because of infrastructure:

- domains get burned
- sending is uncontrolled
- systems don’t adapt

---

## Solution

Xavira Orbit is a backend-driven system that:

- predicts risk before sending
- dynamically controls volume and routing
- learns from replies and outcomes
- guarantees no duplicate sends

---

## Architecture

Lead  
→ Validator  
→ Decision Engine  
→ Queue  
→ Sending Engine  
→ Tracking  
→ Outcome Engine  
→ Feedback Loop  

---

## System Guarantees

- Exactly-once sending (no duplicates)
- Domain protection (auto pause + throttling)
- Explainable decisions (traceable)
- Outcome optimization (reply-driven)

---

## Example Decision Output

```json
{
  "decision": "defer",
  "reasons": ["high_risk_domain", "low_reply_window"],
  "expected_reply_prob": 0.18
}
```

---

## Run Locally

```bash
docker compose up -d
pnpm db:init
pnpm dev
```

---

## Philosophy

Outbound should not be manual.

Systems should:

* decide when to send
* adapt based on results
* protect infrastructure automatically

