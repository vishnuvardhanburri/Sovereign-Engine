// @ts-nocheck
/**
 * Role Management System
 * User permissions, access control, and multi-user support
 * Manages roles, permissions, and resource access across the platform
 */

import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'
import crypto from 'crypto'

export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: UserRole
  status: 'active' | 'inactive' | 'suspended'
  permissions: Permission[]
  lastLogin?: Date
  createdAt: Date
  updatedAt: Date
  createdBy: string
}

export interface UserRole {
  id: string
  name: string
  description: string
  permissions: Permission[]
  isSystemRole: boolean
  createdAt: Date
  updatedAt: Date
}

export interface Permission {
  id: string
  resource: string
  action: string
  scope: 'global' | 'organization' | 'team' | 'personal'
  conditions?: Record<string, any>
}

export interface Organization {
  id: string
  name: string
  domain?: string
  settings: {
    maxUsers: number
    maxCampaigns: number
    maxContacts: number
    features: string[]
  }
  subscription: {
    plan: 'free' | 'starter' | 'professional' | 'enterprise'
    status: 'active' | 'past_due' | 'cancelled'
    expiresAt?: Date
  }
  createdAt: Date
  updatedAt: Date
  ownerId: string
}

export interface Team {
  id: string
  name: string
  description?: string
  organizationId: string
  members: TeamMember[]
  permissions: Permission[]
  createdAt: Date
  updatedAt: Date
  createdBy: string
}

export interface TeamMember {
  userId: string
  role: 'member' | 'admin'
  joinedAt: Date
  addedBy: string
}

export interface AccessControl {
  userId: string
  resourceType: 'campaign' | 'sequence' | 'contact_list' | 'domain' | 'identity'
  resourceId: string
  permissions: string[] // ['read', 'write', 'delete', 'execute']
  grantedBy: string
  grantedAt: Date
  expiresAt?: Date
}

export interface AuditLog {
  id: string
  userId: string
  action: string
  resourceType: string
  resourceId: string
  details: Record<string, any>
  ipAddress: string
  userAgent: string
  timestamp: Date
}

// Predefined permissions
export const PERMISSIONS = {
  // Campaign permissions
  CAMPAIGN_READ: { resource: 'campaign', action: 'read', scope: 'organization' },
  CAMPAIGN_WRITE: { resource: 'campaign', action: 'write', scope: 'organization' },
  CAMPAIGN_DELETE: { resource: 'campaign', action: 'delete', scope: 'organization' },
  CAMPAIGN_EXECUTE: { resource: 'campaign', action: 'execute', scope: 'organization' },

  // Sequence permissions
  SEQUENCE_READ: { resource: 'sequence', action: 'read', scope: 'organization' },
  SEQUENCE_WRITE: { resource: 'sequence', action: 'write', scope: 'organization' },
  SEQUENCE_DELETE: { resource: 'sequence', action: 'delete', scope: 'organization' },
  SEQUENCE_EXECUTE: { resource: 'sequence', action: 'execute', scope: 'organization' },

  // Contact permissions
  CONTACT_READ: { resource: 'contact', action: 'read', scope: 'organization' },
  CONTACT_WRITE: { resource: 'contact', action: 'write', scope: 'organization' },
  CONTACT_DELETE: { resource: 'contact', action: 'delete', scope: 'organization' },
  CONTACT_IMPORT: { resource: 'contact', action: 'import', scope: 'organization' },

  // Domain permissions
  DOMAIN_READ: { resource: 'domain', action: 'read', scope: 'organization' },
  DOMAIN_WRITE: { resource: 'domain', action: 'write', scope: 'organization' },
  DOMAIN_DELETE: { resource: 'domain', action: 'delete', scope: 'organization' },

  // Identity permissions
  IDENTITY_READ: { resource: 'identity', action: 'read', scope: 'organization' },
  IDENTITY_WRITE: { resource: 'identity', action: 'write', scope: 'organization' },
  IDENTITY_DELETE: { resource: 'identity', action: 'delete', scope: 'organization' },

  // Analytics permissions
  ANALYTICS_READ: { resource: 'analytics', action: 'read', scope: 'organization' },
  ANALYTICS_EXPORT: { resource: 'analytics', action: 'export', scope: 'organization' },

  // User management permissions
  USER_READ: { resource: 'user', action: 'read', scope: 'organization' },
  USER_WRITE: { resource: 'user', action: 'write', scope: 'organization' },
  USER_DELETE: { resource: 'user', action: 'delete', scope: 'organization' },

  // Organization permissions
  ORGANIZATION_READ: { resource: 'organization', action: 'read', scope: 'organization' },
  ORGANIZATION_WRITE: { resource: 'organization', action: 'write', scope: 'organization' },

  // System permissions (admin only)
  SYSTEM_CONFIG: { resource: 'system', action: 'config', scope: 'global' },
  AUDIT_READ: { resource: 'audit', action: 'read', scope: 'global' }
} as const

// Predefined roles
export const ROLES = {
  SUPER_ADMIN: {
    name: 'Super Admin',
    description: 'Full system access',
    permissions: Object.values(PERMISSIONS),
    isSystemRole: true
  },
  ORGANIZATION_OWNER: {
    name: 'Organization Owner',
    description: 'Full organization access',
    permissions: [
      PERMISSIONS.CAMPAIGN_READ, PERMISSIONS.CAMPAIGN_WRITE, PERMISSIONS.CAMPAIGN_DELETE, PERMISSIONS.CAMPAIGN_EXECUTE,
      PERMISSIONS.SEQUENCE_READ, PERMISSIONS.SEQUENCE_WRITE, PERMISSIONS.SEQUENCE_DELETE, PERMISSIONS.SEQUENCE_EXECUTE,
      PERMISSIONS.CONTACT_READ, PERMISSIONS.CONTACT_WRITE, PERMISSIONS.CONTACT_DELETE, PERMISSIONS.CONTACT_IMPORT,
      PERMISSIONS.DOMAIN_READ, PERMISSIONS.DOMAIN_WRITE, PERMISSIONS.DOMAIN_DELETE,
      PERMISSIONS.IDENTITY_READ, PERMISSIONS.IDENTITY_WRITE, PERMISSIONS.IDENTITY_DELETE,
      PERMISSIONS.ANALYTICS_READ, PERMISSIONS.ANALYTICS_EXPORT,
      PERMISSIONS.USER_READ, PERMISSIONS.USER_WRITE, PERMISSIONS.USER_DELETE,
      PERMISSIONS.ORGANIZATION_READ, PERMISSIONS.ORGANIZATION_WRITE
    ],
    isSystemRole: true
  },
  CAMPAIGN_MANAGER: {
    name: 'Campaign Manager',
    description: 'Manage campaigns and sequences',
    permissions: [
      PERMISSIONS.CAMPAIGN_READ, PERMISSIONS.CAMPAIGN_WRITE, PERMISSIONS.CAMPAIGN_EXECUTE,
      PERMISSIONS.SEQUENCE_READ, PERMISSIONS.SEQUENCE_WRITE, PERMISSIONS.SEQUENCE_EXECUTE,
      PERMISSIONS.CONTACT_READ, PERMISSIONS.CONTACT_IMPORT,
      PERMISSIONS.ANALYTICS_READ
    ],
    isSystemRole: false
  },
  SALES_REP: {
    name: 'Sales Representative',
    description: 'Execute campaigns and view results',
    permissions: [
      PERMISSIONS.CAMPAIGN_READ, PERMISSIONS.CAMPAIGN_EXECUTE,
      PERMISSIONS.SEQUENCE_READ, PERMISSIONS.SEQUENCE_EXECUTE,
      PERMISSIONS.CONTACT_READ,
      PERMISSIONS.ANALYTICS_READ
    ],
    isSystemRole: false
  },
  ANALYST: {
    name: 'Analyst',
    description: 'View analytics and reports',
    permissions: [
      PERMISSIONS.ANALYTICS_READ, PERMISSIONS.ANALYTICS_EXPORT,
      PERMISSIONS.CAMPAIGN_READ, PERMISSIONS.SEQUENCE_READ, PERMISSIONS.CONTACT_READ
    ],
    isSystemRole: false
  },
  VIEWER: {
    name: 'Viewer',
    description: 'Read-only access',
    permissions: [
      PERMISSIONS.CAMPAIGN_READ, PERMISSIONS.SEQUENCE_READ, PERMISSIONS.CONTACT_READ, PERMISSIONS.ANALYTICS_READ
    ],
    isSystemRole: false
  }
} as const

class RoleManagementEngine {
  /**
   * Create organization
   */
  async createOrganization(
    name: string,
    ownerId: string,
    settings?: Partial<Organization['settings']>
  ): Promise<Organization> {
    const orgId = this.generateId('org')

    const defaultSettings = {
      maxUsers: 5,
      maxCampaigns: 10,
      maxContacts: 1000,
      features: ['basic_campaigns', 'basic_analytics']
    }

    await query(`
      INSERT INTO organizations (
        id, name, settings, subscription, created_at, updated_at, owner_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      orgId,
      name,
      JSON.stringify({ ...defaultSettings, ...settings }),
      JSON.stringify({
        plan: 'free',
        status: 'active'
      }),
      new Date(),
      new Date(),
      ownerId
    ])

    return await this.getOrganization(orgId)
  }

  /**
   * Create user
   */
  async createUser(
    email: string,
    firstName: string,
    lastName: string,
    organizationId: string,
    roleId: string,
    createdBy: string
  ): Promise<User> {
    const userId = this.generateId('user')

    // Get role permissions
    const role = await this.getRole(roleId)
    if (!role) throw new Error('Role not found')

    await query(`
      INSERT INTO users (
        id, email, first_name, last_name, organization_id, role_id,
        status, permissions, created_at, updated_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      userId,
      email,
      firstName,
      lastName,
      organizationId,
      roleId,
      'active',
      JSON.stringify(role.permissions),
      new Date(),
      new Date(),
      createdBy
    ])

    return await this.getUser(userId)
  }

  /**
   * Create role
   */
  async createRole(
    name: string,
    description: string,
    permissions: Permission[],
    organizationId?: string,
    createdBy: string
  ): Promise<UserRole> {
    const roleId = this.generateId('role')

    await query(`
      INSERT INTO roles (
        id, name, description, permissions, organization_id,
        is_system_role, created_at, updated_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      roleId,
      name,
      description,
      JSON.stringify(permissions),
      organizationId || null,
      false,
      new Date(),
      new Date(),
      createdBy
    ])

    return await this.getRole(roleId)
  }

  /**
   * Check permission
   */
  async checkPermission(
    userId: string,
    resource: string,
    action: string,
    resourceId?: string
  ): Promise<boolean> {
    const user = await this.getUser(userId)
    if (!user || user.status !== 'active') return false

    // Check direct permissions
    const hasDirectPermission = user.permissions.some(p =>
      p.resource === resource && p.action === action
    )

    if (hasDirectPermission) return true

    // Check team permissions
    const teamPermissions = await this.getUserTeamPermissions(userId)
    const hasTeamPermission = teamPermissions.some(p =>
      p.resource === resource && p.action === action
    )

    if (hasTeamPermission) return true

    // Check resource-specific access control
    if (resourceId) {
      const accessControl = await this.getAccessControl(userId, resource, resourceId)
      if (accessControl && accessControl.permissions.includes(action)) {
        return true
      }
    }

    return false
  }

  /**
   * Grant resource access
   */
  async grantAccess(
    userId: string,
    resourceType: AccessControl['resourceType'],
    resourceId: string,
    permissions: string[],
    grantedBy: string,
    expiresAt?: Date
  ): Promise<void> {
    await query(`
      INSERT INTO access_control (
        user_id, resource_type, resource_id, permissions, granted_by, granted_at, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, resource_type, resource_id) DO UPDATE SET
        permissions = EXCLUDED.permissions,
        granted_by = EXCLUDED.granted_by,
        granted_at = EXCLUDED.granted_at,
        expires_at = EXCLUDED.expires_at
    `, [
      userId,
      resourceType,
      resourceId,
      JSON.stringify(permissions),
      grantedBy,
      new Date(),
      expiresAt || null
    ])

    // Audit log
    await this.auditLog(userId, 'grant_access', resourceType, resourceId, {
      permissions,
      grantedBy,
      expiresAt
    })
  }

  /**
   * Create team
   */
  async createTeam(
    name: string,
    description: string,
    organizationId: string,
    createdBy: string
  ): Promise<Team> {
    const teamId = this.generateId('team')

    await query(`
      INSERT INTO teams (
        id, name, description, organization_id, created_at, updated_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      teamId,
      name,
      description || null,
      organizationId,
      new Date(),
      new Date(),
      createdBy
    ])

    return await this.getTeam(teamId)
  }

  /**
   * Add user to team
   */
  async addUserToTeam(
    userId: string,
    teamId: string,
    role: TeamMember['role'],
    addedBy: string
  ): Promise<void> {
    await query(`
      INSERT INTO team_members (team_id, user_id, role, joined_at, added_by)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (team_id, user_id) DO UPDATE SET
        role = EXCLUDED.role,
        joined_at = EXCLUDED.joined_at,
        added_by = EXCLUDED.added_by
    `, [teamId, userId, role, new Date(), addedBy])

    // Audit log
    await this.auditLog(addedBy, 'add_team_member', 'team', teamId, {
      userId,
      role
    })
  }

  /**
   * Update user role
   */
  async updateUserRole(userId: string, roleId: string, updatedBy: string): Promise<void> {
    const role = await this.getRole(roleId)
    if (!role) throw new Error('Role not found')

    await query(`
      UPDATE users
      SET role_id = $1, permissions = $2, updated_at = NOW()
      WHERE id = $3
    `, [roleId, JSON.stringify(role.permissions), userId])

    // Audit log
    await this.auditLog(updatedBy, 'update_user_role', 'user', userId, {
      newRoleId: roleId,
      newPermissions: role.permissions
    })
  }

  /**
   * Get organization users
   */
  async getOrganizationUsers(organizationId: string): Promise<User[]> {
    const result = await query(`
      SELECT u.*, r.name as role_name, r.description as role_description
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.organization_id = $1 AND u.status = 'active'
      ORDER BY u.created_at DESC
    `, [organizationId])

    return result.rows.map(row => ({
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      role: {
        id: row.role_id,
        name: row.role_name,
        description: row.role_description,
        permissions: JSON.parse(row.permissions || '[]'),
        isSystemRole: row.is_system_role || false,
        createdAt: row.role_created_at,
        updatedAt: row.role_updated_at
      },
      status: row.status,
      permissions: JSON.parse(row.permissions || '[]'),
      lastLogin: row.last_login,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by
    }))
  }

  /**
   * Get audit logs
   */
  async getAuditLogs(
    organizationId: string,
    filters?: {
      userId?: string
      action?: string
      resourceType?: string
      startDate?: Date
      endDate?: Date
    },
    limit: number = 100,
    offset: number = 0
  ): Promise<AuditLog[]> {
    let whereClause = 'u.organization_id = $1'
    const params: any[] = [organizationId]
    let paramIndex = 2

    if (filters?.userId) {
      whereClause += ` AND a.user_id = $${paramIndex}`
      params.push(filters.userId)
      paramIndex++
    }

    if (filters?.action) {
      whereClause += ` AND a.action = $${paramIndex}`
      params.push(filters.action)
      paramIndex++
    }

    if (filters?.resourceType) {
      whereClause += ` AND a.resource_type = $${paramIndex}`
      params.push(filters.resourceType)
      paramIndex++
    }

    if (filters?.startDate) {
      whereClause += ` AND a.timestamp >= $${paramIndex}`
      params.push(filters.startDate)
      paramIndex++
    }

    if (filters?.endDate) {
      whereClause += ` AND a.timestamp <= $${paramIndex}`
      params.push(filters.endDate)
      paramIndex++
    }

    params.push(limit, offset)

    const result = await query(`
      SELECT a.*, u.email as user_email
      FROM audit_logs a
      JOIN users u ON a.user_id = u.id
      WHERE ${whereClause}
      ORDER BY a.timestamp DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, params)

    return result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      details: JSON.parse(row.details || '{}'),
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      timestamp: row.timestamp
    }))
  }

  /**
   * Suspend user
   */
  async suspendUser(userId: string, reason: string, suspendedBy: string): Promise<void> {
    await query(`
      UPDATE users
      SET status = 'suspended', suspended_reason = $1, suspended_at = NOW(), suspended_by = $2
      WHERE id = $3
    `, [reason, suspendedBy, userId])

    // Audit log
    await this.auditLog(suspendedBy, 'suspend_user', 'user', userId, { reason })
  }

  /**
   * Reactivate user
   */
  async reactivateUser(userId: string, reactivatedBy: string): Promise<void> {
    await query(`
      UPDATE users
      SET status = 'active', suspended_reason = NULL, suspended_at = NULL, suspended_by = NULL
      WHERE id = $3
    `, [reactivatedBy, userId])

    // Audit log
    await this.auditLog(reactivatedBy, 'reactivate_user', 'user', userId, {})
  }

  // Private helper methods

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  }

  private async getOrganization(orgId: string): Promise<Organization> {
    const result = await query('SELECT * FROM organizations WHERE id = $1', [orgId])
    if (result.rows.length === 0) throw new Error('Organization not found')

    const row = result.rows[0]
    return {
      id: row.id,
      name: row.name,
      domain: row.domain,
      settings: JSON.parse(row.settings || '{}'),
      subscription: JSON.parse(row.subscription || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ownerId: row.owner_id
    }
  }

  private async getUser(userId: string): Promise<User | null> {
    const result = await query(`
      SELECT u.*, r.name as role_name, r.description as role_description,
             r.permissions as role_permissions, r.is_system_role
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = $1
    `, [userId])

    if (result.rows.length === 0) return null

    const row = result.rows[0]
    return {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      role: {
        id: row.role_id,
        name: row.role_name,
        description: row.role_description,
        permissions: JSON.parse(row.role_permissions || '[]'),
        isSystemRole: row.is_system_role || false,
        createdAt: row.role_created_at,
        updatedAt: row.role_updated_at
      },
      status: row.status,
      permissions: JSON.parse(row.permissions || '[]'),
      lastLogin: row.last_login,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by
    }
  }

  private async getRole(roleId: string): Promise<UserRole | null> {
    const result = await query('SELECT * FROM roles WHERE id = $1', [roleId])
    if (result.rows.length === 0) return null

    const row = result.rows[0]
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      permissions: JSON.parse(row.permissions || '[]'),
      isSystemRole: row.is_system_role,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private async getTeam(teamId: string): Promise<Team> {
    const result = await query('SELECT * FROM teams WHERE id = $1', [teamId])
    if (result.rows.length === 0) throw new Error('Team not found')

    const row = result.rows[0]

    // Get team members
    const membersResult = await query(`
      SELECT tm.*, u.email, u.first_name, u.last_name
      FROM team_members tm
      JOIN users u ON tm.user_id = u.id
      WHERE tm.team_id = $1
    `, [teamId])

    const members: TeamMember[] = membersResult.rows.map(m => ({
      userId: m.user_id,
      role: m.role,
      joinedAt: m.joined_at,
      addedBy: m.added_by
    }))

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      organizationId: row.organization_id,
      members,
      permissions: JSON.parse(row.permissions || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by
    }
  }

  private async getUserTeamPermissions(userId: string): Promise<Permission[]> {
    const result = await query(`
      SELECT t.permissions
      FROM team_members tm
      JOIN teams t ON tm.team_id = t.id
      WHERE tm.user_id = $1
    `, [userId])

    const allPermissions: Permission[] = []
    for (const row of result.rows) {
      allPermissions.push(...JSON.parse(row.permissions || '[]'))
    }

    return allPermissions
  }

  private async getAccessControl(
    userId: string,
    resourceType: string,
    resourceId: string
  ): Promise<AccessControl | null> {
    const result = await query(`
      SELECT * FROM access_control
      WHERE user_id = $1 AND resource_type = $2 AND resource_id = $3
      AND (expires_at IS NULL OR expires_at > NOW())
    `, [userId, resourceType, resourceId])

    if (result.rows.length === 0) return null

    const row = result.rows[0]
    return {
      userId: row.user_id,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      permissions: JSON.parse(row.permissions || '[]'),
      grantedBy: row.granted_by,
      grantedAt: row.granted_at,
      expiresAt: row.expires_at
    }
  }

  private async auditLog(
    userId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    details: Record<string, any>,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await query(`
      INSERT INTO audit_logs (
        id, user_id, action, resource_type, resource_id,
        details, ip_address, user_agent, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      this.generateId('audit'),
      userId,
      action,
      resourceType,
      resourceId,
      JSON.stringify(details),
      ipAddress || 'unknown',
      userAgent || 'unknown',
      new Date()
    ])
  }
}

// Singleton instance
export const roleManagement = new RoleManagementEngine()

/**
 * Initialize system roles
 */
export async function initializeSystemRoles(): Promise<void> {
  for (const [roleKey, roleData] of Object.entries(ROLES)) {
    const existing = await query('SELECT id FROM roles WHERE name = $1 AND is_system_role = true', [roleData.name])
    if (existing.rows.length === 0) {
      await roleManagement.createRole(
        roleData.name,
        roleData.description,
        roleData.permissions,
        undefined, // system roles have no organization
        'system'
      )
    }
  }
}

/**
 * Check user permission (convenience function)
 */
export async function hasPermission(
  userId: string,
  resource: string,
  action: string,
  resourceId?: string
): Promise<boolean> {
  return await roleManagement.checkPermission(userId, resource, action, resourceId)
}

/**
 * Get user organization
 */
export async function getUserOrganization(userId: string): Promise<Organization | null> {
  const result = await query(`
    SELECT o.* FROM organizations o
    JOIN users u ON o.id = u.organization_id
    WHERE u.id = $1
  `, [userId])

  if (result.rows.length === 0) return null

  const row = result.rows[0]
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    settings: JSON.parse(row.settings || '{}'),
    subscription: JSON.parse(row.subscription || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ownerId: row.owner_id
  }
}
