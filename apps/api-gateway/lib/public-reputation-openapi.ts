export function publicReputationOpenApi(baseUrl = 'https://your-sovereign-domain.com') {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Sovereign Reputation Shield API',
      version: '1.0.0',
      description: 'Public Reputation-as-a-Service API for domain and IP health certificates.',
    },
    servers: [{ url: baseUrl }],
    paths: {
      '/api/v1/reputation/score': {
        post: {
          operationId: 'createReputationHealthCertificate',
          summary: 'Generate a Reputation Health Certificate',
          description:
            'Returns reputation score, provider lane risk, DNS posture, blacklist checks, recommendation, billing usage, and cache status.',
          security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    domain: { type: 'string', example: 'example.com' },
                    ip: { type: 'string', example: '1.2.3.4' },
                  },
                  anyOf: [{ required: ['domain'] }, { required: ['ip'] }],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Health certificate generated successfully.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthCertificate' },
                },
              },
            },
            '400': { description: 'Invalid domain, IP, or payload.' },
            '401': { description: 'Missing or invalid API key.' },
            '429': { description: 'Tiered daily rate limit exceeded.' },
            '503': { description: 'Rate limiter unavailable.' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
        BearerAuth: { type: 'http', scheme: 'bearer' },
      },
      schemas: {
        HealthCertificate: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', example: true },
            product: { type: 'string', example: 'sovereign-reputation-shield' },
            version: { type: 'string', example: 'v1' },
            certificate_id: { type: 'string', example: 'xvra_abc123' },
            issued_at: { type: 'string', format: 'date-time' },
            input: {
              type: 'object',
              properties: {
                domain: { type: ['string', 'null'] },
                ip: { type: ['string', 'null'] },
              },
            },
            observed: { type: 'boolean' },
            reputation_score: { type: 'integer', minimum: 0, maximum: 100 },
            provider_status: {
              type: 'object',
              properties: {
                gmail: { $ref: '#/components/schemas/ProviderStatus' },
                outlook: { $ref: '#/components/schemas/ProviderStatus' },
                yahoo: { $ref: '#/components/schemas/ProviderStatus' },
              },
            },
            blacklist_status: { type: 'object' },
            dns_status: { type: ['object', 'null'] },
            recommendation: { type: 'string' },
            billing: { type: 'object' },
            performance: { type: 'object' },
          },
        },
        ProviderStatus: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['HEALTHY', 'THROTTLED', 'PAUSED', 'UNKNOWN'] },
            risk_level: { type: 'string', enum: ['low', 'medium', 'high', 'critical', 'unknown'] },
            score: { type: 'integer', minimum: 0, maximum: 100 },
            max_per_hour: { type: 'integer' },
            source: { type: 'string', enum: ['reputation_worker_cache', 'postgres', 'not_observed', 'shadow_light_scan'] },
            reasons: { type: 'array', items: { type: 'string' } },
            signals: { type: ['object', 'null'] },
          },
        },
      },
    },
  }
}
