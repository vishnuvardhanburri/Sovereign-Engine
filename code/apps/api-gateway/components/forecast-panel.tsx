'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { ExecutiveForecast } from '@/lib/api'

function riskTone(risk: ExecutiveForecast['forecast']['projectedBounceRisk']): string {
  if (risk === 'LOW') return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
  if (risk === 'MEDIUM') return 'bg-amber-500/15 text-amber-200 border-amber-500/30'
  return 'bg-rose-500/15 text-rose-200 border-rose-500/30'
}

export function ForecastPanel(props: { forecast?: ExecutiveForecast }) {
  const f = props.forecast

  return (
    <Card className="bg-white/5 backdrop-blur border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Forecast & Risk Outlook</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!f ? (
          <div className="text-sm text-muted-foreground">System initializing. Forecast will appear once enough data is collected.</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="text-xs text-muted-foreground">Expected replies today</div>
                <div className="mt-1 text-2xl font-semibold">{f.forecast.expectedRepliesToday.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="text-xs text-muted-foreground">Projected bounce risk</div>
                <div className="mt-2">
                  <Badge variant="outline" className={riskTone(f.forecast.projectedBounceRisk)}>
                    {f.forecast.projectedBounceRisk}
                  </Badge>
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="text-xs text-muted-foreground">Estimated safe send capacity remaining</div>
                <div className="mt-1 text-2xl font-semibold">{f.forecast.estimatedSafeSendCapacityRemaining.toLocaleString()}</div>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-sm font-semibold">Trends (last {f.trends.days} days)</div>
              <div className="mt-2 text-sm text-muted-foreground">{f.trends.reply.text}</div>
              <div className="mt-1 text-sm text-muted-foreground">{f.trends.bounce.text}</div>
            </div>

            {f.earlyWarnings.length > 0 ? (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                <div className="text-sm font-semibold text-amber-200">Early warnings</div>
                <ul className="mt-2 space-y-1 text-sm text-amber-100/90">
                  {f.earlyWarnings.slice(0, 3).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                No near-term risks detected. System will adjust sending automatically if signals change.
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

