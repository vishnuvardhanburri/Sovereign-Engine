/**
 * Performance monitoring utilities for tracking page load and navigation times
 */

export function measureNavigation() {
  if (typeof window === 'undefined') return

  const perfObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.entryType === 'navigation') {
        const navEntry = entry as PerformanceNavigationTiming
        const pageLoadTime = navEntry.loadEventEnd - navEntry.loadEventStart
        const connectTime = navEntry.responseEnd - navEntry.requestStart
        console.log(`[Performance] Page load: ${pageLoadTime.toFixed(2)}ms, Connect: ${connectTime.toFixed(2)}ms`)
      }
    }
  })

  try {
    perfObserver.observe({ entryTypes: ['navigation'] })
  } catch (e) {
    // Fallback for browsers that don't support PerformanceObserver
  }
}

export function measurePageTransition(pageName: string) {
  if (typeof window === 'undefined') return

  const startTime = performance.now()

  return () => {
    const endTime = performance.now()
    const duration = endTime - startTime
    if (duration < 1000) {
      console.log(`[Performance] ${pageName} transition: ${duration.toFixed(2)}ms`)
    }
  }
}

export function measureQueryFetch(queryName: string, duration: number) {
  if (duration < 200) {
    console.log(`[Performance] ${queryName} fetch: ${duration.toFixed(2)}ms OK`)
  } else if (duration < 500) {
    console.log(`[Performance] ${queryName} fetch: ${duration.toFixed(2)}ms WARN`)
  } else {
    console.warn(`[Performance] ${queryName} fetch: ${duration.toFixed(2)}ms SLOW`)
  }
}

export function reportWebVitals() {
  if (typeof window === 'undefined') return

  // Measure Core Web Vitals
  if ('web-vital' in window) {
    try {
      const vitals = (window as any)['web-vital']
      console.log('[Performance] Core Web Vitals:', vitals)
    } catch (e) {
      // Silently fail
    }
  }
}
