// Dev-only stand-in for Netlify Blobs: .data/projects/<googleSub>/<id>.json
// (git-ignored). Same auth as production, so sign-in is exercised locally too.
import fs from 'node:fs/promises'
import path from 'node:path'
import { handleProjects, projectIdFromPath } from './projects-core.js'
import { authConfig, verifyRequest } from './auth.js'

function fileStore(root) {
  const file = (id) => path.join(root, `${id}.json`)
  return {
    async list() {
      try {
        return (await fs.readdir(root)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
      } catch {
        return []
      }
    },
    async get(id) {
      try {
        return JSON.parse(await fs.readFile(file(id), 'utf8'))
      } catch {
        return null
      }
    },
    async set(id, v) {
      await fs.mkdir(root, { recursive: true })
      const tmp = `${file(id)}.tmp`
      await fs.writeFile(tmp, JSON.stringify(v, null, 2))
      await fs.rename(tmp, file(id))
    },
    async del(id) {
      await fs.rm(file(id), { force: true })
    },
  }
}

/** Projects saved before sign-in existed sit loose in .data/projects/ — hand them to the first account that signs in. */
async function adoptUnowned(base, userDir) {
  let names = []
  try {
    names = (await fs.readdir(base)).filter((f) => f.endsWith('.json'))
  } catch {
    return
  }
  if (!names.length) return
  await fs.mkdir(userDir, { recursive: true })
  for (const n of names) await fs.rename(path.join(base, n), path.join(userDir, n))
}

export function devProjectsApi({ dir = '.data/projects', env = process.env } = {}) {
  const base = path.resolve(dir)
  const send = (res, status, body) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify(body))
  }

  return {
    name: 'imageplayer-dev-projects-api',
    configureServer(server) {
      server.middlewares.use('/api/projects', async (req, res) => {
        try {
          let user
          try {
            user = await verifyRequest(req.headers.authorization, authConfig(env))
          } catch (e) {
            return send(res, e.status || 401, { error: e.message })
          }
          const userDir = path.join(base, user.sub)
          await adoptUnowned(base, userDir)

          let body = null
          if (req.method === 'PUT') {
            const chunks = []
            for await (const c of req) chunks.push(c)
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            } catch {
              return send(res, 400, { error: 'Invalid JSON.' })
            }
          }
          const { status, body: out } = await handleProjects(
            { method: req.method, id: projectIdFromPath(req.originalUrl || req.url), body, user },
            fileStore(userDir)
          )
          send(res, status, out)
        } catch (e) {
          send(res, 500, { error: e.message })
        }
      })
    },
  }
}
