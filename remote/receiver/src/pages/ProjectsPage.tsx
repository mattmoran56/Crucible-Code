import { useEffect, useState } from 'react'
import { api } from '../api/wsClient'
import type { Route } from '../App'

interface Project {
  id: string
  name: string
  path: string
}

export function ProjectsPage({ navigate }: { navigate: (r: Route) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.projects
      .list()
      .then((list) => setProjects(list as Project[]))
      .catch((e) => setError(String(e)))
  }, [])

  if (error) return <div style={{ color: '#b91c1c' }}>{error}</div>
  if (!projects) return <div>Loading…</div>
  if (projects.length === 0) return <div>No projects on this instance.</div>

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Projects</h2>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {projects.map((p) => (
          <li
            key={p.id}
            style={{
              padding: 12,
              border: '1px solid rgba(0,0,0,0.08)',
              borderRadius: 8,
              marginBottom: 8,
              background: 'white',
              cursor: 'pointer',
            }}
            onClick={() => navigate({ name: 'project', projectId: p.id })}
          >
            <strong>{p.name}</strong>
            <div style={{ fontSize: 12, color: '#666' }}>{p.path}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}
