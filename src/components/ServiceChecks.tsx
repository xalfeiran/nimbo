import type { ServiceCheck, ServiceCheckResult, ServiceStatus } from '../types/workspace';

interface ServiceChecksProps {
  checks: ServiceCheck[];
  results: Record<string, ServiceCheckResult>;
  running: boolean;
  onRefresh: () => void;
}

const STATUS_LABEL: Record<ServiceStatus, string> = {
  healthy: 'healthy',
  unhealthy: 'down',
  unknown: 'unknown',
  error: 'error'
};

function StatusBadge({ status }: { status: ServiceStatus }) {
  const cls =
    status === 'healthy'
      ? 'badge badge--healthy'
      : status === 'unhealthy'
        ? 'badge badge--unhealthy'
        : status === 'error'
          ? 'badge badge--error'
          : 'badge';
  return (
    <span className={cls}>
      <span className="badge__dot" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ServiceChecks({ checks, results, running, onRefresh }: ServiceChecksProps) {
  if (checks.length === 0) return null;
  return (
    <section>
      <div className="section__title">
        <span>Service Checks</span>
        <button className="btn btn--sm" onClick={onRefresh} disabled={running}>
          {running ? 'Checking…' : 'Refresh Checks'}
        </button>
      </div>
      <div className="checks-grid">
        {checks.map((check) => {
          const result = results[check.id];
          const status: ServiceStatus = result?.status ?? 'unknown';
          return (
            <div className="check-card" key={check.id}>
              <div className="check-card__top">
                <span className="check-card__name">{check.name}</span>
                <StatusBadge status={status} />
              </div>
              <div className="check-card__out" title={result?.error || result?.output || ''}>
                {result?.error
                  ? result.error
                  : result?.output
                    ? result.output
                    : `expected: ${check.expected}`}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
