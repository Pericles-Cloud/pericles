/**
 * WebSocket server for workflow real-time collaboration
 *
 * Handles real-time updates for the workflow builder including:
 * - Node additions, updates, and deletions
 * - Edge connections and deletions
 * - Viewport synchronization
 * - Collaboration presence
 */

import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { PrismaClient, type Prisma } from '@prisma/client';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

// JWT secret must match auth/jwt.ts
function getJWTSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return secret;
}

// JWT payload structure (matches auth/jwt.ts AccessTokenPayload)
interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  organizationId: string;
  type: 'access';
}

// Socket user data (without JWT-specific fields)
interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  organizationId: string;
}

// Socket with authenticated user data
interface AuthenticatedSocket extends Socket {
  user?: TokenPayload;
  workflowId?: string;
  orgId?: string;
}

// Room participants tracking
const roomParticipants = new Map<string, Map<string, { socketId: string; user: TokenPayload; joinedAt: Date }>>();

// Event types
interface NodeData {
  clientId: string;
  type: 'TRIGGER' | 'ACTION' | 'CONDITION' | 'NOTIFICATION' | 'END';
  label?: string;
  positionX: number;
  positionY: number;
  data?: Record<string, unknown>;
}

interface EdgeData {
  clientId: string;
  sourceNodeClientId: string;
  targetNodeClientId: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  data?: Record<string, unknown>;
}

interface ViewportData {
  x: number;
  y: number;
  zoom: number;
}

export function initializeWorkflowSocket(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: ['http://localhost:3000', 'http://localhost:4111'],
      credentials: true,
    },
    path: '/ws/workflow',
  });

  // Authentication middleware
  io.use((socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;

      if (!token || typeof token !== 'string') {
        next(new Error('Authentication required')); return;
      }

      const payload = jwt.verify(token, getJWTSecret()) as unknown as JWTPayload;

      // Verify this is an access token
      if (payload.type !== 'access') {
        next(new Error('Invalid token type')); return;
      }

      socket.user = {
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
        organizationId: payload.organizationId,
      };

      next();
    } catch (_error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`[WS] User connected: ${socket.user?.email} (${socket.id})`);

    // Join workflow room
    socket.on('join_workflow', async (data: { workflowId: string; orgId: string }) => {
      try {
        const { workflowId, orgId } = data;

        // Verify user has access to the organization
        if (!socket.user) {
          socket.emit('error', { message: 'Not authenticated' });
          return;
        }

        const membership = await prisma.userOrganization.findUnique({
          where: {
            user_id_organization_id: {
              user_id: socket.user.userId,
              organization_id: orgId,
            },
          },
        });

        if (membership?.status !== 'active') {
          socket.emit('error', { message: 'Access denied to organization' });
          return;
        }

        // Verify workflow exists and belongs to org
        const workflow = await prisma.workflow.findFirst({
          where: { id: workflowId, organization_id: orgId },
        });

        if (!workflow) {
          socket.emit('error', { message: 'Workflow not found' });
          return;
        }

        // Leave previous room if any
        if (socket.workflowId) {
          const prevRoom = `workflow:${socket.workflowId}`;
          void socket.leave(prevRoom);
          removeParticipant(prevRoom, socket.id);
          io.to(prevRoom).emit('user:left', {
            userId: socket.user.userId,
            email: socket.user.email,
          });
        }

        // Join new room
        const room = `workflow:${workflowId}`;
        void socket.join(room);
        socket.workflowId = workflowId;
        socket.orgId = orgId;

        // Track participant
        addParticipant(room, socket.id, socket.user);

        // Notify others
        socket.to(room).emit('user:joined', {
          userId: socket.user.userId,
          email: socket.user.email,
          name: socket.user.email.split('@')[0],
        });

        // Send current participants to the joining user
        const participants = getParticipants(room);
        socket.emit('room:joined', {
          workflowId,
          participants: participants.map((p) => ({
            userId: p.user.userId,
            email: p.user.email,
            name: p.user.email.split('@')[0],
          })),
        });

        console.log(`[WS] ${socket.user.email} joined workflow ${workflowId}`);
      } catch (error) {
        console.error('[WS] Error joining workflow:', error);
        socket.emit('error', { message: 'Failed to join workflow' });
      }
    });

    // Add node
    socket.on('add_node', async (node: NodeData) => {
      if (!socket.workflowId || !socket.orgId || !socket.user) return;

      try {
        const room = `workflow:${socket.workflowId}`;

        // Check write permissions
        const membership = await prisma.userOrganization.findUnique({
          where: {
            user_id_organization_id: {
              user_id: socket.user.userId,
              organization_id: socket.orgId,
            },
          },
        });

        if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
          socket.emit('error', { message: 'Insufficient permissions' });
          return;
        }

        // Create node in database
        const createdNode = await prisma.workflowNode.create({
          data: {
            workflow_id: socket.workflowId,
            client_id: node.clientId,
            type: node.type,
            label: node.label || null,
            position_x: node.positionX,
            position_y: node.positionY,
            data: (node.data || {}) as Prisma.InputJsonValue,
          },
        });

        // Broadcast to all in room (including sender for consistency)
        io.to(room).emit('state:node_added', {
          id: createdNode.id,
          clientId: createdNode.client_id,
          type: createdNode.type,
          label: createdNode.label,
          position: { x: createdNode.position_x, y: createdNode.position_y },
          data: createdNode.data,
          addedBy: socket.user.email,
        });
      } catch (error) {
        console.error('[WS] Error adding node:', error);
        socket.emit('error', { message: 'Failed to add node' });
      }
    });

    // Update node
    socket.on('update_node', async (data: { clientId: string; updates: Partial<NodeData> }) => {
      if (!socket.workflowId || !socket.orgId || !socket.user) return;

      try {
        const room = `workflow:${socket.workflowId}`;

        // Check write permissions
        const membership = await prisma.userOrganization.findUnique({
          where: {
            user_id_organization_id: {
              user_id: socket.user.userId,
              organization_id: socket.orgId,
            },
          },
        });

        if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
          socket.emit('error', { message: 'Insufficient permissions' });
          return;
        }

        const { clientId, updates } = data;

        // Update node in database
        const updatedNode = await prisma.workflowNode.update({
          where: {
            workflow_id_client_id: {
              workflow_id: socket.workflowId,
              client_id: clientId,
            },
          },
          data: {
            ...(updates.label !== undefined && { label: updates.label }),
            ...(updates.positionX !== undefined && { position_x: updates.positionX }),
            ...(updates.positionY !== undefined && { position_y: updates.positionY }),
            ...(updates.data !== undefined && { data: updates.data as Prisma.InputJsonValue }),
          },
        });

        // Broadcast to all in room
        io.to(room).emit('state:node_updated', {
          clientId: updatedNode.client_id,
          label: updatedNode.label,
          position: { x: updatedNode.position_x, y: updatedNode.position_y },
          data: updatedNode.data,
          updatedBy: socket.user.email,
        });
      } catch (error) {
        console.error('[WS] Error updating node:', error);
        socket.emit('error', { message: 'Failed to update node' });
      }
    });

    // Delete nodes
    socket.on('delete_nodes', async (clientIds: string[]) => {
      if (!socket.workflowId || !socket.orgId || !socket.user) return;

      try {
        const room = `workflow:${socket.workflowId}`;

        // Check write permissions
        const membership = await prisma.userOrganization.findUnique({
          where: {
            user_id_organization_id: {
              user_id: socket.user.userId,
              organization_id: socket.orgId,
            },
          },
        });

        if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
          socket.emit('error', { message: 'Insufficient permissions' });
          return;
        }

        // Delete nodes (edges cascade automatically)
        await prisma.workflowNode.deleteMany({
          where: {
            workflow_id: socket.workflowId,
            client_id: { in: clientIds },
          },
        });

        // Broadcast to all in room
        io.to(room).emit('state:nodes_deleted', {
          clientIds,
          deletedBy: socket.user.email,
        });
      } catch (error) {
        console.error('[WS] Error deleting nodes:', error);
        socket.emit('error', { message: 'Failed to delete nodes' });
      }
    });

    // Connect nodes (create edge)
    socket.on('connect_nodes', async (edge: EdgeData) => {
      if (!socket.workflowId || !socket.orgId || !socket.user) return;

      try {
        const room = `workflow:${socket.workflowId}`;

        // Check write permissions
        const membership = await prisma.userOrganization.findUnique({
          where: {
            user_id_organization_id: {
              user_id: socket.user.userId,
              organization_id: socket.orgId,
            },
          },
        });

        if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
          socket.emit('error', { message: 'Insufficient permissions' });
          return;
        }

        // Get source and target node IDs
        const sourceNode = await prisma.workflowNode.findUnique({
          where: {
            workflow_id_client_id: {
              workflow_id: socket.workflowId,
              client_id: edge.sourceNodeClientId,
            },
          },
        });

        const targetNode = await prisma.workflowNode.findUnique({
          where: {
            workflow_id_client_id: {
              workflow_id: socket.workflowId,
              client_id: edge.targetNodeClientId,
            },
          },
        });

        if (!sourceNode || !targetNode) {
          socket.emit('error', { message: 'Source or target node not found' });
          return;
        }

        // Create edge
        const createdEdge = await prisma.workflowEdge.create({
          data: {
            workflow_id: socket.workflowId,
            client_id: edge.clientId,
            source_node_id: sourceNode.id,
            target_node_id: targetNode.id,
            source_handle: edge.sourceHandle || null,
            target_handle: edge.targetHandle || null,
            label: edge.label || null,
            data: (edge.data || {}) as Prisma.InputJsonValue,
          },
        });

        // Broadcast to all in room
        io.to(room).emit('state:edge_added', {
          id: createdEdge.id,
          clientId: createdEdge.client_id,
          source: edge.sourceNodeClientId,
          target: edge.targetNodeClientId,
          sourceHandle: createdEdge.source_handle,
          targetHandle: createdEdge.target_handle,
          label: createdEdge.label,
          data: createdEdge.data,
          addedBy: socket.user.email,
        });
      } catch (error) {
        console.error('[WS] Error connecting nodes:', error);
        socket.emit('error', { message: 'Failed to create connection' });
      }
    });

    // Delete edge
    socket.on('delete_edge', async (clientId: string) => {
      if (!socket.workflowId || !socket.orgId || !socket.user) return;

      try {
        const room = `workflow:${socket.workflowId}`;

        // Check write permissions
        const membership = await prisma.userOrganization.findUnique({
          where: {
            user_id_organization_id: {
              user_id: socket.user.userId,
              organization_id: socket.orgId,
            },
          },
        });

        if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
          socket.emit('error', { message: 'Insufficient permissions' });
          return;
        }

        // Delete edge
        await prisma.workflowEdge.delete({
          where: {
            workflow_id_client_id: {
              workflow_id: socket.workflowId,
              client_id: clientId,
            },
          },
        });

        // Broadcast to all in room
        io.to(room).emit('state:edge_deleted', {
          clientId,
          deletedBy: socket.user.email,
        });
      } catch (error) {
        console.error('[WS] Error deleting edge:', error);
        socket.emit('error', { message: 'Failed to delete edge' });
      }
    });

    // Update viewport (for collaboration awareness)
    socket.on('update_viewport', (viewport: ViewportData) => {
      if (!socket.workflowId || !socket.user) return;

      const room = `workflow:${socket.workflowId}`;

      // Broadcast viewport to others (not to sender)
      socket.to(room).emit('state:viewport_updated', {
        userId: socket.user.userId,
        viewport,
      });
    });

    // Cursor position for collaboration awareness
    socket.on('cursor_move', (position: { x: number; y: number }) => {
      if (!socket.workflowId || !socket.user) return;

      const room = `workflow:${socket.workflowId}`;

      // Broadcast cursor to others (not to sender)
      socket.to(room).emit('cursor:move', {
        userId: socket.user.userId,
        email: socket.user.email,
        position,
      });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`[WS] User disconnected: ${socket.user?.email} (${socket.id})`);

      if (socket.workflowId && socket.user) {
        const room = `workflow:${socket.workflowId}`;
        removeParticipant(room, socket.id);

        io.to(room).emit('user:left', {
          userId: socket.user.userId,
          email: socket.user.email,
        });
      }
    });
  });

  return io;
}

// Helper functions for participant tracking
function addParticipant(room: string, socketId: string, user: TokenPayload): void {
  let participants = roomParticipants.get(room);
  if (!participants) {
    participants = new Map();
    roomParticipants.set(room, participants);
  }
  participants.set(socketId, { socketId, user, joinedAt: new Date() });
}

function removeParticipant(room: string, socketId: string): void {
  const participants = roomParticipants.get(room);
  if (participants) {
    participants.delete(socketId);
    if (participants.size === 0) {
      roomParticipants.delete(room);
    }
  }
}

function getParticipants(room: string): Array<{ socketId: string; user: TokenPayload; joinedAt: Date }> {
  const participants = roomParticipants.get(room);
  return participants ? Array.from(participants.values()) : [];
}
