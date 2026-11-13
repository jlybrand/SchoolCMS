import { expect, type Locator } from '@playwright/test'

/**
 * A scheduled time is a day box and a five-minute Time list, grouped under its legend
 * (`src/admin/ScheduleTime/ScheduleTimeInput.tsx`, 2026-11-13). These take and check the
 * `datetime-local` value the dialogs keep ("2026-11-13T08:40").
 */
export const scheduleTime = (scope: Locator, legend: string): Locator =>
  scope.getByRole('group', { name: legend })

export const setScheduleTime = async (group: Locator, local: string): Promise<void> => {
  const [day = '', time = ''] = local.split('T')
  await group.getByLabel('Day').fill(day)
  await group.getByLabel('Time').selectOption(time)
}

export const expectScheduleTime = async (group: Locator, local: string): Promise<void> => {
  const [day = '', time = ''] = local.split('T')
  await expect(group.getByLabel('Day')).toHaveValue(day)
  await expect(group.getByLabel('Time')).toHaveValue(time)
}
