import 'dotenv/config'

let sql = null
if (process.env.DATABASE_URL) {
  const { neon } = await import('@neondatabase/serverless')
  sql = neon(process.env.DATABASE_URL)
}

export { sql }

export function hasDb() {
  return !!sql
}
