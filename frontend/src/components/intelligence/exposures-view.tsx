'use client';

import type { CandidateExposure, ExposurePathway } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  EXPOSURE_PRIORITY_CONFIG,
  EXPOSURE_STRENGTH_CONFIG,
  EXPOSURE_VALIDATION_CONFIG,
  formatEventDateTime,
  formatTypeLabel,
} from '@/lib/intelligence-utils';
import { cn } from '@/lib/utils';

interface ExposureListProps {
  exposures: CandidateExposure[];
  selectedExposureId: string | null;
  onSelect: (exposure: CandidateExposure) => void;
}

/** geographic_site → 'Geographic Site' (chip labels). */
function formatPathway(pathway: ExposurePathway): string {
  return formatTypeLabel(pathway);
}

/**
 * The Exposures view's selectable list (Doctrine §13): the org-specific
 * candidate exposures the Client Monitoring Agent derived from global events.
 * Tenant-scoped server-side — the list only ever holds this org's rows.
 */
export function ExposureList({ exposures, selectedExposureId, onSelect }: ExposureListProps) {
  if (exposures.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <svg
            className="mx-auto h-12 w-12 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
            />
          </svg>
          <p className="mt-4 text-muted-foreground">No candidate exposures for this organization</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {exposures.map((exposure) => {
        const strength = EXPOSURE_STRENGTH_CONFIG[exposure.exposureStrength];
        const validation = EXPOSURE_VALIDATION_CONFIG[exposure.validationStatus];

        return (
          <button
            key={exposure.id}
            onClick={() => onSelect(exposure)}
            aria-current={selectedExposureId === exposure.id}
            className={`w-full text-left p-4 rounded-lg border transition-colors ${
              selectedExposureId === exposure.id
                ? 'border-primary bg-primary/10'
                : 'border-border hover:bg-muted'
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-medium text-sm leading-tight line-clamp-2">
                  {exposure.globalEvent?.headline ?? 'Global event unavailable'}
                </h4>
                <span
                  className={cn(
                    'shrink-0 inline-flex px-2 py-0.5 rounded text-xs font-medium',
                    strength.bgColor,
                    strength.textColor,
                  )}
                >
                  {strength.label}
                </span>
              </div>

              <div className="text-xs text-muted-foreground">
                {exposure.exposurePathways.map((p) => formatPathway(p.pathway)).join(', ')}
                {exposure.exposedAssets.length > 0 &&
                  ` · ${exposure.exposedAssets.length} asset${exposure.exposedAssets.length !== 1 ? 's' : ''}`}
              </div>

              <div className="pt-1 flex items-center gap-2 flex-wrap">
                <span
                  className={cn(
                    'inline-flex px-2 py-0.5 rounded text-xs font-medium',
                    validation.bgColor,
                    validation.textColor,
                  )}
                >
                  {validation.label}
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </>
  );
}

/**
 * Full detail for one candidate exposure: why the agent believes the org is
 * exposed, through which pathways, and which assets are in the blast radius.
 */
export function ExposureDetail({
  exposure,
  onOpenGlobalEvent,
}: {
  exposure: CandidateExposure;
  onOpenGlobalEvent?: (globalEventId: string) => void;
}) {
  const strength = EXPOSURE_STRENGTH_CONFIG[exposure.exposureStrength];
  const priority = EXPOSURE_PRIORITY_CONFIG[exposure.exposurePriority];
  const validation = EXPOSURE_VALIDATION_CONFIG[exposure.validationStatus];

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <CardTitle className="text-lg leading-snug">
              {exposure.globalEvent?.headline ?? 'Candidate exposure'}
            </CardTitle>
            <CardDescription>
              Detected {formatEventDateTime(exposure.createdAt)}
              {exposure.updatedAt !== exposure.createdAt &&
                ` · Updated ${formatEventDateTime(exposure.updatedAt)}`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                'inline-flex px-2 py-0.5 rounded text-xs font-medium',
                priority.bgColor,
                priority.textColor,
              )}
            >
              {priority.label} priority
            </span>
            <span
              className={cn(
                'inline-flex px-2 py-0.5 rounded text-xs font-medium',
                strength.bgColor,
                strength.textColor,
              )}
            >
              {strength.label} exposure
            </span>
            <span
              className={cn(
                'inline-flex px-2 py-0.5 rounded text-xs font-medium',
                validation.bgColor,
                validation.textColor,
              )}
            >
              {validation.label}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 p-4">
        {/* Why the Client Monitoring Agent linked this org to the event. */}
        <section>
          <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Rationale
          </h4>
          <p className="text-sm">{exposure.rationale}</p>
        </section>

        <section>
          <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Exposure pathways
          </h4>
          <ul className="space-y-3">
            {exposure.exposurePathways.map((pathway, i) => (
              <li key={`${pathway.pathway}-${i}`} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{formatPathway(pathway.pathway)}</span>
                  <span className="text-muted-foreground">
                    {Math.round(pathway.confidence * 100)}% confidence
                  </span>
                </div>
                <p className="text-muted-foreground mt-0.5">{pathway.matchBasis}</p>
              </li>
            ))}
          </ul>
        </section>

        {exposure.exposedAssets.length > 0 && (
          <section>
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Exposed assets ({exposure.exposedAssets.length})
            </h4>
            <ul className="space-y-2">
              {exposure.exposedAssets.map((asset) => (
                <li key={`${asset.assetType}-${asset.assetId}`} className="text-sm">
                  <span className="font-medium">
                    {asset.assetName ?? asset.assetId}
                  </span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {formatTypeLabel(asset.assetType)} · {asset.distanceOrMatchBasis}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {exposure.temporalRelevance &&
          (exposure.temporalRelevance.shipmentEta ||
            exposure.temporalRelevance.eventWindow ||
            exposure.temporalRelevance.regulationEffectiveDate) && (
            <section>
              <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Temporal relevance
              </h4>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {exposure.temporalRelevance.shipmentEta && (
                  <div>
                    <dt className="text-muted-foreground">Shipment ETA</dt>
                    <dd>{formatEventDateTime(exposure.temporalRelevance.shipmentEta)}</dd>
                  </div>
                )}
                {exposure.temporalRelevance.eventWindow && (
                  <div>
                    <dt className="text-muted-foreground">Event window</dt>
                    <dd>{exposure.temporalRelevance.eventWindow}</dd>
                  </div>
                )}
                {exposure.temporalRelevance.regulationEffectiveDate && (
                  <div>
                    <dt className="text-muted-foreground">Regulation effective</dt>
                    <dd>{formatEventDateTime(exposure.temporalRelevance.regulationEffectiveDate)}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}

        {exposure.strategicContext && exposure.strategicContext.length > 0 && (
          <section>
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Strategic context
            </h4>
            <ul className="space-y-1 text-sm">
              {exposure.strategicContext.map((ctx, i) => (
                <li key={`${ctx.docRef}-${i}`}>
                  <span className="font-medium">{ctx.initiative}</span>
                  <span className="text-muted-foreground"> ({ctx.docRef})</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {exposure.clearedAt && (
          <section>
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Clearance
            </h4>
            <p className="text-sm">
              Cleared {formatEventDateTime(exposure.clearedAt)}
              {exposure.clearedReason ? ` — ${exposure.clearedReason}` : ''}
            </p>
          </section>
        )}

        {onOpenGlobalEvent && exposure.globalEvent && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenGlobalEvent(exposure.globalEventId)}
          >
            View global event →
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
