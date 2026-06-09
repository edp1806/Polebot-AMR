/**
 * ============================================================
 *  USER MANAGEMENT — TELEOPERATION PAGE
 * ============================================================
 *
 *  To ADD a new user:
 *  Add an object { username, password, role } to the USERS array below.
 *
 *  Available roles:
 *    - 'operator'  : access to teleoperation page only
 *    - 'admin'     : full access + can view all accounts
 *
 *  ⚠️  Security note: This file is client-side (frontend only).
 *      It is intended for use on a closed local network (AMR robot in lab).
 *      Never expose this file to the internet without a secure backend.
 * ============================================================
 */

export const USERS = [
  {
    username: 'polebot01',
    password: 'polebot@amr01',
    role: 'admin',
    displayName: 'Administrator'
  },
  {
    username: 'polebot02',
    password: 'polebot@amr02',
    role: 'operator',
    displayName: 'Operator 1'
  },
  {
    username: 'polebot03',
    password: 'polebot@amr03',
    role: 'operator',
    displayName: 'Operator 2'
  },
]

/**
 * Verifies credentials and returns user or null
 */
export function authenticate(username, password) {
  return USERS.find(
    u => u.username === username && u.password === password
  ) || null
}
