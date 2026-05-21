# Sovereign Engine n8n Research Templates

These workflows are designed to feed Sovereign Engine with evidence-backed lead context before approval and sending.

Use them as importable starting points in n8n. They do not bypass platform protections or scrape private data. They collect operator-provided, public, or API-backed signals and push clean rows into Google Sheets or Sovereign endpoints.

Templates:

- `01-google-maps-to-sheets.json`: Google Maps/Apify business discovery to Google Sheet.
- `02-website-contact-evidence.json`: Website/contact-page evidence scan to sheet.
- `03-social-context-research.json`: Operator-provided social URLs to concise research signals.
- `04-sheet-to-sovereign-approval.json`: Push sheet leads into Sovereign daily intake/approval.

Recommended sheet columns:

`email, company, company_domain, source_url, linkedin_url, linkedin_post_url, social_signal, competitor_signal, research_summary, offer_type`
