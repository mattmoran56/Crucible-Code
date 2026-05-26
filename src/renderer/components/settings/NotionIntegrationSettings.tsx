import React, { useEffect, useMemo, useState } from 'react'
import type {
  NotionDatabaseSchema,
  NotionFilterOperator,
  NotionIntegrationConfig,
  NotionPropertyFilter,
  NotionPropertyType,
  NotionPropertyUpdate,
  NotionRelationOption,
  NotionUser,
  Project,
} from '../../../shared/types'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Input } from '../ui/Input'
import { ToggleGroup } from '../ui/ToggleGroup'
import { useNotionStore, DEFAULT_NOTION_CONFIG } from '../../stores/notionStore'
import { useToastStore } from '../../stores/toastStore'

interface Props {
  projects: Project[]
}

export function NotionIntegrationSettings({ projects }: Props) {
  const load = useNotionStore((s) => s.load)
  const loadConfigPath = useNotionStore((s) => s.loadConfigPath)

  useEffect(() => {
    for (const p of projects) load(p.id)
    loadConfigPath()
  }, [projects, load, loadConfigPath])

  if (projects.length === 0) return null

  return (
    <div style={{ marginTop: 40 }}>
      <h1 className="text-lg font-semibold text-text" style={{ marginBottom: 4 }}>
        Notion Integration
      </h1>
      <p className="text-xs text-text-muted" style={{ marginBottom: 20 }}>
        Poll a Notion database every 5 seconds for new tasks. For each new task matching the
        configured filter, Crucible automatically creates a session and types a startup prompt into
        the agent terminal. Available placeholders:{' '}
        <code className="text-text">{'{{taskUrl}}'}</code>,{' '}
        <code className="text-text">{'{{taskTitle}}'}</code>,{' '}
        <code className="text-text">{'{{taskTitleSlug}}'}</code>,{' '}
        <code className="text-text">{'{{taskId}}'}</code>,{' '}
        <code className="text-text">{'{{branch}}'}</code>,{' '}
        <code className="text-text">{'{{sessionId}}'}</code>.
      </p>

      <div className="flex flex-col gap-2">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </div>
  )
}

const PROPERTY_TYPE_OPTIONS: { value: NotionPropertyType; label: string }[] = [
  { value: 'status', label: 'status' },
  { value: 'select', label: 'select' },
  { value: 'multi_select', label: 'multi-select' },
  { value: 'relation', label: 'relation' },
  { value: 'checkbox', label: 'checkbox' },
  { value: 'rich_text', label: 'rich text' },
  { value: 'title', label: 'title' },
  { value: 'url', label: 'URL' },
  { value: 'number', label: 'number' },
  { value: 'date', label: 'date' },
]

const FILTER_OPERATORS: { value: NotionFilterOperator; label: string }[] = [
  { value: 'equals', label: 'equals' },
  { value: 'does_not_equal', label: 'does not equal' },
  { value: 'contains', label: 'contains' },
  { value: 'does_not_contain', label: 'does not contain' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

// Notion's API only accepts certain operators per property type. Mismatches
// produce 400 errors (e.g. multi_select doesn't support `equals`).
const OPERATORS_BY_TYPE: Record<NotionPropertyType, NotionFilterOperator[]> = {
  select: ['equals', 'does_not_equal', 'is_empty', 'is_not_empty'],
  status: ['equals', 'does_not_equal', 'is_empty', 'is_not_empty'],
  multi_select: ['contains', 'does_not_contain', 'is_empty', 'is_not_empty'],
  checkbox: ['equals', 'does_not_equal'],
  rich_text: ['equals', 'does_not_equal', 'contains', 'does_not_contain', 'is_empty', 'is_not_empty'],
  title: ['equals', 'does_not_equal', 'contains', 'does_not_contain', 'is_empty', 'is_not_empty'],
  url: ['equals', 'does_not_equal', 'contains', 'does_not_contain', 'is_empty', 'is_not_empty'],
  number: ['equals', 'does_not_equal', 'is_empty', 'is_not_empty'],
  date: ['equals', 'is_empty', 'is_not_empty'],
}

function operatorsForType(type: NotionPropertyType): { value: NotionFilterOperator; label: string }[] {
  const allowed = new Set(OPERATORS_BY_TYPE[type] ?? FILTER_OPERATORS.map((o) => o.value))
  return FILTER_OPERATORS.filter((o) => allowed.has(o.value))
}

function defaultOperatorForType(type: NotionPropertyType): NotionFilterOperator {
  return OPERATORS_BY_TYPE[type]?.[0] ?? 'equals'
}

interface ProjectCardProps {
  project: Project
}

function ProjectCard({ project }: ProjectCardProps) {
  const config = useNotionStore((s) => s.configByProject[project.id])
  const schema = useNotionStore((s) => s.schemaByProject[project.id])
  const save = useNotionStore((s) => s.save)
  const loadSchema = useNotionStore((s) => s.loadSchema)
  const testConnection = useNotionStore((s) => s.testConnection)
  const clearPickedUp = useNotionStore((s) => s.clearPickedUp)
  const configPath = useNotionStore((s) => s.configPath)
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState<NotionIntegrationConfig>(DEFAULT_NOTION_CONFIG)
  const [backfill, setBackfill] = useState(false)
  const [testing, setTesting] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    if (config) setDraft(config)
  }, [config])

  const summary = useMemo(() => {
    if (!config) return 'Not configured'
    if (!config.enabled) return 'Disabled'
    if (!config.apiToken || !config.databaseId) return 'Incomplete'
    return `Polling · ${config.filters.length} filter${config.filters.length === 1 ? '' : 's'}`
  }, [config])

  const handleSave = async (override?: Partial<NotionIntegrationConfig>) => {
    const next = { ...draft, ...override }
    setDraft(next)
    await save(project.id, next, { backfill })
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1500)
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      const res = await testConnection(draft.apiToken, draft.databaseId)
      if (res.ok) {
        useToastStore
          .getState()
          .addToast('success', `Connection ok — ${res.taskCount ?? 0} task${res.taskCount === 1 ? '' : 's'} match this filter currently`)
        await loadSchema(project.id, draft.apiToken, draft.databaseId)
      } else {
        useToastStore.getState().addToast('error', res.error ?? 'Connection failed')
      }
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="border border-border rounded-md" style={{ padding: '10px 14px' }}>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-text truncate">{project.name}</p>
          <p className="text-[10px] text-text-muted truncate">{summary}</p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' },
            ]}
            value={draft.enabled ? 'on' : 'off'}
            onChange={(v) => handleSave({ enabled: v === 'on' })}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((e) => !e)}
            className="border border-border shrink-0"
            style={{ padding: '4px 10px' }}
          >
            {expanded ? 'Hide' : 'Configure'}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="flex flex-col gap-3" style={{ marginTop: 12 }}>
          <Input
            label="API token"
            type="password"
            value={draft.apiToken}
            placeholder="secret_…"
            onChange={(e) => setDraft({ ...draft, apiToken: e.target.value })}
            onBlur={() => handleSave()}
          />
          <p className="text-[10px] text-text-muted" style={{ marginTop: -8 }}>
            Create an internal integration token at{' '}
            <span className="font-mono">notion.so/profile/integrations</span> and share your
            database with it.
          </p>

          <Input
            label="Database ID (or paste a Notion DB URL)"
            value={draft.databaseId}
            placeholder="32-char id or https://notion.so/…"
            onChange={(e) => setDraft({ ...draft, databaseId: e.target.value })}
            onBlur={() => handleSave()}
          />

          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={handleTest} disabled={testing || !draft.apiToken || !draft.databaseId} className="border border-border">
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
            {savedFlash && <span className="text-[10px] text-text-muted self-center">Saved</span>}
          </div>

          <FilterEditor
            schema={schema}
            apiToken={draft.apiToken}
            filters={draft.filters}
            onChange={(filters) => handleSave({ filters })}
          />

          <UpdatesEditor
            schema={schema}
            updates={draft.pickupUpdates}
            onChange={(pickupUpdates) => handleSave({ pickupUpdates })}
          />

          <div>
            <label className="block text-xs text-text-muted mb-1.5">
              Append on pickup (markdown, optional)
            </label>
            <textarea
              value={draft.pickupAppendMarkdown ?? ''}
              onChange={(e) => setDraft({ ...draft, pickupAppendMarkdown: e.target.value })}
              onBlur={() => handleSave()}
              rows={2}
              placeholder="Picked up by Crucible — branch {{branch}}"
              className="w-full bg-bg border border-border rounded-md text-xs text-text font-mono focus:outline-none focus:border-accent"
              style={{ padding: '8px 14px', resize: 'vertical' }}
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1.5">Startup prompt template</label>
            <textarea
              value={draft.startupPromptTemplate}
              onChange={(e) => setDraft({ ...draft, startupPromptTemplate: e.target.value })}
              onBlur={() => handleSave()}
              rows={2}
              placeholder="/notion-ticket {{taskUrl}}"
              className="w-full bg-bg border border-border rounded-md text-xs text-text font-mono focus:outline-none focus:border-accent"
              style={{ padding: '8px 14px', resize: 'vertical' }}
            />
          </div>

          <Input
            label="Branch name template"
            value={draft.branchNameTemplate ?? ''}
            placeholder="notion/{{taskTitleSlug}}"
            onChange={(e) => setDraft({ ...draft, branchNameTemplate: e.target.value })}
            onBlur={() => handleSave()}
          />

          {schema && schema.properties.some((p) => p.type === 'title') && (
            <div>
              <label className="block text-xs text-text-muted mb-1.5">Title property</label>
              <select
                value={draft.titlePropertyName ?? schema.titlePropertyName}
                onChange={(e) => {
                  const titlePropertyName = e.target.value
                  setDraft({ ...draft, titlePropertyName })
                  handleSave({ titlePropertyName })
                }}
                className="bg-bg border border-border rounded-md text-xs text-text px-3 py-2 focus:outline-none focus:border-accent"
              >
                {schema.properties
                  .filter((p) => p.type === 'title')
                  .map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-text">
            <input
              type="checkbox"
              checked={backfill}
              onChange={(e) => setBackfill(e.target.checked)}
            />
            On first enable, also pick up tasks that already match (backfill backlog)
          </label>

          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => clearPickedUp(project.id)}
              className="border border-border"
            >
              Clear picked-up cache
            </Button>
          </div>

          <McpPromptBlock projectId={project.id} configPath={configPath} />
        </div>
      )}
    </div>
  )
}

interface FilterEditorProps {
  schema: NotionDatabaseSchema | undefined
  apiToken: string
  filters: NotionPropertyFilter[]
  onChange: (filters: NotionPropertyFilter[]) => void
}

function FilterEditor({ schema, apiToken, filters, onChange }: FilterEditorProps) {
  const propertyOptions = schema?.properties ?? []
  const updateAt = (i: number, patch: Partial<NotionPropertyFilter>) => {
    const next = filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f))
    onChange(next)
  }
  const remove = (i: number) => onChange(filters.filter((_, idx) => idx !== i))
  const add = () => {
    const type = (propertyOptions[0]?.type as NotionPropertyType) ?? 'rich_text'
    onChange([
      ...filters,
      { property: propertyOptions[0]?.name ?? '', type, operator: defaultOperatorForType(type), value: '' },
    ])
  }

  const operatorNeedsValue = (op: NotionFilterOperator) =>
    op !== 'is_empty' && op !== 'is_not_empty'

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs text-text-muted">Filters (ANDed; empty = no filter)</label>
        <Button variant="ghost" size="sm" onClick={add} className="border border-border" style={{ padding: '2px 8px' }}>
          + Add
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        {filters.length === 0 && (
          <p className="text-[10px] text-text-muted italic">No filter — every row in the database is picked up.</p>
        )}
        {filters.map((f, i) => {
          const isSubFilterMode = f.type === 'relation' && !!f.subFilter
          return (
          <div key={i} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            {propertyOptions.length > 0 ? (
              <select
                value={f.property}
                onChange={(e) => {
                  const prop = propertyOptions.find((p) => p.name === e.target.value)
                  const nextType = (prop?.type as NotionPropertyType) ?? f.type
                  const allowed = new Set(OPERATORS_BY_TYPE[nextType] ?? [])
                  updateAt(i, {
                    property: e.target.value,
                    type: nextType,
                    operator: allowed.has(f.operator) ? f.operator : defaultOperatorForType(nextType),
                    // Track the related DB id so the service can resolve sub-filters.
                    relationDatabaseId: nextType === 'relation' ? prop?.relationDatabaseId : undefined,
                    formulaResultType:
                      nextType === 'formula' || nextType === 'rollup' ? prop?.formulaResultType : undefined,
                    // Reset stale sub-filter / value when switching properties.
                    subFilter: undefined,
                    value: '',
                  })
                }}
                className="flex-1 bg-bg border border-border rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
              >
                {propertyOptions.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={f.property}
                onChange={(e) => updateAt(i, { property: e.target.value })}
                placeholder="property name"
                className="flex-1 bg-bg border border-border rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
              />
            )}
            <select
              value={f.type}
              onChange={(e) => {
                const nextType = e.target.value as NotionPropertyType
                const allowed = new Set(OPERATORS_BY_TYPE[nextType] ?? [])
                updateAt(i, {
                  type: nextType,
                  operator: allowed.has(f.operator) ? f.operator : defaultOperatorForType(nextType),
                })
              }}
              className="bg-bg border border-border rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
            >
              {PROPERTY_TYPE_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            {!isSubFilterMode && (
              <select
                value={f.operator}
                onChange={(e) => updateAt(i, { operator: e.target.value as NotionFilterOperator })}
                className="bg-bg border border-border rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
              >
                {FILTER_OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
            )}
            {(isSubFilterMode || operatorNeedsValue(f.operator)) && (
              <FilterValueInput
                schema={schema}
                apiToken={apiToken}
                filter={f}
                onChange={(value) => updateAt(i, { value })}
                onPatch={(patch) => updateAt(i, patch)}
              />
            )}
            <IconButton label="Remove" size="sm" variant="danger" onClick={() => remove(i)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </IconButton>
          </div>
          {isSubFilterMode && f.subFilter && f.relationDatabaseId && (
            <div style={{ paddingLeft: 24 }}>
              <SubFilterRow
                apiToken={apiToken}
                relatedDatabaseId={f.relationDatabaseId}
                filter={f.subFilter}
                onChange={(next) => updateAt(i, { subFilter: next })}
              />
            </div>
          )}
          </div>
          )
        })}
      </div>
    </div>
  )
}

function FilterValueInput({
  schema,
  apiToken,
  filter,
  onChange,
  onPatch,
}: {
  schema: NotionDatabaseSchema | undefined
  apiToken: string
  filter: NotionPropertyFilter
  onChange: (value: string | boolean | number) => void
  onPatch: (patch: Partial<NotionPropertyFilter>) => void
}) {
  const prop = schema?.properties.find((p) => p.name === filter.property)
  if (prop && (prop.type === 'select' || prop.type === 'status' || prop.type === 'multi_select') && prop.options) {
    return (
      <select
        value={String(filter.value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="bg-bg border border-border rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
      >
        <option value="">—</option>
        {prop.options.map((o) => (
          <option key={o.id} value={o.name}>
            {o.name}
          </option>
        ))}
      </select>
    )
  }
  if (prop && prop.type === 'relation' && prop.relationDatabaseId) {
    return (
      <RelationValueOrSubFilter
        apiToken={apiToken}
        databaseId={prop.relationDatabaseId}
        filter={filter}
        onChangeValue={onChange}
        onPatch={onPatch}
      />
    )
  }
  if (prop && prop.type === 'people') {
    return (
      <PeopleValueInput apiToken={apiToken} value={String(filter.value ?? '')} onChange={onChange} />
    )
  }
  if (filter.type === 'checkbox' || ((filter.type === 'formula' || filter.type === 'rollup') && filter.formulaResultType === 'boolean')) {
    return (
      <select
        value={String(filter.value ?? 'false')}
        onChange={(e) => onChange(e.target.value === 'true')}
        className="bg-bg border border-border rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
      >
        <option value="true">checked</option>
        <option value="false">unchecked</option>
      </select>
    )
  }
  return (
    <input
      value={String(filter.value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      placeholder="value"
      className="flex-1 bg-bg border border-border rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
    />
  )
}

// Cache so we don't refetch the same related-DB pages / schema each render.
const relationOptionsCache = new Map<string, Promise<NotionRelationOption[]>>()
const relationSchemaCache = new Map<string, Promise<NotionDatabaseSchema>>()

function useRelatedSchema(apiToken: string, databaseId: string): NotionDatabaseSchema | null {
  const [schema, setSchema] = useState<NotionDatabaseSchema | null>(null)
  useEffect(() => {
    if (!apiToken || !databaseId) return
    const key = `${apiToken}:${databaseId}`
    let cancelled = false
    let promise = relationSchemaCache.get(key)
    if (!promise) {
      promise = window.api.notion.getDatabaseSchema(apiToken, databaseId)
      relationSchemaCache.set(key, promise)
    }
    promise
      .then((s) => {
        if (!cancelled) setSchema(s)
      })
      .catch(() => {
        relationSchemaCache.delete(key)
      })
    return () => {
      cancelled = true
    }
  }, [apiToken, databaseId])
  return schema
}

function RelationValueOrSubFilter({
  apiToken,
  databaseId,
  filter,
  onChangeValue,
  onPatch,
}: {
  apiToken: string
  databaseId: string
  filter: NotionPropertyFilter
  onChangeValue: (value: string) => void
  onPatch: (patch: Partial<NotionPropertyFilter>) => void
}) {
  const mode: 'page' | 'sub' = filter.subFilter ? 'sub' : 'page'
  const relatedSchema = useRelatedSchema(apiToken, databaseId)

  const enterSubMode = () => {
    const firstProp = relatedSchema?.properties[0]
    const innerType = (firstProp?.type as NotionPropertyType) ?? 'rich_text'
    onPatch({
      value: '',
      subFilter: {
        property: firstProp?.name ?? '',
        type: innerType,
        operator: defaultOperatorForType(innerType),
        value: '',
      },
    })
  }
  const exitSubMode = () => onPatch({ subFilter: undefined })

  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex border border-border rounded-md overflow-hidden text-[11px] shrink-0">
        <button
          type="button"
          onClick={() => mode === 'sub' && exitSubMode()}
          style={{ padding: '4px 10px' }}
          className={`${mode === 'page' ? 'bg-accent text-bg' : 'bg-bg text-text-muted hover:text-text'}`}
        >
          page
        </button>
        <button
          type="button"
          onClick={() => mode === 'page' && enterSubMode()}
          style={{ padding: '4px 10px' }}
          className={`${mode === 'sub' ? 'bg-accent text-bg' : 'bg-bg text-text-muted hover:text-text'}`}
        >
          where
        </button>
      </div>
      {mode === 'page' && (
        <RelationValueInput
          apiToken={apiToken}
          databaseId={databaseId}
          value={String(filter.value ?? '')}
          onChange={onChangeValue}
        />
      )}
    </div>
  )
}

function SubFilterRow({
  apiToken,
  relatedDatabaseId,
  filter,
  onChange,
}: {
  apiToken: string
  relatedDatabaseId: string
  filter: NotionPropertyFilter
  onChange: (filter: NotionPropertyFilter) => void
}) {
  const schema = useRelatedSchema(apiToken, relatedDatabaseId)
  const propertyOptions = schema?.properties ?? []
  const operatorNeedsValue = (op: NotionFilterOperator) =>
    op !== 'is_empty' && op !== 'is_not_empty'
  const patch = (p: Partial<NotionPropertyFilter>) => onChange({ ...filter, ...p })
  const prop = propertyOptions.find((p) => p.name === filter.property)

  // Race: if the user clicked `where` before the related schema loaded, the
  // sub-filter is sitting with an empty property + default `rich_text` type.
  // Once the schema arrives, snap to the first real property so the value
  // input reflects the actual type (people / checkbox / select / etc).
  useEffect(() => {
    if (propertyOptions.length === 0) return
    if (prop) return
    const first = propertyOptions[0]
    const firstType = (first.type as NotionPropertyType) ?? 'rich_text'
    onChange({
      ...filter,
      property: first.name,
      type: firstType,
      operator: defaultOperatorForType(firstType),
      value: '',
      formulaResultType:
        firstType === 'formula' || firstType === 'rollup' ? first.formulaResultType : undefined,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyOptions.length, prop?.name])
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-text-muted" style={{ minWidth: 40 }}>where</span>
      {propertyOptions.length > 0 ? (
        <select
          value={filter.property}
          onChange={(e) => {
            const p = propertyOptions.find((x) => x.name === e.target.value)
            const nextType = (p?.type as NotionPropertyType) ?? filter.type
            patch({
              property: e.target.value,
              type: nextType,
              operator: defaultOperatorForType(nextType),
              value: '',
              formulaResultType:
                nextType === 'formula' || nextType === 'rollup' ? p?.formulaResultType : undefined,
            })
          }}
          className="flex-1 bg-bg border border-border rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
        >
          {propertyOptions.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-[11px] text-text-muted italic">Loading related schema…</span>
      )}
      <select
        value={filter.operator}
        onChange={(e) => patch({ operator: e.target.value as NotionFilterOperator })}
        className="bg-bg border border-border rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
      >
        {FILTER_OPERATORS.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>
      {operatorNeedsValue(filter.operator) &&
        (prop && prop.type === 'people' ? (
          <PeopleValueInput
            apiToken={apiToken}
            value={String(filter.value ?? '')}
            onChange={(v) => patch({ value: v })}
          />
        ) : prop && (prop.type === 'select' || prop.type === 'status' || prop.type === 'multi_select') && prop.options ? (
          <select
            value={String(filter.value ?? '')}
            onChange={(e) => patch({ value: e.target.value })}
            className="bg-bg border border-border rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
          >
            <option value="">—</option>
            {prop.options.map((o) => (
              <option key={o.id} value={o.name}>
                {o.name}
              </option>
            ))}
          </select>
        ) : filter.type === 'checkbox' || ((filter.type === 'formula' || filter.type === 'rollup') && filter.formulaResultType === 'boolean') ? (
          <select
            value={String(filter.value ?? 'false')}
            onChange={(e) => patch({ value: e.target.value === 'true' })}
            className="bg-bg border border-border rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
          >
            <option value="true">checked</option>
            <option value="false">unchecked</option>
          </select>
        ) : (
          <input
            value={String(filter.value ?? '')}
            onChange={(e) => patch({ value: e.target.value })}
            placeholder="value"
            className="flex-1 bg-bg border border-border rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
          />
        ))}
    </div>
  )
}

const usersCache = new Map<string, Promise<NotionUser[]>>()

function PeopleValueInput({
  apiToken,
  value,
  onChange,
}: {
  apiToken: string
  value: string
  onChange: (value: string) => void
}) {
  const [users, setUsers] = useState<NotionUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!apiToken) return
    let cancelled = false
    let promise = usersCache.get(apiToken)
    if (!promise) {
      promise = window.api.notion.listUsers(apiToken)
      usersCache.set(apiToken, promise)
    }
    promise
      .then((u) => {
        if (!cancelled) setUsers(u)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          usersCache.delete(apiToken)
        }
      })
    return () => {
      cancelled = true
    }
  }, [apiToken])

  if (error) {
    return (
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="user id"
        title={`Couldn't fetch users: ${error}`}
        className="flex-1 bg-bg border border-danger rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
      />
    )
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-bg border border-border rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
    >
      <option value="">{users ? '—' : 'Loading users…'}</option>
      {(users ?? []).map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </select>
  )
}

function RelationValueInput({
  apiToken,
  databaseId,
  value,
  onChange,
}: {
  apiToken: string
  databaseId: string
  value: string
  onChange: (value: string) => void
}) {
  const [options, setOptions] = useState<NotionRelationOption[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!apiToken || !databaseId) return
    const key = `${apiToken}:${databaseId}`
    let cancelled = false
    let promise = relationOptionsCache.get(key)
    if (!promise) {
      promise = window.api.notion.listRelationOptions(apiToken, databaseId)
      relationOptionsCache.set(key, promise)
    }
    promise
      .then((opts) => {
        if (!cancelled) setOptions(opts)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          relationOptionsCache.delete(key)
        }
      })
    return () => {
      cancelled = true
    }
  }, [apiToken, databaseId])

  if (error) {
    return (
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="page id"
        title={`Couldn't fetch related pages: ${error}`}
        className="flex-1 bg-bg border border-danger rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
      />
    )
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-bg border border-border rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
    >
      <option value="">{options ? '—' : 'Loading…'}</option>
      {(options ?? []).map((o) => (
        <option key={o.id} value={o.id}>
          {o.title || o.id}
        </option>
      ))}
    </select>
  )
}

interface UpdatesEditorProps {
  schema: NotionDatabaseSchema | undefined
  updates: NotionPropertyUpdate[]
  onChange: (updates: NotionPropertyUpdate[]) => void
}

function UpdatesEditor({ schema, updates, onChange }: UpdatesEditorProps) {
  const propertyOptions = schema?.properties ?? []
  const updateAt = (i: number, patch: Partial<NotionPropertyUpdate>) => {
    const next = updates.map((u, idx) => (idx === i ? { ...u, ...patch } : u))
    onChange(next)
  }
  const remove = (i: number) => onChange(updates.filter((_, idx) => idx !== i))
  const add = () =>
    onChange([
      ...updates,
      { property: propertyOptions[0]?.name ?? '', type: (propertyOptions[0]?.type as NotionPropertyType) ?? 'rich_text', value: '' },
    ])

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs text-text-muted">
          Property updates on pickup (placeholders ok)
        </label>
        <Button variant="ghost" size="sm" onClick={add} className="border border-border" style={{ padding: '2px 8px' }}>
          + Add
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        {updates.map((u, i) => (
          <div key={i} className="flex items-center gap-2">
            {propertyOptions.length > 0 ? (
              <select
                value={u.property}
                onChange={(e) => {
                  const prop = propertyOptions.find((p) => p.name === e.target.value)
                  updateAt(i, {
                    property: e.target.value,
                    type: (prop?.type as NotionPropertyType) ?? u.type,
                  })
                }}
                className="flex-1 bg-bg border border-border rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
              >
                {propertyOptions.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={u.property}
                onChange={(e) => updateAt(i, { property: e.target.value })}
                placeholder="property name"
                className="flex-1 bg-bg border border-border rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
              />
            )}
            <select
              value={u.type}
              onChange={(e) => updateAt(i, { type: e.target.value as NotionPropertyType })}
              className="bg-bg border border-border rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
            >
              {PROPERTY_TYPE_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <UpdateValueInput
              schema={schema}
              update={u}
              onChange={(value) => updateAt(i, { value })}
            />
            <IconButton label="Remove" size="sm" variant="danger" onClick={() => remove(i)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  )
}

function UpdateValueInput({
  schema,
  update,
  onChange,
}: {
  schema: NotionDatabaseSchema | undefined
  update: NotionPropertyUpdate
  onChange: (value: string) => void
}) {
  const prop = schema?.properties.find((p) => p.name === update.property)
  if (prop && (prop.type === 'select' || prop.type === 'status') && prop.options) {
    return (
      <select
        value={update.value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-bg border border-border rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
      >
        <option value="">—</option>
        {prop.options.map((o) => (
          <option key={o.id} value={o.name}>
            {o.name}
          </option>
        ))}
      </select>
    )
  }
  return (
    <input
      value={update.value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="value (placeholders ok)"
      className="flex-1 bg-bg border border-border rounded-md text-xs text-text px-2 py-1.5 focus:outline-none focus:border-accent"
    />
  )
}

interface McpPromptBlockProps {
  projectId: string
  configPath: string | null
}

function buildCreatePrompt(projectId: string, configPath: string): string {
  return `You have access to the Notion MCP and filesystem tools. Help me set up
Crucible-Code's Notion task integration for project id "${projectId}".

1. Using the Notion MCP, create a new database called "Crucible Tasks" with:
     - Task (title)
     - Status (status, with options: Ready, In Progress, Done)
     - Crucible Branch (URL)
   Tell me the new database's id.

2. Ask me for my Notion internal-integration token (do not guess).

3. Open the JSON file at:
       ${configPath}
   Read it, then set the entry configByProject["${projectId}"] to:
   {
     "enabled": true,
     "apiToken": "<the token from step 2>",
     "databaseId": "<the id from step 1>",
     "filters": [{ "property": "Status", "type": "status", "operator": "equals", "value": "Ready" }],
     "pickupUpdates": [
       { "property": "Status", "type": "status", "value": "In Progress" },
       { "property": "Crucible Branch", "type": "url", "value": "https://github.com/<owner>/<repo>/tree/{{branch}}" }
     ],
     "startupPromptTemplate": "/notion-ticket {{taskUrl}}",
     "branchNameTemplate": "notion/{{taskTitleSlug}}",
     "titlePropertyName": "Task"
   }
   Preserve every other key in configByProject. Write the file back.

4. Confirm the file was written. Crucible will pick up the new config within 5 seconds automatically — no restart needed.`
}

function buildExistingPrompt(projectId: string, configPath: string): string {
  return `You have access to the Notion MCP and filesystem tools. Help me wire
Crucible-Code's Notion task integration to my existing Notion database
called "<DB NAME>" for project id "${projectId}".

1. Using the Notion MCP, search for a database whose title matches "<DB NAME>"
   and return its id. If there are multiple matches, list them and ask me
   which one before continuing.

2. Fetch the schema of that database (property names + types + status/select
   options). Show me the schema, then propose:
     - which property to use as the "trigger" (the value of Status, or whatever
       I'm using to mark a task as ready to pick up),
     - which property to flip on pickup, and to what value,
     - which property (if any) to write the Crucible branch URL into.
   Wait for my confirmation before continuing.

3. Ask me for my Notion internal-integration token (do not guess).

4. Open the JSON file at:
       ${configPath}
   Read it, then set the entry configByProject["${projectId}"] to a NotionIntegrationConfig built from the choices in step 2. Use this shape (fill in the values from the schema you fetched):
   {
     "enabled": true,
     "apiToken": "<the token from step 3>",
     "databaseId": "<the id from step 1>",
     "filters": [/* property + type + operator + value from step 2 */],
     "pickupUpdates": [/* one or more {property, type, value}, including
                          "{{branch}}" if I asked for the branch URL */],
     "startupPromptTemplate": "/notion-ticket {{taskUrl}}",
     "branchNameTemplate": "notion/{{taskTitleSlug}}",
     "titlePropertyName": "<the title-type property from the fetched schema>"
   }
   Preserve every other key in configByProject. Write the file back.

5. Confirm the file was written. Crucible will pick up the new config within 5 seconds automatically — no restart needed.`
}

function McpPromptBlock({ projectId, configPath }: McpPromptBlockProps) {
  const [open, setOpen] = useState(false)
  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      useToastStore.getState().addToast('success', `${label} copied`)
    } catch (err) {
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    }
  }

  const createPrompt = configPath ? buildCreatePrompt(projectId, configPath) : ''
  const existingPrompt = configPath ? buildExistingPrompt(projectId, configPath) : ''

  return (
    <div className="border border-border rounded-md" style={{ padding: '8px 12px', marginTop: 4 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-text font-medium flex items-center justify-between w-full focus:outline-none"
      >
        <span>Set up automatically via Notion MCP</span>
        <span className="text-text-muted">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2" style={{ marginTop: 8 }}>
          <p className="text-[10px] text-text-muted">
            Paste one of these prompts into a Claude (or other) coding agent that has the Notion MCP
            and filesystem tools. The agent will create / locate the database, ask you for a token,
            and edit Crucible's config file directly — Crucible reloads within 5s.
          </p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-text">Create a new Notion database</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleCopy(createPrompt, 'New-DB prompt')}
              disabled={!configPath}
              className="border border-border"
            >
              Copy
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-text">
              Use my existing database <span className="text-text-muted">(replace <code>&lt;DB NAME&gt;</code>)</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleCopy(existingPrompt, 'Existing-DB prompt')}
              disabled={!configPath}
              className="border border-border"
            >
              Copy
            </Button>
          </div>
          {configPath && (
            <p className="text-[10px] text-text-muted font-mono truncate" title={configPath}>
              {configPath}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
