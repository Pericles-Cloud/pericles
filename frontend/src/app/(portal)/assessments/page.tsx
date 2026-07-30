'use client';

/**
 * Assessments — risk-profiling module (GH #12 adds the nav entry).
 *
 * Placeholder shell only. The module itself (risk-profile heat map, framework
 * selection, report generation/viewing, scenario exploration) is specified in
 * the pericles-assessments-ui build skill and is not implemented yet.
 */

import { useAuth } from '@/providers/auth-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Fillet } from '@/components/ui/fillet';

export default function AssessmentsPage() {
  const { currentOrganization } = useAuth();

  if (!currentOrganization) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">Please select an organization to view assessments</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-3xl font-semibold text-foreground">Assessments</h2>
        <Fillet className="my-2" />
        <p className="text-muted-foreground">
          Risk profiling and assessment reports for {currentOrganization.name}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Coming soon</CardTitle>
          <CardDescription>
            Assessments will provide a risk-profile heat map across your supply chain, generated
            assessment reports, and scenario exploration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 rounded-full bg-muted-foreground shrink-0" />
              Risk Profile heat map across suppliers, lanes, and regions
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 rounded-full bg-muted-foreground shrink-0" />
              Assessment frameworks supplied by your active Industry Pack
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 rounded-full bg-muted-foreground shrink-0" />
              Generated assessment reports and scenario exploration
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
