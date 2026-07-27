'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, FileText, Play, Archive, Trash2, MoreVertical } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Workflow,
  WorkflowStatus,
  getWorkflows,
  createWorkflow,
  deleteWorkflow,
  archiveWorkflow,
  executeWorkflow,
} from '@/lib/api-client';

type StatusFilter = 'all' | WorkflowStatus;

export default function PlansPage() {
  const router = useRouter();
  const { currentOrganization: organization } = useAuth();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Create dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newWorkflowName, setNewWorkflowName] = useState('');
  const [newWorkflowDescription, setNewWorkflowDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Load workflows
  useEffect(() => {
    const orgId = organization?.id;
    if (!orgId) return;

    async function loadWorkflows(organizationId: string) {
      setIsLoading(true);
      setError(null);

      try {
        const response = await getWorkflows(
          organizationId,
          statusFilter === 'all' ? undefined : statusFilter
        );

        if (response.success && response.data) {
          setWorkflows(response.data);
        } else {
          setError(response.error?.message || 'Failed to load workflows');
        }
      } catch {
        setError('Failed to load workflows');
      } finally {
        setIsLoading(false);
      }
    }

    loadWorkflows(orgId);
  }, [organization?.id, statusFilter]);

  // Handle create workflow
  const handleCreate = async () => {
    if (!organization?.id || !newWorkflowName.trim()) return;

    setIsCreating(true);
    try {
      const response = await createWorkflow(organization.id, {
        name: newWorkflowName.trim(),
        description: newWorkflowDescription.trim() || undefined,
      });

      if (response.success && response.data) {
        // Navigate to editor
        router.push(`/plans/${response.data.id}`);
      } else {
        setError(response.error?.message || 'Failed to create workflow');
      }
    } catch {
      setError('Failed to create workflow');
    } finally {
      setIsCreating(false);
    }
  };

  // Handle delete workflow
  const handleDelete = async (workflowId: string) => {
    if (!organization?.id) return;

    try {
      const response = await deleteWorkflow(organization.id, workflowId);
      if (response.success) {
        setWorkflows((prev) => prev.filter((w) => w.id !== workflowId));
      } else {
        setError(response.error?.message || 'Failed to delete workflow');
      }
    } catch {
      setError('Failed to delete workflow');
    }
  };

  // Handle archive workflow
  const handleArchive = async (workflowId: string) => {
    if (!organization?.id) return;

    try {
      const response = await archiveWorkflow(organization.id, workflowId);
      if (response.success && response.data) {
        setWorkflows((prev) =>
          prev.map((w) => (w.id === workflowId ? response.data! : w))
        );
      } else {
        setError(response.error?.message || 'Failed to archive workflow');
      }
    } catch {
      setError('Failed to archive workflow');
    }
  };

  // Handle execute workflow
  const handleExecute = async (workflowId: string, name: string) => {
    if (!organization?.id) return;

    // A run (as opposed to a trial) commits for real: notification nodes send
    // actual email/SMS/Slack rather than simulating. This is one click deep in
    // a ⋮ menu, so confirm before anything leaves the building. The detail page
    // has separate Trial and Run buttons and does not need this.
    const confirmed = window.confirm(
      `Run "${name}" for real?\n\n` +
        'This executes the plan in run mode — notification steps will send actual ' +
        'emails, SMS, and Slack messages to their configured recipients.\n\n' +
        'To rehearse without sending anything, open the plan and use Trial instead.'
    );
    if (!confirmed) return;

    try {
      const response = await executeWorkflow(organization.id, workflowId, { mode: 'run' });
      if (response.success) {
        // Could show a toast or update UI to show execution started
        alert('Workflow execution started!');
      } else {
        setError(response.error?.message || 'Failed to execute workflow');
      }
    } catch {
      setError('Failed to execute workflow');
    }
  };

  // Status badge colors
  const getStatusColor = (status: WorkflowStatus) => {
    switch (status) {
      case 'PUBLISHED':
        return 'bg-green-100 text-green-700';
      case 'DRAFT':
        return 'bg-yellow-100 text-yellow-700';
      case 'ARCHIVED':
        return 'bg-gray-100 text-gray-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  if (!organization) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-gray-500">Please select an organization</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Plans</h1>
          <p className="text-sm text-gray-500">
            Create and manage supply chain contingency workflows
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Workflow
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 border-b border-gray-200 px-6 py-3">
        <span className="text-sm font-medium text-gray-700">Status:</span>
        <div className="flex gap-2">
          {(['all', 'DRAFT', 'PUBLISHED', 'ARCHIVED'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === status
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {status === 'all' ? 'All' : status.charAt(0) + status.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="mx-6 mt-4 rounded-md bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          </div>
        ) : workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-12 w-12 text-gray-300" />
            <h3 className="mt-4 text-lg font-medium text-gray-900">No workflows yet</h3>
            <p className="mt-1 text-sm text-gray-500">
              Create your first workflow to start building contingency plans
            </p>
            <Button className="mt-4" onClick={() => setShowCreateDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Workflow
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {workflows.map((workflow) => (
              <Card
                key={workflow.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => router.push(`/plans/${workflow.id}`)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">
                        {workflow.name}
                      </CardTitle>
                      <CardDescription className="line-clamp-2 text-xs mt-1">
                        {workflow.description || 'No description'}
                      </CardDescription>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="rounded-md p-1 hover:bg-gray-100"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="h-4 w-4 text-gray-500" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {workflow.status === 'PUBLISHED' && (
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleExecute(workflow.id, workflow.name);
                            }}
                          >
                            <Play className="mr-2 h-4 w-4" />
                            Run…
                          </DropdownMenuItem>
                        )}
                        {workflow.status !== 'ARCHIVED' && (
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleArchive(workflow.id);
                            }}
                          >
                            <Archive className="mr-2 h-4 w-4" />
                            Archive
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="text-red-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm('Are you sure you want to delete this workflow?')) {
                              handleDelete(workflow.id);
                            }
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-xs">
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${getStatusColor(
                        workflow.status
                      )}`}
                    >
                      {workflow.status}
                    </span>
                    <span className="text-gray-500">
                      v{workflow.version} - {workflow.counts?.nodes || 0} nodes
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-gray-400">
                    Updated {new Date(workflow.updatedAt).toLocaleDateString()}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Create New Workflow</h2>
            <p className="mt-1 text-sm text-gray-500">
              Give your workflow a name and optional description
            </p>

            <div className="mt-4 space-y-4">
              <div>
                <Label htmlFor="workflow-name">Name</Label>
                <Input
                  id="workflow-name"
                  value={newWorkflowName}
                  onChange={(e) => setNewWorkflowName(e.target.value)}
                  placeholder="e.g., Hurricane Response Plan"
                  className="mt-1"
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="workflow-description">Description (optional)</Label>
                <textarea
                  id="workflow-description"
                  value={newWorkflowDescription}
                  onChange={(e) => setNewWorkflowDescription(e.target.value)}
                  placeholder="Describe the purpose of this workflow..."
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  rows={3}
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateDialog(false);
                  setNewWorkflowName('');
                  setNewWorkflowDescription('');
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!newWorkflowName.trim() || isCreating}
              >
                {isCreating ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
