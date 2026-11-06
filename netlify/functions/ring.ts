// Every minute: send the "Call me later" calls that are due as Web Push (server/schedule.ts).

import { deliverDue } from '../../server/schedule.ts'

export default async (): Promise<Response> => {
  const sent = await deliverDue()
  return new Response(JSON.stringify({ sent }))
}

export const config = { schedule: '* * * * *' }
