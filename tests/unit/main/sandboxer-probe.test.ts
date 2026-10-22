// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { probeUrl } from '../../../src/main/services/sandboxer.service'

// One local server standing in for the sandbox's Caddy and Traefik, answering
// per path the way each really does.
let server: Server
let base: string

beforeAll(async () => {
  server = createServer((req, res) => {
    switch (req.url) {
      case '/ready':
        res.writeHead(200, { via: '1.1 Caddy' }).end('<html>')
        break
      case '/app-404':
        res.writeHead(404, { via: '1.1 Caddy' }).end('not found')
        break
      case '/caddy-502':
        res.writeHead(502, { server: 'Caddy' }).end()
        break
      case '/not-built':
        res.writeHead(503, { server: 'Caddy' }).end('app has not been built in this sandbox.\n\nRun:  sandboxer build x --app app\n')
        break
      case '/busy-503':
        res.writeHead(503, { server: 'Caddy' }).end('Service Unavailable')
        break
      case '/traefik-404':
        res.writeHead(404).end('404 page not found')
        break
      case '/hang':
        break // never answers
      default:
        res.writeHead(200).end()
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server.closeAllConnections()
  server.close()
})

describe('probeUrl', () => {
  it('treats any answer from the app as ready, including its own 404', async () => {
    expect(await probeUrl(`${base}/ready`)).toBe('ready')
    expect(await probeUrl(`${base}/app-404`)).toBe('ready')
  })

  it('treats a 502 from Caddy and a route Traefik does not have yet as starting', async () => {
    expect(await probeUrl(`${base}/caddy-502`)).toBe('starting')
    expect(await probeUrl(`${base}/traefik-404`)).toBe('starting')
    expect(await probeUrl(`${base}/busy-503`)).toBe('starting')
  })

  it('recognises a front-end sandboxer has not built', async () => {
    expect(await probeUrl(`${base}/not-built`)).toBe('not-built')
  })

  it('treats no connection, or no answer in time, as starting', async () => {
    expect(await probeUrl('http://127.0.0.1:1/')).toBe('starting')
    expect(await probeUrl(`${base}/hang`, 200)).toBe('starting')
    expect(await probeUrl('not a url')).toBe('starting')
  })
})
