import config from '@payload-config'
import {
  REST_DELETE,
  REST_GET,
  REST_OPTIONS,
  REST_PATCH,
  REST_POST,
  REST_PUT,
} from '@payloadcms/next/routes'

/* Payload's REST surface. Access control is enforced in the collection access functions,
 * not here — reads return QUERY CONSTRAINTS so lists are filtered server-side (`03` §6.2).
 * The adversarial suite hits these routes as every role on every build (`03` §6.4).
 */
export const GET = REST_GET(config)
export const POST = REST_POST(config)
export const DELETE = REST_DELETE(config)
export const PATCH = REST_PATCH(config)
export const PUT = REST_PUT(config)
export const OPTIONS = REST_OPTIONS(config)
