// Dev-only stand-in for Netlify Blobs: .data/projects/<googleSub>/<id>.json
// (git-ignored). Same auth as production, so sign-in is exercised locally too.
import fs from 'node:fs/promises'
import path from 'node:path'
import { handleProjects, projectIdFromPath } from './projects-core.js'
import { authConfig, viewerConfig, verifyRequest } from './auth.js'
import { handleShares, handleView, tokenFromPath } from './shares-core.js'

/** Key–value store on disk: key "a/b/c" → <root>/a/b/c.json. Keys are built server-side from validated parts. */
function kvFiles(root) {
  const file = (k) => path.join(root, ...k.split('/')) + '.json'
  const walk = async (dir, rel) => {
    let out = []
    let ents = []
    try {
      ents = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return out
    }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) out = out.concat(await walk(path.join(dir, e.name), r))
      else if (e.name.endsWith('.json')) out.push(r.slice(0, -5))
    }
    return out
  }
  return {
    async get(k) {
      try {
        return JSON.parse(await fs.readFile(file(k), 'utf8'))
      } catch {
        return null
      }
    },
    async set(k, v) {
      await fs.mkdir(path.dirname(file(k)), { recursive: true })
      await fs.writeFile(file(k), JSON.stringify(v, null, 2))
    },
    async del(k) {
      await fs.rm(file(k), { force: true })
    },
    async list(prefix) {
      return (await walk(root, '')).filter((k) => k.startsWith(prefix))
    },
  }
}

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
  const sharesKv = kvFiles(path.resolve('.data/shares'))
  const projectsKv = { get: (sub, id) => fileStore(path.join(base, sub)).get(id) }
  const readBody = async (req) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')
  }
  const send = (res, status, body) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify(body))
  }

  return {
    name: 'imageplayer-dev-projects-api',
    configureServer(server) {
      server.middlewares.use('/api/shares', async (req, res) => {
        try {
          let user
          try {
            user = await verifyRequest(req.headers.authorization, authConfig(env))
          } catch (e) {
            return send(res, e.status || 401, { error: e.message })
          }
          let body = null
          if (req.method === 'POST' || req.method === 'PUT') {
            try {
              body = await readBody(req)
            } catch {
              return send(res, 400, { error: 'Invalid JSON.' })
            }
          }
          const url = new URL(req.originalUrl || req.url, 'http://dev')
          const { status, body: out } = await handleShares(
            {
              method: req.method,
              token: tokenFromPath(url.pathname, 'shares'),
              body,
              query: Object.fromEntries(url.searchParams),
              user,
            },
            { shares: sharesKv, projects: projectsKv }
          )
          send(res, status, out)
        } catch (e) {
          send(res, 500, { error: e.message })
        }
      })

      server.middlewares.use('/api/view', async (req, res) => {
        try {
          const url = new URL(req.originalUrl || req.url, 'http://dev')
          const { status, body: out } = await handleView(
            {
              method: req.method,
              token: tokenFromPath(url.pathname, 'view'),
              getViewer: () => verifyRequest(req.headers.authorization, viewerConfig(env)),
            },
            { shares: sharesKv, projects: projectsKv }
          )
          send(res, status, out)
        } catch (e) {
          send(res, 500, { error: e.message })
        }
      })

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
