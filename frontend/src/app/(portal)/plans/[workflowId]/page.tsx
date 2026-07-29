'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Save,
  Play,
  Upload,
  Loader2,
  Users,
  Zap,
} from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WorkflowCanvas, NodePalette, NodeProperties, ExecutionResultsModal } from '@/components/workflow';
import { useWorkflowStore } from '@/stores/workflow-store';
import { publishWorkflow, updateWorkflow, executeWorkflow, type WorkflowExecutionResult, type WorkflowRunMode } from '@/lib/api-client';

export default function WorkflowEditorPage() {
  const params = useParams();
  const router = useRouter();
  const { currentOrganization: organization } = useAuth();
  const workflowId = params.workflowId as string;

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isTrialRunning, setIsTrialRunning] = useState(false);
  const [executionResult, setExecutionResult] = useState<WorkflowExecutionResult | null>(null);
  const [isResultsModalOpen, setIsResultsModalOpen] = useState(false);

  const {
    workflow,
    isLoading,
    isSaving,
    error,
    // connectionStatus, // TODO: Display connection indicator
    participants,
    loadWorkflow,
    clearWorkflow,
    saveState,
  } = useWorkflowStore();

  // Load workflow on mount
  useEffect(() => {
    if (organization?.id && workflowId) {
      loadWorkflow(organization.id, workflowId);
    }

    return () => {
      clearWorkflow();
    };
  }, [organization?.id, workflowId, loadWorkflow, clearWorkflow]);

  // Handle name edit
  const handleNameSubmit = async () => {
    if (!workflow || !organization?.id || !editedName.trim()) return;

    try {
      await updateWorkflow(organization.id, workflow.id, {
        name: editedName.trim(),
      });
      // Reload workflow to get updated data
      await loadWorkflow(organization.id, workflow.id);
    } catch {
      setActionError('Failed to update name');
    }
    setIsEditingName(false);
  };

  // Handle save
  const handleSave = useCallback(async () => {
    setActionError(null);
    try {
      await saveState();
    } catch {
      setActionError('Failed to save workflow');
    }
  }, [saveState]);

  // Handle publish
  const handlePublish = async () => {
    if (!workflow || !organization?.id) return;

    setIsPublishing(true);
    setActionError(null);

    try {
      const response = await publishWorkflow(organization.id, workflow.id);
      if (response.success) {
        await loadWorkflow(organization.id, workflow.id);
      } else {
        setActionError(response.error?.message || 'Failed to publish');
      }
    } catch {
      setActionError('Failed to publish workflow');
    } finally {
      setIsPublishing(false);
    }
  };

  // Handle execute (trial or live)
  const handleExecute = async (mode: WorkflowRunMode) => {
    if (!workflow || !organization?.id) return;

    const isTrial = mode === 'trial';
    if (isTrial) {
      setIsTrialRunning(true);
    } else {
      setIsExecuting(true);
    }
    setActionError(null);

    try {
      const response = await executeWorkflow(organization.id, workflow.id, { mode });
      if (response.success && response.data) {
        setExecutionResult(response.data);
        setIsResultsModalOpen(true);
      } else {
        setActionError(response.error?.message || 'Failed to execute');
      }
    } catch {
      setActionError('Failed to execute workflow');
    } finally {
      if (isTrial) {
        setIsTrialRunning(false);
      } else {
        setIsExecuting(false);
      }
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + S to save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  if (!organization) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Please select an organization</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading workflow...</p>
        </div>
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-risk-critical-text">{error || 'Workflow not found'}</p>
        <Button variant="outline" onClick={() => router.push('/plans')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Plans
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-4">
          {/* Back button */}
          <Button variant="ghost" size="sm" onClick={() => router.push('/plans')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>

          {/* Workflow name */}
          {isEditingName ? (
            <Input
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onBlur={handleNameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNameSubmit();
                if (e.key === 'Escape') setIsEditingName(false);
              }}
              className="h-8 w-64"
              autoFocus
            />
          ) : (
            <button
              className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted"
              onClick={() => {
                setEditedName(workflow.name);
                setIsEditingName(true);
              }}
            >
              <h1 className="text-lg font-semibold text-foreground">{workflow.name}</h1>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  workflow.status === 'PUBLISHED'
                    ? 'bg-risk-low text-risk-low-fg'
                    : workflow.status === 'DRAFT'
                    ? 'bg-risk-elevated text-risk-elevated-fg'
                    : 'bg-muted-foreground/20 text-muted-foreground'
                }`}
              >
                {workflow.status}
              </span>
            </button>
          )}

          {/* Version */}
          <span className="text-xs text-muted-foreground">v{workflow.version}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Collaborators */}
          {participants.length > 0 && (
            <div className="flex items-center gap-1 mr-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {participants.length} online
              </span>
            </div>
          )}

          {/* Error message */}
          {actionError && (
            <span className="text-xs text-risk-critical-text mr-2">{actionError}</span>
          )}

          {/* Save button */}
          <Button variant="outline" size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save
          </Button>

          {/* Publish button */}
          {workflow.status === 'DRAFT' && (
            <Button
              variant="outline"
              size="sm"
              onClick={handlePublish}
              disabled={isPublishing}
            >
              {isPublishing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Publish
            </Button>
          )}

          {/* Trial Run button */}
          {workflow.status === 'PUBLISHED' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExecute('trial')}
              disabled={isTrialRunning || isExecuting}
            >
              {isTrialRunning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="mr-2 h-4 w-4" />
              )}
              Trial Run
            </Button>
          )}

          {/* Run button */}
          {workflow.status === 'PUBLISHED' && (
            <Button
              size="sm"
              onClick={() => handleExecute('run')}
              disabled={isExecuting || isTrialRunning}
            >
              {isExecuting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Run
            </Button>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - Node palette */}
        <div className="w-64 flex-shrink-0 border-r border-border bg-card p-4 overflow-y-auto">
          <NodePalette />
        </div>

        {/* Canvas */}
        <div className="flex-1 relative">
          <WorkflowCanvas onNodeSelect={setSelectedNodeId} />
        </div>

        {/* Right sidebar - Properties */}
        <div className="w-72 flex-shrink-0 border-l border-border bg-card overflow-hidden">
          <NodeProperties selectedNodeId={selectedNodeId} />
        </div>
      </div>

      {/* Execution Results Modal */}
      <ExecutionResultsModal
        isOpen={isResultsModalOpen}
        onClose={() => setIsResultsModalOpen(false)}
        result={executionResult}
      />
    </div>
  );
}
