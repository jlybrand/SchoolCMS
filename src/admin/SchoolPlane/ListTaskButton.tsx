'use client'

import { Button, useAuth } from '@payloadcms/ui'

import type { AuthUser } from '@/access/types'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'

import { listTaskFor } from './school-plane'
import styles from './SchoolPlane.module.css'

/**
 * A school manager's create button on a list (`admin.components.beforeListTable`, with the
 * collection passed as a client prop): "Post an announcement" on News and announcements, "Add a
 * page" on Pages. Leads to the same task screen as the landing view. See `listTaskFor`.
 *
 * Renders nothing for the district, who keep Payload's own Create New.
 */
export const ListTaskButton = ({ collection }: { collection: string }) => {
  const { user } = useAuth()
  if (!sendsForApproval(user as AuthUser | null)) return null

  const task = listTaskFor(collection)
  if (task === null) return null

  return (
    <div className={styles.listTask}>
      <Button buttonStyle="primary" el="link" id="list-task" margin={false} to={task.href}>
        {task.label}
      </Button>
    </div>
  )
}
